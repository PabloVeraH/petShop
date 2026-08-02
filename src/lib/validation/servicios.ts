import { z } from "zod";

// Regex local (no en primitives.ts): mismo precedente que el regex de fecha
// en inventario.ts, tampoco centralizado — nada más lo usa hoy (YAGNI).
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:MM 24h

// Requisito explícito del usuario: "la duración del servicio (puede ser 30,
// 60 y 90 minutos)". Enum cerrado, NO un rango libre — ver migrations/063.
const DURACION_MINUTOS_VALIDAS = [30, 60, 90] as const;
const DuracionMinutosSchema = z
  .number()
  .refine((v): v is 30 | 60 | 90 => (DURACION_MINUTOS_VALIDAS as readonly number[]).includes(v), {
    message: "La duración debe ser 30, 60 o 90 minutos",
  });

export const ServicioCreateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  descripcion: z.string().max(500).optional(),
  duracion_minutos: DuracionMinutosSchema,
});

export const ServicioUpdateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100).optional(),
  descripcion: z.string().max(500).optional(),
  duracion_minutos: DuracionMinutosSchema.optional(),
  activo: z.boolean().optional(),
});

export const DiaSemanaSchema = z
  .number()
  .int("El día de la semana debe ser un entero")
  .min(1, "El día de la semana debe estar entre 1 (Lunes) y 7 (Domingo)")
  .max(7, "El día de la semana debe estar entre 1 (Lunes) y 7 (Domingo)");

export const ServicioHorarioItemSchema = z
  .object({
    dia_semana: DiaSemanaSchema,
    hora_inicio: z.string().regex(HORA_REGEX, "Formato de hora inválido (use HH:MM)"),
    hora_fin: z.string().regex(HORA_REGEX, "Formato de hora inválido (use HH:MM)"),
  })
  .refine((d) => d.hora_inicio < d.hora_fin, {
    message: "La hora de inicio debe ser anterior a la hora de fin",
    path: ["hora_fin"],
  });

export const ServicioHorariosReplaceSchema = z
  .object({
    horarios: z.array(ServicioHorarioItemSchema).max(7, "No puede haber más de 7 franjas (una por día)"),
  })
  .refine(
    (d) => new Set(d.horarios.map((h) => h.dia_semana)).size === d.horarios.length,
    { message: "No puede repetirse el mismo día de la semana", path: ["horarios"] }
  );
