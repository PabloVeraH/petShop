import { z } from "zod";
import { UUIDSchema, RUTSchema } from "./primitives";

export const ClienteCreateSchema = z.object({
  rut: RUTSchema,
  nombre: z.string().min(3, "El nombre debe tener al menos 3 caracteres").max(100),
  email: z.string().email("Correo electrónico inválido").optional(),
  telefono: z.string().max(20).optional(),
  store_id: UUIDSchema,
});

export const ClienteUpdateSchema = z.object({
  nombre: z.string().min(3, "El nombre debe tener al menos 3 caracteres").max(100).optional(),
  email: z.string().email("Correo electrónico inválido").optional(),
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
