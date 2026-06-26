import { z } from "zod";
import { UUIDSchema } from "./primitives";

export const ProveedorCreateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  rut: z.string().max(20).optional(),
  contacto: z.string().max(100).optional(),
  telefono: z.string().max(20).optional(),
  email: z.string().email("Correo electrónico inválido").optional(),
});

export const ProveedorUpdateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100).optional(),
  rut: z.string().max(20).optional(),
  contacto: z.string().max(100).optional(),
  telefono: z.string().max(20).optional(),
  email: z.string().email("Correo electrónico inválido").optional(),
});

export const ProveedorProductoSchema = z.object({
  proveedorId: UUIDSchema,
  productoId: UUIDSchema,
  precioCosto: z.number().positive(),
  activo: z.boolean().optional(),
});

export const ProveedorProductoCreateSchema = z.object({
  proveedor_id: UUIDSchema,
  producto_id: UUIDSchema,
  costo: z.number().positive().optional(),
  tiempo_entrega_dias: z.number().int().positive().optional(),
});

export const CuentasPagarSchema = z.object({
  proveedorId: UUIDSchema,
  monto: z.number().positive(),
  fechaVencimiento: z.string().datetime(),
  notas: z.string().max(500).optional(),
});

export const CuentasPagarUpdateSchema = z.object({
  estado: z.enum(["pendiente", "pagada", "vencida"]),
  metodo_pago: z.enum(["efectivo", "debito", "credito", "transferencia"]).optional(),
});

export const NotasCreditoCreateSchema = z.object({
  ventaId: UUIDSchema,
  motivo: z.string().min(5, "El motivo debe tener al menos 5 caracteres").max(200),
  monto: z.number().positive("El monto debe ser mayor a 0"),
});

export const NotaCreditoPostSchema = z.object({
  ventaId: UUIDSchema,
  items: z.array(z.object({
    ventaItemId: UUIDSchema,
    cantidadDevuelta: z.number().int().positive(),
    restituirStock: z.boolean().optional(),
  })).min(1),
  tipoReembolso: z.enum(["reembolso_directo", "saldo_a_favor"]),
  metodoReembolso: z.string().max(100).nullable().optional(),
  motivo: z.string().max(500).nullable().optional(),
});

export const OrdenesCompraCreateSchema = z.object({
  proveedorId: UUIDSchema,
  items: z.array(z.object({
    productoId: UUIDSchema,
    cantidad: z.number().int().positive(),
    precioUnitario: z.number().positive(),
  })).min(1),
  notas: z.string().max(500).optional(),
});

export const OrdenCompraItemCreateSchema = z.object({
  producto_id: UUIDSchema.optional(),
  nombre_nuevo: z.string().min(1).max(200).optional(),
  cantidad_solicitada: z.number().int().positive(),
}).refine(
  (d) => d.producto_id || d.nombre_nuevo,
  { message: "Debe proveer producto_id o nombre_nuevo" }
);

export const OrdenCompraCreateSchema = z.object({
  proveedor_id: UUIDSchema,
  items: z.array(OrdenCompraItemCreateSchema).min(1),
  fecha_estimada: z.string().datetime().optional(),
  notas: z.string().max(500).optional(),
});

export const OrdenCompraReceiveItemSchema = z.object({
  id: UUIDSchema,
  cantidad_recibida: z.number().int().min(0),
  precio_unitario: z.number().nonnegative(),
  producto_id: UUIDSchema.optional(),
  nombre_nuevo: z.string().min(1).max(200).optional(),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  numero_lote: z.string().max(100).optional(),
});

export const OrdenCompraReceiveSchema = z.object({
  action: z.literal("recibir"),
  items: z.array(OrdenCompraReceiveItemSchema).min(1),
});

export const OrdenCompraEditItemsSchema = z.object({
  action: z.literal("edit_items"),
  items: z.array(OrdenCompraItemCreateSchema).min(1),
});

export const OrdenCompraEstadoSchema = z.object({
  estado: z.enum(["pendiente", "enviada", "recibida", "cancelada"]),
  notificar_proveedor: z.boolean().optional(),
});
