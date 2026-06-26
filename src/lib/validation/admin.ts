import { z } from "zod";
import { UUIDSchema, validateRUT } from "./primitives";

export const FidelizacionNivelSchema = z.object({
  monto: z.number().int().positive("El monto debe ser mayor a 0"),
  descuento: z.number().int().min(1).max(100, "El descuento debe estar entre 1 y 100"),
});

export const SettingsUpdateSchema = z.object({
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100).optional(),
  rut: z.string().max(20).optional(),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email("Correo electrónico inválido").optional(),
  whatsapp_enabled: z.boolean().optional(),
  whatsapp_phone_number_id: z.string().max(50).nullable().optional(),
  whatsapp_access_token: z.string().max(200).optional(),
  whatsapp_webhook_verify_token: z.string().max(100).nullable().optional(),
  email_reminder_enabled: z.boolean().optional(),
  email_reminder_dias_aviso: z.number().int().min(1).max(30).optional(),
  resend_from_email: z.string().email("Correo electrónico inválido").nullable().optional(),
  fidelizacion_niveles: z.array(FidelizacionNivelSchema).max(5).optional(),
  ciudad: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  direccion: z.string().max(300).nullable().optional(),
});

export const AdminUserAssignSchema = z.object({
  email: z.string().email("Correo electrónico inválido"),
  storeId: UUIDSchema,
  role: z.enum(["storeAdmin", "storeWorker"]),
});

export const AdminStoreCreateSchema = z.object({
  name: z.string().min(3, "El nombre debe tener al menos 3 caracteres").max(100),
  rut: z.string().max(20).optional(),
  email: z.string().email("Correo electrónico inválido").optional(),
  phone: z.string().max(20).optional(),
});

export const AdminUserCreateFullSchema = z.object({
  email: z.string().email("Correo electrónico inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  firstName: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  lastName: z.string().min(2, "El apellido debe tener al menos 2 caracteres").max(100),
  storeId: UUIDSchema.optional(),
  role: z.enum(["storeAdmin", "storeWorker", "systemAdmin"]),
  rut: z.string().max(20).optional(),
  meta_ventas: z.number().positive().optional(),
});

export const UserDisableSchema = z.object({
  userIds: z.array(z.string()).min(1, "Debes seleccionar al menos un usuario"),
  action: z.enum(["disable", "enable"]),
});

export const LicenseConfigSchema = z.object({
  license_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  license_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  license_warning_days: z.number().int().min(1).max(90).optional(),
}).refine(
  (data) => {
    if (data.license_start_date && data.license_end_date) {
      return new Date(data.license_start_date) <= new Date(data.license_end_date);
    }
    return true;
  },
  { message: "license_start_date debe ser anterior o igual a license_end_date" }
);

export const AuditLogsQuerySchema = z.object({
  store_id: UUIDSchema.optional(),
  user_id: z.string().optional(),
  action: z.enum(["CREATE", "UPDATE", "DELETE", "LOGIN_FAILED", "EXPORT", "SETTINGS", "BAN_USER", "UNBAN_USER"]).optional(),
  entity_type: z.string().max(50).optional(),
  result: z.enum(["success", "failure", "partial"]).optional(),
  desde: z.string().datetime().optional(),
  hasta: z.string().datetime().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ErrorLogsQuerySchema = z.object({
  store_id: UUIDSchema.optional(),
  severity: z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]).optional(),
  resolved: z.enum(["true", "false"]).optional(),
  endpoint: z.string().max(200).optional(),
  desde: z.string().datetime().optional(),
  hasta: z.string().datetime().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const UserSessionsQuerySchema = z.object({
  store_id: UUIDSchema.optional(),
  user_id: z.string().optional(),
  event_type: z.enum(["session.created", "session.ended", "session.removed"]).optional(),
  desde: z.string().datetime().optional(),
  hasta: z.string().datetime().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const OptimizadorVencimientosRequestSchema = z.object({
  diasAlerta: z.number().int().min(1).max(365).optional().default(30),
});

export const AiConfigUpdateSchema = z.object({
  store_id:        z.string().uuid(),
  openrouter_model: z.string().min(3).max(100),
});

export type OptimizadorVencimientosRequestInput = z.infer<typeof OptimizadorVencimientosRequestSchema>;
export type AiConfigUpdateInput = z.infer<typeof AiConfigUpdateSchema>;

export const POSRecomendadorRequestSchema = z.object({
  clienteId:     z.string().uuid().optional(),
  mascotaId:     z.string().uuid().optional(),
  itemsCarrito: z.array(z.object({
    producto_id: z.string().uuid(),
    nombre:      z.string(),
    categoria:   z.string().optional(),
  })).max(50),
});

export type POSRecomendadorRequestInput = z.infer<typeof POSRecomendadorRequestSchema>;

export const WorkerUpdateSchema = z.object({
  clerk_id: z.string().min(1, "clerk_id requerido"),
  rut: z.string().max(20).optional().nullable().refine(
    (v) => v === undefined || v === null || v === "" || validateRUT(v),
    { message: "RUT inválido" },
  ),
  meta_ventas: z.coerce.number().min(0).optional().nullable(),
});
