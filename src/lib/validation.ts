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
  peso_kg: z.number().positive().optional(),
  alimento_habitual_id: UUIDSchema.optional(),
});
