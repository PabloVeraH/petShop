import { linearRegression, weightedMovingAverage, calculateSeasonality } from "@/lib/analytics/demand-forecasting";

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
