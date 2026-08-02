// Librería pura de disponibilidad de slots para citas (Fase 2, plan §13).
// Extraída como funciones puras (no inline en la ruta) porque el cálculo es
// de solo lectura — la única sección crítica real es reservar, ya cubierta
// por crear_cita_tx en SQL. Por eso puede vivir en TS y ser unit-testeable
// sin mocks de DB.

export interface RangoHorario {
  hora_inicio: string; // "HH:MM"
  hora_fin: string;
}

// Comparación lexicográfica de strings "HH:MM" de ancho fijo — correcta
// porque el formato garantiza el ancho (mismo truco que los schemas Zod).
export function rangosSuperponen(aInicio: string, aFin: string, bInicio: string, bFin: string): boolean {
  return aInicio < bFin && aFin > bInicio;
}

// "09:00" + 90 → "10:30". No contempla cruce de medianoche (limitación
// documentada — los servicios del catálogo son diurnos).
export function sumarMinutos(hora: string, minutos: number): string {
  const [h, m] = hora.split(":").map(Number);
  const total = h * 60 + m + minutos;
  const hh = Math.floor(total / 60).toString().padStart(2, "0");
  const mm = (total % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

// Genera slots contiguos de `duracionMinutos` dentro de la ventana,
// excluyendo los que se solapan con rangos ocupados. Slots contiguos sin
// espacio entre uno y otro (buffer time es Fase 3).
export function calcularSlotsDisponibles(
  ventana: RangoHorario,
  duracionMinutos: number,
  ocupados: RangoHorario[]
): RangoHorario[] {
  const slots: RangoHorario[] = [];
  let cursor = ventana.hora_inicio;
  while (true) {
    const fin = sumarMinutos(cursor, duracionMinutos);
    if (fin > ventana.hora_fin) break;
    const conflicto = ocupados.some((o) => rangosSuperponen(cursor, fin, o.hora_inicio, o.hora_fin));
    if (!conflicto) slots.push({ hora_inicio: cursor, hora_fin: fin });
    cursor = fin;
  }
  return slots;
}

// Convierte "YYYY-MM-DD" al dia_semana ISO 8601 (1=Lunes ... 7=Domingo) que
// usa servicio_horarios. Se parsea como UTC para que no dependa de la zona
// horaria del servidor Node — coincide con EXTRACT(ISODOW ...) del lado SQL.
export function diaSemanaIsoDesdeFecha(fecha: string): number {
  const d = new Date(`${fecha}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Domingo ... 6=Sábado
  return ((dow + 6) % 7) + 1; // 1=Lunes ... 7=Domingo
}
