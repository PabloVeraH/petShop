import { calculateROP, calculateEOQ } from "@/lib/analytics/reorder-suggestions";

describe("calculateROP", () => {
  it("calcula ROP correctamente con parámetros básicos", () => {
    const rop = calculateROP(5, 7, 7);
    expect(rop).toBe(70); // 5 * 7 + 5 * 7 = 35 + 35 = 70
  });

  it("usa 7 días de seguridad por defecto", () => {
    const rop = calculateROP(10, 5);
    expect(rop).toBe(120); // 10 * 5 + 10 * 7 = 50 + 70 = 120
  });

  it("redondea hacia arriba", () => {
    const rop = calculateROP(3.3, 5, 7);
    expect(rop).toBe(40); // 3.3 * 5 + 3.3 * 7 = 16.5 + 23.1 = 39.6 -> ceil = 40
  });
});

describe("calculateEOQ", () => {
  it("calcula EOQ correctamente", () => {
    const eoq = calculateEOQ(1000, 50, 25, 0.2);
    expect(eoq).toBeGreaterThan(0);
  });

  it("devuelve 0 si costoProducto es 0", () => {
    const eoq = calculateEOQ(1000, 50, 0, 0.2);
    expect(eoq).toBe(0);
  });

  it("devuelve 0 si costoMantenimientoPct es 0", () => {
    const eoq = calculateEOQ(1000, 50, 25, 0);
    expect(eoq).toBe(0);
  });

  it("redondea hacia arriba", () => {
    const eoq = calculateEOQ(1000, 50, 25, 0.2);
    const rawEOQ = Math.sqrt((2 * 1000 * 50) / (25 * 0.2));
    expect(eoq).toBe(Math.ceil(rawEOQ));
  });
});