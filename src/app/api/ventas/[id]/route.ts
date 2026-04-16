import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: venta, error } = await supabase
    .from("ventas")
    .select("id, numero_comprobante, subtotal, descuento, impuesto, total, metodo_pago, estado, created_at, clientes(id, nombre, rut, telefono), vendedores(nombre)")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  if (error || !venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });

  const { data: items } = await supabase
    .from("venta_items")
    .select("id, cantidad, precio_unitario, subtotal, productos(nombre, sku)")
    .eq("venta_id", id);

  return NextResponse.json({ ...venta, items: items ?? [] });
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

  const { action } = await req.json();

  if (action !== "anular") {
    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  }

  const { data: venta } = await supabase
    .from("ventas")
    .select("id, estado, cliente_id, total")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  if (!venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
  if (venta.estado === "anulada") return NextResponse.json({ error: "La venta ya está anulada" }, { status: 409 });

  // Revert stock for each item
  const { data: items } = await supabase
    .from("venta_items")
    .select("producto_id, cantidad")
    .eq("venta_id", id);

  for (const item of items ?? []) {
    const { data: prod } = await supabase
      .from("productos")
      .select("stock")
      .eq("id", item.producto_id)
      .single();

    if (prod) {
      await supabase
        .from("productos")
        .update({ stock: prod.stock + item.cantidad })
        .eq("id", item.producto_id);

      await supabase.from("stock_movements").insert({
        producto_id: item.producto_id,
        tipo: "entrada",
        cantidad: item.cantidad,
        referencia_id: id,
        notas: `Anulación venta ${id.slice(0, 8)}`,
      });
    }
  }

  if (venta.cliente_id) {
    const { data: fid } = await supabase
      .from("fidelizacion")
      .select("id, total_historico, frecuencia_compras")
      .eq("cliente_id", venta.cliente_id)
      .single();

    if (fid) {
      const nuevoTotal = Math.max(0, Number(fid.total_historico) - Number(venta.total ?? 0));
      const nuevaFrecuencia = Math.max(0, fid.frecuencia_compras - 1);
      const nuevoDescuento =
        nuevoTotal >= 300_000 ? 20 :
        nuevoTotal >= 150_000 ? 10 :
        nuevoTotal >= 50_000 ? 5 : 0;

      await supabase.from("fidelizacion").update({
        total_historico: nuevoTotal,
        frecuencia_compras: nuevaFrecuencia,
        descuento_actual: nuevoDescuento,
        updated_at: new Date().toISOString(),
      }).eq("cliente_id", venta.cliente_id);
    }
  }

  const { data: updated, error } = await supabase
    .from("ventas")
    .update({ estado: "anulada" })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(updated);
}
