// Precio por canal (D7, D13, D14 — §4.5). Precios brutos en CLP enteros
// (IVA incluido, AGENTS.md §23.3). Sin I/O.

export interface PrecioProducto {
  precio: number | null;
  precio_oferta?: number | null;
  en_oferta?: boolean | null;
}

// D13: precio base = precio_oferta si el producto está en oferta, si no precio.
export function precioBase(p: PrecioProducto): number | null {
  if (p.en_oferta && p.precio_oferta != null && Number(p.precio_oferta) > 0) {
    return Number(p.precio_oferta);
  }
  return p.precio != null ? Number(p.precio) : null;
}

// D7 + D14: override del producto si existe; si no, base × (1 + recargo%),
// redondeado HACIA ARRIBA a la decena. Aritmética en enteros (centésimas de
// porcentaje) para no arrastrar error de punto flotante:
// 1000 × 1,15 = 1150.0000000000002 en float, y ceil a la decena daría 1160.
export function precioCanal(base: number, recargoPct: number, override?: number | null): number {
  if (override != null && override > 0) return Math.round(override);
  if (!(base > 0)) throw new Error("Precio base inválido");
  if (!(recargoPct >= 0)) throw new Error("Recargo inválido");
  // base (CLP entero) × (100 + recargo con 2 decimales) → exacto en centésimas.
  const escalado = Math.round(Math.round(base) * Math.round((100 + recargoPct) * 100)); // precio × 10 000
  return Math.ceil(escalado / 100_000) * 10;
}
