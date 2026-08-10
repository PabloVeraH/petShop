import { createServiceClient } from "@/lib/supabase";

export type CierreMesPreview = {
  periodo: string;
  desde: string;
  hasta: string;
  numero_asientos: number;
  total_debitos: number;
  total_creditos: number;
  balanceado: boolean;
  cogs_estimado: number;
  ya_tiene_cierre: boolean;
  asientos_cierre_count: number;
};

type SupabaseClient = ReturnType<typeof createServiceClient>;

export async function checkExistingCierre(
  supabase: SupabaseClient,
  storeId: string,
  periodo: string
): Promise<number> {
  const { data } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("store_id", storeId)
    .eq("tipo_movimiento", "CIERRE_MES")
    .eq("referencia_numero", periodo);
  return data?.length ?? 0;
}

export async function computeCierrePreview(
  supabase: SupabaseClient,
  storeId: string,
  mes: number,
  año: number,
  calcular_costo_venta: boolean
): Promise<CierreMesPreview> {
  const m = String(mes).padStart(2, "0");
  const lastDay = new Date(año, mes, 0).getDate();
  const desde = `${año}-${m}-01`;
  const hasta = `${año}-${m}-${lastDay}`;
  const periodo = `${año}-${m}`;

  const existentes = await checkExistingCierre(supabase, storeId, periodo);

  const { data: entries } = await supabase
    .from("journal_entries")
    .select("id, total_debito, total_credito")
    .eq("store_id", storeId)
    .gte("fecha", desde)
    .lte("fecha", hasta);

  const totalDebitos = (entries ?? []).reduce((s, e) => s + Number(e.total_debito), 0);
  const totalCreditos = (entries ?? []).reduce((s, e) => s + Number(e.total_credito), 0);

  let cogsEstimado = 0;
  let asientosCierreCount = 0;

  if (calcular_costo_venta) {
    // COGS a cerrar = SOLO el de ventas activas del período que TODAVÍA NO
    // tienen su propio asiento COGS (mismo principio "solo faltantes" que
    // POST /api/contabilidad/backfill, que ya hace este mismo chequeo antes
    // de crear su asiento "VENTA (COGS)": journal_entries con
    // tipo_movimiento=VENTA, referencia_id=venta.id, descripcion ILIKE
    // 'COGS%'). El sistema es de inventario PERPETUO — cada venta ya genera
    // su propio asiento COGS en POST /api/ventas (lineasVentaCOGS) — así que
    // recalcular el COGS de TODO el período y sumarlo en un asiento nuevo
    // duplica lo ya contabilizado. Verificado contra producción (ticket
    // Trello 6a77ec78ad60d990e448439e): el asiento 230 (Cierre 2026-08,
    // $65.000, calculado desde costo de COMPRAS) inflaba la cuenta 510101
    // encima de $43.500 ya contabilizados por 6 asientos VENTA/COGS del
    // mismo período — ni siquiera la fórmula "correcta" basada en ventas
    // ($25.500) habría sido correcta como asiento nuevo: para agosto 2026,
    // las 5 ventas activas del período YA tenían su asiento COGS, así que
    // el gap real era $0. La cuenta 510101 se corrigió revirtiendo el
    // asiento 230 (asiento 232, AJUSTE) — no se reemplazó con uno nuevo.
    const { data: ventas } = await supabase
      .from("ventas")
      .select("id")
      .eq("store_id", storeId)
      .neq("estado", "anulada")
      .gte("created_at", desde)
      .lte("created_at", hasta);

    const ventaIds = (ventas ?? []).map((v) => v.id);

    if (ventaIds.length > 0) {
      const { data: asientosCogsExistentes } = await supabase
        .from("journal_entries")
        .select("referencia_id")
        .eq("store_id", storeId)
        .eq("tipo_movimiento", "VENTA")
        .in("referencia_id", ventaIds)
        .ilike("descripcion", "COGS%");

      const ventasConCogs = new Set((asientosCogsExistentes ?? []).map((a) => a.referencia_id));
      const ventaIdsSinCogs = ventaIds.filter((id) => !ventasConCogs.has(id));

      if (ventaIdsSinCogs.length > 0) {
        const { data: items } = await supabase
          .from("venta_items")
          .select("id, cantidad, productos!inner(costo)")
          .in("venta_id", ventaIdsSinCogs);

        cogsEstimado = (items ?? []).reduce((s, item) => {
          const costo = (item.productos as unknown as { costo: number }).costo ?? 0;
          return s + (item.cantidad * Number(costo));
        }, 0);

        const itemIds = (items ?? []).map((i) => i.id);

        if (itemIds.length > 0) {
          const { data: devoluciones } = await supabase
            .from("nota_credito_items")
            .select("cantidad_devuelta, restituir_stock, productos!inner(costo)")
            .in("venta_item_id", itemIds)
            .eq("restituir_stock", true);

          const cogsDevuelto = (devoluciones ?? []).reduce((s, d) => {
            const costo = (d.productos as unknown as { costo: number }).costo ?? 0;
            return s + (d.cantidad_devuelta * Number(costo));
          }, 0);

          // Clamp a 0: a diferencia del Estado de Resultado (estado-resultado.ts,
          // que deliberadamente NO clampea para reflejar COGS neto negativo real
          // de un período), esto es un ESTIMADO del monto a contabilizar en el
          // asiento de cierre — un asiento no puede cerrar COGS negativo (no hay
          // contrapartida válida en el cierre), así que el gap se considera 0.
          cogsEstimado = Math.max(0, cogsEstimado - cogsDevuelto);
        }

        cogsEstimado = Math.round(cogsEstimado);
        if (cogsEstimado > 0) {
          asientosCierreCount = 1;
        }
      }
    }
  }

  return {
    periodo,
    desde,
    hasta,
    numero_asientos: entries?.length ?? 0,
    total_debitos: Math.round(totalDebitos * 100) / 100,
    total_creditos: Math.round(totalCreditos * 100) / 100,
    balanceado: Math.abs(totalDebitos - totalCreditos) < 0.01,
    cogs_estimado: Math.round(cogsEstimado),
    ya_tiene_cierre: existentes > 0,
    asientos_cierre_count: asientosCierreCount,
  };
}
