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