import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { crearAsiento, lineasVenta, lineasVentaCOGS, lineasNotaCredito, lineasCompra } from "@/lib/contabilidad/generador-asientos";
import { extraerIva } from "@/lib/tax";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
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
      else errores.push(`VENTA (ingreso):${venta.numero_comprobante}`);
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
        else errores.push(`VENTA (COGS):${venta.numero_comprobante}`);
      }
    }
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

    // Fetch client name for description
    const { data: ncDetalle } = await supabase
      .from("notas_credito")
      .select("ventas!inner(clientes!inner(nombre))")
      .eq("id", nc.id)
      .maybeSingle();
    const ncVenta = ncDetalle?.ventas as unknown as { clientes: { nombre: string } } | null;
    const ncCliente = ncVenta?.clientes?.nombre;

    const id = await crearAsiento({
      storeId: store_id,
      fecha: nc.created_at.split("T")[0],
      tipoMovimiento: "NOTA_CREDITO",
      referenciaId: nc.id,
      referenciaNomero: nc.numero_nc,
      descripcion: `Devolución${ncCliente ? ` a ${ncCliente}` : ""}`,
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

    // Fetch supplier name for description
    const { data: ocDetalle } = await supabase
      .from("ordenes_compra")
      .select("proveedores!inner(nombre)")
      .eq("id", orden.id)
      .maybeSingle();
    const ocProveedor = ocDetalle?.proveedores as unknown as { nombre: string } | null;

    const id = await crearAsiento({
      storeId: store_id,
      fecha: orden.created_at.split("T")[0],
      tipoMovimiento: "COMPRA",
      referenciaId: orden.id,
      referenciaNomero: orden.numero,
      descripcion: `Compra a ${ocProveedor?.nombre ?? "proveedor"}`,
      lineas: lineasCompra({ montoNeto: Number(orden.subtotal), iva: Number(orden.impuesto), total: Number(orden.total) }),
      creadoPor: "backfill",
    });

    if (id) creados.push(`COMPRA:${orden.numero}`);
    else errores.push(`COMPRA:${orden.numero}`);
  }

  logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "BACKFILL",
    entityType: "journal_entries",
    changeDescription: `${creados.length} creados, ${errores.length} errores`,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    creados: creados.length,
    errores: errores.length,
    detalle_creados: creados,
    detalle_errores: errores,
  }, { status: 200 });
}

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
