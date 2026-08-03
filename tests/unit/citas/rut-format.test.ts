/**
 * Tests U-CITA-19 a U-CITA-26: formateadores de RUT específicos del buscador
 * de /citas (display left-to-right + búsqueda miles-from-right).
 * Archivo nuevo — los formateadores viven en
 * src/app/(app)/citas/components/rut-format.ts (decisión del usuario
 * 2026-08-02: solo en /citas, no se centraliza en src/lib/validation/primitives).
 */
import { autoFormatRUT, formatRUTMiles, pareceRUT } from "@/app/(app)/citas/components/rut-format";

describe("autoFormatRUT (display, left-to-right first-2)", () => {
  // U-CITA-19
  it("U-CITA-19: 1-2 dígitos se devuelven sin formato", () => {
    expect(autoFormatRUT("")).toBe("");
    expect(autoFormatRUT("1")).toBe("1");
    expect(autoFormatRUT("12")).toBe("12");
  });

  // U-CITA-20
  it("U-CITA-20: tercer dígito agrega punto entre 2° y 3° (ancla explícita del usuario)", () => {
    expect(autoFormatRUT("158")).toBe("15.8");
    expect(autoFormatRUT("123")).toBe("12.3");
  });

  // U-CITA-21
  it("U-CITA-21: 4-5 dígitos completan el segundo grupo sin segundo punto", () => {
    expect(autoFormatRUT("1585")).toBe("15.85");
    expect(autoFormatRUT("12345")).toBe("12.345");
  });

  // U-CITA-22
  it("U-CITA-22: 6° dígito agrega punto entre 5° y 6° (ancla explícita del usuario)", () => {
    expect(autoFormatRUT("158552")).toBe("15.855.2");
    expect(autoFormatRUT("123456")).toBe("12.345.6");
  });

  // U-CITA-23
  it("U-CITA-23: 7-8 dígitos del cuerpo completan el tercer grupo sin guion", () => {
    expect(autoFormatRUT("1234567")).toBe("12.345.67");
    expect(autoFormatRUT("12345678")).toBe("12.345.678");
  });

  // U-CITA-24
  it("U-CITA-24: 9 car. (8 cuerpo + DV) separa DV con guion", () => {
    expect(autoFormatRUT("123456789")).toBe("12.345.678-9");
    expect(autoFormatRUT("12345678k")).toBe("12.345.678-K");
    expect(autoFormatRUT("12345678K")).toBe("12.345.678-K");
  });

  // U-CITA-25
  it("U-CITA-25: ruido (puntos, guiones, letras no RUT) se ignora; max 9 car.", () => {
    expect(autoFormatRUT("12.345.678-9")).toBe("12.345.678-9");
    expect(autoFormatRUT("abc 12 def 345 678 9")).toBe("12.345.678-9");
    expect(autoFormatRUT("12345678901234")).toBe("12.345.678-9");
  });
});

describe("formatRUTMiles (búsqueda, miles-from-right)", () => {
  // U-CITA-26
  it("U-CITA-26: 1-3 dígitos sin formato; 4-8 car. en miles-from-right; 9 car. con guion DV", () => {
    expect(formatRUTMiles("")).toBe("");
    expect(formatRUTMiles("1")).toBe("1");
    expect(formatRUTMiles("12")).toBe("12");
    expect(formatRUTMiles("123")).toBe("123");
    expect(formatRUTMiles("1234")).toBe("1.234");
    expect(formatRUTMiles("12345")).toBe("12.345");
    expect(formatRUTMiles("123456")).toBe("123.456");
    expect(formatRUTMiles("1234567")).toBe("1.234.567");
    expect(formatRUTMiles("12345678")).toBe("12.345.678");
    expect(formatRUTMiles("123456789")).toBe("12.345.678-9");
    expect(formatRUTMiles("12345678K")).toBe("12.345.678-K");
  });
});

describe("pareceRUT", () => {
  it("acepta dígitos, dígitos+K/k al final, con o sin puntos/guiones previos", () => {
    expect(pareceRUT("")).toBe(true);
    expect(pareceRUT("1")).toBe(true);
    expect(pareceRUT("1234567")).toBe(true);
    expect(pareceRUT("1234567k")).toBe(true);
    expect(pareceRUT("12.345.678-k")).toBe(true);
    expect(pareceRUT("juan")).toBe(false);
    expect(pareceRUT("12k5")).toBe(false);
  });
});
