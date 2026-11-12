// Pagos de ventas para reportes y dashboard (pago mixto, "opción A" de
// docs/pago_complementario.md §4.5): las ventas con metodo_pago='mixto' se
// reparten entre sus métodos reales leyendo `pagos`; el resto sigue usando
// ventas.metodo_pago. El monto a boletear (§4.9) sale de calcularMontoBoleta.
import type { createServiceClient } from "@/lib/supabase";
import { calcularMontoBoleta, desgloseBoleta } from "@/lib/ventas/pagos";

type Supabase = ReturnType<typeof createServiceClient>;
export type PagoReporte = { metodo: string; monto: number };
export type VentaReporte = { id: string; total: number | string; metodo_pago?: string | null; canal?: string | null };

// Una sola query (sin N+1), acotada a la tienda de la sesión: el service role
// omite RLS, así que el filtro store_id es la única barrera (AGENTS.md §6).
export async function cargarPagosPorVenta(
  supabase: Supabase,
  storeId: string,
  ventaIds: string[]
): Promise<Map<string, PagoReporte[]>> {
  const porVenta = new Map<string, PagoReporte[]>();
  const ids = [...new Set(ventaIds.filter(Boolean))];
  if (ids.length === 0) return porVenta;
  const { data } = await supabase
    .from("pagos")
    .select("venta_id, metodo, monto")
    .eq("store_id", storeId)
    .in("venta_id", ids);
  for (const p of (data ?? []) as { venta_id: string; metodo: string; monto: number | string }[]) {
    if (!p.venta_id) continue;
    const lista = porVenta.get(p.venta_id) ?? [];
    lista.push({ metodo: p.metodo, monto: Number(p.monto) });
    porVenta.set(p.venta_id, lista);
  }
  return porVenta;
}

// Pagos de una venta; una venta antigua sin filas en `pagos` se toma como
// pagada entera con su metodo_pago.
export function pagosDeVenta(v: VentaReporte, porVenta: Map<string, PagoReporte[]>): PagoReporte[] {
  const pagos = porVenta.get(v.id);
  if (pagos && pagos.length > 0) return pagos;
  return [{ metodo: v.metodo_pago ?? "efectivo", monto: Number(v.total) }];
}

// Métodos a los que se imputa una venta para agrupar: solo la mixta se reparte.
export function metodosParaAgrupar(v: VentaReporte, porVenta: Map<string, PagoReporte[]>): PagoReporte[] {
  if (v.metodo_pago === "mixto") return pagosDeVenta(v, porVenta);
  return [{ metodo: v.metodo_pago ?? "efectivo", monto: Number(v.total) }];
}

export const esVentaPos = (v: VentaReporte) => (v.canal ?? "pos") === "pos";

// Ventas cuyos pagos hay que leer: las mixtas (reparto) y las del POS (boleta).
export function ventasConPagos(ventas: VentaReporte[]): string[] {
  return ventas.filter((v) => v.metodo_pago === "mixto" || esVentaPos(v)).map((v) => v.id);
}

// Total a boletear de ventas POS (el llamador ya excluye las anuladas) y su
// desglose por método. Las de canal no pasan por el cobro del POS.
export function resumenBoleta(
  ventas: VentaReporte[],
  porVenta: Map<string, PagoReporte[]>
): { montoBoleta: number; boletaPorMetodo: Record<string, number> } {
  let montoBoleta = 0;
  const boletaPorMetodo: Record<string, number> = {};
  for (const v of ventas) {
    if (!esVentaPos(v)) continue;
    const pagos = pagosDeVenta(v, porVenta);
    montoBoleta += calcularMontoBoleta(pagos);
    for (const d of desgloseBoleta(pagos)) boletaPorMetodo[d.metodo] = (boletaPorMetodo[d.metodo] ?? 0) + d.monto;
  }
  return { montoBoleta, boletaPorMetodo };
}
