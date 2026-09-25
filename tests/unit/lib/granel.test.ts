/**
 * Tests U-164 a U-166: src/lib/granel.ts — descomposición del stock granel
 * (§4.6, D20): stock = sacos cerrados + ROUND(gramos abiertos / peso, 3).
 * Misma fórmula que fraccion_gramos() de migrations/077; la BD es la fuente
 * de verdad (verificada con stock_canales_fase1b_verificacion.sql).
 */
import { estadoSacos, formatoSacos } from "@/lib/granel";

describe("estadoSacos", () => {
  it("U-164: 9,967 con 14 500 g abiertos de un saco de 15 000 g → 9 cerrados", () => {
    expect(estadoSacos({ stock: 9.967, peso_gramos: 15000, saco_abierto_gramos: 14500 }))
      .toEqual({ peso: 15000, gramosAbiertos: 14500, cerrados: 9 });
  });

  it.each([
    // sin saco abierto: todo el stock son cerrados
    [{ stock: 10, peso_gramos: 15000, saco_abierto_gramos: null }, 10],
    // saco recién abierto: 9 cerrados + 1,000 abierto = 10
    [{ stock: 10, peso_gramos: 15000, saco_abierto_gramos: 15000 }, 9],
    // 200 g de 15 000 → fracción 0,013 (redondeo a 3 decimales igual que la BD)
    [{ stock: 8.013, peso_gramos: 15000, saco_abierto_gramos: 200 }, 8],
    // gramos devueltos sin saco (fracción > 1): 0 cerrados
    [{ stock: 1.5, peso_gramos: 10000, saco_abierto_gramos: 15000 }, 0],
    // sin peso (dato inválido): no se descuenta fracción
    [{ stock: 4, peso_gramos: null, saco_abierto_gramos: 300 }, 4],
  ])("U-165: %p → %i cerrados", (prod, cerrados) => {
    expect(estadoSacos(prod).cerrados).toBe(cerrados);
  });
});

describe("formatoSacos", () => {
  it("U-166: 'N sacos + X kg' (G11), singular y decimales es-CL", () => {
    expect(formatoSacos(9, 14500)).toBe("9 sacos + 14,5 kg");
    expect(formatoSacos(1, 0)).toBe("1 saco + 0 kg");
    expect(formatoSacos(0, 250)).toBe("0 sacos + 0,25 kg");
  });
});
