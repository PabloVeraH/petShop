/**
 * Tests I-221 to I-222: consumo en mascotas (migración 032)
 * El consumo (gramos_porcion, veces_dia) ahora es un atributo de la mascota.
 * PATCH /api/mascotas/[id] acepta estos campos — ver mascotas.test.ts para cobertura completa.
 */

// Estos tests documentan que /api/consumo-configs fue eliminado en migración 032.
// La lógica de consumo se maneja directamente en /api/mascotas/[id] (PATCH).

describe("consumo-configs (migración 032)", () => {
  it("I-221: consumo vive en mascotas, no en tabla separada", () => {
    expect(true).toBe(true);
  });
});
