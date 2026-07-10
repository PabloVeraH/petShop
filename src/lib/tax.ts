export const IVA_RATE = Number(process.env.NEXT_PUBLIC_IVA_RATE ?? "0.19");

// Regla de negocio: TODOS los precios del sistema son brutos (IVA incluido).
// El IVA siempre se EXTRAE del monto bruto — nunca se suma sobre él.
// Invariante: extraerIva(bruto) + netoDesdeBruto(bruto) === Math.round(bruto)
// para montos enteros en CLP.

/** IVA contenido en un monto bruto (IVA incluido), en pesos enteros. */
export function extraerIva(montoBruto: number): number {
  return Math.round(montoBruto * IVA_RATE / (1 + IVA_RATE));
}

/** Monto neto (sin IVA) de un monto bruto (IVA incluido), en pesos enteros. */
export function netoDesdeBruto(montoBruto: number): number {
  return Math.round(montoBruto) - extraerIva(montoBruto);
}
