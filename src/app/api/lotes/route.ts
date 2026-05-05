import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { LoteCreateSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
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
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { storeId, userId } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = LoteCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const d = parsed.data;

  const { data: prod } = await supabase
    .from("productos")
    .select("id")
    .eq("id", d.producto_id)
    .eq("store_id", storeId)
    .single();
  if (!prod) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const { data: lote, error } = await supabase
    .from("lotes_producto")
    .insert({
      store_id:          storeId,
      producto_id:       d.producto_id,
      numero_lote:       d.numero_lote ?? null,
      cantidad_inicial:  d.cantidad_inicial,
      cantidad_actual:   d.cantidad_actual ?? d.cantidad_inicial,
      fecha_vencimiento: d.fecha_vencimiento,
      fecha_ingreso:     d.fecha_ingreso ?? new Date().toISOString().split("T")[0],
      orden_compra_id:   d.orden_compra_id ?? null,
      notas:             d.notas ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    storeId,
    userId: userId || "unknown",
    action: "CREATE",
    entityType: "lote_producto",
    entityId: lote.id,
    newValues: lote,
    ipAddress: (await getRequestMetadata(req)).ipAddress,
    userAgent: (await getRequestMetadata(req)).userAgent,
    result: "success",
  });

  return NextResponse.json({ lote }, { status: 201 });
}