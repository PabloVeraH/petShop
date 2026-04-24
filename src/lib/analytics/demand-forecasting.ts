import { createServiceClient } from "@/lib/supabase";

export interface SalesDataPoint {
  fecha: string;
  cantidad: number;
  revenue: number;
}

export interface ForecastResult {
  prediccion: number[];
  tendencia: "alta" | "baja" | "estable";
  confianza: number;
  estacionalidad: string[];
}

export function linearRegression(data: number[]): { slope: number; intercept: number } {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: data[0] || 0 };

  const x = Array.from({ length: n }, (_, i) => i);
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = data.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * data[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

export function weightedMovingAverage(
  data: number[],
  periods: number = 7,
  weights?: number[]
): number[] {
  const w = weights || Array.from({ length: periods }, (_, i) => i + 1);
  const result: number[] = [];

  for (let i = periods - 1; i < data.length; i++) {
    const window = data.slice(i - periods + 1, i + 1);
    const sum = window.reduce((acc, val, j) => acc + val * w[j], 0);
    const weightSum = w.reduce((a, b) => a + b, 0);
    result.push(sum / weightSum);
  }

  return result;
}

export function calculateSeasonality(data: SalesDataPoint[]): Record<string, number> {
  const byDayOfWeek: Record<string, number[]> = {
    domingo: [],
    lunes: [],
    martes: [],
    miércoles: [],
    jueves: [],
    viernes: [],
    sábado: [],
  };

  const dayNames = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

  for (const point of data) {
    const dayIndex = new Date(point.fecha).getDay();
    byDayOfWeek[dayNames[dayIndex]].push(point.cantidad);
  }

  const seasonality: Record<string, number> = {};
  for (const [day, values] of Object.entries(byDayOfWeek)) {
    seasonality[day] = values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;
  }

  return seasonality;
}

export async function predictDemand(
  productoId: string,
  storeId: string,
  dias: number = 30
): Promise<ForecastResult> {
  const supabase = createServiceClient();

  const desde = new Date();
  desde.setDate(desde.getDate() - 90);

  const { data: historico } = await supabase
    .from("ventas_historico")
    .select("fecha, cantidad, canal")
    .eq("producto_id", productoId)
    .eq("store_id", storeId)
    .gte("fecha", desde.toISOString().split("T")[0])
    .order("fecha");

  if (!historico?.length) {
    return {
      prediccion: Array(dias).fill(0),
      tendencia: "estable",
      confianza: 0,
      estacionalidad: [],
    };
  }

  const byDate: Record<string, number> = {};
  for (const row of historico) {
    const fecha = row.fecha.split("T")[0];
    byDate[fecha] = (byDate[fecha] || 0) + row.cantidad;
  }

  const dataPoints: SalesDataPoint[] = Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fecha, cantidad]) => ({ fecha, cantidad, revenue: 0 }));

  const quantities = dataPoints.map(d => d.cantidad);

  const { slope } = linearRegression(quantities);
  const tendencia = slope > 0.1 ? "alta" : slope < -0.1 ? "baja" : "estable";

  const seasonality = calculateSeasonality(dataPoints);
  const avgFactor = Object.values(seasonality).reduce((a, b) => a + b, 0) / 7 || 1;

  const wma = weightedMovingAverage(quantities.slice(-30), 7);
  let basePred = wma[wma.length - 1] || 0;

  const dayNames = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const prediccion: number[] = [];

  for (let i = 0; i < dias; i++) {
    if (tendencia === "alta") basePred *= 1.02;
    else if (tendencia === "baja") basePred *= 0.98;

    const dayIndex = (new Date().getDay() + i) % 7;
    const dayFactor = seasonality[dayNames[dayIndex]] || avgFactor;

    prediccion.push(Math.max(0, Math.round(basePred * (dayFactor / avgFactor))));
  }

  const mean = quantities.reduce((a, b) => a + b, 0) / quantities.length;
  const variance = quantities.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / quantities.length;
  const stdDev = Math.sqrt(variance);
  const confianza = mean > 0 ? Math.max(0, Math.min(1, 1 - stdDev / mean)) : 0;

  return {
    prediccion,
    tendencia,
    confianza: Math.round(confianza * 100) / 100,
    estacionalidad: Object.entries(seasonality)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([day, val]) => `${day}: ${Math.round(val)}`),
  };
}
