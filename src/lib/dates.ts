// Fechas "date-only" (columnas DATE de Postgres → cadenas "YYYY-MM-DD").
// new Date("2026-05-01") interpreta la cadena como medianoche UTC; formateada
// en América/Santiago (UTC-3/-4) desplaza la fecha 1 día antes
// (ticket Trello 6a77ef3a0ed45ac54505c62a). El sufijo "T00:00:00" parsea en
// hora local y preserva el componente de fecha sin importar el huso del
// proceso (cliente o middleware).

export function parseDateOnlyLocal(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`);
}

export function formatDateOnlyEsCL(isoDate: string): string {
  return parseDateOnlyLocal(isoDate).toLocaleDateString("es-CL");
}
// Fecha YYYY-MM-DD de un instante en el huso del negocio (America/Santiago),
// sin depender del TZ del proceso (Vercel corre en UTC). Mismo criterio que
// hoyISO() de src/lib/validation/citas.ts.
export function fechaNegocioISO(instante: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}
