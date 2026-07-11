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
    .select("id, estado, cliente_id, total, impuesto, metodo_pago, canal, numero_comprobante, created_at")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  if (!venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
  if (venta.estado === "anulada") return NextResponse.json({ error: "La venta ya está anulada" }, { status: 409 });

  const { data: items } = await supabase
    .from("venta_items")
    .select("id, producto_id, cantidad")
    .eq("venta_id", id);

  // Todas las NCs de esta venta (cualquier estado) con sus items — una sola
  // consulta reutilizada para 3 correcciones (stock, fidelización, reversión
  // de saldo). Cada NC ya emitida, sea "activa" o "usada", aplicó su efecto
  // UNA VEZ al crearse (restituyó stock y decrementó fidelización) — anular
  // la venta completa no debe volver a aplicar el efecto ya cubierto por esas
  // NCs, sino solo el remanente. Ver invariante en AGENTS.md §22.5.
  const { data: ncs } = await supabase
    .from("notas_credito")
    .select("id, estado, tipo_reembolso, monto_total, nota_credito_items(venta_item_id, cantidad_devuelta, restituir_stock)")
    .eq("venta_id", id);

  const yaDevueltoPorItem = new Map<string, number>();
  let totalNcMonto = 0;
  for (const nc of ncs ?? []) {
    totalNcMonto += Number(nc.monto_total ?? 0);
    for (const nci of (nc.nota_credito_items ?? []) as { venta_item_id: string; cantidad_devuelta: number; restituir_stock: boolean }[]) {
      if (!nci.restituir_stock) continue;
      yaDevueltoPorItem.set(
        nci.venta_item_id,
        (yaDevueltoPorItem.get(nci.venta_item_id) ?? 0) + Number(nci.cantidad_devuelta ?? 0)
      );
    }
  }

  // Restaurar stock: solo la cantidad AÚN NO devuelta vía NC — la porción ya
  // devuelta con restituir_stock=true ya incrementó productos.stock cuando se
  // creó la NC (POST /api/notas-credito). Restaurar la cantidad completa aquí
  // duplicaría esas unidades (regresión: "doble crédito" también en inventario).
  let costoTotal = 0;
  const stockErrors: string[] = [];
  for (const item of items ?? []) {
    const yaDevuelto = yaDevueltoPorItem.get(item.id) ?? 0;
    const pendiente = Math.max(0, item.cantidad - yaDevuelto);
    if (pendiente <= 0) continue;

    const { data: prod } = await supabase
      .from("productos")
      .select("stock, costo")
      .eq("id", item.producto_id)
      .single();

    if (prod) {
      costoTotal += (prod.costo ?? 0) * pendiente;

      const { error: stockErr } = await supabase
        .from("productos")
        .update({ stock: prod.stock + pendiente })
        .eq("id", item.producto_id);

      if (stockErr) stockErrors.push(`producto ${item.producto_id}: ${stockErr.message}`);

      const { error: movErr } = await supabase.from("stock_movements").insert({
        producto_id: item.producto_id,
        tipo: "entrada",
        cantidad: pendiente,
        referencia_id: id,
        notas: `Anulación ${venta.numero_comprobante ?? id.slice(0, 8)}`,
        user_id: ctx.userId,
      });

      if (movErr) stockErrors.push(`stock_movement producto ${item.producto_id}: ${movErr.message}`);
    }
  }

  if (stockErrors.length > 0) {
    return NextResponse.json({ error: `Error restaurando stock: ${stockErrors.join("; ")}` }, { status: 500 });
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
      // Descontar solo el neto: cada NC ya emitida (activa o usada) restó su
      // propio monto_total de total_historico al crearse (POST /api/notas-credito).
      // Descontar venta.total completo aquí duplicaría esa resta.
      const netoVenta = Math.max(0, Number(venta.total ?? 0) - totalNcMonto);
      const nuevoTotal = Math.max(0, Number(fid.total_historico) - netoVenta);
      const nuevaFrecuencia = Math.max(0, fid.frecuencia_compras - 1);
      const niveles = ((storeNiveles?.fidelizacion_niveles as { monto: number; descuento: number }[] | null) ?? [
        { monto: 50000, descuento: 5 }, { monto: 150000, descuento: 10 }, { monto: 300000, descuento: 20 },
      ]).sort((a, b) => b.monto - a.monto);
      const nuevoDescuento = niveles.find((n) => nuevoTotal >= n.monto)?.descuento ?? 0;

      const { error: fidErr } = await supabase.from("fidelizacion").update({
        total_historico: nuevoTotal,
        frecuencia_compras: nuevaFrecuencia,
        descuento_actual: nuevoDescuento,
        updated_at: new Date().toISOString(),
      }).eq("cliente_id", venta.cliente_id);

      if (fidErr) {
        return NextResponse.json({ error: "Error actualizando fidelización del cliente" }, { status: 500 });
      }
    }
  }

  // Cancelar NCs activas asociadas a esta venta y revertir sus saldos a favor.
  // Solo NCs "activa": una NC "usada" ya fue consumida como pago de OTRA venta
  // (crear_venta_tx ya decrementó su saldo_a_favor en ese momento) — revertirla
  // de nuevo aquí sería un TERCER descuento sobre el mismo crédito.
  const ncsActivas = (ncs ?? []).filter((nc) => nc.estado === "activa");
  const ncErrors: string[] = [];
  for (const nc of ncsActivas) {
    if (nc.tipo_reembolso === "saldo_a_favor" && venta.cliente_id) {
      // Decremento atómico (UPDATE de una sola sentencia) — evita el lost-update
      // que existía con el patrón previo de leer saldo_disponible en JS y
      // recién después escribir el valor calculado.
      const { error: saldoErr } = await supabase.rpc("revertir_saldo_a_favor", {
        p_store_id: store_id,
        p_cliente_id: venta.cliente_id,
        p_monto: nc.monto_total,
      });

      if (saldoErr) ncErrors.push(`saldo NC ${nc.id}: ${saldoErr.message}`);
    }

    const { error: ncErr } = await supabase
      .from("notas_credito")
      .update({ estado: "anulada" })
      .eq("id", nc.id);

    if (ncErr) ncErrors.push(`actualizar NC ${nc.id}: ${ncErr.message}`);
  }

  if (ncErrors.length > 0) {
    return NextResponse.json({ error: `Error cancelando NCs: ${ncErrors.join("; ")}` }, { status: 500 });
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
  //
  // Se usa la fecha ORIGINAL de la venta (no la fecha de hoy) para que el
  // contra-asiento caiga en el mismo período contable que el asiento
  // original. Si se usara la fecha de anulación, anular una venta de un
  // mes anterior generaría un ingreso "fantasma" en el Estado de Resultado
  // del mes de la venta (no se neteó) y un resultado negativo "fantasma"
  // en el mes de la anulación (reverso sin venta que lo explique).
  const fechaAnulacion = new Date(venta.created_at).toISOString().split("T")[0];
  const totalVenta = Math.round(Number(venta.total));
  const ivaVenta = Math.round(Number(venta.impuesto ?? 0));
  const montoNeto = totalVenta - ivaVenta;
  const numeroRef = venta.numero_comprobante ?? id.slice(0, 8);
  const canalVenta = (venta.canal ?? "pos") as "pos" | "rappi" | "pedidosya" | "ubereats";

  // Asiento contable (post-response fire-and-forget)
  (async () => {
    const asiento = await crearAsiento({
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
    });
    if (!asiento) console.error(`[contabilidad] Asiento de anulación NO CREADO para venta ${numeroRef}`);

    if (costoTotal > 0) {
      const reverso = await crearAsiento({
        storeId: store_id,
        fecha: fechaAnulacion,
        tipoMovimiento: "ANULACION_VENTA",
        canal: canalVenta,
        referenciaId: id,
        referenciaNomero: numeroRef,
        descripcion: `Reverso COGS anulación ${numeroRef}`,
        lineas: lineasAnulacionCOGS(Math.round(costoTotal)),
        usuarioId: ctx.userId ?? undefined,
      });
      if (!reverso) console.error(`[contabilidad] Reverso COGS NO CREADO para venta ${numeroRef}`);
    }
  })().catch((e) => console.error("[contabilidad] Error en asiento de anulación:", e));

  return NextResponse.json(updated);
}
