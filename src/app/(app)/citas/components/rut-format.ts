// Formateadores de RUT específicos del buscador de /citas (decisión del
// usuario 2026-08-02). Se separaron acá — y no en src/lib/validation/primitives.ts
// — porque son helpers de UX para este input, no primitivas de validación del
// sistema: el estándar sigue siendo formatRUT (miles-from-right), usado por
// API routes, PDFs, boletas, vendedores y la persistencia en BD.

// autoFormatRUT (display): agrupa izquierda→derecha con primer grupo de 2 y
// luego grupos de 3: "158" → "15.8", "158552" → "15.855.2",
// "15855222K" → "15.855.222-K". Difiere del estándar miles-from-right por
// decisión explícita del usuario para este buscador de /citas.
//
// Guion del DV solo a 9 car. (8 cuerpo + DV): mientras haya ≤8 car. todo se
// trata como cuerpo sin guion. La K/k del DV, escrita antes de los 8
// dígitos del cuerpo, queda literal dentro del cuerpo formateado (no se
// separa), porque el usuario optó por el corte en 9 car. únicamente.
export function autoFormatRUT(value: string): string {
  const raw = value
    .replace(/[.-]/g, "")
    .replace(/[^0-9kK]/g, "")
    .toUpperCase()
    .slice(0, 9);

  if (raw.length === 0) return "";

  if (raw.length <= 8) return formatCuerpoIzq2(raw);

  const body = raw.slice(0, 8);
  const dv = raw.slice(8);
  return `${formatCuerpoIzq2(body)}-${dv}`;
}

// Formatea el cuerpo sin DV con agrupación izquierda→derecha: primer grupo
// de 2, luego grupos de 3.
export function formatCuerpoIzq2(body: string): string {
  if (body.length <= 2) return body;
  const groups = [body.slice(0, 2)];
  for (let i = 2; i < body.length; i += 3) {
    groups.push(body.slice(i, i + 3));
  }
  return groups.join(".");
}

// formatRUTMiles (término de búsqueda enviado a /api/clientes). Agrupa
// derecha→izquierda de a 3 (estándar chileno, igual que el stored `rut` en
// BD persistido con formatRUT). El backend hace rut.ilike.%s% contra esa
// columna; enviar el término en este formato permite que los prefijos
// parcialmente tipeados coincidan con el prefijo del RUT almacenado.
//
// Misma regla que autoFormatRUT para el DV: guion solo a 9 car. Antes de
// eso todo es cuerpo formateado miles-from-right, sin guion/DV inventado.
// Así, al tipear 5 crudos "12345" se envía "12.345" (substring real del RUT
// almacenado "12.345.678-9") y el backend hace match; enviar el display
// left-to-right ("12.345") en este caso coincide también, pero para 6 crudos
// "123456" el display sería "12.345.6" (no substring de "12.345.678-9")
// mientras que en miles-from-right es "123.456" (no substring tampoco —
// ambos fallan en esa longitud porque cruzan un separador del stored; es
// la limitación esperada de ilike contra la rut persistida formateada).
export function formatRUTMiles(value: string): string {
  const raw = value
    .replace(/[.-]/g, "")
    .replace(/[^0-9kK]/g, "")
    .toUpperCase()
    .slice(0, 9);
  if (raw.length === 0) return "";
  if (raw.length <= 8) {
    return raw.length <= 3
      ? raw
      : raw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
  const body = raw.slice(0, 8);
  const dv = raw.slice(8);
  const bodyFmt = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${bodyFmt}-${dv}`;
}

// ¿Lo escrito hasta ahora podría ser un RUT (dígitos, con un eventual DV k/K
// al final)? Si no, el input se trata como búsqueda por nombre y no se le
// aplica formato. Acepta puntos/guiones como ruido ya digitado.
export function pareceRUT(value: string): boolean {
  return /^[0-9]*[0-9kK]?$/.test(value.replace(/[.-]/g, ""));
}
