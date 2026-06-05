import { z } from "zod";
import { es } from "zod/locales";

z.config(es());

/**
 * Validates Chilean RUT format (e.g., "12.345.678-9" or "12345678-9")
 * Includes check digit validation.
 */
export function validateRUT(rut: string): boolean {
  const clean = rut.replace(/[.\-]/g, "");
  if (!/^\d{7,8}[0-9Kk]$/.test(clean)) return false;

  const digits = clean.slice(0, -1);
  const dv = clean.slice(-1).toUpperCase();

  let sum = 0;
  let multiplier = 2;

  for (let i = digits.length - 1; i >= 0; i--) {
    sum += parseInt(digits[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  const expected =
    remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);

  return dv === expected;
}

export function formatRUT(rut: string): string {
  const clean = rut.replace(/[.\-]/g, "");
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
}

// Zod schemas for API boundaries
export const UUIDSchema = z.string().uuid();
export const RUTSchema = z
  .string()
  .refine((v) => validateRUT(v), { message: "RUT inválido" });
export const PositiveIntSchema = z.number().int().positive();
export const PriceSchema = z.number().positive().multipleOf(0.01);

export const ClienteCreateSchema = z.object({
  rut: RUTSchema,
  nombre: z.string().min(3, "El nombre debe tener al menos 3 caracteres").max(100),
  email: z.string().email("Correo electrónico inválido").optional(),
  telefono: z.string().max(20).optional(),
  store_id: UUIDSchema,
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

export const ClienteUpdateSchema = z.object({
  nombre: z.string().min(3, "El nombre debe tener al menos 3 caracteres").max(100).optional(),
  email: z.string().email("Correo electrónico inválido").optional(),
  telefono: z.string().max(20).optional(),
});

export const InventarioUpdateSchema = z.object({
  tipo: z.enum(["entrada", "salida"]),
  cantidad: z.number().int().positive(),
  notas: z.string().max(500).optional(),
});

export const ProveedorCreateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  rut: z.string().max(20).optional(),
  contacto: z.string().max(100).optional(),
  telefono: z.string().max(20).optional(),
  email: z.string().email("Correo electrónico inválido").optional(),
});

export const CategoriaCreateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  descripcion: z.string().max(500).optional(),
});

export const CategoriaUpdateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100).optional(),
  descripcion: z.string().max(500).optional(),
  activo: z.boolean().optional(),
  es_alimento: z.boolean().optional(),
});

export const ProductoCreateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  sku: z.string().min(1, "El SKU es obligatorio").max(50),
  precio: z.number().positive("El precio debe ser mayor a 0"),
  costo: z.number().nonnegative("El costo no puede ser negativo").optional(),
  stock: z.number().int().nonnegative("El stock no puede ser negativo").optional(),
  stock_minimo: z.number().int().nonnegative("El stock mínimo no puede ser negativo").optional(),
  marca: z.string().max(50).optional(),
  peso_gramos: z.number().int().positive("El peso debe ser mayor a 0").optional(),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)").optional(),
  dias_alerta_expira: z.number().int().positive().max(365).optional(),
  precio_oferta: z.number().nonnegative("El precio de oferta no puede ser negativo").optional(),
  en_oferta: z.boolean().optional(),
  categoria_id: UUIDSchema.nullable().optional(),
  codigo_barra: z.string().max(100).optional(),
});

export const ProductoUpdateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100).optional(),
  sku: z.string().min(1, "El SKU es obligatorio").max(50).optional(),
  precio: z.number().positive("El precio debe ser mayor a 0").optional(),
  costo: z.number().nonnegative("El costo no puede ser negativo").optional(),
  stock: z.number().int().nonnegative("El stock no puede ser negativo").optional(),
  stock_minimo: z.number().int().nonnegative("El stock mínimo no puede ser negativo").optional(),
  marca: z.string().max(50).optional(),
  peso_gramos: z.number().int().positive("El peso debe ser mayor a 0").optional(),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)").optional(),
  dias_alerta_expira: z.number().int().positive().max(365).optional(),
  precio_oferta: z.number().nonnegative("El precio de oferta no puede ser negativo").optional(),
  en_oferta: z.boolean().optional(),
  categoria_id: UUIDSchema.nullable().optional(),
  codigo_barra: z.string().max(100).nullable().optional(),
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

export const VentaItemSchema = z.object({
  producto_id: UUIDSchema,
  cantidad: z.number().int().positive(),
  precioUnitario: z.number().positive().optional(),
  mascota_id: UUIDSchema.optional(),
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
});

export const PagoSchema = z.object({
  ventaId: UUIDSchema,
  monto: z.number().positive(),
  metodoPago: z.enum(["efectivo", "debito", "credito", "transferencia"]),
  referencia: z.string().max(100).optional(),
  numeroTransaccion: z.string().optional(),
  comprobante: z.string().optional(),
});

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
  whatsapp_phone_number_id: z.string().max(50).optional(),
  whatsapp_access_token: z.string().max(200).optional(),
  whatsapp_webhook_verify_token: z.string().max(100).optional(),
  email_reminder_enabled: z.boolean().optional(),
  email_reminder_dias_aviso: z.number().int().min(1).max(30).optional(),
  resend_from_email: z.string().email("Correo electrónico inválido").nullable().optional(),
  fidelizacion_niveles: z.array(FidelizacionNivelSchema).max(5).optional(),
  ciudad: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  direccion: z.string().max(300).nullable().optional(),
});

