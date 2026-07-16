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

  // ── Transacción ACID en una sola llamada RPC ──────────────────────────────
  // anular_venta_tx (migración 053) hace el reclamo atómico de estado='anulada'
  // ANTES de restaurar stock/fidelización/saldo — cierra la race condition de
  // doble crédito por anulaciones concurrentes de la misma venta — y envuelve
  // toda la reversión en una sola transacción (rollback automático ante
  // cualquier error parcial). Ver comentario en la migración y AGENTS.md §22.5/
  // §22.6 para el detalle de la lógica de negocio preservada.
  const { data: txResult, error: txError } = await supabase.rpc("anular_venta_tx", {
    p_store_id: store_id,
    p_venta_id: id,
    p_user_id: ctx.userId,
  });

  if (txError) {
    if (txError.message.includes("no encontrada")) {
      return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
    }
    if (txError.message.includes("ya está anulada")) {
      return NextResponse.json({ error: "La venta ya está anulada" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { venta, costo_total: costoTotal } = txResult as {
    venta: {
      id: string; total: number; impuesto: number | null; metodo_pago: string | null;
      canal: string | null; numero_comprobante: string | null; created_at: string;
    };
    costo_total: number;
  };

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

  return NextResponse.json(venta);
}
