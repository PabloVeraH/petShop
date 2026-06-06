import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { crearAsiento, lineasVenta, lineasNotaCredito, lineasCompra } from "@/lib/contabilidad/generador-asientos";

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const creados: string[] = [];
  const errores: string[] = [];

  // ── Ventas sin asiento contable ──────────────────────────────────────────
  const { data: ventas } = await supabase
    .from("ventas")
    .select("id, created_at, total, metodo_pago, numero_comprobante")
    .eq("store_id", store_id)
    .order("created_at", { ascending: true });

  const { data: asientosVenta } = await supabase
    .from("journal_entries")
    .select("referencia_id")
    .eq("store_id", store_id)
    .eq("tipo_movimiento", "VENTA");

  const ventasConAsiento = new Set((asientosVenta ?? []).map((a) => a.referencia_id));

  for (const venta of ventas ?? []) {
    if (ventasConAsiento.has(venta.id)) continue;

    const total = Number(venta.total);
    const montoNeto = Math.round(total / 1.19);
    const iva = total - montoNeto;

    const id = await crearAsiento({
      storeId: store_id,
      fecha: venta.created_at.split("T")[0],
      tipoMovimiento: "VENTA",
      referenciaId: venta.id,
      referenciaNomero: venta.numero_comprobante,
      descripcion: `Venta ${venta.metodo_pago} - ${venta.numero_comprobante}`,
      lineas: lineasVenta({ metodoPago: venta.metodo_pago, montoNeto, iva, total }),
      creadoPor: "backfill",
    });

    if (id) creados.push(`VENTA:${venta.numero_comprobante}`);
    else errores.push(`VENTA:${venta.numero_comprobante}`);
  }

  // ── Notas de crédito sin asiento ─────────────────────────────────────────
  const { data: notas } = await supabase
    .from("notas_credito")
    .select("id, created_at, monto_total, tipo_reembolso, numero_nc")
    .eq("store_id", store_id)
    .order("created_at", { ascending: true });

  const { data: asientosNc } = await supabase
    .from("journal_entries")
    .select("referencia_id")
    .eq("store_id", store_id)
    .eq("tipo_movimiento", "NOTA_CREDITO");

  const ncConAsiento = new Set((asientosNc ?? []).map((a) => a.referencia_id));

  for (const nc of notas ?? []) {
    if (ncConAsiento.has(nc.id)) continue;

    const id = await crearAsiento({
      storeId: store_id,
      fecha: nc.created_at.split("T")[0],
      tipoMovimiento: "NOTA_CREDITO",
      referenciaId: nc.id,
      referenciaNomero: nc.numero_nc,
      descripcion: `Nota de Crédito ${nc.numero_nc}`,
      lineas: lineasNotaCredito({ monto: Number(nc.monto_total), tipoReembolso: nc.tipo_reembolso }),
      creadoPor: "backfill",
    });

    if (id) creados.push(`NC:${nc.numero_nc}`);
    else errores.push(`NC:${nc.numero_nc}`);
  }

  // ── Órdenes de compra sin asiento ────────────────────────────────────────
  const { data: ordenes } = await supabase
    .from("ordenes_compra")
    .select("id, created_at, subtotal, impuesto, total, numero")
    .eq("store_id", store_id)
    .order("created_at", { ascending: true });

  const { data: asientosCompra } = await supabase
    .from("journal_entries")
    .select("referencia_id")
    .eq("store_id", store_id)
    .eq("tipo_movimiento", "COMPRA");

  const comprasConAsiento = new Set((asientosCompra ?? []).map((a) => a.referencia_id));

  for (const orden of ordenes ?? []) {
    if (comprasConAsiento.has(orden.id)) continue;

    const id = await crearAsiento({
      storeId: store_id,
      fecha: orden.created_at.split("T")[0],
      tipoMovimiento: "COMPRA",
      referenciaId: orden.id,
      referenciaNomero: orden.numero,
      descripcion: `Compra a proveedor - ${orden.numero}`,
      lineas: lineasCompra({ montoNeto: Number(orden.subtotal), iva: Number(orden.impuesto), total: Number(orden.total) }),
      creadoPor: "backfill",
    });

    if (id) creados.push(`COMPRA:${orden.numero}`);
    else errores.push(`COMPRA:${orden.numero}`);
  }

  return NextResponse.json({
    ok: true,
    creados: creados.length,
    errores: errores.length,
    detalle_creados: creados,
    detalle_errores: errores,
  }, { status: 200 });
}
