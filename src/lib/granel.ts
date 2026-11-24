// Granel (§4.6 de docs/canales-stock/stock_canales_externos.md, D20):
// productos.stock = sacos cerrados + ROUND(gramos del saco abierto / peso, 3).
// Misma fórmula que fraccion_gramos() en migrations/077 — la BD es la fuente
// de verdad; esto solo descompone el stock para mostrarlo y para decidir en
// el POS si una venta exige abrir un saco nuevo (G1).

import type { SacoAbiertoResumen } from "@/types";

export interface ProductoGranel {
  stock: number;
  peso_gramos?: number | null;
  saco_abierto_gramos?: number | null;
  // Migración 096: puede haber varios sacos abiertos (uno por punto de venta).
  sacos_abiertos?: SacoAbiertoResumen[];
}

const fraccionGramos = (gramos: number, peso: number) =>
  peso > 0 ? Math.round((gramos / peso) * 1000) / 1000 : 0;

export function estadoSacos(prod: ProductoGranel) {
  const peso = Number(prod.peso_gramos ?? 0);
  const gramosAbiertos = Number(prod.saco_abierto_gramos ?? 0);
  // Fracción saco por saco, como fraccion_saco_abierto() en la BD (096): con
  // varios sacos, redondear la suma daría otro valor.
  const fraccion = prod.sacos_abiertos?.length
    ? Math.round(prod.sacos_abiertos.reduce((s, x) => s + fraccionGramos(Number(x.gramos_restantes), peso), 0) * 1000) / 1000
    : fraccionGramos(gramosAbiertos, peso);
  const cerrados = Math.max(0, Math.floor(Number(prod.stock) - fraccion + 1e-9));
  // Stock que no es saco cerrado ni gramos del saco abierto: decimal heredado
  // de S9 (ej. stock 0.2 sin saco abierto). Se corrige con conteo físico (D22);
  // sin mostrarlo, el producto aparecía como "0 sacos + 0 kg".
  const residuo = Math.max(0, Math.round((Number(prod.stock) - cerrados - fraccion) * 1000) / 1000);
  return { peso, gramosAbiertos, cerrados, residuo };
}

// "+0,2 saco sin asignar" (vacío si no hay residuo). El POS lo muestra en una
// línea aparte: dentro del badge desbordaba la tarjeta.
export function textoResiduoSacos(residuo: number): string {
  if (!(residuo > 0)) return "";
  return `+${residuo.toLocaleString("es-CL", { maximumFractionDigits: 3 })} saco sin asignar`;
}

// Sacos abiertos de cada producto (filas de sacos_abiertos con cerrado_at
// null), del más antiguo al más nuevo, y la suma de gramos. Lo usan
// GET /api/productos y GET /api/inventario.
export function agruparSacosAbiertos(
  filas: (SacoAbiertoResumen & { producto_id: string })[]
): Map<string, { gramos: number; sacos: SacoAbiertoResumen[] }> {
  const ordenadas = [...filas].sort((a, b) => a.abierto_at.localeCompare(b.abierto_at) || a.id.localeCompare(b.id));
  const porProducto = new Map<string, { gramos: number; sacos: SacoAbiertoResumen[] }>();
  for (const { producto_id, id, gramos_restantes, nota, abierto_at } of ordenadas) {
    const actual = porProducto.get(producto_id) ?? { gramos: 0, sacos: [] };
    actual.gramos += Number(gramos_restantes);
    actual.sacos.push({ id, gramos_restantes: Number(gramos_restantes), nota, abierto_at });
    porProducto.set(producto_id, actual);
  }
  return porProducto;
}

// "Mesón 2 · 12,5 kg" o, sin nombre, "Saco 1 · 12,5 kg" (orden de apertura).
export function etiquetaSaco(saco: SacoAbiertoResumen, indice: number): string {
  const kg = (saco.gramos_restantes / 1000).toLocaleString("es-CL", { maximumFractionDigits: 3 });
  return `${saco.nota?.trim() || `Saco ${indice + 1}`} · ${kg} kg`;
}

// "9 sacos + 14,5 kg" (G11). Con residuo: "0 sacos + 0 kg (+0,2 saco sin asignar)".
export function formatoSacos(cerrados: number, gramosAbiertos: number, residuo = 0): string {
  const kg = (gramosAbiertos / 1000).toLocaleString("es-CL", { maximumFractionDigits: 3 });
  const base = `${cerrados} saco${cerrados !== 1 ? "s" : ""} + ${kg} kg`;
  const extra = textoResiduoSacos(residuo);
  return extra ? `${base} (${extra})` : base;
}
