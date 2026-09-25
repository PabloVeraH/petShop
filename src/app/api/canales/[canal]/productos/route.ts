import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { UUIDSchema } from "@/lib/validation";
import { esCanalExterno, type CanalExternoId } from "@/lib/canales/domain/types";
import { precioBase, precioCanal } from "@/lib/canales/domain/precio";
import { autorizarCanales } from "@/lib/canales/infrastructure/autorizacion";

// Catálogo por canal (paso 4.3). Configurar catálogo y precios es solo para
// storeAdmin/systemAdmin no deshabilitados (D8, 5.1), validado aquí. Tenant: todo filtra por el
// store_id de la sesión; un producto de otra tienda responde 404.

type Params = { params: Promise<{ canal: string }> };

type Contexto =
  | { error: NextResponse; ctx?: never; canal?: never }
  | { error?: never; ctx: { storeId: string; userId: string }; canal: CanalExternoId };

async function contexto(params: Params["params"]): Promise<Contexto> {
  const r = await autorizarCanales({ soloAdmin: true });
  if (!r.ok) return { error: r.response };
  const ctx = { storeId: r.storeId, userId: r.userId };

  const { canal } = await params;
  if (!esCanalExterno(canal)) return { error: NextResponse.json({ error: "Canal no encontrado" }, { status: 404 }) };
  return { ctx, canal };
}

function precioCalculado(
  p: { precio: number | null; precio_oferta: number | null; en_oferta: boolean | null },
  recargoPct: number,
  override: number | null
): number | null {
  const base = precioBase(p);
  if (!(override != null && override > 0) && !(base != null && base > 0)) return null;
  return precioCanal(base ?? 0, recargoPct, override);
}

export const GET = withErrorLogging(async (_req: NextRequest, { params }: Params) => {
  const r = await contexto(params);
  if (r.error) return r.error;
  const { ctx, canal } = r;
  const supabase = createServiceClient();

  const { data: config } = await supabase
    .from("canal_config")
    .select("activo, recargo_pct")
    .eq("store_id", ctx.storeId)
    .eq("canal_id", canal)
    .maybeSingle();
  if (!config) return NextResponse.json({ error: "Canal no configurado" }, { status: 404 });
  const recargoPct = Number(config.recargo_pct ?? 0);

  const [productosRes, configsRes, cuposRes] = await Promise.all([
    supabase
      .from("productos")
      .select("id, nombre, sku, precio, precio_oferta, en_oferta, stock, stock_minimo, activo")
      .eq("store_id", ctx.storeId)
      .order("nombre", { ascending: true }),
    supabase
      .from("canal_producto_config")
      .select("producto_id, activo, precio_override, publicado_at, ultimo_disponible_publicado, disponibilidad_publicada_at")
      .eq("store_id", ctx.storeId)
      .eq("canal_id", canal),
    supabase.rpc("cupos_canal_tienda", { p_store_id: ctx.storeId }),
  ]);
  if (productosRes.error || configsRes.error || cuposRes.error) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const configs = new Map((configsRes.data ?? []).map((c) => [c.producto_id as string, c]));
  const cupos = new Map(
    ((cuposRes.data ?? []) as { producto_id: string; cupo: number }[]).map((c) => [c.producto_id, Number(c.cupo)])
  );

  const productos = (productosRes.data ?? [])
    .filter((p) => p.activo !== false)
    .map((p) => {
      const c = configs.get(p.id);
      const override = c?.precio_override != null ? Number(c.precio_override) : null;
      return {
        producto_id: p.id,
        nombre: p.nombre,
        sku: p.sku,
        precio_base: precioBase(p),
        precio_override: override,
        precio_canal: precioCalculado(p, recargoPct, override),
        habilitado: c?.activo ?? false,
        publicado_at: c?.publicado_at ?? null,
        disponible_publicado: c?.ultimo_disponible_publicado ?? null,
        disponibilidad_publicada_at: c?.disponibilidad_publicada_at ?? null,
        stock: p.stock != null ? Number(p.stock) : 0,
        stock_minimo: p.stock_minimo ?? 0,
        cupo: cupos.get(p.id) ?? 0,
      };
    });

  return NextResponse.json({ canal, activo: !!config.activo, recargo_pct: recargoPct, productos });
}, { endpoint: "GET /api/canales/canal/productos" });

// precio_override: CLP entero con IVA (AGENTS.md §23.3); null = usar el
// recargo del canal. Ausente = no cambiar.
const putSchema = z
  .object({
    producto_id: UUIDSchema,
    habilitado: z.boolean(),
    precio_override: z.number().int().positive().max(100_000_000).nullable().optional(),
  })
  .strict();

export const PUT = withErrorLogging(async (req: NextRequest, { params }: Params) => {
  const r = await contexto(params);
  if (r.error) return r.error;
  const { ctx, canal } = r;

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { producto_id, habilitado, precio_override } = parsed.data;
  const supabase = createServiceClient();

  // Ownership: el producto debe ser de la tienda de la sesión.
  const { data: producto } = await supabase
    .from("productos")
    .select("id, nombre")
    .eq("id", producto_id)
    .eq("store_id", ctx.storeId)
    .maybeSingle();
  if (!producto) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const { data: existente } = await supabase
    .from("canal_producto_config")
    .select("id, activo, precio_override")
    .eq("store_id", ctx.storeId)
    .eq("canal_id", canal)
    .eq("producto_id", producto_id)
    .maybeSingle();

  const cambios: Record<string, unknown> = { activo: habilitado, updated_at: new Date().toISOString() };
  if (precio_override !== undefined) cambios.precio_override = precio_override;

  let fila;
  if (existente) {
    const { data, error } = await supabase
      .from("canal_producto_config")
      .update(cambios)
      .eq("id", existente.id)
      .eq("store_id", ctx.storeId)
      .select("id, activo, precio_override")
      .single();
    if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    fila = data;
  } else {
    // store_id desde la sesión, después del spread (AGENTS.md §6.2).
    const { data, error } = await supabase
      .from("canal_producto_config")
      .insert({ ...cambios, canal_id: canal, producto_id, store_id: ctx.storeId })
      .select("id, activo, precio_override")
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "El producto se modificó al mismo tiempo; reintenta" }, { status: 409 });
      }
      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
    fila = data;
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId: ctx.userId,
    action: existente ? "UPDATE" : "CREATE",
    entityType: "canal_producto_config",
    entityId: fila.id,
    changeDescription: `${producto.nombre} en ${canal}: ${habilitado ? "habilitado" : "deshabilitado"}` +
      (precio_override !== undefined ? `, precio override ${precio_override ?? "sin override"}` : ""),
    oldValues: existente ? { activo: existente.activo, precio_override: existente.precio_override } : undefined,
    newValues: { activo: fila.activo, precio_override: fila.precio_override },
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json({
    producto_id,
    habilitado: fila.activo,
    precio_override: fila.precio_override != null ? Number(fila.precio_override) : null,
  });
}, { endpoint: "PUT /api/canales/canal/productos" });
