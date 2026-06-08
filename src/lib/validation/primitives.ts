import { z } from "zod";
import { es } from "zod/locales";

z.config(es());

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

export const UUIDSchema = z.string().uuid();
export const RUTSchema = z
  .string()
  .refine((v) => validateRUT(v), { message: "RUT inválido" });
export const PositiveIntSchema = z.number().int().positive();
export const PriceSchema = z.number().positive().multipleOf(0.01);
