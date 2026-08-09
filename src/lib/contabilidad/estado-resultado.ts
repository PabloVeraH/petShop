import { createServiceClient } from "@/lib/supabase";
import { CUENTAS } from "./types";

const INGRESOS_CODIGOS = [CUENTAS.VENTAS.codigo];
const DEVOLUCIONES_CODIGOS = [CUENTAS.DEVOLUCIONES.codigo];
const COGS_CODIGOS = [CUENTAS.COGS.codigo];

export interface DatosEstadoResultado {
  ventaProductos: number;
  devoluciones: number;
  costoVenta: number;
}

// COGS real del período desde las ventas activas (ground truth), sin depender
// de los asientos contables. Antes (commit 2439f2b) consultaba
// venta_item_lotes.costo_unitario, columna que NO existe en el schema real
// (venta_item_lotes solo tiene id, venta_item_id, lote_id, cantidad,
// created_at) — la query fallaba en silencio, devolvía 0 y el reporte caía
// siempre al fallback de journal_detail, perdiendo el COGS de asientos
// huérfanos (journal_entries sin journal_detail, ticket Trello 6a77e779e5698ef7e7e3afda).
//
// Fuente de costo: productos.costo, la misma que usa POST /api/ventas
// (costoMap) y el backfill (calcularCostoTotalVenta). Se netea el costo de
// las notas de crédito con restituir_stock=true creadas en el período, porque
// su asiento reverso acredita COGS (lineasNotaCreditoCOGS) — sin esta resta,
// una devolución que devolvió mercadería a inventario seguiría sumando su
// costo como gasto del período.
export async function calcularCostoVentaActual(
  supabase: ReturnType<typeof createServiceClient>,
  store_id: string,
  desde: string,
  hasta: string
): Promise<number> {
  const { data: ventas } = await supabase
    .from("ventas")
    .select("id")
    .eq("store_id", store_id)
    .neq("estado", "anulada")
    .gte("created_at", desde)
    .lte("created_at", hasta);

  const ventaIds = (ventas ?? []).map((v) => v.id);
  if (ventaIds.length === 0) return 0;

  const { data: items } = await supabase
    .from("venta_items")
    .select("cantidad, productos!inner(costo)")
    .in("venta_id", ventaIds);

  const costoVentas = (items ?? []).reduce((sum, item) => {
    const costo = (item.productos as unknown as { costo: number } | null)?.costo ?? 0;
    return sum + (Number(item.cantidad) || 0) * Number(costo);
  }, 0);

  const { data: notas } = await supabase
    .from("notas_credito")
    .select("id")
    .eq("store_id", store_id)
    .gte("created_at", desde)
    .lte("created_at", hasta);

  const notaIds = (notas ?? []).map((n) => n.id);
  if (notaIds.length === 0) return costoVentas;

  const { data: ncItems } = await supabase
    .from("nota_credito_items")
    .select("cantidad_devuelta, productos!inner(costo)")
    .in("nota_credito_id", notaIds)
    .eq("restituir_stock", true);

  const costoDevuelto = (ncItems ?? []).reduce((sum, item) => {
    const costo = (item.productos as unknown as { costo: number } | null)?.costo ?? 0;
    return sum + (Number(item.cantidad_devuelta) || 0) * Number(costo);
  }, 0);

  // Sin clamp a 0: el netting del fallback de journal_detail tampoco clampea
  // (cogsDebits - cogsCredits puede ser negativo en períodos donde las
  // devoluciones superan a las ventas). Forzar 0 aquí ocultaría ese efecto y
  // además dispararía el fallback por el chequeo costoVenta === 0.
  return costoVentas - costoDevuelto;
}

// Datos compartidos por el reporte JSON (estado-resultado/route.ts), el PDF
// (pdf/route.ts) y el Excel (excel/route.ts). Extraído a lib porque las tres
// rutas duplicaban inline la misma lógica — el COGS ground truth roto se
// propagó a las tres (la de Excel además usaba códigos de cuenta hardcodeados
// "5.1.01"/"4.1.01"/"4.1.02" que no coinciden con los reales "510101" etc.,
// así que su fallback de journal_detail nunca matcheaba nada).
export async function calcularDatosEstadoResultado(
  supabase: ReturnType<typeof createServiceClient>,
  store_id: string,
  desde: string,
  hasta: string
): Promise<DatosEstadoResultado> {
  let costoVenta = await calcularCostoVentaActual(supabase, store_id, desde, hasta);

  const { data: entries } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("store_id", store_id)
    .gte("fecha", desde)
    .lte("fecha", hasta);

  const entryIds = (entries ?? []).map((e) => e.id);

  let ventaProductos = 0;
  let devoluciones = 0;

  if (entryIds.length > 0) {
    const { data: detalles } = await supabase
      .from("journal_detail")
      .select("cuenta_codigo, debito, credito")
      .in("journal_entry_id", entryIds);

    const sumCuenta = (codigos: string[], campo: "debito" | "credito") =>
      (detalles ?? [])
        .filter((d) => codigos.includes(d.cuenta_codigo))
        .reduce((s, d) => s + Number(d[campo] ?? 0), 0);

    // VENTAS neto: créditos (venta) - débitos (anulación). La anulación
    // invierte el asiento original debitando VENTAS; sin esta resta el
    // estado de resultado mostraría ingresos de ventas ya anuladas.
    const ventaCredits = sumCuenta(INGRESOS_CODIGOS, "credito");
    const ventaDebits = sumCuenta(INGRESOS_CODIGOS, "debito");
    ventaProductos = ventaCredits - ventaDebits;
    devoluciones = sumCuenta(DEVOLUCIONES_CODIGOS, "debito");

    // Fallback: si no hay ventas reales, usar COGS desde asientos contables.
    // También neto: débitos (COGS original) - créditos (reverso COGS por
    // anulación/devolución).
    if (costoVenta === 0) {
      const cogsDebits = sumCuenta(COGS_CODIGOS, "debito");
      const cogsCredits = sumCuenta(COGS_CODIGOS, "credito");
      costoVenta = cogsDebits - cogsCredits;
    }
  }

  return { ventaProductos, devoluciones, costoVenta };
}
