import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: orden, error } = await supabase
    .from("ordenes_compra")
    .select("id, numero, estado, subtotal, impuesto, total, fecha_estimada, fecha_recibida, notas, created_at, proveedores(nombre, telefono, email)")
    .eq("id", id).single();
  if (error || !orden) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const { data: items } = await supabase
    .from("ordenes_compra_items")
    .select("id, cantidad_solicitada, cantidad_recibida, precio_unitario, subtotal, productos(id, nombre, sku)")
    .eq("orden_id", id);

  return NextResponse.json({ ...orden, items: items ?? [] });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { id } = await params;
  const supabase = createServiceClient();

  const body = await req.json();

  // Receiving order: estado = "recibida", items with cantidad_recibida
  if (body.action === "recibir") {
    const { items } = body as { items: Array<{ id: string; cantidad_recibida: number; producto_id: string }> };

    // Update each item and increment stock
    for (const item of items) {
      await supabase.from("ordenes_compra_items")
        .update({ cantidad_recibida: item.cantidad_recibida })
        .eq("id", item.id);

      if (item.cantidad_recibida > 0) {
        const { data: prod } = await supabase.from("productos").select("stock").eq("id", item.producto_id).single();
        if (prod) {
          await supabase.from("productos").update({ stock: prod.stock + item.cantidad_recibida }).eq("id", item.producto_id);
        }

        await supabase.from("stock_movements").insert({
          producto_id: item.producto_id,
          tipo: "entrada",
          cantidad: item.cantidad_recibida,
          referencia_id: id,
          notas: `Recepción orden ${id}`,
        });
      }
    }

    // Mark order as received
    const { data: orden, error } = await supabase
      .from("ordenes_compra")
      .update({ estado: "recibida", fecha_recibida: new Date().toISOString().split("T")[0] })
      .eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Create cuenta por pagar if not exists
    const { data: existente } = await supabase
      .from("cuentas_pagar").select("id").eq("orden_id", id).single();
    if (!existente) {
      const vencimiento = new Date();
      vencimiento.setDate(vencimiento.getDate() + 30);
      await supabase.from("cuentas_pagar").insert({
        store_id,
        orden_id: id,
        proveedor_id: orden.proveedor_id,
        monto: orden.total,
        fecha_emision: new Date().toISOString().split("T")[0],
        fecha_vencimiento: vencimiento.toISOString().split("T")[0],
        estado: "pendiente",
      });
    }

    return NextResponse.json(orden);
  }

  // Simple estado update
  const { data, error } = await supabase
    .from("ordenes_compra").update(body).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
