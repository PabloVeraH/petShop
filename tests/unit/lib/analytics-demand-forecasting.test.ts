import { linearRegression, weightedMovingAverage, calculateSeasonality, predictDemand, MIN_DATOS_HISTORICOS } from "@/lib/analytics/demand-forecasting";

// ── Mock Supabase ─────────────────────────────────────────────────────────────
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      then: jest.fn(),
    })),
  })),
}));

describe("linearRegression", () => {
  it("calcula pendiente positiva para datos crecientes", () => {
    const { slope } = linearRegression([10, 12, 14, 16, 18]);
    expect(slope).toBeCloseTo(2, 0);
  });

  it("devuelve pendiente 0 para datos planos", () => {
    const { slope } = linearRegression([10, 10, 10, 10]);
    expect(slope).toBeCloseTo(0, 1);
  });

  it("maneja array de un elemento", () => {
    const { slope, intercept } = linearRegression([5]);
    expect(slope).toBe(0);
    expect(intercept).toBe(5);
  });
});

describe("weightedMovingAverage", () => {
  it("calcula WMA de 3 períodos correctamente", () => {
    const result = weightedMovingAverage([10, 20, 30, 40, 50], 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(23.33, 1);
  });

  it("devuelve array vacío si los datos son menores que periods", () => {
    const result = weightedMovingAverage([10, 20], 5);
    expect(result).toHaveLength(0);
  });
});

describe("predictDemand — umbral mínimo de datos", () => {
  const { createServiceClient } = require("@/lib/supabase");

  beforeEach(() => jest.clearAllMocks());

  function mockHistorico(rows: { fecha: string; cantidad: number; canal: string }[]) {
    createServiceClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: rows, error: null }),
      })),
    });
  }

  // DF-01: menos de MIN_DATOS_HISTORICOS → insuficienteDatos true
  it(`DF-01: con menos de ${MIN_DATOS_HISTORICOS} registros retorna insuficienteDatos=true`, async () => {
    const pocosRegistros = Array.from({ length: MIN_DATOS_HISTORICOS - 1 }, (_, i) => ({
      fecha: `2024-01-0${i + 1}`,
      cantidad: 5,
      canal: "pos",
    }));
    mockHistorico(pocosRegistros);

    const result = await predictDemand("prod-1", "store-1", 7);

    expect(result.insuficienteDatos).toBe(true);
    expect(result.confianza).toBe(0);
    expect(result.prediccion.every(v => v === 0)).toBe(true);
  });

  // DF-02: sin registros → insuficienteDatos true
  it("DF-02: sin registros históricos retorna insuficienteDatos=true", async () => {
    mockHistorico([]);

    const result = await predictDemand("prod-1", "store-1", 7);

    expect(result.insuficienteDatos).toBe(true);
  });

  // DF-03: exactamente MIN_DATOS_HISTORICOS registros → NO insuficienteDatos
  it(`DF-03: con exactamente ${MIN_DATOS_HISTORICOS} registros NO retorna insuficienteDatos`, async () => {
    const suficientes = Array.from({ length: MIN_DATOS_HISTORICOS }, (_, i) => ({
      fecha: `2024-01-${String(i + 1).padStart(2, "0")}`,
      cantidad: 5,
      canal: "pos",
    }));
    mockHistorico(suficientes);

    const result = await predictDemand("prod-1", "store-1", 7);

    expect(result.insuficienteDatos).toBeUndefined();
  });
});

describe("calculateSeasonality", () => {
  it("calcula promedio correcto por día de semana", () => {
    // Use dates at noon UTC to avoid timezone shifting the day
    const data = [
      { fecha: new Date(Date.UTC(2024, 0, 2, 12)).toISOString(), cantidad: 10, revenue: 100 }, // martes
      { fecha: new Date(Date.UTC(2024, 0, 3, 12)).toISOString(), cantidad: 5, revenue: 50 },  // miércoles
      { fecha: new Date(Date.UTC(2024, 0, 9, 12)).toISOString(), cantidad: 20, revenue: 200 }, // martes
      { fecha: new Date(Date.UTC(2024, 0, 10, 12)).toISOString(), cantidad: 15, revenue: 150 }, // miércoles
    ];

    const result = calculateSeasonality(data);
    expect(result["martes"]).toBeCloseTo(15, 0);  // (10 + 20) / 2
    expect(result["miércoles"]).toBeCloseTo(10, 0); // (5 + 15) / 2
  });

  it("retorna 0 para días sin datos", () => {
    const data = [{ fecha: new Date(Date.UTC(2024, 0, 2, 12)).toISOString(), cantidad: 10, revenue: 0 }]; // martes
    const result = calculateSeasonality(data);
    expect(result["jueves"]).toBe(0);
  });
});
