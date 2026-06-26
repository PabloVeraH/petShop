import { z } from "zod";
import { UUIDSchema, RUTSchema } from "./primitives";

// Acepta email válido, string vacío (→null para borrar) o ausencia. Rechaza formatos inválidos.
const emailField = z.preprocess(
  (v) => (v === "" ? null : v),
  z.string().email("Correo electrónico inválido").nullable().optional()
);

export const ClienteCreateSchema = z.object({
  rut: RUTSchema,
  nombre: z.string().min(3, "El nombre debe tener al menos 3 caracteres").max(100),
  email: emailField,
  telefono: z.string().max(20).optional(),
  store_id: UUIDSchema,
});

export const ClienteUpdateSchema = z.object({
  rut: RUTSchema.optional(),
  nombre: z.string().min(3, "El nombre debe tener al menos 3 caracteres").max(100).optional(),
  email: emailField,
  telefono: z.string().max(20).optional(),
});

export const ClienteDeleteSchema = z.object({
  confirm: z.literal("DELETE"),
});

export const MascotaCreateSchema = z.object({
  cliente_id: UUIDSchema,
  nombre: z.string().min(2).max(50),
  tipo: z.enum(["perro", "gato", "otro"]),
  raza: z.string().max(50).optional(),
  peso_kg: z.number().positive().max(100).optional(),
  alimento_habitual_id: UUIDSchema.optional(),
  gramos_porcion: z.number().positive().optional(),
  veces_dia: z.number().int().positive().optional(),
});

export const MascotaUpdateSchema = z.object({
  nombre: z.string().min(2).max(50).optional(),
  tipo: z.enum(["perro", "gato", "otro"]).optional(),
  raza: z.string().max(50).optional(),
  peso_kg: z.number().positive().max(100).optional(),
  alimento_habitual_id: UUIDSchema.optional(),
  gramos_porcion: z.number().positive().optional(),
  veces_dia: z.number().int().positive().optional(),
});

export const MascotaGetSchema = z.object({
  id: UUIDSchema,
});
