import {
  validateRUT,
  formatRUT,
  ClienteCreateSchema,
  MascotaCreateSchema,
  CategoriaCreateSchema,
  CategoriaUpdateSchema,
  ProductoCreateSchema,
  ServicioCreateSchema,
  ServicioHorarioItemSchema,
  ServicioHorariosReplaceSchema,
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

  // ── Suite extendida: cobertura exhaustiva del algoritmo módulo-11 ────────────

  // U-10: REGRESIÓN — body todo-ceros genera DV=0 matemáticamente correcto pero RUT 0
  // no existe en Chile. Sin este guard, "00.000.000-0" pasaba la validación.
  it("U-10: rechaza RUT con cuerpo todo-ceros (00.000.000-0 no existe en Chile)", () => {
    expect(validateRUT("00.000.000-0")).toBe(false);
    expect(validateRUT("00000000-0")).toBe(false);
  });

  // U-11: RUT de persona natural de 7 dígitos (cuerpo < 1.000.000)
  it("U-11: acepta RUT de 7 dígitos (1.234.567-4)", () => {
    expect(validateRUT("1.234.567-4")).toBe(true);
    expect(validateRUT("12345674")).toBe(true); // sin formato
  });

  // U-12: DV en minúscula 'k' debe ser aceptado igual que 'K'
  it("U-12: acepta DV 'k' en minúscula como equivalente a 'K'", () => {
    expect(validateRUT("1.111.119-k")).toBe(true);
    expect(validateRUT("76.354.771-k")).toBe(true);
  });

  // U-13: RUT de empresa con DV = K (76.354.771-K verificado)
  it("U-13: acepta RUT de empresa con DV = K (76.354.771-K)", () => {
    expect(validateRUT("76.354.771-K")).toBe(true);
  });

  // U-14: RUT de 8 dígitos en rango alto (17.456.789-1 del reporte del usuario)
  it("U-14: acepta RUT de 8 dígitos en rango alto (17.456.789-1)", () => {
    expect(validateRUT("17.456.789-1")).toBe(true);
  });

  // U-15: RUT con DV correcto para body 18.234.567 (DV real = 9, no 4)
  it("U-15: acepta 18.234.567-9 (DV correcto) y rechaza 18.234.567-4 (DV incorrecto)", () => {
    expect(validateRUT("18.234.567-9")).toBe(true);
    expect(validateRUT("18.234.567-4")).toBe(false);
  });

  // U-16: RUT persona natural adicional verificado (5.126.663-3)
  it("U-16: acepta 5.126.663-3", () => {
    expect(validateRUT("5.126.663-3")).toBe(true);
  });

  // U-17: DV incorrecto en diferentes rangos
  it("U-17: rechaza varios RUTs con DV incorrecto", () => {
    expect(validateRUT("11.111.111-2")).toBe(false); // DV correcto es 1
    expect(validateRUT("17.456.789-9")).toBe(false); // DV correcto es 1
    expect(validateRUT("5.126.663-0")).toBe(false);  // DV correcto es 3
  });

  // U-18: formatos sin separadores (solo dígitos + DV)
  it("U-18: acepta RUT sin puntos ni guión (solo dígitos y DV pegados)", () => {
    expect(validateRUT("111111111")).toBe(true);   // 11.111.111-1 sin formato
    expect(validateRUT("174567891")).toBe(true);   // 17.456.789-1 sin formato
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

describe("ProductoCreateSchema con codigo_barra", () => {
  const BASE = { nombre: "Test", sku: "SKU-01", precio: 9990 };

  it("U-CB-01: acepta codigo_barra string válido", () => {
    expect(ProductoCreateSchema.safeParse({ ...BASE, codigo_barra: "7891234567890" }).success).toBe(true);
  });

  it("U-CB-02: acepta sin codigo_barra (campo opcional)", () => {
    expect(ProductoCreateSchema.safeParse(BASE).success).toBe(true);
  });

  it("U-CB-03: acepta codigo_barra null (BUG: antes rechazaba con 'se esperaba texto, recibido nulo')", () => {
    expect(ProductoCreateSchema.safeParse({ ...BASE, codigo_barra: null }).success).toBe(true);
  });

  it("U-CB-04: acepta codigo_barra string vacío", () => {
    expect(ProductoCreateSchema.safeParse({ ...BASE, codigo_barra: "" }).success).toBe(true);
  });

  it("U-CB-05: rechaza codigo_barra > 100 caracteres", () => {
    expect(ProductoCreateSchema.safeParse({ ...BASE, codigo_barra: "x".repeat(101) }).success).toBe(false);
  });
});

// ─── Servicios agendables (U-SRV-01 a U-SRV-12) ──────────────────────────────

describe("ServicioCreateSchema", () => {
  it("U-SRV-01: payload válido → success", () => {
    const r = ServicioCreateSchema.safeParse({ nombre: "Corte básico", duracion_minutos: 30 });
    expect(r.success).toBe(true);
  });

  it("U-SRV-02: nombre 1 carácter → fail", () => {
    const r = ServicioCreateSchema.safeParse({ nombre: "A", duracion_minutos: 30 });
    expect(r.success).toBe(false);
  });

  it("U-SRV-03: duracion_minutos: 0 → fail", () => {
    const r = ServicioCreateSchema.safeParse({ nombre: "Corte básico", duracion_minutos: 0 });
    expect(r.success).toBe(false);
  });

  it("U-SRV-04: duracion_minutos: 481 → fail", () => {
    const r = ServicioCreateSchema.safeParse({ nombre: "Corte básico", duracion_minutos: 481 });
    expect(r.success).toBe(false);
  });

  it("U-SRV-05: duracion_minutos: 45.5 → fail (no está en {30,60,90})", () => {
    const r = ServicioCreateSchema.safeParse({ nombre: "Corte básico", duracion_minutos: 45.5 });
    expect(r.success).toBe(false);
  });

  it("U-SRV-13: duracion_minutos: 45 (entero válido pero fuera del enum) → fail", () => {
    const r = ServicioCreateSchema.safeParse({ nombre: "Corte básico", duracion_minutos: 45 });
    expect(r.success).toBe(false);
  });

  it("U-SRV-14: duracion_minutos: 60 → success", () => {
    const r = ServicioCreateSchema.safeParse({ nombre: "Corte básico", duracion_minutos: 60 });
    expect(r.success).toBe(true);
  });

  it("U-SRV-15: duracion_minutos: 90 → success", () => {
    const r = ServicioCreateSchema.safeParse({ nombre: "Corte básico", duracion_minutos: 90 });
    expect(r.success).toBe(true);
  });
});

describe("ServicioHorarioItemSchema", () => {
  it("U-SRV-06: 09:00→18:00 → success", () => {
    const r = ServicioHorarioItemSchema.safeParse({ dia_semana: 1, hora_inicio: "09:00", hora_fin: "18:00" });
    expect(r.success).toBe(true);
  });

  it("U-SRV-07: 18:00→09:00 (invertido) → fail", () => {
    const r = ServicioHorarioItemSchema.safeParse({ dia_semana: 1, hora_inicio: "18:00", hora_fin: "09:00" });
    expect(r.success).toBe(false);
  });

  it("U-SRV-08: formatos inválidos (9:00, 25:00, 09:60) → fail", () => {
    expect(ServicioHorarioItemSchema.safeParse({ dia_semana: 1, hora_inicio: "9:00", hora_fin: "10:00" }).success).toBe(false);
    expect(ServicioHorarioItemSchema.safeParse({ dia_semana: 1, hora_inicio: "25:00", hora_fin: "26:00" }).success).toBe(false);
    expect(ServicioHorarioItemSchema.safeParse({ dia_semana: 1, hora_inicio: "09:60", hora_fin: "10:00" }).success).toBe(false);
  });

  it("U-SRV-09: dia_semana 0 y 8 → fail", () => {
    expect(ServicioHorarioItemSchema.safeParse({ dia_semana: 0, hora_inicio: "09:00", hora_fin: "10:00" }).success).toBe(false);
    expect(ServicioHorarioItemSchema.safeParse({ dia_semana: 8, hora_inicio: "09:00", hora_fin: "10:00" }).success).toBe(false);
  });
});

describe("ServicioHorariosReplaceSchema", () => {
  it("U-SRV-10: día repetido → fail", () => {
    const r = ServicioHorariosReplaceSchema.safeParse({
      horarios: [
        { dia_semana: 1, hora_inicio: "09:00", hora_fin: "12:00" },
        { dia_semana: 1, hora_inicio: "14:00", hora_fin: "18:00" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("U-SRV-11: array de 8 elementos → fail", () => {
    const r = ServicioHorariosReplaceSchema.safeParse({
      horarios: Array.from({ length: 8 }, (_, i) => ({
        dia_semana: (i % 7) + 1,
        hora_inicio: "09:00",
        hora_fin: "18:00",
      })),
    });
    expect(r.success).toBe(false);
  });

  it("U-SRV-12: array vacío → success", () => {
    const r = ServicioHorariosReplaceSchema.safeParse({ horarios: [] });
    expect(r.success).toBe(true);
  });
});
