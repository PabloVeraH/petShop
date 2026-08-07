// Fecha local del navegador en formato YYYY-MM-DD. Deliberadamente NO usa
// `new Date().toISOString().split("T")[0]` (el patrón usado server-side en
// este proyecto): toISOString() convierte a UTC primero, lo que retrocede un
// día cerca de medianoche en husos horarios negativos (ej. Chile, UTC-3/4).
// Compartido entre CitasTab (filtro) y NuevaCitaForm (valor inicial + min).
export function hoyLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Fecha/hora de un timestamp ISO en zona horaria local del navegador, formato
// "DD/MM/YYYY HH:MM". NO usa toLocaleString(): su salida varía según el
// locale/ICU del entorno (a. m. vs AM, año de 2 vs 4 dígitos), lo que la
// haría frágil de testear. Usado para mostrar cancelado_at y created_at.
export function formatFechaHora(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
