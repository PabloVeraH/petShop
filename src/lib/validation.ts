import { z } from "zod";

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
  nombre: z.string().min(3).max(100),
  email: z.string().email().optional(),
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
});

export const ClienteUpdateSchema = z.object({
  nombre: z.string().min(3).max(100).optional(),
  email: z.string().email().optional(),
  telefono: z.string().max(20).optional(),
});

export const InventarioUpdateSchema = z.object({
  tipo: z.enum(["entrada", "salida"]),
  cantidad: z.number().int().positive(),
  notas: z.string().max(500).optional(),
});

export const ProveedorCreateSchema = z.object({
  nombre: z.string().min(2).max(100),
  rut: z.string().max(20).optional(),
  contacto: z.string().max(100).optional(),
  telefono: z.string().max(20).optional(),
  email: z.string().email().optional(),
});

export const ProductoCreateSchema = z.object({
  nombre: z.string().min(2).max(100),
  sku: z.string().min(1).max(50),
  precio: z.number().positive(),
  costo: z.number().nonnegative().optional(),
  stock: z.number().int().nonnegative().optional(),
  stock_minimo: z.number().int().nonnegative().optional(),
  marca: z.string().max(50).optional(),
  peso_gramos: z.number().int().positive().optional(),
  fecha_vencimiento: z.string().datetime().optional(),
  dias_alerta: z.number().int().positive().max(365).optional(),
  precio_oferta: z.number().nonnegative().optional(),
  en_oferta: z.boolean().optional(),
});

export const ProductoUpdateSchema = z.object({
  nombre: z.string().min(2).max(100).optional(),
  sku: z.string().min(1).max(50).optional(),
  precio: z.number().positive().optional(),
  costo: z.number().nonnegative().optional(),
  stock: z.number().int().nonnegative().optional(),
  stock_minimo: z.number().int().nonnegative().optional(),
  marca: z.string().max(50).optional(),
  peso_gramos: z.number().int().positive().optional(),
  fecha_vencimiento: z.string().datetime().optional(),
  dias_alerta: z.number().int().positive().max(365).optional(),
  precio_oferta: z.number().nonnegative().optional(),
  en_oferta: z.boolean().optional(),
});

export const MascotaUpdateSchema = z.object({
  nombre: z.string().min(2).max(50).optional(),
  tipo: z.enum(["perro", "gato", "otro"]).optional(),
  raza: z.string().max(50).optional(),
  peso_kg: z.number().positive().max(100).optional(),
  alimento_habitual_id: UUIDSchema.optional(),
});

export const VendedorCreateSchema = z.object({
  nombre: z.string().min(3).max(100),
  email: z.string().email(),
  telefono: z.string().max(20).optional(),
  activo: z.boolean().optional(),
});

export const VentaItemSchema = z.object({
  producto_id: UUIDSchema,
  cantidad: z.number().int().positive(),
  precioUnitario: z.number().positive().optional(),
  mascota_id: UUIDSchema.optional(),
});

export const VentaCreateSchema = z.object({
  clienteId: UUIDSchema,
  items: z.array(VentaItemSchema).min(1),
  descuento: z.number().nonnegative().max(100).optional(),
  metodoPago: z.enum(["efectivo", "debito", "credito", "transferencia", "saldo_favor"]),
  notas: z.string().max(500).optional(),
  numeroTransaccion: z.string().optional(),
});

export const PagoSchema = z.object({
  ventaId: UUIDSchema,
  monto: z.number().positive(),
  metodoPago: z.enum(["efectivo", "debito", "credito", "transferencia"]),
  referencia: z.string().max(100).optional(),
  numeroTransaccion: z.string().optional(),
  comprobante: z.string().optional(),
});

export const SettingsUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  rut: z.string().max(20).optional(),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  whatsapp_enabled: z.boolean().optional(),
  whatsapp_phone_number_id: z.string().max(50).optional(),
  whatsapp_access_token: z.string().max(200).optional(),
  whatsapp_webhook_verify_token: z.string().max(100).optional(),
});

export const ClienteDeleteSchema = z.object({
  confirm: z.literal("DELETE"),
});

export const VendedorUpdateSchema = z.object({
  nombre: z.string().min(3).max(100).optional(),
  email: z.string().email().optional(),
  telefono: z.string().max(20).optional(),
  activo: z.boolean().optional(),
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
  motivo: z.string().min(5).max(200),
  monto: z.number().positive(),
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
  nombre: z.string().min(2).max(100).optional(),
  rut: z.string().max(20).optional(),
  contacto: z.string().max(100).optional(),
  telefono: z.string().max(20).optional(),
  email: z.string().email().optional(),
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
