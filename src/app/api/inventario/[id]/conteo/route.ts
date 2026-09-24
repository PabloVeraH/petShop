import { getStoreId } from "@/lib/auth";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { syncProductsToHub } from "@/lib/hub-sync";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { ConteoFisicoSchema, UUIDSchema } from "@/lib/validation";
import { mapearErrorStock } from "@/lib/stock-errors";
import type { AjusteConteoResultado } from "@/types";

// D22 — Ajuste por conteo físico: fija el stock al valor contado (por lote si
// el producto tiene lotes), con motivo obligatorio, stock_movements
// 'ajuste_conteo' y auditoría. Solo storeAdmin/systemAdmin, validado aquí
// (el botón oculto en la UI es solo conveniencia). Endpoint separado del
// PATCH de entrada/salida a propósito: "fijar al valor contado" no es un
// delta, y permite corregir stocks con decimales heredados (S9).
export const POST = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId, userId } = ctx;

  const { sessionClaims } = await auth();
  try {
    requireStoreAdmin(getAdminStatus(sessionClaims), storeId);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!UUIDSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = ConteoFisicoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { stock_contado, lote_id, motivo } = parsed.data;

  const supabase = createServiceClient();

  // El RPC filtra por store_id (producto de otra tienda → "Producto no
  // encontrado" → 404, sin confirmar que exista).
  const { data, error } = await supabase.rpc("ajustar_stock_conteo", {
    p_store_id:      storeId,
    p_producto_id:   id,
    p_lote_id:       lote_id ?? null,
    p_stock_contado: stock_contado,
    p_motivo:        motivo,
    p_user_id:       userId,
  });

  const { ipAddress, userAgent } = getRequestMetadata(req);

  if (error) {
    const mapped = mapearErrorStock(error.message);
    if (mapped.status === 500) {
      logAudit({
        storeId,
        userId,
        action: "UPDATE",
        entityType: "inventario",
        entityId: id,
        changeDescription: "Error en ajuste por conteo físico",
        ipAddress,
        userAgent,
        result: "failure",
        errorMessage: error.message,
      }).catch(() => {});
    }
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const resultado = data as AjusteConteoResultado;

  logAudit({
    storeId,
    userId,
    action: "UPDATE",
    entityType: "inventario",
    entityId: id,
    oldValues: { stock: resultado.stock_anterior, cantidad: resultado.cantidad_anterior, lote_id: resultado.lote_id },
    newValues: { stock: resultado.stock_nuevo, cantidad: resultado.cantidad_contada, lote_id: resultado.lote_id },
    changeDescription: `Conteo físico${resultado.lote_id ? " (lote)" : ""}: ${resultado.cantidad_anterior} → ${resultado.cantidad_contada} (delta ${resultado.delta}). Motivo: ${motivo}`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

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

  return NextResponse.json(resultado);
}, { endpoint: "POST /api/inventario/id/conteo" });
