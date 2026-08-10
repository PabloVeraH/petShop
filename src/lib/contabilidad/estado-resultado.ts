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
// created_at; verificado contra information_schema.columns en producción) —
// la query fallaba en silencio (el resultado desestructuraba solo `data`,
// descartando `error`) y siempre devolvía 0, cayendo al fallback de
// journal_detail (ticket Trello 6a77e779e5698ef7e7e3afda). Ese fallback SÍ
// requiere que el asiento COGS tenga sus líneas de journal_detail — un
// asiento "huérfano" (journal_entries sin journal_detail, ver crearAsiento())
// sería invisible para él, pero esto es un riesgo teórico documentado en
// crearAsiento(), no una causa confirmada: al revisar este ticket no se
// encontró ningún asiento huérfano en producción (los citados en commits
// previos de este fix, #38/#201/#209, tienen su journal_detail completo). La
// causa raíz confirmada es únicamente la columna inexistente arriba.
//
// Fuente de costo: productos.costo, la misma que usa POST /api/ventas
// (costoMap) y el backfill (calcularCostoTotalVenta). Se netea el costo de
// las notas de crédito con restituir_stock=true creadas en el período, porque
// su asiento reverso acredita COGS (lineasNotaCreditoCOGS) — sin esta resta,
// una devolución que devolvió mercadería a inventario seguiría sumando su
// costo como gasto del período.
//
// El netting excluye NCs cuya VENTA esté anulada (join con ventas), no por
// estado de la NC: anular_venta_tx solo marca 'anulada' las NCs que estaban
// 'activa'; una NC 'usada' (consumida como pago de otra venta) queda 'usada'
// aunque su venta se anule después. Sin el filtro por venta, una venta
// anulada se excluye del COGS (arriba, neq estado anulada) pero su NC
// seguiría restando costo — COGS negativo espurio. El journal netea a 0 por
// el reverso de anulación (lineasAnulacionCOGS sobre el pendiente), así que
// el ground truth debe excluir ambos lados de la misma venta anulada.
export async function calcularCostoVentaActual(
  supabase: ReturnType<typeof createServiceClient>,
  store_id: string,
  desde: string,
  hasta: string
): Promise<number> {
  // Observabilidad §20.5: un fallo de query aquí degrada SILENCIOSO (data →
  // null → COGS 0 → fallback a journal_detail sin señal). Se loguea el error
  // para que una regresión de ground truth no quede invisible, sin cambiar el
  // comportamiento: el reporte sigue cayendo al fallback en vez de romper.
  const { data: ventas, error: errVentas } = await supabase
    .from("ventas")
    .select("id")
    .eq("store_id", store_id)
    .neq("estado", "anulada")
    .gte("created_at", desde)
    .lte("created_at", hasta);
  if (errVentas) console.error("[contabilidad] Error consultando ventas para COGS ground truth:", errVentas.message);

  const ventaIds = (ventas ?? []).map((v) => v.id);
  if (ventaIds.length === 0) return 0;

  const { data: items, error: errItems } = await supabase
    .from("venta_items")
    .select("cantidad, productos!inner(costo)")
    .in("venta_id", ventaIds);
  if (errItems) console.error("[contabilidad] Error consultando venta_items para COGS ground truth:", errItems.message);

  const costoVentas = (items ?? []).reduce((sum, item) => {
    const costo = (item.productos as unknown as { costo: number } | null)?.costo ?? 0;
    return sum + (Number(item.cantidad) || 0) * Number(costo);
  }, 0);

  const { data: notas, error: errNotas } = await supabase
    .from("notas_credito")
    .select("id, ventas!inner(estado)")
    .eq("store_id", store_id)
    .neq("ventas.estado", "anulada")
    .gte("created_at", desde)
    .lte("created_at", hasta);
  if (errNotas) console.error("[contabilidad] Error consultando notas_credito para COGS ground truth:", errNotas.message);

  const notaIds = (notas ?? []).map((n) => n.id);
  if (notaIds.length === 0) return costoVentas;

  const { data: ncItems, error: errNcItems } = await supabase
    .from("nota_credito_items")
    .select("cantidad_devuelta, productos!inner(costo)")
    .in("nota_credito_id", notaIds)
    .eq("restituir_stock", true);
  if (errNcItems) console.error("[contabilidad] Error consultando nota_credito_items para COGS ground truth:", errNcItems.message);

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
