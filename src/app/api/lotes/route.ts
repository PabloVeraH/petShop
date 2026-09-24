import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { LoteCreateSchema } from "@/lib/validation";
import { mapearErrorStock } from "@/lib/stock-errors";
import type { RegistrarLoteResultado } from "@/types";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { storeId, userId } = ctx;
  const supabase = createServiceClient();

  const { searchParams } = req.nextUrl;
  const productoId  = searchParams.get("producto_id");
  const soloActivos = searchParams.get("activo") !== "0";
  const conStock    = searchParams.get("con_stock") === "1";

  let query = supabase
    .from("lotes_producto")
    .select("*, producto:productos(id, nombre, sku, stock, dias_alerta_expira)")
    .eq("store_id", storeId);

  if (soloActivos !== false) query = query.eq("activo", true);
  if (productoId)  query = query.eq("producto_id", productoId);
  if (conStock)    query = query.gt("cantidad_actual", 0);

  query = query.order("fecha_vencimiento", { ascending: true });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ lotes: data ?? [] });
}, { endpoint: "GET /api/lotes" });

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { storeId, userId } = ctx;

  // S11: registrar stock es una acción de administración — el menú ya oculta
  // Inventario a storeWorker, pero eso es solo UX; el control real es este.
  const { sessionClaims } = await auth();
  try {
    requireStoreAdmin(getAdminStatus(sessionClaims), storeId);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = LoteCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const d = parsed.data;

  const { data: prod } = await supabase
    .from("productos")
    .select("id, nombre")
    .eq("id", d.producto_id)
    .eq("store_id", storeId)
    .single();
  if (!prod) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  // D11 (S6): registrar_lote convierte el stock suelto existente en "LOTE-0"
  // y crea el lote nuevo en UNA transacción — antes, el INSERT directo hacía
  // que el trigger recalculara stock = Σ lotes y se perdiera el stock suelto.
  const { data: resultado, error } = await supabase.rpc("registrar_lote", {
    p_store_id:                   storeId,
    p_producto_id:                d.producto_id,
    p_cantidad_inicial:           d.cantidad_inicial,
    p_cantidad_actual:            d.cantidad_actual ?? d.cantidad_inicial,
    p_fecha_vencimiento:          d.fecha_vencimiento,
    p_user_id:                    userId,
    p_numero_lote:                d.numero_lote ?? null,
    p_fecha_ingreso:              d.fecha_ingreso ?? null,
    p_orden_compra_id:            d.orden_compra_id ?? null,
    p_notas:                      d.notas ?? null,
    p_fecha_venc_stock_existente: d.fecha_vencimiento_stock_existente ?? null,
  });

  if (error) {
    const mapped = mapearErrorStock(error.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const { lote, lote_inicial } = resultado as RegistrarLoteResultado;

  // MEJORA (ticket Trello 6a62eb37bfe280fc94919d5e): mismo defecto reportado
  // para "lotes_producto" en ordenes-compra/[id]/route.ts — changeDescription
  // ausente. Se corrige aquí también (llamador similar del mismo logAudit).
  const { ipAddress, userAgent } = getRequestMetadata(req);
  if (lote_inicial) {
    await logAudit({
      storeId,
      userId: userId || "unknown",
      action: "CREATE",
      entityType: "lote_producto",
      entityId: lote_inicial.id,
      newValues: { ...lote_inicial },
      changeDescription: `Stock existente convertido a lote inicial: ${prod.nombre} × ${lote_inicial.cantidad_inicial} unidades`,
      ipAddress,
      userAgent,
      result: "success",
    });
  }
  await logAudit({
    storeId,
    userId: userId || "unknown",
    action: "CREATE",
    entityType: "lote_producto",
    entityId: lote.id,
    newValues: { ...lote },
    changeDescription: `Lote creado manualmente: ${prod.nombre} × ${lote.cantidad_inicial} unidades`,
    ipAddress,
    userAgent,
    result: "success",
  });

  return NextResponse.json({ lote, lote_inicial }, { status: 201 });
}, { endpoint: "POST /api/lotes" });