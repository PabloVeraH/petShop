import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { ChannelError } from "@/lib/canales/types";
import { getActiveOrders } from "@/lib/canales/hub";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;

  const canalId = req.nextUrl.searchParams.get("canal");
  const estado = req.nextUrl.searchParams.get("estado");

  const supabase = createServiceClient();

  let query = supabase
    .from("canal_ordenes")
    .select("*, venta_id")
    .eq("store_id", storeId);

  if (canalId) {
    query = query.eq("canal_id", canalId);
  }

  if (estado) {
    query = query.eq("estado", estado);
  } else {
    query = query.in("estado", ["pending", "reserved", "accepted", "ready"]);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Error obteniendo órdenes" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}, { endpoint: "GET /api/canales/orders" });

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId, userId } = ctx;

  const body = await req.json();
  const { canal_id, external_order_id, action, reason } = body;

  if (!canal_id || !external_order_id || !action) {
    return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: ordenes, error: findError } = await supabase
    .from("canal_ordenes")
    .select("*, venta_id")
    .eq("store_id", storeId)
    .eq("external_order_id", external_order_id);

  if (findError) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
  if (!ordenes || ordenes.length === 0) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }
  if (ordenes.length > 1) {
    console.error(`[canales] Integridad: ${ordenes.length} órdenes con external_order_id ${external_order_id} en store ${storeId}`);
    return NextResponse.json({ error: "Error de integridad de datos" }, { status: 500 });
  }
  const orden = ordenes[0];

  if (action === "accept") {
    if (orden.estado !== "pending" && orden.estado !== "reserved") {
      return NextResponse.json({ error: "La orden ya fue procesada" }, { status: 400 });
    }

    // TODO: Crear venta, descontar stock, confirmar al canal
    await supabase
      .from("canal_ordenes")
      .update({ estado: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", orden.id);

    return NextResponse.json({ status: "accepted" });
  }

  if (action === "reject") {
    if (orden.estado !== "pending" && orden.estado !== "reserved") {
      return NextResponse.json({ error: "La orden ya fue procesada" }, { status: 400 });
    }

    // Liberar reserva sin descontar stock
    await supabase
      .from("canal_ordenes")
      .update({ estado: "rejected", rejected_at: new Date().toISOString(), motivo_rechazo: reason ?? "" })
      .eq("id", orden.id);

    return NextResponse.json({ status: "rejected" });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}, { endpoint: "POST /api/canales/orders" });