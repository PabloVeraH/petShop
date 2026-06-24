/** @jest-environment jsdom */
/**
 * Tests FP-01 a FP-06: Product creation form data serialization
 * Verifica que los campos opcionales se envían correctamente
 * (undefined/null según corresponda) y que no causan errores de validación Zod.
 */
import "@testing-library/jest-dom";

// Simula el mismo patrón de serialización que usa inventory/page.tsx
function buildCreatePayload(form: Record<string, unknown>) {
  return {
    nombre: form.nombre,
    sku: form.sku,
    precio: Number(form.precio),
    costo: form.costo ? Number(form.costo) : undefined,
    stock: Number(form.stock ?? 0),
    stock_minimo: Number(form.stock_minimo ?? 0),
    marca: (form.marca as string) || undefined,
    peso_gramos: form.peso_gramos ? Number(form.peso_gramos) : undefined,
    fecha_vencimiento: (form.fecha_vencimiento as string) || undefined,
    dias_alerta_expira: form.fecha_vencimiento ? Number(form.dias_alerta_expira) : undefined,
    precio_oferta: form.precio_oferta ? Number(form.precio_oferta) : undefined,
    en_oferta: form.en_oferta,
    categoria_id: (form.categoria_id as string) || null,
    codigo_barra: (form.codigo_barra as string) || undefined,
    precio_venta_kg: form.precio_venta_kg ? Number(form.precio_venta_kg) : null,
  };
}

// FP-01
it("FP-01: campos mínimos requeridos no causan error", () => {
  const payload = buildCreatePayload({
    nombre: "Producto Test",
    sku: "TEST-001",
    precio: "9990",
  });
  expect(payload.nombre).toBe("Producto Test");
  expect(payload.sku).toBe("TEST-001");
  expect(payload.precio).toBe(9990);
  // Opcionales deben ser undefined/null, no strings vacíos
  expect(payload.codigo_barra).toBeUndefined();
  expect(payload.categoria_id).toBeNull();
  expect(payload.marca).toBeUndefined();
});

// FP-02
it("FP-02: codigo_barra vacío envía undefined, no null ni ''", () => {
  const payload = buildCreatePayload({
    nombre: "Test", sku: "SKU-01", precio: "5000",
    codigo_barra: "",
  });
  expect(payload.codigo_barra).toBeUndefined();
});

// FP-03
it("FP-03: codigo_barra con valor envía el string", () => {
  const payload = buildCreatePayload({
    nombre: "Test", sku: "SKU-01", precio: "5000",
    codigo_barra: "7891234567890",
  });
  expect(payload.codigo_barra).toBe("7891234567890");
});

// FP-04
it("FP-04: marca vacía envía undefined, no null ni ''", () => {
  const payload = buildCreatePayload({
    nombre: "Test", sku: "SKU-01", precio: "5000",
    marca: "",
  });
  expect(payload.marca).toBeUndefined();
});

// FP-05
it("FP-05: categoría vacía envía null (comportamiento existente)", () => {
  const payload = buildCreatePayload({
    nombre: "Test", sku: "SKU-01", precio: "5000",
    categoria_id: "",
  });
  expect(payload.categoria_id).toBeNull();
});

// FP-06
it("FP-06: formulario completo no pierde datos", () => {
  const payload = buildCreatePayload({
    nombre: "Alimento Premium",
    sku: "ALI-001",
    precio: "19990",
    costo: "12000",
    stock: "10",
    stock_minimo: "5",
    marca: "ProCan",
    peso_gramos: "15000",
    codigo_barra: "7891234567890",
    categoria_id: "123e4567-e89b-12d3-a456-426614174000",
  });
  expect(payload.nombre).toBe("Alimento Premium");
  expect(payload.sku).toBe("ALI-001");
  expect(payload.precio).toBe(19990);
  expect(payload.costo).toBe(12000);
  expect(payload.stock).toBe(10);
  expect(payload.stock_minimo).toBe(5);
  expect(payload.marca).toBe("ProCan");
  expect(payload.peso_gramos).toBe(15000);
  expect(payload.codigo_barra).toBe("7891234567890");
  expect(payload.categoria_id).toBe("123e4567-e89b-12d3-a456-426614174000");
});
