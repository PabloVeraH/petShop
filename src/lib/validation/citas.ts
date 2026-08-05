import { z } from "zod";
import { UUIDSchema } from "./primitives";

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/; // mismo regex que servicios.ts — no se centraliza, mismo precedente de inventario.ts/servicios.ts
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// "Hoy" en formato YYYY-MM-DD según el reloj del servidor — mismo patrón que
// el resto del proyecto (ver p.ej. src/app/api/dashboard/vencimientos/route.ts,
// src/app/api/reports/route.ts: new Date().toISOString().split("T")[0]).
// Comparación lexicográfica de strings "YYYY-MM-DD" == comparación cronológica.
const hoyISO = () => new Date().toISOString().split("T")[0];

export const CitaCreateSchema = z
  .object({
    servicio_id: UUIDSchema,
    cliente_id: UUIDSchema,
    encargado_id: UUIDSchema, // nuevo, obligatorio (Fase 3, plan_sirvientes §6) — sin .optional()
    mascota_id: UUIDSchema.nullable().optional(),
    fecha: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)"),
    hora_inicio: z.string().regex(HORA_REGEX, "Formato de hora inválido (use HH:MM)"),
    notas: z.string().max(500).optional(),
  })
  // No se pueden agendar citas en fechas pasadas. El date picker del
  // formulario ya pone min=hoy, pero eso es evadible vía API directa —
  // este es el chequeo real (AGENTS.md §8: validar en el límite de
  // confianza, nunca confiar solo en la UI). Hoy mismo SÍ se permite (>=).
  .refine((d) => d.fecha >= hoyISO(), {
    message: "No se pueden agendar citas en fechas pasadas",
    path: ["fecha"],
  });

export const CitaAccionSchema = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("cancelar"),
    motivo: z.string().min(5, "El motivo debe tener al menos 5 caracteres").max(500),
  }),
  z.object({ accion: z.literal("completar") }),
  z.object({ accion: z.literal("no_show") }),
]);

export const CitasQuerySchema = z.object({
  fecha: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)").optional(),
  servicio_id: UUIDSchema.optional(),
  cliente_id: UUIDSchema.optional(),
  encargado_id: UUIDSchema.optional(), // nuevo (Fase 3)
  estado: z.enum(["confirmada", "cancelada", "completada", "no_show"]).optional(),
});

export const DisponibilidadQuerySchema = z.object({
  fecha: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)"),
  encargado_id: UUIDSchema, // nuevo, obligatorio (Fase 3)
});

export const ServicioExcepcionCreateSchema = z
  .object({
    fecha: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)"),
    cerrado: z.boolean(),
    hora_inicio: z.string().regex(HORA_REGEX, "Formato de hora inválido (use HH:MM)").optional(),
    hora_fin: z.string().regex(HORA_REGEX, "Formato de hora inválido (use HH:MM)").optional(),
  })
  .refine(
    (d) => (d.cerrado ? !d.hora_inicio && !d.hora_fin : !!d.hora_inicio && !!d.hora_fin && d.hora_inicio < d.hora_fin),
    {
      message:
        "Si cerrado=true no debe enviar horas; si cerrado=false, hora_inicio y hora_fin son obligatorias y hora_inicio debe ser anterior a hora_fin",
      path: ["hora_inicio"],
    }
  );
