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
