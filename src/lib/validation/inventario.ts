import { z } from "zod";
import { UUIDSchema } from "./primitives";

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

export const InventarioUpdateSchema = z.object({
  tipo: z.enum(["entrada", "salida"]),
  cantidad: z.number().int().positive(),
  notas: z.string().max(500).optional(),
});

export const ProductoCreateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  sku: z.string().min(1, "El SKU es obligatorio").max(50),
  precio: z.number().positive("El precio debe ser mayor a 0"),
  costo: z.number().nonnegative("El costo no puede ser negativo").optional(),
  stock: z.number().nonnegative("El stock no puede ser negativo").optional(),
  stock_minimo: z.number().nonnegative("El stock mínimo no puede ser negativo").optional(),
  marca: z.string().max(50).optional(),
  peso_gramos: z.number().int().positive("El peso debe ser mayor a 0").optional(),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)").optional(),
  dias_alerta_expira: z.number().int().positive().max(365).optional(),
  precio_oferta: z.number().nonnegative("El precio de oferta no puede ser negativo").optional(),
  en_oferta: z.boolean().optional(),
  categoria_id: UUIDSchema.nullable().optional(),
  codigo_barra: z.string().max(100).nullable().optional(),
  precio_venta_kg: z.number().positive("El precio por kg debe ser mayor a 0").nullable().optional(),
}).refine(
  (data) => !(data.precio_venta_kg && !data.peso_gramos),
  { message: "El peso por unidad (gramos) es obligatorio para productos granel", path: ["peso_gramos"] }
);

export const ProductoUpdateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100).optional(),
  sku: z.string().min(1, "El SKU es obligatorio").max(50).optional(),
  precio: z.number().positive("El precio debe ser mayor a 0").optional(),
  costo: z.number().nonnegative("El costo no puede ser negativo").optional(),
  stock: z.number().nonnegative("El stock no puede ser negativo").optional(),
  stock_minimo: z.number().nonnegative("El stock mínimo no puede ser negativo").optional(),
  marca: z.string().max(50).optional(),
  peso_gramos: z.number().int().positive("El peso debe ser mayor a 0").optional(),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)").optional(),
  dias_alerta_expira: z.number().int().positive().max(365).optional(),
  precio_oferta: z.number().nonnegative("El precio de oferta no puede ser negativo").optional(),
  en_oferta: z.boolean().optional(),
  categoria_id: UUIDSchema.nullable().optional(),
  codigo_barra: z.string().max(100).nullable().optional(),
  precio_venta_kg: z.number().positive("El precio por kg debe ser mayor a 0").nullable().optional(),
}).refine(
  (data) => !(data.precio_venta_kg && !data.peso_gramos),
  { message: "El peso por unidad (gramos) es obligatorio para productos granel", path: ["peso_gramos"] }
);

export const StockMovementsSchema = z.object({
  productoId: UUIDSchema,
  tipo: z.enum(["entrada", "salida", "ajuste"]),
  cantidad: z.number().int(),
  notas: z.string().max(500).optional(),
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
