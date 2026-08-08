import { z } from "zod";
import { UUIDSchema } from "./primitives";

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/; // mismo regex que servicios.ts — no se centraliza, mismo precedente de inventario.ts/servicios.ts
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Huso horario del negocio (single-tenant Chile — ver es-CL/RUT/IVA en todo
// el proyecto; no hay columna de timezone por tienda en `stores`). Ver
// justificación completa en el comentario de hoyISO() más abajo.
const BUSINESS_TZ = "America/Santiago";

// "Hoy" en formato YYYY-MM-DD según el huso del negocio (BUSINESS_TZ), NO
// según el huso del proceso Node — son cosas distintas y aquí es donde
// falló el intento de fix anterior de este mismo ticket.
//
// `TZ` es una variable de entorno RESERVADA en Vercel (no configurable desde
// project settings: https://vercel.com/docs/environment-variables/reserved-environment-variables)
// y las Vercel Functions heredan el default de AWS Lambda, que es UTC — sin
// excepción, sin importar la región del deployment. Por eso
// `new Date().getFullYear()/getMonth()/getDate()` ("hora local del proceso")
// devuelve exactamente lo mismo que `toISOString().split("T")[0]` en
// producción: ambos son UTC. Un fix anterior de este ticket cambió
// `toISOString()` por esos getters locales asumiendo que reflejarían la hora
// de Chile — verificado que NO es así (simulación con TZ=UTC, como corre
// Vercel realmente: ambas variantes devuelven el mismo valor, un día
// adelantado respecto al "hoy" de Chile durante la franja ~20:00-23:59
// hora local, cuando UTC ya cruzó la medianoche). El bug seguía presente.
//
// Fix real: `Intl.DateTimeFormat` con `timeZone` explícito ignora el TZ del
// proceso — calcula la fecha en BUSINESS_TZ sin importar dónde ni con qué
// huso corra el servidor. formato "en-CA" da directamente YYYY-MM-DD.
// Mismo criterio de negocio que hoyLocal() del frontend
// (src/app/(app)/citas/components/date-utils.ts), que sí es correcto porque
// corre en el navegador del usuario chileno. Comparación lexicográfica de
// strings "YYYY-MM-DD" == comparación cronológica.
const hoyISO = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

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
  // Rama "completar" (Fase 4): metodoPago/numeroTransaccion/pagoNc quedan
  // opcionales a nivel de schema porque la misma acción sirve para citas
  // legado sin precio (§3g), donde no se envía nada de esto. La ruta API
  // decide en runtime si son obligatorios según si la cita tiene precio —
  // Zod valida forma, no la regla de negocio condicional al registro.
  z.object({
    accion: z.literal("completar"),
    metodoPago: z.enum(["efectivo", "debito", "credito", "transferencia"]).optional(),
    numeroTransaccion: z.string().optional(),
    pagoNc: z.object({
      nota_credito_id: UUIDSchema,
      numero_nc: z.string(),
      monto: z.number().positive(),
    }).optional(),
  }).superRefine((val, ctx) => {
    if (["debito", "credito", "transferencia"].includes(val.metodoPago ?? "") && !val.numeroTransaccion?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El número de transacción es obligatorio para pagos con débito, crédito o transferencia",
        path: ["numeroTransaccion"],
      });
    }
  }),
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
