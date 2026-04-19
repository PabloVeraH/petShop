import {
  validateRUT,
  formatRUT,
  ClienteCreateSchema,
  MascotaCreateSchema,
  CategoriaCreateSchema,
  CategoriaUpdateSchema,
  ProductoCreateSchema,
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

describe("CategoriaCreateSchema", () => {
  it("U-CAT-01: acepta nombre válido", () => {
    expect(CategoriaCreateSchema.safeParse({ nombre: "Alimentos" }).success).toBe(true);
  });

  it("U-CAT-02: acepta nombre + descripción", () => {
    expect(CategoriaCreateSchema.safeParse({ nombre: "Accesorios", descripcion: "Collares, correas, etc." }).success).toBe(true);
  });

  it("U-CAT-03: nombre < 2 chars → inválido", () => {
    expect(CategoriaCreateSchema.safeParse({ nombre: "A" }).success).toBe(false);
  });

  it("U-CAT-04: nombre > 100 chars → inválido", () => {
    expect(CategoriaCreateSchema.safeParse({ nombre: "A".repeat(101) }).success).toBe(false);
  });

  it("U-CAT-05: nombre faltante → inválido", () => {
    expect(CategoriaCreateSchema.safeParse({}).success).toBe(false);
  });

  it("U-CAT-06: descripción > 500 chars → inválido", () => {
    expect(CategoriaCreateSchema.safeParse({ nombre: "Test", descripcion: "A".repeat(501) }).success).toBe(false);
  });
});

describe("CategoriaUpdateSchema", () => {
  it("U-CAT-07: todos los campos opcionales → objeto vacío es válido", () => {
    expect(CategoriaUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("U-CAT-08: activo:false válido", () => {
    expect(CategoriaUpdateSchema.safeParse({ activo: false }).success).toBe(true);
  });

  it("U-CAT-09: nombre + descripcion parcial → válido", () => {
    expect(CategoriaUpdateSchema.safeParse({ nombre: "Medicamentos" }).success).toBe(true);
  });
});

describe("ProductoCreateSchema con categoria_id", () => {
  it("U-CAT-10: acepta categoria_id UUID válido", () => {
    const result = ProductoCreateSchema.safeParse({
      nombre: "Alimento Premium",
      sku: "ALI-001",
      precio: 15000,
      categoria_id: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("U-CAT-11: acepta sin categoria_id (campo opcional)", () => {
    const result = ProductoCreateSchema.safeParse({
      nombre: "Alimento Premium",
      sku: "ALI-001",
      precio: 15000,
    });
    expect(result.success).toBe(true);
  });

  it("U-CAT-12: acepta categoria_id null", () => {
    const result = ProductoCreateSchema.safeParse({
      nombre: "Alimento Premium",
      sku: "ALI-001",
      precio: 15000,
      categoria_id: null,
    });
    expect(result.success).toBe(true);
  });

  it("U-CAT-13: rechaza categoria_id no-UUID", () => {
    const result = ProductoCreateSchema.safeParse({
      nombre: "Alimento Premium",
      sku: "ALI-001",
      precio: 15000,
      categoria_id: "no-es-uuid",
    });
    expect(result.success).toBe(false);
  });
});
