import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { OrdenCompraCreateSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const estado = req.nextUrl.searchParams.get("estado") ?? "";
  const proveedor_id = req.nextUrl.searchParams.get("proveedor_id") ?? "";

  let query = supabase
    .from("ordenes_compra")
    .select("id, numero, estado, total, fecha_estimada, fecha_recibida, created_at, proveedores(nombre)")
    .eq("store_id", store_id)
    .order("created_at", { ascending: false });
  if (estado) query = query.eq("estado", estado);
  if (proveedor_id) query = query.eq("proveedor_id", proveedor_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data ?? []);
}, { endpoint: "GET /api/ordenes-compra" });

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = OrdenCompraCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { proveedor_id, items, fecha_estimada, notas } = parsed.data;

  const hoy = new Date();
  const numero = `OC-${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  const { data: orden, error: ordenError } = await supabase
    .from("ordenes_compra")
    .insert({
      store_id,
      proveedor_id,
      numero,
      estado: "pendiente",
      subtotal: null,
      impuesto: null,
      total: null,
      fecha_estimada: fecha_estimada || null,
      notas: notas || null,
    })
    .select().single();
  if (ordenError) {
    const { ipAddress, userAgent } = getRequestMetadata(req);
    logAudit({
      storeId: store_id,
      userId: ctx.userId,
      action: "CREATE",
      entityType: "orden_compra",
      changeDescription: "Error creando orden de compra",
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: ordenError.message,
    }).catch(() => {});
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { error: itemsError } = await supabase.from("ordenes_compra_items").insert(
    items.map(i => ({
      orden_id: orden.id,
      producto_id: i.producto_id ?? null,
      nombre_nuevo: i.nombre_nuevo ?? null,
      cantidad_solicitada: i.cantidad_solicitada,
      precio_unitario: null,
      subtotal: null,
    }))
  );
  if (itemsError) {
    const { ipAddress, userAgent } = getRequestMetadata(req);
    logAudit({
      storeId: store_id,
      userId: ctx.userId,
      action: "CREATE",
      entityType: "orden_compra",
      entityId: orden.id,
      changeDescription: "Error creando items de orden de compra",
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: itemsError.message,
    }).catch(() => {});
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "orden_compra",
    entityId: orden.id,
    newValues: { proveedor_id, total: orden.total },
    changeDescription: `Orden de compra creada`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(orden);
}, { endpoint: "POST /api/ordenes-compra" });
