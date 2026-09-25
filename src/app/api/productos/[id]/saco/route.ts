import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { syncProductsToHub } from "@/lib/hub-sync";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { SacoAccionSchema, UUIDSchema } from "@/lib/validation";
import { mapearErrorStock } from "@/lib/stock-errors";
import type { SacoAccionResultado } from "@/types";

// Granel (§4.6, D18/D19) — acciones sobre el saco abierto de un producto:
//   abrir    D18: "Abrí un saco nuevo" (cualquier usuario de la tienda — lo
//            usa el POS). La BD rechaza si el saco abierto aún tiene gramos
//            (primero la merma del resto, G6). No cambia el stock total.
//   merma    G6: da de baja los gramos restantes y guarda quién la registró.
//   deshacer G2: solo storeAdmin/systemAdmin (validado aquí; la BD además
//            rechaza sacos con ventas o con gramos que ya cambiaron).
// Todas las RPC filtran por store_id: producto de otra tienda → 404.
export const POST = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId, userId } = ctx;

  const { id } = await params;
  if (!UUIDSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = SacoAccionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const input = parsed.data;

  if (input.accion === "deshacer") {
    const { sessionClaims } = await auth();
    try {
      requireStoreAdmin(getAdminStatus(sessionClaims), storeId);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const supabase = createServiceClient();
  const { data, error } =
    input.accion === "abrir"
      ? await supabase.rpc("abrir_saco", {
          p_store_id:    storeId,
          p_producto_id: id,
          p_user_id:     userId,
          p_nota:        input.nota ?? null,
        })
      : input.accion === "merma"
        ? await supabase.rpc("cerrar_saco_merma", {
            p_store_id:    storeId,
            p_producto_id: id,
            p_motivo:      input.motivo,
            p_user_id:     userId,
          })
        : await supabase.rpc("deshacer_apertura_saco", {
            p_store_id:    storeId,
            p_producto_id: id,
            p_user_id:     userId,
          });

  const { ipAddress, userAgent } = getRequestMetadata(req);

  if (error) {
    const mapped = mapearErrorStock(error.message);
    if (mapped.status === 500) {
      logAudit({
        storeId,
        userId,
        action: "UPDATE",
        entityType: "saco_abierto",
        entityId: id,
        changeDescription: `Error en acción de saco (${input.accion})`,
        ipAddress,
        userAgent,
        result: "failure",
        errorMessage: error.message,
      }).catch(() => {});
    }
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const resultado = data as SacoAccionResultado;
  const descripcion =
    input.accion === "abrir"
      ? `Apertura de saco (${resultado.saco.gramos_iniciales} g)${input.nota ? `: ${input.nota}` : ""}`
      : input.accion === "merma"
        ? `Merma de saco abierto: ${resultado.gramos_merma ?? 0} g. Motivo: ${input.motivo}`
        : "Apertura de saco deshecha";

  logAudit({
    storeId,
    userId,
    action: "UPDATE",
    entityType: "saco_abierto",
    entityId: resultado.saco.id,
    newValues: { ...resultado.saco, stock: resultado.stock },
    changeDescription: descripcion,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  // Solo la merma cambia el stock total (abrir y deshacer lo conservan).
  if (input.accion === "merma") {
    const { data: prod } = await supabase
      .from("productos")
      .select("id, nombre, marca, precio, stock, activo, codigo_barra, tipo_animal, peso_gramos, en_oferta, precio_oferta, imagen_url, categorias(nombre)")
      .eq("id", id)
      .eq("store_id", storeId)
      .single();

    if (prod) {
      syncProductsToHub([{
        producto_id: prod.id,
        nombre_producto: prod.nombre,
        marca: prod.marca ?? undefined,
        codigo_barra: prod.codigo_barra ?? null,
        precio: Number(prod.precio),
        stock: prod.stock,
        tipo_animal: prod.tipo_animal ?? undefined,
        peso_gramos: prod.peso_gramos ?? undefined,
        precio_oferta: prod.precio_oferta ? Number(prod.precio_oferta) : undefined,
        en_oferta: prod.en_oferta ?? false,
        categoria: (prod.categorias as unknown as { nombre: string } | null)?.nombre ?? undefined,
        imagen_url: prod.imagen_url ?? null,
        activo: prod.activo ?? true,
      }]);
    }
  }

  return NextResponse.json(resultado);
}, { endpoint: "POST /api/productos/id/saco" });
