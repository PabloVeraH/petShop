// Granel (§4.6 de docs/canales-stock/stock_canales_externos.md, D20):
// productos.stock = sacos cerrados + ROUND(gramos del saco abierto / peso, 3).
// Misma fórmula que fraccion_gramos() en migrations/077 — la BD es la fuente
// de verdad; esto solo descompone el stock para mostrarlo y para decidir en
// el POS si una venta exige abrir un saco nuevo (G1).

export interface ProductoGranel {
  stock: number;
  peso_gramos?: number | null;
  saco_abierto_gramos?: number | null;
}

export function estadoSacos(prod: ProductoGranel) {
  const peso = Number(prod.peso_gramos ?? 0);
  const gramosAbiertos = Number(prod.saco_abierto_gramos ?? 0);
  const fraccion = peso > 0 ? Math.round((gramosAbiertos / peso) * 1000) / 1000 : 0;
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

// "9 sacos + 14,5 kg" (G11). Con residuo: "0 sacos + 0 kg (+0,2 saco sin asignar)".
export function formatoSacos(cerrados: number, gramosAbiertos: number, residuo = 0): string {
  const kg = (gramosAbiertos / 1000).toLocaleString("es-CL", { maximumFractionDigits: 3 });
  const base = `${cerrados} saco${cerrados !== 1 ? "s" : ""} + ${kg} kg`;
  const extra = textoResiduoSacos(residuo);
  return extra ? `${base} (${extra})` : base;
}
