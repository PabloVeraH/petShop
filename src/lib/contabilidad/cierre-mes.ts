import { createServiceClient } from "@/lib/supabase";
import { CUENTAS } from "./types";

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
    const { data: compras } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("store_id", storeId)
      .eq("tipo_movimiento", "COMPRA")
      .gte("fecha", desde)
      .lte("fecha", hasta);

    const compraIds = (compras ?? []).map((c) => c.id);

    if (compraIds.length > 0) {
      const { data: inventarioLines } = await supabase
        .from("journal_detail")
        .select("debito")
        .in("journal_entry_id", compraIds)
        .eq("cuenta_codigo", CUENTAS.INVENTARIO.codigo);

      cogsEstimado = (inventarioLines ?? []).reduce((s, l) => s + Number(l.debito), 0);
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
