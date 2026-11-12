import { z } from "zod";
import { UUIDSchema } from "./primitives";
import { METODOS_PAGO, MAX_PAGOS, validarFormaPagos } from "@/lib/ventas/pagos";

// Un medio de pago de una venta o cita (pago mixto, docs/plan_pago_mixto.md).
export const PagoItemSchema = z.object({
  metodo: z.enum(METODOS_PAGO),
  // >= 0: un pago único de $0 es válido para una venta de $0 (100 % de
  // descuento); validarFormaPagos rechaza $0 cuando hay varios pagos.
  monto: z.number().int("Cada monto debe ser un entero en pesos").nonnegative("Cada monto debe ser mayor a 0"),
  numeroTransaccion: z.string().max(100).optional(),
  notaCreditoId: UUIDSchema.optional(),
});

export const PagosSchema = z
  .array(PagoItemSchema)
  .min(1, "Debe indicar al menos un medio de pago")
  .max(MAX_PAGOS, `Máximo ${MAX_PAGOS} medios de pago por venta`)
  .superRefine((pagos, ctx) => {
    const error = validarFormaPagos(pagos);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  });

// Formato legado (un método + NC opcional). Solo métodos que se pueden pagar
// sin consumir un crédito de otra forma: "saldo_favor", "plataforma" y
// "mixto" registraban un pago "con crédito" sin consumir ningún crédito.
const METODOS_LEGADO = ["efectivo", "debito", "credito", "transferencia", "nota_credito"] as const;

// Reglas comunes de "pagos[] o formato legado, nunca ambos" para venta y cita.
// `legadoOpcional`: la cita legada sin precio no envía ningún dato de pago.
export function refinarPagosOLegado(
  val: { pagos?: unknown; metodoPago?: string; numeroTransaccion?: string; pagoNc?: unknown },
  ctx: z.RefinementCtx,
  legadoOpcional = false
) {
  if (val.pagos !== undefined) {
    if (val.metodoPago !== undefined || val.pagoNc !== undefined || val.numeroTransaccion !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Envíe los pagos en `pagos` o en el formato anterior (metodoPago), no ambos",
        path: ["pagos"],
      });
    }
    return;
  }
  if (val.metodoPago === undefined) {
    if (!legadoOpcional) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Debe indicar los pagos de la venta", path: ["pagos"] });
    }
    return;
  }
  if (val.metodoPago === "nota_credito" && !val.pagoNc) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "El pago con nota de crédito requiere validar la NC",
      path: ["pagoNc"],
    });
  }
  if (["debito", "credito", "transferencia"].includes(val.metodoPago) && !val.numeroTransaccion?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "El número de transacción es obligatorio para pagos con débito, crédito o transferencia",
      path: ["numeroTransaccion"],
    });
  }
}

export const VentaItemSchema = z.object({
  producto_id: UUIDSchema,
  // Granel: informativo (kg); la ruta y la BD lo recalculan desde `gramos`.
  // Por unidad: entero (la BD rechaza fracciones — migración 078).
  cantidad: z.number().positive(),
  precioUnitario: z.number().positive().optional(),
  mascota_id: UUIDSchema.optional(),
  es_granel: z.boolean().optional(),
  gramos: z.number().int().positive().optional(),
  // Granel (G1): el POS confirmó abrir un saco nuevo si el abierto no alcanza.
  abrir_saco: z.boolean().optional(),
}).superRefine((val, ctx) => {
  // Granel sin gramos → backend caería silenciosamente al precio de lista
  if (val.es_granel && !val.gramos) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "gramos es requerido para ventas a granel (es_granel=true)",
      path: ["gramos"],
    });
  }
  if (!val.es_granel && !Number.isInteger(val.cantidad)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "La cantidad debe ser entera (para vender por peso use la venta a granel)",
      path: ["cantidad"],
    });
  }
});

export const VentaCreateSchema = z.object({
  clienteId: UUIDSchema.optional(),
  items: z.array(VentaItemSchema).min(1, "La venta debe tener al menos un producto"),
  descuentoPct: z.number().nonnegative().max(100).optional(),
  // Pago mixto: 1..5 medios. Excluyente con metodoPago/pagoNc/numeroTransaccion.
  pagos: PagosSchema.optional(),
  metodoPago: z.enum(METODOS_LEGADO).optional(),
  notas: z.string().max(255, "Las notas no pueden superar los 255 caracteres").optional().refine(
    (v) => v == null || v.trim().length === 0 || v.trim().length >= 5,
    { message: "Las notas deben tener al menos 5 caracteres" }
  ),
  numeroTransaccion: z.string().optional(),
  canal: z.enum(["pos", "rappi", "pedidosya", "ubereats"]).default("pos"),
  procedencia: z.enum(["presencial", "instagram", "whatsapp", "facebook", "tiktok", "telefonico"]).default("presencial"),
  workerClerkId: z.string().optional(),
  pagoNc: z.object({
    nota_credito_id: UUIDSchema,
    numero_nc: z.string(),
    monto: z.number().positive(),
  }).optional(),
  // UUID generado por el cliente al abrir el modal de pago, reenviado en cada
  // reintento de "Cobrar" dentro del mismo intento de cobro. Permite a
  // crear_venta_tx devolver la venta ya creada en vez de duplicarla si la
  // respuesta del primer intento se perdió en la red (ticket Trello
  // 6a61a067a9350a401550e770). Opcional: callers que no la envíen (o clientes
  // desactualizados) siguen funcionando sin protección de idempotencia.
  idempotencyKey: z.string().uuid().optional(),
}).superRefine((val, ctx) => {
  refinarPagosOLegado(val, ctx);
  // Los canales externos los cobra la plataforma: no hay pago mixto.
  if (val.pagos !== undefined && val.canal !== "pos") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "El pago con varios medios solo aplica a ventas del POS",
      path: ["pagos"],
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
