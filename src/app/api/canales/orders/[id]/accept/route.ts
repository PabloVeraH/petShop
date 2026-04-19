import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { getChannel } from "@/lib/canales/registry";
import type { CanalId, CanalConfig } from "@/lib/canales/types";
import { logAudit, getRequestMetadata } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId, userId } = ctx;

  const ordenId = req.nextUrl.pathname.split("/orders/")[1]?.split("/")[0];

  if (!ordenId) {
    return NextResponse.json({ error: "ID de orden requerido" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: orden, error: ordenError } = await supabase
    .from("canal_ordenes")
    .select("*, canal_config(credenciales_encriptada, credenciales_iv, credenciales_auth_tag)")
    .eq("id", ordenId)
    .eq("store_id", storeId)
    .single();

  if (ordenError || !orden) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  if (orden.estado !== "pending" && orden.estado !== "reserved") {
    return NextResponse.json({ error: "La orden ya fue procesada" }, { status: 400 });
  }

  const canalId = orden.canal_id;
  const rawPayload = orden.raw_payload as { items?: { id: string; quantity: number; unit_price: number }[] };

  const items = rawPayload?.items ?? [];

  if (items.length === 0) {
    return NextResponse.json({ error: "Orden sin items" }, { status: 400 });
  }

  const total = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);

  const { data: nuevaVenta, error: ventaError } = await supabase
    .from("ventas")
    .insert({
      store_id: storeId,
      canal: canalId,
      total,
      subtotal: total,
      descuento: 0,
      metodo_pago: "plataforma",
      estado: "completada",
    })
    .select()
    .single();

  if (ventaError) {
    return NextResponse.json({ error: "Error creando venta" }, { status: 500 });
  }

  for (const item of items) {
    const { data: producto } = await supabase
      .from("productos")
      .select("id")
      .eq("store_id", storeId)
      .eq("sku", item.id)
      .single();

    const productoId = producto?.id;

    await supabase.from("venta_items").insert({
      venta_id: nuevaVenta.id,
      producto_id: productoId,
      cantidad: item.quantity,
      precio: item.unit_price,
      subtotal: item.unit_price * item.quantity,
    });

    if (productoId) {
      await supabase.rpc("decrement_stock", {
        p_producto_id: productoId,
        p_cantidad: item.quantity,
      });
    }
  }

  const canalIdTyped = canalId as CanalId;
  try {
    const channel = getChannel(canalIdTyped);
    const config: CanalConfig = {
      storeId,
      canalId: canalIdTyped,
      externalStoreId: "",
      credentials: {},
      comisionPct: 0,
    };
    await channel.confirmOrder(config, orden.external_order_id);
  } catch (e) {
    console.error("Error confirmando al canal:", e);
  }

  await supabase
    .from("canal_ordenes")
    .update({
      estado: "accepted",
      accepted_at: new Date().toISOString(),
      venta_id: nuevaVenta.id,
    })
    .eq("id", ordenId);

  await logAudit({
    storeId,
    userId,
    action: "CREATE",
    entityType: "venta",
    entityId: nuevaVenta.id,
    changeDescription: `Venta creada desde orden ${orden.external_order_id} (${canalId})`,
    ipAddress: (await getRequestMetadata(req)).ipAddress,
    userAgent: (await getRequestMetadata(req)).userAgent,
    result: "success",
  });

  return NextResponse.json({
    status: "accepted",
    ventaId: nuevaVenta.id,
    total,
  });
}