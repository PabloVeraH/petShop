import {
  validateRUT,
  formatRUT,
  ClienteCreateSchema,
  MascotaCreateSchema,
} from "@/lib/validation";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("lib/validation", () => {
  // U-01
  it("U-01: validateRUT acepta RUT válido con puntos y guión", () => {
    expect(validateRUT("11.111.111-1")).toBe(true);
  });

  // U-02
  it("U-02: validateRUT rechaza RUT con DV incorrecto", () => {
    expect(validateRUT("12.345.678-9")).toBe(false);
  });

  // U-03
  it("U-03: validateRUT rechaza string vacío", () => {
    expect(validateRUT("")).toBe(false);
  });

  // U-04
  it("U-04: validateRUT rechaza RUT muy corto (< 7 dígitos en cuerpo)", () => {
    expect(validateRUT("1-9")).toBe(false);
  });

  it("validateRUT acepta RUT con DV = K", () => {
    expect(validateRUT("1.111.119-K")).toBe(true);
  });

  it("validateRUT acepta RUT sin puntos", () => {
    expect(validateRUT("11111111-1")).toBe(true);
  });

  // U-05
  it("U-05: formatRUT formatea sin puntos ni guión a formato estándar", () => {
    expect(formatRUT("11111111-1")).toBe("11.111.111-1");
  });

  // U-06
  it("U-06: formatRUT es idempotente con formato ya correcto", () => {
    expect(formatRUT("11.111.111-1")).toBe("11.111.111-1");
  });

  // U-07
  it("U-07: ClienteCreateSchema acepta datos válidos", () => {
    const result = ClienteCreateSchema.safeParse({
      rut: "11.111.111-1",
      nombre: "Juan Pérez",
      store_id: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  // U-08
  it("U-08: ClienteCreateSchema rechaza RUT inválido", () => {
    const result = ClienteCreateSchema.safeParse({
      rut: "12.345.678-9",
      nombre: "Juan Pérez",
      store_id: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  // U-09
  it("U-09: MascotaCreateSchema acepta datos mínimos válidos", () => {
    const result = MascotaCreateSchema.safeParse({
      cliente_id: VALID_UUID,
      nombre: "Firulais",
      tipo: "perro",
    });
    expect(result.success).toBe(true);
  });

  it("MascotaCreateSchema rechaza tipo fuera del enum", () => {
    const result = MascotaCreateSchema.safeParse({
      cliente_id: VALID_UUID,
      nombre: "Firulais",
      tipo: "hamster",
    });
    expect(result.success).toBe(false);
  });
});
