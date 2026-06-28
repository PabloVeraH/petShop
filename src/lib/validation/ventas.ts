import { z } from "zod";
import { UUIDSchema } from "./primitives";

export const VentaItemSchema = z.object({
  producto_id: UUIDSchema,
  cantidad: z.number().positive(),          // decimal for granel (kg), integer for normal
  precioUnitario: z.number().positive().optional(),
  mascota_id: UUIDSchema.optional(),
  es_granel: z.boolean().optional(),
  gramos: z.number().int().positive().optional(),
}).superRefine((val, ctx) => {
  // Granel sin gramos → backend caería silenciosamente al precio de lista
  if (val.es_granel && !val.gramos) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "gramos es requerido para ventas a granel (es_granel=true)",
      path: ["gramos"],
    });
  }
});

export const VentaCreateSchema = z.object({
  clienteId: UUIDSchema.optional(),
  items: z.array(VentaItemSchema).min(1, "La venta debe tener al menos un producto"),
  descuentoPct: z.number().nonnegative().max(100).optional(),
  metodoPago: z.enum(["efectivo", "debito", "credito", "transferencia", "saldo_favor", "plataforma", "nota_credito", "mixto"]),
  notas: z.string().max(500).optional(),
  numeroTransaccion: z.string().optional(),
  canal: z.enum(["pos", "rappi", "pedidosya", "ubereats"]).default("pos"),
  procedencia: z.enum(["presencial", "instagram", "whatsapp", "facebook", "tiktok", "telefonico"]).default("presencial"),
  workerClerkId: z.string().optional(),
  pagoNc: z.object({
    nota_credito_id: UUIDSchema,
    numero_nc: z.string(),
    monto: z.number().positive(),
  }).optional(),
}).superRefine((val, ctx) => {
  if (["debito", "credito", "transferencia"].includes(val.metodoPago) && !val.numeroTransaccion?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "El número de transacción es obligatorio para pagos con débito, crédito o transferencia",
      path: ["numeroTransaccion"],
    });
  }
});

export const PagoSchema = z.object({
  ventaId: UUIDSchema,
  monto: z.number().positive(),
  metodoPago: z.enum(["efectivo", "debito", "credito", "transferencia"]),
  referencia: z.string().max(100).optional(),
  numeroTransaccion: z.string().optional(),
  comprobante: z.string().optional(),
});

export const RecomprasSchema = z.object({
  clienteId: UUIDSchema,
  productoId: UUIDSchema,
  cantidad: z.number().int().positive(),
});

export const FidelizacionSchema = z.object({
  clienteId: UUIDSchema,
  accion: z.enum(["acumular", "canjear"]),
  puntos: z.number().int().positive(),
  description: z.string().max(200).optional(),
});

export const SaldosFavorCreateSchema = z.object({
  clienteId: UUIDSchema,
  monto: z.number().positive(),
  motivo: z.string().max(200).optional(),
});

export const SaldosFavorUsageSchema = z.object({
  clienteId: UUIDSchema,
  ventaId: UUIDSchema,
  monto: z.number().positive(),
});

export const ReciboGetSchema = z.object({
  ventaId: UUIDSchema,
});

export const DashboardQuerySchema = z.object({
  filtro: z.enum(["diario", "semanal", "mensual"]).optional(),
});

export const FidelizacionQuerySchema = z.object({
  clienteId: z.string().uuid("clienteId debe ser un UUID válido"),
});

export const ReportsQuerySchema = z.object({
  periodo: z.coerce.number().int().positive().max(365).default(30),
  canal: z.string().optional(),
});
