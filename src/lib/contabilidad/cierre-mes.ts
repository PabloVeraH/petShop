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
    // COGS real del período = costo de mercancía de las ventas ACTIVAS
    // (no anuladas, no devueltas). Se calcula desde los datos de venta
    // (productos.costo, misma base que el asiento COGS por venta en
    // POST /api/ventas y que el backfill) menos el costo devuelto por
    // notas de crédito con restituir_stock=true. Usar el costo de COMPRAS
    // (débito a Inventario de asientos COMPRA) genera un monto erróneo:
    // no representa lo vendido (ticket Trello 6a77ec78ad60d990e448e439).
    const { data: ventas } = await supabase
      .from("ventas")
      .select("id")
      .eq("store_id", storeId)
      .neq("estado", "anulada")
      .gte("created_at", desde)
      .lte("created_at", hasta);

    const ventaIds = (ventas ?? []).map((v) => v.id);

    if (ventaIds.length > 0) {
      const { data: items } = await supabase
        .from("venta_items")
        .select("id, cantidad, productos!inner(costo)")
        .in("venta_id", ventaIds);

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

        cogsEstimado = Math.max(0, cogsEstimado - cogsDevuelto);
      }

      cogsEstimado = Math.round(cogsEstimado);
      if (cogsEstimado > 0) {
        asientosCierreCount = 1;
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