export const ClienteDeleteSchema = z.object({
  confirm: z.literal("DELETE"),
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

export const NotasCreditoCreateSchema = z.object({
  ventaId: UUIDSchema,
  motivo: z.string().min(5, "El motivo debe tener al menos 5 caracteres").max(200),
  monto: z.number().positive("El monto debe ser mayor a 0"),
});

export const SaldosFavorCreateSchema = z.object({
  clienteId: UUIDSchema,
  monto: z.number().positive(),
  motivo: z.string().max(200).optional(),
});

export const RecomprasSchema = z.object({
  clienteId: UUIDSchema,
  productoId: UUIDSchema,
  cantidad: z.number().int().positive(),
});

export const StockMovementsSchema = z.object({
  productoId: UUIDSchema,
  tipo: z.enum(["entrada", "salida", "ajuste"]),
  cantidad: z.number().int(),
  notas: z.string().max(500).optional(),
});

export const FidelizacionSchema = z.object({
  clienteId: UUIDSchema,
  accion: z.enum(["acumular", "canjear"]),
  puntos: z.number().int().positive(),
  description: z.string().max(200).optional(),
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

export const CuentasPagarSchema = z.object({
  proveedorId: UUIDSchema,
  monto: z.number().positive(),
  fechaVencimiento: z.string().datetime(),
  notas: z.string().max(500).optional(),
});

export const CuentasPagarUpdateSchema = z.object({
  estado: z.enum(["pendiente", "pagada", "vencida"]),
});


export const MascotaGetSchema = z.object({
  id: UUIDSchema,
});

export const ReciboGetSchema = z.object({
  ventaId: UUIDSchema,
});

export const DashboardQuerySchema = z.object({
  filtro: z.enum(["diario", "semanal", "mensual"]).optional(),
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

export const SaldosFavorUsageSchema = z.object({
  clienteId: UUIDSchema,
  ventaId: UUIDSchema,
  monto: z.number().positive(),
});

export const ProveedorProductoCreateSchema = z.object({
  proveedor_id: UUIDSchema,
  producto_id: UUIDSchema,
  costo: z.number().positive().optional(),
  tiempo_entrega_dias: z.number().int().positive().optional(),
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

export const OrdenCompraEstadoSchema = z.object({
  estado: z.enum(["pendiente", "enviada", "recibida", "cancelada"]),
  notificar_proveedor: z.boolean().optional(),
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

export const UserDisableSchema = z.object({
  userIds: z.array(z.string()).min(1, "Debes seleccionar al menos un usuario"),
  action: z.enum(["disable", "enable"]),
});

export const ProductoImportRowSchema = z.object({
  sku: z.string().min(1, "SKU es obligatorio").max(100),
  nombre: z.string().min(1, "Nombre es obligatorio").max(255),
  precio: z.number("Precio es obligatorio o inválido").positive("Precio debe ser mayor a 0"),
  costo: z.number().nonnegative().optional(),
  stock: z.number().int().nonnegative().default(0),
  stock_minimo: z.number().int().nonnegative().default(5),
  marca: z.string().max(100).optional(),
  peso_gramos: z.number().int().positive().optional(),
  codigo_barra: z.string().max(100).optional(),
  categoria: z.string().max(100).optional(),
  fecha_vencimiento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (debe ser YYYY-MM-DD)")
    .optional()
    .nullable(),
});

export const LoteCreateSchema = z.object({
  producto_id:       z.string().uuid(),
  numero_lote:       z.string().max(100).optional().nullable(),
  cantidad_inicial:  z.number().int().positive(),
  cantidad_actual:   z.number().int().min(0).optional(),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD'),
  fecha_ingreso:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  orden_compra_id:   z.string().uuid().optional().nullable(),
  notas:             z.string().max(500).optional().nullable(),
});

export const LoteUpdateSchema = z.object({
  numero_lote:       z.string().max(100).optional().nullable(),
  cantidad_actual:   z.number().int().min(0).optional(),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notas:             z.string().max(500).optional().nullable(),
  activo:            z.boolean().optional(),
});

export type LoteCreateInput = z.infer<typeof LoteCreateSchema>;
export type LoteUpdateInput = z.infer<typeof LoteUpdateSchema>;

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

// AI Optimizer schemas
export const OptimizadorVencimientosRequestSchema = z.object({
  diasAlerta: z.number().int().min(1).max(365).optional().default(30),
});

export const AiConfigUpdateSchema = z.object({
  store_id:        z.string().uuid(),
  openrouter_model: z.string().min(3).max(100),
});

export type OptimizadorVencimientosRequestInput = z.infer<typeof OptimizadorVencimientosRequestSchema>;
export type AiConfigUpdateInput = z.infer<typeof AiConfigUpdateSchema>;

// POS Recommender
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
