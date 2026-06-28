import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { crearAsiento, lineasAnulacionVentaCanal, lineasAnulacionCOGS } from "@/lib/contabilidad/generador-asientos";

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
    .select("id, numero_comprobante, subtotal, descuento, impuesto, total, metodo_pago, estado, created_at, worker_clerk_id, clientes(id, nombre, rut, telefono)")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  if (error || !venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });

  let worker = null;
  if (venta.worker_clerk_id) {
    const { data: workerData } = await supabase
      .from("clerk_users")
      .select("nombre, email")
      .eq("clerk_id", venta.worker_clerk_id)
      .single();
    worker = workerData;
  }

  const { data: items } = await supabase
    .from("venta_items")
    .select("id, cantidad, precio_unitario, subtotal, productos(nombre, sku)")
    .eq("venta_id", id);

  const { data: pagos } = await supabase
    .from("pagos")
    .select("id, metodo, monto, numero_transaccion, nota_credito_id")
    .eq("venta_id", id);

  return NextResponse.json({ ...venta, worker, items: items ?? [], pagos: pagos ?? [] });
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
    .select("id, estado, cliente_id, total, impuesto, metodo_pago, canal, numero_comprobante")
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

  let costoTotal = 0;
  for (const item of items ?? []) {
    const { data: prod } = await supabase
      .from("productos")
      .select("stock, costo")
      .eq("id", item.producto_id)
      .single();

    if (prod) {
      costoTotal += (prod.costo ?? 0) * item.cantidad;

      await supabase
        .from("productos")
        .update({ stock: prod.stock + item.cantidad })
        .eq("id", item.producto_id);

      await supabase.from("stock_movements").insert({
        producto_id: item.producto_id,
        tipo: "entrada",
        cantidad: item.cantidad,
        referencia_id: id,
        notas: `Anulación ${venta.numero_comprobante ?? id.slice(0, 8)}`,
        user_id: ctx.userId,
      });
    }
  }

  if (venta.cliente_id) {
    const [{ data: fid }, { data: storeNiveles }] = await Promise.all([
      supabase
        .from("fidelizacion")
        .select("id, total_historico, frecuencia_compras")
        .eq("cliente_id", venta.cliente_id)
        .single(),
      supabase
        .from("stores")
        .select("fidelizacion_niveles")
        .eq("id", store_id)
        .single(),
    ]);

    if (fid) {
      const nuevoTotal = Math.max(0, Number(fid.total_historico) - Number(venta.total ?? 0));
      const nuevaFrecuencia = Math.max(0, fid.frecuencia_compras - 1);
      const niveles = ((storeNiveles?.fidelizacion_niveles as { monto: number; descuento: number }[] | null) ?? [
        { monto: 50000, descuento: 5 }, { monto: 150000, descuento: 10 }, { monto: 300000, descuento: 20 },
      ]).sort((a, b) => b.monto - a.monto);
      const nuevoDescuento = niveles.find((n) => nuevoTotal >= n.monto)?.descuento ?? 0;

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

  // Fire-and-forget: contra-asientos de anulación en el Libro Diario.
  // Dos asientos independientes (igual que la venta original):
  // 1. Reverso del ingreso — Dr Ventas + Dr IVA / Cr Caja|Banco
  // 2. Reverso del COGS   — Dr Inventario / Cr COGS (solo si hubo costo)
  const fechaAnulacion = new Date().toISOString().split("T")[0];
  const totalVenta = Math.round(Number(venta.total));
  const ivaVenta = Math.round(Number(venta.impuesto ?? 0));
  const montoNeto = totalVenta - ivaVenta;
  const numeroRef = venta.numero_comprobante ?? id.slice(0, 8);
  const canalVenta = (venta.canal ?? "pos") as "pos" | "rappi" | "pedidosya" | "ubereats";

  ;(async () => {
    crearAsiento({
      storeId: store_id,
      fecha: fechaAnulacion,
      tipoMovimiento: "ANULACION_VENTA",
      canal: canalVenta,
      referenciaId: id,
      referenciaNomero: numeroRef,
      descripcion: `Anulación venta ${numeroRef}`,
      lineas: lineasAnulacionVentaCanal({
        canal: venta.canal ?? "pos",
        metodoPago: venta.metodo_pago ?? "efectivo",
        montoNeto,
        iva: ivaVenta,
        total: totalVenta,
      }),
      usuarioId: ctx.userId ?? undefined,
    }).catch((e) => console.error("[contabilidad] Error asiento anulación venta:", e));

    if (costoTotal > 0) {
      crearAsiento({
        storeId: store_id,
        fecha: fechaAnulacion,
        tipoMovimiento: "ANULACION_VENTA",
        canal: canalVenta,
        referenciaId: id,
        referenciaNomero: numeroRef,
        descripcion: `Reverso COGS anulación ${numeroRef}`,
        lineas: lineasAnulacionCOGS(Math.round(costoTotal)),
        usuarioId: ctx.userId ?? undefined,
      }).catch((e) => console.error("[contabilidad] Error reverso COGS anulación:", e));
    }
  })();

  return NextResponse.json(updated);
}
