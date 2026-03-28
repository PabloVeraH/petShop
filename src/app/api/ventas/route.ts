import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users")
    .select("store_id")
    .eq("clerk_id", userId)
    .single();

  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const { items, clienteId, metodoPago, descuentoPct } = await req.json();

  const subtotal: number = items.reduce(
    (sum: number, i: { subtotal: number }) => sum + i.subtotal,
    0
  );
  const descuento = (subtotal * (descuentoPct ?? 0)) / 100;
  const impuesto = (subtotal - descuento) * 0.19;
  const total = (subtotal - descuento) * 1.19;

  const { data: venta, error: ventaError } = await supabase
    .from("ventas")
    .insert({
      store_id: user.store_id,
      cliente_id: clienteId ?? null,
      subtotal,
      descuento,
      impuesto,
      total,
      metodo_pago: metodoPago,
      estado: "completada",
    })
    .select()
    .single();

  if (ventaError) return NextResponse.json({ error: ventaError.message }, { status: 500 });

  const { error: itemsError } = await supabase.from("venta_items").insert(
    items.map((item: {
      producto_id: string;
      cantidad: number;
      precio_unitario: number;
      subtotal: number;
      mascota_id?: string;
    }) => ({
      venta_id: venta.id,
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      subtotal: item.subtotal,
      mascota_id: item.mascota_id ?? null,
    }))
  );

  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  // Decrement stock and log movements
  for (const item of items as { producto_id: string; cantidad: number }[]) {
    await supabase.rpc("decrement_stock", {
      p_producto_id: item.producto_id,
      p_cantidad: item.cantidad,
    });
    await supabase.from("stock_movements").insert({
      producto_id: item.producto_id,
      tipo: "salida",
      cantidad: -item.cantidad,
      referencia_id: venta.id,
      notas: `Venta ${venta.id}`,
    });
  }

  return NextResponse.json(venta);
}
