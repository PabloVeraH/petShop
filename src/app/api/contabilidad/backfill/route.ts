import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { crearAsiento, lineasVenta, lineasVentaCOGS, lineasNotaCredito, lineasNotaCreditoCOGS, lineasCompra, lineasPagoProveedor, lineasLiquidacionCanal } from "@/lib/contabilidad/generador-asientos";
import { extraerIva } from "@/lib/tax";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  try {
    requireStoreAdmin(admin, store_id);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const creados: string[] = [];
  const errores: string[] = [];

  // ── Ventas sin asiento contable ──────────────────────────────────────────
  // NOTA: cada venta genera DOS asientos VENTA (ingreso + COGS), ambos con
  // tipo_movimiento="VENTA". La consulta debe filtrar SOLO los de ingreso
  // (descripcion empieza con "Venta") para no saltarse ventas cuyo asiento
  // de COGS existe pero el de ingreso falló.
  //
  // Excluye ventas anuladas: una venta 'anulada' que perdió su asiento de
  // ingreso original NO debe recibir uno nuevo — no hay ingreso que reconocer
  // para una venta sin efecto económico vigente, y crearlo generaría un
  // ingreso fantasma que el Estado de Resultado no debe contar (mismo
  // principio que 685f07a: ventas anuladas fuera de ingresos).
  const { data: ventasBackfill } = await supabase
    .from("ventas")
    .select("id, created_at, total, metodo_pago, numero_comprobante")
    .eq("store_id", store_id)
    .neq("estado", "anulada")
    .order("created_at", { ascending: true });

  const { data: asientosIngreso } = await supabase
    .from("journal_entries")
    .select("referencia_id")
    .eq("store_id", store_id)
    .eq("tipo_movimiento", "VENTA")
    .not("descripcion", "ilike", "COGS%");

  const ventasConIngreso = new Set((asientosIngreso ?? []).map((a) => a.referencia_id));

  for (const venta of ventasBackfill ?? []) {
    const total = Number(venta.total);
    const iva = extraerIva(total);
    const montoNeto = total - iva;

    // Fetch client name for description
    const { data: ventaDetalle } = await supabase
      .from("ventas")
      .select("clientes!inner(nombre)")
      .eq("id", venta.id)
      .maybeSingle();
    const ventaCliente = ventaDetalle?.clientes as unknown as { nombre: string } | null;

    if (!ventasConIngreso.has(venta.id)) {
      if (total === 0) {
        errores.push(`VENTA (ingreso):${venta.numero_comprobante} — monto cero`);
      } else {
        const id = await crearAsiento({
          storeId: store_id,
          fecha: venta.created_at.split("T")[0],
          tipoMovimiento: "VENTA",
          referenciaId: venta.id,
          referenciaNomero: venta.numero_comprobante,
          descripcion: `Venta ${venta.metodo_pago}${ventaCliente?.nombre ? ` a ${ventaCliente.nombre}` : ""}`,
          lineas: lineasVenta({ metodoPago: venta.metodo_pago, montoNeto, iva, total }),
          creadoPor: "backfill",
        });

        if (id) creados.push(`VENTA (ingreso):${venta.numero_comprobante}`);
        else errores.push(`VENTA (ingreso):${venta.numero_comprobante} — error al crear asiento contable`);
      }
    }

    // También backfill asiento COGS faltante
    const { data: asientosCogs } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("store_id", store_id)
      .eq("tipo_movimiento", "VENTA")
      .eq("referencia_id", venta.id)
      .ilike("descripcion", "COGS%");

    if (!asientosCogs || asientosCogs.length === 0) {
      const costoTotalVenta = await calcularCostoTotalVenta(venta.id);
      if (costoTotalVenta > 0) {
        const id = await crearAsiento({
          storeId: store_id,
          fecha: venta.created_at.split("T")[0],
          tipoMovimiento: "VENTA",
          referenciaId: venta.id,
          referenciaNomero: venta.numero_comprobante,
          descripcion: `COGS venta${ventaCliente?.nombre ? ` a ${ventaCliente.nombre}` : ""} — costo mercancía`,
          lineas: lineasVentaCOGS(costoTotalVenta),
          creadoPor: "backfill",
        });

        if (id) creados.push(`VENTA (COGS):${venta.numero_comprobante}`);
        else errores.push(`VENTA (COGS):${venta.numero_comprobante} — error al crear asiento contable`);
      }
    }
  }

  // ── Notas de crédito sin asiento ─────────────────────────────────────────
  // Igual que VENTA arriba: cada NC puede generar DOS asientos NOTA_CREDITO
  // (reverso de ingreso + reverso de COGS), así que se detectan por separado
  // filtrando la descripción — si no, una NC con solo el asiento de ingreso
  // (el caso que este backfill existe para arreglar) nunca recibiría el de COGS.
  const { data: notas } = await supabase
    .from("notas_credito")
    .select("id, created_at, monto_total, tipo_reembolso, numero_nc")
    .eq("store_id", store_id)
    .order("created_at", { ascending: true });

  const { data: asientosNcIngreso } = await supabase
    .from("journal_entries")
    .select("referencia_id")
    .eq("store_id", store_id)
    .eq("tipo_movimiento", "NOTA_CREDITO")
    .not("descripcion", "ilike", "Reverso COGS%");

  const { data: asientosNcCogs } = await supabase
    .from("journal_entries")
    .select("referencia_id")
    .eq("store_id", store_id)
    .eq("tipo_movimiento", "NOTA_CREDITO")
    .ilike("descripcion", "Reverso COGS%");

  const ncConIngreso = new Set((asientosNcIngreso ?? []).map((a) => a.referencia_id));
  const ncConCogs = new Set((asientosNcCogs ?? []).map((a) => a.referencia_id));

  for (const nc of notas ?? []) {
    if (ncConIngreso.has(nc.id) && ncConCogs.has(nc.id)) continue;

    // Fetch client name for description
    const { data: ncDetalle } = await supabase
      .from("notas_credito")
      .select("ventas!inner(clientes!inner(nombre))")
      .eq("id", nc.id)
      .maybeSingle();
    const ncVenta = ncDetalle?.ventas as unknown as { clientes: { nombre: string } } | null;
    const ncCliente = ncVenta?.clientes?.nombre;

    if (!ncConIngreso.has(nc.id)) {
      const montoNc = Number(nc.monto_total);
      if (montoNc === 0) {
        errores.push(`NC (ingreso):${nc.numero_nc} — monto cero`);
      } else {
        const id = await crearAsiento({
          storeId: store_id,
          fecha: nc.created_at.split("T")[0],
          tipoMovimiento: "NOTA_CREDITO",
          referenciaId: nc.id,
          referenciaNomero: nc.numero_nc,
          descripcion: `Devolución${ncCliente ? ` a ${ncCliente}` : ""}`,
          lineas: lineasNotaCredito({ monto: montoNc, tipoReembolso: nc.tipo_reembolso }),
          creadoPor: "backfill",
        });

        if (id) creados.push(`NC (ingreso):${nc.numero_nc}`);
        else errores.push(`NC (ingreso):${nc.numero_nc} — error al crear asiento contable`);
      }
    }

    if (!ncConCogs.has(nc.id)) {
      const costoTotalNc = await calcularCostoTotalNc(nc.id);
      if (costoTotalNc > 0) {
        const id = await crearAsiento({
          storeId: store_id,
          fecha: nc.created_at.split("T")[0],
          tipoMovimiento: "NOTA_CREDITO",
          referenciaId: nc.id,
          referenciaNomero: nc.numero_nc,
          descripcion: `Reverso COGS devolución${ncCliente ? ` a ${ncCliente}` : ""}`,
          lineas: lineasNotaCreditoCOGS(costoTotalNc),
          creadoPor: "backfill",
        });

        if (id) creados.push(`NC (COGS):${nc.numero_nc}`);
        else errores.push(`NC (COGS):${nc.numero_nc} — error al crear asiento contable`);
      }
    }
  }

  // ── Órdenes de compra sin asiento ────────────────────────────────────────
  // Solo procesa OC recibidas: el precio se define al recibir la mercadería
  // del proveedor. Las OC 'pendiente'/'enviada' aún no tienen precio definido
  // (subtotal=null), y 'cancelada' nunca se recibió. Sin este filtro, todas
  // aparecían como error "precio no definido" — ruido/falsa alarma para el
  // usuario (ticket Trello 6a5e9533c7978fcb117449d7).
  const { data: ordenes } = await supabase
    .from("ordenes_compra")
    .select("id, created_at, subtotal, impuesto, total, numero")
    .eq("store_id", store_id)
    .eq("estado", "recibida")
    .order("created_at", { ascending: true });

  const { data: asientosCompra } = await supabase
    .from("journal_entries")
    .select("referencia_id")
    .eq("store_id", store_id)
    .eq("tipo_movimiento", "COMPRA");

  const comprasConAsiento = new Set((asientosCompra ?? []).map((a) => a.referencia_id));

  for (const orden of ordenes ?? []) {
    if (comprasConAsiento.has(orden.id)) continue;

    // Fetch supplier name for description
    const { data: ocDetalle } = await supabase
      .from("ordenes_compra")
      .select("proveedores!inner(nombre)")
      .eq("id", orden.id)
      .maybeSingle();
    const ocProveedor = ocDetalle?.proveedores as unknown as { nombre: string } | null;

    const subtotal = Number(orden.subtotal);
    const total = Number(orden.total);

    if (subtotal <= 0 || total <= 0) {
      errores.push(`COMPRA:${orden.numero} — precio no definido`);
    } else {
      const id = await crearAsiento({
        storeId: store_id,
        fecha: orden.created_at.split("T")[0],
        tipoMovimiento: "COMPRA",
        referenciaId: orden.id,
        referenciaNomero: orden.numero,
        descripcion: `Compra a ${ocProveedor?.nombre ?? "proveedor"}`,
        lineas: lineasCompra({ montoNeto: subtotal, iva: Number(orden.impuesto), total }),
        creadoPor: "backfill",
      });

      if (id) creados.push(`COMPRA:${orden.numero}`);
      else errores.push(`COMPRA:${orden.numero} — error al crear asiento contable`);
    }
  }

  // ── Pagos a proveedor sin asiento ────────────────────────────────────────
  // El asiento PAGO_PROVEEDOR se creaba fire-and-forget hasta d2f3750 y podía
  // perderse en serverless. Fecha = updated_at, la misma que usa
  // PATCH /api/cuentas-pagar (una cuenta pagada ya no se modifica: 409).
  const { data: pagos } = await supabase
    .from("cuentas_pagar")
    .select("id, monto, metodo_pago, updated_at, created_at, proveedores(nombre)")
    .eq("store_id", store_id)
    .eq("estado", "pagada")
    .order("updated_at", { ascending: true });

  const { data: asientosPago } = await supabase
    .from("journal_entries")
    .select("referencia_id")
    .eq("store_id", store_id)
    .eq("tipo_movimiento", "PAGO_PROVEEDOR");

  const pagosConAsiento = new Set((asientosPago ?? []).map((a) => a.referencia_id));

  for (const pago of pagos ?? []) {
    if (pagosConAsiento.has(pago.id)) continue;

    const monto = Number(pago.monto);
    const proveedor = (pago.proveedores as unknown as { nombre: string } | null)?.nombre;
    const etiqueta = `PAGO_PROVEEDOR:${proveedor ?? "proveedor"} $${monto.toLocaleString("es-CL")}`;
    const fecha = (pago.updated_at ?? pago.created_at ?? new Date().toISOString()).split("T")[0];

    const id = await crearAsiento({
      storeId: store_id,
      fecha,
      tipoMovimiento: "PAGO_PROVEEDOR",
      referenciaId: pago.id,
      descripcion: `Pago${proveedor ? ` a ${proveedor}` : ""} — $${monto.toLocaleString("es-CL")}`,
      lineas: lineasPagoProveedor(monto, pago.metodo_pago ?? undefined),
      creadoPor: "backfill",
    });

    if (id) creados.push(etiqueta);
    else errores.push(`${etiqueta} — error al crear asiento contable`);
  }

  // ── Liquidaciones de canal sin asiento ───────────────────────────────────
  // POST /api/canales/liquidacion borra la liquidación si su asiento falla, así
  // que una sin journal_entry_id es (a) asiento creado pero vínculo fallido →
  // solo se vincula, sin duplicar; o (b) una fila cargada por otro medio → se
  // crea el asiento. La fecha de depósito no se persiste: se usa created_at
  // (el registro se hace al recibir el depósito).
  const { data: liquidaciones } = await supabase
    .from("canal_liquidaciones")
    .select("id, canal_id, periodo_desde, periodo_hasta, monto_bruto, comision, referencia, created_at")
    .eq("store_id", store_id)
    .is("journal_entry_id", null)
    .order("created_at", { ascending: true });

  const { data: asientosLiq } = await supabase
    .from("journal_entries")
    .select("id, referencia_id")
    .eq("store_id", store_id)
    .eq("tipo_movimiento", "LIQUIDACION_CANAL");

  const asientoPorLiq = new Map((asientosLiq ?? []).map((a) => [a.referencia_id, a.id as string]));

  for (const liq of liquidaciones ?? []) {
    const etiqueta = `LIQUIDACION_CANAL:${liq.canal_id} ${liq.periodo_desde}/${liq.periodo_hasta}`;
    let asientoId = asientoPorLiq.get(liq.id) ?? null;
    const existente = asientoId !== null;

    if (!asientoId) {
      // lineasLiquidacionCanal lanza con un canal sin cuenta por cobrar.
      asientoId = await (async () =>
        crearAsiento({
          storeId: store_id,
          fecha: liq.created_at.split("T")[0],
          tipoMovimiento: "LIQUIDACION_CANAL",
          canal: liq.canal_id,
          referenciaId: liq.id,
          referenciaNomero: liq.referencia || `${liq.periodo_desde}/${liq.periodo_hasta}`,
          descripcion: `Liquidación ${liq.canal_id} ${liq.periodo_desde} al ${liq.periodo_hasta}`,
          lineas: lineasLiquidacionCanal({ canal: liq.canal_id, montoBruto: Number(liq.monto_bruto), comision: Number(liq.comision) }),
          creadoPor: "backfill",
        }))().catch(() => null);
      if (!asientoId) {
        errores.push(`${etiqueta} — error al crear asiento contable`);
        continue;
      }
    }

    const { error: errVinculo } = await supabase
      .from("canal_liquidaciones")
      .update({ journal_entry_id: asientoId })
      .eq("id", liq.id)
      .eq("store_id", store_id);

    if (errVinculo) errores.push(`${etiqueta} — asiento ${asientoId} creado pero sin vincular`);
    else creados.push(existente ? `${etiqueta} (asiento existente vinculado)` : etiqueta);
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "BACKFILL",
    entityType: "journal_entries",
    changeDescription: `${creados.length} creados, ${errores.length} errores`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    creados: creados.length,
    errores: errores.length,
    detalle_creados: creados,
    detalle_errores: errores,
  }, { status: 200 });
}, { endpoint: "POST /api/contabilidad/backfill" });

async function calcularCostoTotalVenta(ventaId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data: items } = await supabase
    .from("venta_items")
    .select("cantidad, productos!inner(costo)")
    .eq("venta_id", ventaId);

  if (!items) return 0;

  return items.reduce((sum, item) => {
    const costo = (item.productos as unknown as { costo: number }).costo ?? 0;
    return sum + (item.cantidad * Number(costo));
  }, 0);
}

// Costo a revertir por una nota de crédito: solo los ítems con
// restituir_stock=true (mismo criterio que anular_venta_tx, migración 053,
// y la ruta POST /api/notas-credito).
async function calcularCostoTotalNc(ncId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data: items } = await supabase
    .from("nota_credito_items")
    .select("cantidad_devuelta, restituir_stock, productos!inner(costo)")
    .eq("nota_credito_id", ncId)
    .eq("restituir_stock", true);

  if (!items) return 0;

  return Math.round(
    items.reduce((sum, item) => {
      const costo = (item.productos as unknown as { costo: number }).costo ?? 0;
      return sum + (item.cantidad_devuelta * Number(costo));
    }, 0)
  );
}
