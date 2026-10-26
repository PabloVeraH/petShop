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
// ── Fechas del negocio (hora de Chile) ──────────────────────────────────────
// Vercel corre en UTC y `TZ` es una variable reservada (no configurable, ver
// src/lib/validation/citas.ts): `new Date().getDate()`, `setHours(0,0,0,0)`,
// `startOfDay()` de date-fns y `toISOString().split("T")[0]` dan la fecha UTC,
// que entre las ~20:00/21:00 y 24:00 de Chile ya es "mañana". Toda fecha de
// negocio ("hoy", "este mes", la fecha de una venta) se calcula con estas
// funciones, que usan Intl con timeZone explícito y no dependen del TZ del
// proceso.
export const ZONA_NEGOCIO = "America/Santiago";

const formatoFecha = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_NEGOCIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Fecha YYYY-MM-DD de un instante en el huso del negocio. Mismo criterio que
// hoyISO() de src/lib/validation/citas.ts.
export function fechaNegocioISO(instante: Date): string {
  return formatoFecha.format(instante);
}

// "Hoy" del negocio en YYYY-MM-DD.
export function hoyNegocioISO(ahora: Date = new Date()): string {
  return fechaNegocioISO(ahora);
}

// "Hoy" del negocio como YYYYMMDD (prefijo de comprobantes, NC y OC).
export function hoyNegocioCompacto(ahora: Date = new Date()): string {
  return hoyNegocioISO(ahora).replaceAll("-", "");
}

// Año y mes (1-12) actuales del negocio.
export function anioMesNegocio(ahora: Date = new Date()): { anio: number; mes: number } {
  const [anio, mes] = hoyNegocioISO(ahora).split("-").map(Number);
  return { anio, mes };
}

// Suma (o resta) días a una fecha YYYY-MM-DD. Aritmética de calendario pura
// (en UTC solo como soporte de cálculo): no depende del huso ni del horario
// de verano.
export function sumarDiasISO(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

// Días entre dos fechas YYYY-MM-DD (hasta − desde), exacto e independiente
// del horario de verano.
export function diasEntreISO(desdeISO: string, hastaISO: string): number {
  const aUTC = (f: string) => {
    const [y, m, d] = f.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((aUTC(hastaISO) - aUTC(desdeISO)) / 86_400_000);
}

// Fecha del negocio de un timestamp leído de la BD. Las columnas
// `timestamp without time zone` (ventas.created_at, etc.) guardan UTC y
// PostgREST las devuelve SIN zona ("2026-10-23T01:30:00.123456"): new Date()
// las leería como hora local del proceso. Se fuerzan a UTC.
export function instanteDeTimestamp(timestamp: string): Date {
  return new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(timestamp) ? timestamp : `${timestamp}Z`);
}

export function fechaNegocioDeTimestamp(timestamp: string): string {
  return fechaNegocioISO(instanteDeTimestamp(timestamp));
}

// Fecha y hora en formato es-CL y hora de Chile de un timestamp de la BD,
// para textos que arma el servidor (recibo HTML, CSV). Sin timeZone,
// toLocale*String() mostraba la hora UTC del servidor (3-4 h adelantada).
export function fechaHoraNegocioEsCL(timestamp: string): { fecha: string; hora: string } {
  const instante = instanteDeTimestamp(timestamp);
  return {
    fecha: instante.toLocaleDateString("es-CL", { timeZone: ZONA_NEGOCIO }),
    hora: instante.toLocaleTimeString("es-CL", { timeZone: ZONA_NEGOCIO }),
  };
}

// Valor para <input type="datetime-local"> ("YYYY-MM-DDTHH:mm") en la hora
// LOCAL del navegador, la misma con que new Date(valor) lo vuelve a leer al
// guardar. toISOString().slice(0, 16) daba la hora UTC y cada edición corría
// la hora 3-4 h. Solo para código de navegador.
export function aDatetimeLocal(instante: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${instante.getFullYear()}-${p(instante.getMonth() + 1)}-${p(instante.getDate())}T${p(instante.getHours())}:${p(instante.getMinutes())}`;
}

// Instante (UTC) en que empieza el día `fechaISO` en Chile. Normalmente es la
// medianoche local; el día en que empieza el horario de verano la medianoche
// no existe (el reloj salta de 24:00 a 01:00) y el día empieza a la 01:00.
export function inicioDiaNegocio(fechaISO: string): Date {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const medianocheUTC = Date.UTC(y, m - 1, d);
  // Desfase (hora local − UTC) en un instante, en ms.
  const desfase = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: ZONA_NEGOCIO, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).formatToParts(new Date(t)).map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
  };
  let t = medianocheUTC - desfase(medianocheUTC);
  t = medianocheUTC - desfase(t);
  // Ajuste por los cambios de horario: el inicio es el primer instante cuya
  // fecha local es fechaISO (Chile solo usa desfases de horas enteras).
  while (fechaNegocioISO(new Date(t)) < fechaISO) t += 3_600_000;
  while (fechaNegocioISO(new Date(t - 3_600_000)) === fechaISO) t -= 3_600_000;
  return new Date(t);
}

// Rango [desde, hasta) en UTC de un día del negocio, para filtrar columnas
// timestamp (`.gte("created_at", desde).lt("created_at", hasta)`).
export function rangoDiaNegocio(fechaISO: string): { desde: string; hasta: string } {
  return {
    desde: inicioDiaNegocio(fechaISO).toISOString(),
    hasta: inicioDiaNegocio(sumarDiasISO(fechaISO, 1)).toISOString(),
  };
}

// Instante (ISO UTC) en que empezó el mes en curso del negocio.
export function inicioMesNegocio(ahora: Date = new Date()): string {
  return inicioDiaNegocio(`${hoyNegocioISO(ahora).slice(0, 7)}-01`).toISOString();
}

// Día de la semana del negocio (0 = domingo … 6 = sábado), como Date#getDay().
export function diaSemanaNegocio(ahora: Date = new Date()): number {
  const [y, m, d] = hoyNegocioISO(ahora).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
