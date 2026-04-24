# Plan de Implementación: Predicción de Demanda, Sugerencias de Compra y Reportes Exportables

Este documento contiene el step-by-step detallado para implementar las mejoras identificadas en el análisis de funcionalidades.

---

## Tabla de Contenidos

1. [Predicción de Demanda Avanzada](#1-predicción-de-demanda-avanzada)
2. [Sugerencias de Compra Inteligentes](#2-sugerencias-de-compra-inteligentes)
3. [Reportes Exportables Extendidos](#3-reportes-exportables-extendidos)

---

## 1. Predicción de Demanda Avanzada

### 1.1 Objetivo

Reemplazar la predicción básica actual (promedio simple de 7 días) con un sistema que considere:
- Tendencias históricas (ventas por producto)
- Estacionalidad (días de semana)
- Promedio móvil ponderado (WMA)

### 1.2 Estado Actual

```typescript
// /src/app/api/reports/route.ts
const promedioDiario = ultimos7.reduce((s, v) => s + v, 0) / ultimos7.length;
const prediccion7dias = Math.round(promedioDiario * 7);
```

**Limitación**: Solo usa promedio aritmético simple, no considera estacionalidad ni tendencias.

### 1.3 Step-by-Step

#### 1.3.1 Paso 1: Crear Tabla de Historial de Ventas por Producto

**Archivo nuevo**: `migrations/018_ventas_historico.sql`

```sql
CREATE TABLE IF NOT EXISTS ventas_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  producto_id UUID NOT NULL REFERENCES productos(id),
  fecha DATE NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 0,
  revenue NUMERIC(12, 2) DEFAULT 0,
  canal VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, producto_id, fecha, canal)
);

CREATE INDEX idx_ventas_historico_fecha ON ventas_historico(store_id, fecha);
CREATE INDEX idx_ventas_historico_producto ON ventas_historico(producto_id, fecha);

-- Función para agregar fila diaria agregada (ejecutar vía cron o trigger)
CREATE OR REPLACE FUNCTION sync_ventas_historico()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO ventas_historico (store_id, producto_id, fecha, cantidad, revenue, canal)
  SELECT
    v.store_id,
    vi.producto_id,
    DATE(v.created_at) AS fecha,
    SUM(vi.cantidad) AS cantidad,
    SUM(vi.subtotal) AS revenue,
    v.canal
  FROM ventas v
  JOIN venta_items vi ON v.id = vi.venta_id
  WHERE DATE(v.created_at) = CURRENT_DATE - 1
  ON CONFLICT (store_id, producto_id, fecha, canal)
  DO UPDATE SET
    cantidad = EXCLUDED.cantidad,
    revenue = EXCLUDED.revenue;
END;
$$;
```

> **Nota**: La función `sync_ventas_historico()` debe ejecutarse diariamente. Puede dispararse con un pg_cron job en Supabase (`SELECT cron.schedule('sync-historico', '0 1 * * *', 'SELECT sync_ventas_historico()')`) o desde una Edge Function scheduleable.

#### 1.3.2 Paso 2: Crear Biblioteca de Algoritmos de Predicción

**Archivo nuevo**: `src/lib/analytics/demand-forecasting.ts`

```typescript
import { createServiceClient } from "@/lib/supabase";

interface SalesDataPoint {
  fecha: string;
  cantidad: number;
  revenue: number;
}

interface ForecastResult {
  prediccion: number[];
  tendencia: "alta" | "baja" | "estable";
  confianza: number;
  estacionalidad: string[];
}

/**
 * Regresión lineal simple para detectar tendencia.
 * Exportada para poder testearse de forma aislada.
 */
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

/**
 * Promedio móvil ponderado (WMA).
 * Exportada para poder testearse de forma aislada.
 */
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

/**
 * Promedio de ventas por día de semana (índice de estacionalidad).
 * Retorna un objeto { lunes: 12.3, martes: 8.1, ... } con el promedio de unidades por día.
 * Exportada para poder testearse de forma aislada.
 */
export function calculateSeasonality(data: SalesDataPoint[]): Record<string, number> {
  const byDayOfWeek: Record<string, number[]> = {
    domingo: [], lunes: [], martes: [], miércoles: [], jueves: [], viernes: [], sábado: [],
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

/**
 * Predicción de demanda para un producto usando WMA + regresión lineal + estacionalidad.
 * Requiere que la tabla ventas_historico esté poblada (migración 018).
 * Si no hay datos históricos, devuelve predicción cero con confianza 0.
 */
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

  // Agregar por fecha (sumar todos los canales)
  const byDate: Record<string, number> = {};
  for (const row of historico) {
    const fecha = row.fecha.split("T")[0];
    byDate[fecha] = (byDate[fecha] || 0) + row.cantidad;
  }

  const dataPoints: SalesDataPoint[] = Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fecha, cantidad]) => ({ fecha, cantidad, revenue: 0 }));

  const quantities = dataPoints.map(d => d.cantidad);

  // 1. Tendencia vía regresión lineal
  const { slope } = linearRegression(quantities);
  const tendencia = slope > 0.1 ? "alta" : slope < -0.1 ? "baja" : "estable";

  // 2. Índice de estacionalidad por día de semana
  const seasonality = calculateSeasonality(dataPoints);
  const avgFactor = Object.values(seasonality).reduce((a, b) => a + b, 0) / 7 || 1;

  // 3. WMA sobre los últimos 30 días como base
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

  // Confianza: 1 - coeficiente de variación (penaliza alta dispersión)
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
```

#### 1.3.3 Paso 3: Crear Endpoint de Predicción

La función `GET_PREDICCION` del borrador original **no es un export válido de Next.js**. Los route handlers solo reconocen `GET`, `POST`, etc. Debe ser un archivo de ruta propio.

**Archivo nuevo**: `src/app/api/reports/prediccion/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { predictDemand } from "@/lib/analytics/demand-forecasting";
import { z } from "zod";

const QuerySchema = z.object({
  producto_id: z.string().uuid(),
  dias: z.coerce.number().int().min(1).max(90).default(30),
});

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = QuerySchema.safeParse({
    producto_id: req.nextUrl.searchParams.get("producto_id"),
    dias: req.nextUrl.searchParams.get("dias") ?? 30,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { producto_id, dias } = parsed.data;
  const prediccion = await predictDemand(producto_id, ctx.storeId, dias);
  return NextResponse.json(prediccion);
}
```

#### 1.3.4 Paso 4: Crear Frontend de Predicción

**Archivo nuevo**: `src/app/(app)/reportes/prediccion/page.tsx`

```typescript
"use client";

import { useState, useEffect } from "react";

interface Prediccion {
  prediccion: number[];
  tendencia: "alta" | "baja" | "estable";
  confianza: number;
  estacionalidad: string[];
}

interface ProductoBasico {
  id: string;
  nombre: string;
}

export default function PrediccionPage() {
  const [productos, setProductos] = useState<ProductoBasico[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [prediccion, setPrediccion] = useState<Prediccion | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProductos, setLoadingProductos] = useState(true);

  useEffect(() => {
    fetch("/api/productos")
      .then(r => r.json())
      .then((data: ProductoBasico[]) => setProductos(data || []))
      .finally(() => setLoadingProductos(false));
  }, []);

  const handlePredict = async () => {
    if (!selectedProduct) return;
    setLoading(true);
    const res = await fetch(`/api/reports/prediccion?producto_id=${selectedProduct}&dias=30`);
    const data = await res.json();
    setPrediccion(data);
    setLoading(false);
  };

  const tendenciaColor = {
    alta: "text-green-700 bg-green-50",
    baja: "text-red-700 bg-red-50",
    estable: "text-gray-700 bg-gray-50",
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Predicción de Demanda</h1>

      <div className="flex gap-4 mb-6">
        <select
          value={selectedProduct}
          onChange={e => setSelectedProduct(e.target.value)}
          className="border rounded px-3 py-2 flex-1"
          disabled={loadingProductos}
        >
          <option value="">
            {loadingProductos ? "Cargando productos..." : "Seleccionar producto"}
          </option>
          {productos.map(p => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>

        <button
          onClick={handlePredict}
          disabled={!selectedProduct || loading}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Calculando..." : "Predecir"}
        </button>
      </div>

      {prediccion && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className={`p-4 rounded ${tendenciaColor[prediccion.tendencia]}`}>
              <div className="text-sm opacity-70">Tendencia</div>
              <div className="text-2xl font-bold capitalize">{prediccion.tendencia}</div>
            </div>
            <div className="bg-blue-50 p-4 rounded">
              <div className="text-sm text-gray-600">Confianza</div>
              <div className="text-2xl font-bold">{Math.round(prediccion.confianza * 100)}%</div>
            </div>
            <div className="bg-purple-50 p-4 rounded">
              <div className="text-sm text-gray-600">Total 30 días</div>
              <div className="text-2xl font-bold">
                {prediccion.prediccion.reduce((a, b) => a + b, 0)} uds.
              </div>
            </div>
          </div>

          {prediccion.estacionalidad.length > 0 && (
            <p className="text-sm text-gray-600 mb-4">
              Días pico: {prediccion.estacionalidad.join(" · ")}
            </p>
          )}

          {prediccion.confianza === 0 && (
            <p className="text-sm text-amber-600 mb-4">
              Sin datos históricos suficientes. Poblar la tabla ventas_historico primero.
            </p>
          )}

          <div className="bg-white border rounded overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-sm">Día</th>
                  <th className="px-4 py-2 text-right text-sm">Unidades predichas</th>
                </tr>
              </thead>
              <tbody>
                {prediccion.prediccion.slice(0, 14).map((cant, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-4 py-2 text-sm">Día {i + 1}</td>
                    <td className="px-4 py-2 text-right font-medium">{cant}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
```

#### 1.3.5 Paso 5: Tests Unitarios

**Archivo nuevo**: `tests/unit/lib/analytics-demand-forecasting.test.ts`

> **Nota**: El proyecto usa Jest con globals implícitos. No importar `describe`, `it`, `expect` — están disponibles globalmente como en el resto de la suite.

```typescript
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
    // (10×1 + 20×2 + 30×3) / (1+2+3) = 140/6 ≈ 23.33
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
    // 2024-01-07 = domingo, 2024-01-08 = lunes, 2024-01-14 = domingo, 2024-01-15 = lunes
    const data = [
      { fecha: "2024-01-07", cantidad: 10, revenue: 100 },
      { fecha: "2024-01-08", cantidad: 5,  revenue: 50  },
      { fecha: "2024-01-14", cantidad: 20, revenue: 200 },
      { fecha: "2024-01-15", cantidad: 15, revenue: 150 },
    ];

    const result = calculateSeasonality(data);
    expect(result["domingo"]).toBeCloseTo(15, 0); // (10+20)/2
    expect(result["lunes"]).toBeCloseTo(10, 0);   // (5+15)/2
  });

  it("retorna 0 para días sin datos", () => {
    const data = [{ fecha: "2024-01-07", cantidad: 10, revenue: 0 }];
    const result = calculateSeasonality(data);
    expect(result["lunes"]).toBe(0);
  });
});
```

---

## 2. Sugerencias de Compra Inteligentes

### 2.1 Objetivo

Expandir las sugerencias actuales para incluir:
- Reorder point (ROP) dinámico basado en lead time y consumo histórico
- Cantidad económica de pedido (EOQ)
- Nivel de urgencia por días de stock restante vs. tiempo de entrega

### 2.2 Estado Actual

```typescript
// /src/app/api/recompras/route.ts
// Solo considera fecha_estimada_termino de consumo_alertas
// No calcula ROP ni EOQ
```

### 2.3 Step-by-Step

#### 2.3.1 Paso 1: Agregar Campos de Reorder a Productos

**Archivo nuevo**: `migrations/019_reorder_fields.sql`

```sql
ALTER TABLE productos ADD COLUMN IF NOT EXISTS demanda_promedio_diaria NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS dias_seguridad INTEGER DEFAULT 7;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS tendencia_ventas VARCHAR(20) DEFAULT 'estable';
ALTER TABLE productos ADD COLUMN IF NOT EXISTS ultimo_consumo TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_productos_reorder
  ON productos(store_id, demanda_promedio_diaria, stock)
  WHERE activo = true;
```

> **Dependencia**: Esta migración debe aplicarse después de `018_ventas_historico.sql`. Los campos `demanda_promedio_diaria` y `tendencia_ventas` pueden actualizarse periódicamente vía un job que llame a `predictDemand()` para cada producto y persista los resultados.

#### 2.3.2 Paso 2: Crear Biblioteca de Reorder Point

**Archivo nuevo**: `src/lib/analytics/reorder-suggestions.ts`

> **Schema real**: La tabla `proveedor_productos` tiene columnas: `id`, `proveedor_id`, `producto_id`, `costo`, `tiempo_entrega_dias`. No existe columna `sku_proveedor`. La tabla `proveedores` tiene: `id`, `store_id`, `nombre`, `rut`, `contacto`, `telefono`, `email`.

```typescript
import { createServiceClient } from "@/lib/supabase";

export interface ReorderSuggestion {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  stock_actual: number;
  stock_minimo: number;
  demanda_promedio: number;
  dias_restantes: number;
  cantidad_sugerida: number;
  proveedor: {
    id: string;
    nombre: string;
    tiempo_entrega: number;
    costo: number;
  };
  urgencia: "critica" | "alta" | "media" | "baja";
  razon: string;
  tendencia: "creciendo" | "estable" | "bajando";
}

/**
 * Reorder Point: stock mínimo para iniciar un pedido sin quedarse sin stock.
 * ROP = (demanda_diaria × lead_time) + (demanda_diaria × dias_seguridad)
 */
export function calculateROP(
  demandaDiaria: number,
  leadTimeDias: number,
  diasSeguridad: number = 7
): number {
  return Math.ceil(demandaDiaria * leadTimeDias + demandaDiaria * diasSeguridad);
}

/**
 * Cantidad Económica de Pedido (EOQ).
 * EOQ = √(2 × D × S / H)
 * D = demanda anual, S = costo por orden, H = costo de mantenimiento (precio × pct)
 */
export function calculateEOQ(
  demandaAnual: number,
  costoOrden: number,
  costoProducto: number,
  costoMantenimientoPct: number = 0.2
): number {
  if (costoProducto <= 0 || costoMantenimientoPct <= 0) return 0;
  const optimal = Math.sqrt((2 * demandaAnual * costoOrden) / (costoProducto * costoMantenimientoPct));
  return Math.ceil(optimal);
}

/**
 * Demanda diaria promedio calculada directamente desde venta_items + ventas.
 * Fallback cuando ventas_historico no está poblado.
 * Nota: hace dos queries separadas para evitar filtrar sobre relaciones embebidas,
 * lo cual no es soportado por el cliente JS de Supabase.
 */
async function getDemandaDiariaFallback(
  supabase: ReturnType<typeof createServiceClient>,
  productoId: string,
  storeId: string,
  diasHistorial: number = 30
): Promise<number> {
  const desde = new Date();
  desde.setDate(desde.getDate() - diasHistorial);
  const desdeStr = desde.toISOString();

  // 1. Obtener IDs de ventas del período para esta tienda
  const { data: ventasIds } = await supabase
    .from("ventas")
    .select("id")
    .eq("store_id", storeId)
    .gte("created_at", desdeStr);

  if (!ventasIds?.length) return 0;

  const ids = ventasIds.map(v => v.id);

  // 2. Sumar cantidades vendidas del producto en esas ventas
  const { data: items } = await supabase
    .from("venta_items")
    .select("cantidad")
    .eq("producto_id", productoId)
    .in("venta_id", ids);

  if (!items?.length) return 0;

  const total = items.reduce((sum, item) => sum + item.cantidad, 0);
  return Math.max(0.1, total / diasHistorial);
}

/**
 * Genera sugerencias de recompra para todos los productos activos de la tienda.
 * Solo incluye productos que tienen al menos un proveedor configurado.
 */
export async function getReorderSuggestions(storeId: string): Promise<ReorderSuggestion[]> {
  const supabase = createServiceClient();

  const { data: productos } = await supabase
    .from("productos")
    .select("id, nombre, sku, stock, stock_minimo, demanda_promedio_diaria, dias_seguridad, tendencia_ventas")
    .eq("store_id", storeId)
    .eq("activo", true);

  if (!productos?.length) return [];

  const productoIds = productos.map(p => p.id);

  // proveedor_productos no tiene sku_proveedor — columnas reales: id, proveedor_id, producto_id, costo, tiempo_entrega_dias
  const { data: proveedorProductos } = await supabase
    .from("proveedor_productos")
    .select("producto_id, costo, tiempo_entrega_dias, proveedores(id, nombre)")
    .in("producto_id", productoIds);

  const sugerencias: ReorderSuggestion[] = [];

  for (const prod of productos) {
    const demandaDiaria: number =
      prod.demanda_promedio_diaria > 0
        ? prod.demanda_promedio_diaria
        : await getDemandaDiariaFallback(supabase, prod.id, storeId);

    if (demandaDiaria <= 0) continue;

    const pp = (proveedorProductos || []).filter(p => p.producto_id === prod.id);
    if (!pp.length) continue;

    // Mejor proveedor: menor (lead_time × 10 + costo)
    const mejorProv = pp.reduce((best, curr) => {
      const currScore = (curr.tiempo_entrega_dias ?? 99) * 10 + Number(curr.costo ?? 0);
      const bestScore = (best.tiempo_entrega_dias ?? 99) * 10 + Number(best.costo ?? 0);
      return currScore < bestScore ? curr : best;
    }, pp[0]);

    const leadTime = mejorProv.tiempo_entrega_dias ?? 3;
    const diasSeguridad = prod.dias_seguridad ?? 7;
    const rop = calculateROP(demandaDiaria, leadTime, diasSeguridad);
    const diasRestantes = Math.floor(prod.stock / demandaDiaria);
    const cantidadSugerida = Math.max(0, rop - prod.stock + Math.ceil(demandaDiaria * leadTime));

    let urgencia: ReorderSuggestion["urgencia"] = "baja";
    if (diasRestantes <= leadTime) urgencia = "critica";
    else if (diasRestantes <= leadTime + diasSeguridad) urgencia = "alta";
    else if (diasRestantes <= leadTime * 2) urgencia = "media";

    let razon: string;
    if (diasRestantes <= leadTime) {
      razon = `Stock actual (${prod.stock}) cubre solo ${diasRestantes} días. Tiempo de entrega: ${leadTime} días.`;
    } else if (prod.stock <= prod.stock_minimo) {
      razon = `Stock bajo mínimo (${prod.stock}/${prod.stock_minimo}).`;
    } else {
      razon = `Reorder point alcanzado: ${rop} unidades.`;
    }

    const proveedor = mejorProv.proveedores as { id: string; nombre: string } | null;

    sugerencias.push({
      producto_id: prod.id,
      producto_nombre: prod.nombre,
      sku: prod.sku,
      stock_actual: prod.stock,
      stock_minimo: prod.stock_minimo,
      demanda_promedio: Math.round(demandaDiaria * 100) / 100,
      cantidad_sugerida: cantidadSugerida,
      dias_restantes: diasRestantes,
      proveedor: {
        id: proveedor?.id ?? "",
        nombre: proveedor?.nombre ?? "Sin nombre",
        tiempo_entrega: leadTime,
        costo: Number(mejorProv.costo ?? 0),
      },
      urgencia,
      razon,
      tendencia: (prod.tendencia_ventas as ReorderSuggestion["tendencia"]) ?? "estable",
    });
  }

  const urgenciaOrden: Record<string, number> = { critica: 0, alta: 1, media: 2, baja: 3 };
  return sugerencias
    .filter(s => urgenciaOrden[s.urgencia] < 3)
    .sort((a, b) => urgenciaOrden[a.urgencia] - urgenciaOrden[b.urgencia]);
}
```

#### 2.3.3 Paso 3: Nueva API para Sugerencias Avanzadas

**Archivo nuevo**: `src/app/api/analytics/recompras-avanzadas/route.ts`

```typescript
import { getStoreId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { getReorderSuggestions } from "@/lib/analytics/reorder-suggestions";

export async function GET() {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sugerencias = await getReorderSuggestions(ctx.storeId);
  return NextResponse.json(sugerencias);
}
```

#### 2.3.4 Paso 4: Actualizar Frontend de Recompras

**Archivo a modificar**: `src/app/(app)/purchases/page.tsx`

Agregar toggle entre modo básico (endpoint existente) y avanzado (nuevo endpoint):

```typescript
"use client";

import { useState, useEffect } from "react";

interface Suggestion {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  stock_actual: number;
  demanda_promedio: number;
  dias_restantes: number;
  cantidad_sugerida: number;
  proveedor: { nombre: string; tiempo_entrega: number; costo: number };
  urgencia: "critica" | "alta" | "media" | "baja";
  razon: string;
  tendencia: string;
}

const URGENCIA_STYLE: Record<string, string> = {
  critica: "bg-red-100 text-red-800 border-red-200",
  alta:    "bg-orange-100 text-orange-800 border-orange-200",
  media:   "bg-yellow-100 text-yellow-800 border-yellow-200",
  baja:    "bg-green-100 text-green-800 border-green-200",
};

export default function RecomprasPage() {
  const [mode, setMode] = useState<"basico" | "avanzado">("basico");
  const [loading, setLoading] = useState(false);
  const [sugerencias, setSugerencias] = useState<Suggestion[]>([]);

  useEffect(() => {
    setLoading(true);
    const endpoint = mode === "basico" ? "/api/recompras" : "/api/analytics/recompras-avanzadas";
    fetch(endpoint)
      .then(r => r.json())
      .then(data => setSugerencias(data || []))
      .finally(() => setLoading(false));
  }, [mode]);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Sugerencias de Compra</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setMode("basico")}
            className={`px-4 py-2 rounded text-sm ${mode === "basico" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}
          >
            Básico
          </button>
          <button
            onClick={() => setMode("avanzado")}
            className={`px-4 py-2 rounded text-sm ${mode === "avanzado" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}
          >
            Avanzado (ROP)
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando sugerencias...</div>
      ) : sugerencias.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No hay sugerencias de recompra en este momento.
        </div>
      ) : (
        <div className="space-y-3">
          {sugerencias.map(s => (
            <div key={s.producto_id} className={`border rounded p-4 flex gap-4 ${URGENCIA_STYLE[s.urgencia]}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold uppercase">{s.urgencia}</span>
                  {s.tendencia === "creciendo" && (
                    <span className="text-xs">↑ Demanda creciente</span>
                  )}
                </div>
                <div className="font-medium">{s.producto_nombre}</div>
                <div className="text-xs mt-1 opacity-70">SKU: {s.sku} · Proveedor: {s.proveedor.nombre}</div>
                <div className="text-sm mt-2">{s.razon}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold">{s.stock_actual}</div>
                <div className="text-xs opacity-70">stock actual</div>
                {mode === "avanzado" && (
                  <>
                    <div className="text-sm mt-2">{s.demanda_promedio}/día</div>
                    <div className="text-sm">{s.dias_restantes} días restantes</div>
                    <div className="text-sm font-medium mt-1">Pedir: {s.cantidad_sugerida} uds.</div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

#### 2.3.5 Paso 5: Tests Unitarios

**Archivo nuevo**: `tests/unit/lib/analytics-reorder.test.ts`

```typescript
import { calculateROP, calculateEOQ } from "@/lib/analytics/reorder-suggestions";

describe("calculateROP", () => {
  it("calcula reorder point correctamente", () => {
    // ROP = (10 × 5) + (10 × 7) = 120
    expect(calculateROP(10, 5, 7)).toBe(120);
  });

  it("redondea hacia arriba", () => {
    // (1.5 × 3) + (1.5 × 7) = 15 → Math.ceil(15) = 15
    expect(calculateROP(1.5, 3, 7)).toBe(15);
  });

  it("devuelve 0 con demanda 0", () => {
    expect(calculateROP(0, 5, 7)).toBe(0);
  });

  it("usa 7 días de seguridad por defecto", () => {
    // ROP = (10 × 5) + (10 × 7) = 120
    expect(calculateROP(10, 5)).toBe(120);
  });
});

describe("calculateEOQ", () => {
  it("calcula EOQ correctamente", () => {
    // EOQ = √(2 × 1000 × 50 / (100 × 0.2)) = √(100000/20) = √5000 ≈ 70.7 → 71
    expect(calculateEOQ(1000, 50, 100)).toBe(71);
  });

  it("devuelve 0 si costo del producto es 0", () => {
    expect(calculateEOQ(1000, 50, 0)).toBe(0);
  });

  it("devuelve 0 si porcentaje de mantenimiento es 0", () => {
    expect(calculateEOQ(1000, 50, 100, 0)).toBe(0);
  });
});
```

> **Nota EOQ**: El borrador original calculaba `√(50000) = 224`, pero ese resultado era incorrecto. Con D=1000, S=50, precio=100, H=0.2: `√(2×1000×50 / (100×0.2)) = √(100000/20) = √5000 ≈ 70.7 → 71`. Los tests reflejan el valor correcto.

---

## 3. Reportes Exportables Extendidos

### 3.1 Objetivo

Agregar más formatos y tipos de reporte:
- PDF para reportes de ventas y predicción
- Excel multi-hoja
- Reporte ejecutivo mensual
- Catálogo de proveedor (historial de órdenes de compra)

### 3.2 Estado Actual

```
/src/app/api/reports/export/route.ts  → solo CSV (ventas, inventario)
/src/lib/contabilidad/excel-generator.ts  → solo XLSX (libro diario, balance)
```

### 3.3 Step-by-Step

#### 3.3.1 Paso 1: Instalar Dependencias

```bash
npm install jspdf xlsx
npm install --save-dev @types/jspdf
```

> `jspdf` tiene soporte Node.js desde v2.x. En server components / route handlers usar `output("arraybuffer")` y convertir con `Buffer.from()`.

#### 3.3.2 Paso 2: Crear Generador de PDF

**Archivo nuevo**: `src/lib/reports/pdf-generator.ts`

```typescript
import jsPDF from "jspdf";

interface ReporteVentas {
  titulo: string;
  desde: string;
  hasta: string;
  totalVentas: number;
  transacciones: number;
  data: Array<{
    fecha: string;
    numero: string;
    cliente: string;
    total: number;
    metodo: string;
  }>;
}

/**
 * Genera PDF de reporte de ventas.
 * Retorna Buffer para usarse directamente en NextResponse.
 */
export function generateVentasPDF(reporte: ReporteVentas): Buffer {
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text(reporte.titulo, 20, 20);

  doc.setFontSize(10);
  doc.text(`Período: ${reporte.desde} al ${reporte.hasta}`, 20, 30);
  doc.text(
    `Total: $${reporte.totalVentas.toLocaleString("es-CL")} (${reporte.transacciones} transacciones)`,
    20, 36
  );

  let y = 50;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Fecha", 20, y);
  doc.text("N°", 50, y);
  doc.text("Cliente", 70, y);
  doc.text("Total", 150, y);
  doc.text("Método", 175, y);
  doc.setFont("helvetica", "normal");

  y += 8;
  for (const row of reporte.data.slice(0, 30)) {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.text(row.fecha, 20, y);
    doc.text(row.numero, 50, y);
    doc.text(row.cliente.substring(0, 28), 70, y);
    doc.text(`$${row.total.toLocaleString("es-CL")}`, 150, y);
    doc.text(row.metodo, 175, y);
    y += 8;
  }

  // jsPDF output("arraybuffer") retorna ArrayBuffer — convertir a Buffer para Node.js
  return Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
}

/**
 * Genera PDF de predicción de demanda por producto.
 */
export function generatePrediccionPDF(data: {
  producto: string;
  tendencia: string;
  confianza: number;
  prediccion: Array<{ dia: number; cantidad: number }>;
}): Buffer {
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text(`Predicción: ${data.producto}`, 20, 20);

  doc.setFontSize(12);
  doc.text(`Tendencia: ${data.tendencia}`, 20, 32);
  doc.text(`Confianza: ${Math.round(data.confianza * 100)}%`, 20, 40);

  doc.setFontSize(10);
  doc.text("Proyección próximos 30 días:", 20, 55);

  let y = 65;
  for (const p of data.prediccion) {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.text(`Día ${p.dia}: ${p.cantidad} unidades`, 25, y);
    y += 7;
  }

  return Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
}
```

#### 3.3.3 Paso 3: Crear Generador Excel Multi-Hoja

**Archivo nuevo**: `src/lib/reports/excel-generator.ts`

> **Schema real**: La tabla de historial de pedidos a proveedores es `ordenes_compra` (columnas: `id`, `numero`, `estado`, `total`, `created_at`, `proveedor_id`). No existe tabla `pedidos`.

```typescript
import * as XLSX from "xlsx";
import { createServiceClient } from "@/lib/supabase";

interface DataSheet {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
}

export function generateExcelMultiSheet(sheets: DataSheet[]): Buffer {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

/**
 * Genera Excel con catálogo de productos de un proveedor + historial de órdenes de compra.
 * Nota: proveedor_productos no tiene columna sku_proveedor.
 */
export async function generateProveedorExcel(
  supabase: ReturnType<typeof createServiceClient>,
  proveedorId: string
): Promise<Buffer> {
  // Hoja 1: catálogo de productos del proveedor
  const { data: productos } = await supabase
    .from("proveedor_productos")
    .select("costo, tiempo_entrega_dias, productos(nombre, sku)")
    .eq("proveedor_id", proveedorId);

  const catalogoSheet: DataSheet = {
    name: "Catálogo",
    headers: ["SKU", "Producto", "Costo", "Entrega (días)"],
    rows: (productos || []).map(p => {
      const prod = p.productos as { nombre: string; sku: string } | null;
      return [
        prod?.sku ?? "",
        prod?.nombre ?? "",
        Number(p.costo ?? 0),
        p.tiempo_entrega_dias ?? 0,
      ];
    }),
  };

  // Hoja 2: historial de órdenes de compra (tabla real: ordenes_compra)
  const { data: ordenes } = await supabase
    .from("ordenes_compra")
    .select("numero, created_at, estado, total")
    .eq("proveedor_id", proveedorId)
    .order("created_at", { ascending: false })
    .limit(50);

  const ordenesSheet: DataSheet = {
    name: "Órdenes de Compra",
    headers: ["Número", "Fecha", "Estado", "Total"],
    rows: (ordenes || []).map(o => [
      o.numero,
      new Date(o.created_at).toLocaleDateString("es-CL"),
      o.estado,
      Number(o.total ?? 0),
    ]),
  };

  return generateExcelMultiSheet([catalogoSheet, ordenesSheet]);
}

/**
 * Genera Excel de reporte ejecutivo mensual con tres hojas: Resumen, Top Productos, Ventas por Día.
 */
export function generateReporteEjecutivo(data: {
  mes: string;
  ventas: number;
  transacciones: number;
  ticketPromedio: number;
  topProductos: Array<{ nombre: string; cantidad: number; revenue: number }>;
  ventasPorDia: Array<{ dia: string; total: number }>;
}): Buffer {
  const sheets: DataSheet[] = [
    {
      name: "Resumen",
      headers: ["Métrica", "Valor"],
      rows: [
        ["Mes", data.mes],
        ["Ventas totales ($)", data.ventas],
        ["Transacciones", data.transacciones],
        ["Ticket promedio ($)", data.ticketPromedio],
      ],
    },
    {
      name: "Top Productos",
      headers: ["Producto", "Cantidad", "Revenue ($)"],
      rows: data.topProductos.map(p => [p.nombre, p.cantidad, p.revenue]),
    },
    {
      name: "Ventas por Día",
      headers: ["Día", "Total ($)"],
      rows: data.ventasPorDia.map(d => [d.dia, d.total]),
    },
  ];

  return generateExcelMultiSheet(sheets);
}
```

#### 3.3.4 Paso 4: API de Export Extendida

**Archivo nuevo**: `src/app/api/reports/export-full/route.ts`

```typescript
import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generateProveedorExcel, generateReporteEjecutivo } from "@/lib/reports/excel-generator";
import { generateVentasPDF } from "@/lib/reports/pdf-generator";
import { predictDemand } from "@/lib/analytics/demand-forecasting";
import { generatePrediccionPDF } from "@/lib/reports/pdf-generator";
import { z } from "zod";

const QuerySchema = z.object({
  tipo: z.enum(["proveedor", "ejecutivo", "pdf-ventas", "pdf-prediccion"]),
  formato: z.enum(["xlsx", "pdf"]).default("xlsx"),
  proveedor_id: z.string().uuid().optional(),
  producto_id: z.string().uuid().optional(),
  mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  desde: z.string().optional(),
  hasta: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { tipo, proveedor_id, producto_id, mes, desde, hasta } = parsed.data;
  const supabase = createServiceClient();

  if (tipo === "proveedor") {
    if (!proveedor_id) return NextResponse.json({ error: "proveedor_id requerido" }, { status: 400 });
    const excel = await generateProveedorExcel(supabase, proveedor_id);
    return new NextResponse(excel, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="proveedor-${proveedor_id}.xlsx"`,
      },
    });
  }

  if (tipo === "ejecutivo") {
    const periodo = mes ?? new Date().toISOString().slice(0, 7);
    const { data: ventas } = await supabase
      .from("ventas")
      .select("id, total, created_at")
      .eq("store_id", ctx.storeId)
      .like("created_at", `${periodo}%`);

    const totalVentas = (ventas || []).reduce((s, v) => s + Number(v.total), 0);
    const transacciones = ventas?.length ?? 0;

    const excel = generateReporteEjecutivo({
      mes: periodo,
      ventas: totalVentas,
      transacciones,
      ticketPromedio: transacciones ? Math.round(totalVentas / transacciones) : 0,
      topProductos: [],  // TODO: agregar query de top productos por venta_items
      ventasPorDia: [],  // TODO: agregar agrupación por día
    });

    return new NextResponse(excel, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="ejecutivo-${periodo}.xlsx"`,
      },
    });
  }

  if (tipo === "pdf-ventas") {
    const desdeStr = desde ?? new Date(new Date().setDate(1)).toISOString().split("T")[0];
    const hastaStr = hasta ?? new Date().toISOString().split("T")[0];

    const { data: ventas } = await supabase
      .from("ventas")
      .select("id, total, created_at, metodo_pago, clientes(nombre)")
      .eq("store_id", ctx.storeId)
      .gte("created_at", desdeStr)
      .lte("created_at", hastaStr)
      .order("created_at", { ascending: false })
      .limit(30);

    const totalVentas = (ventas || []).reduce((s, v) => s + Number(v.total), 0);

    const pdf = generateVentasPDF({
      titulo: "Reporte de Ventas",
      desde: desdeStr,
      hasta: hastaStr,
      totalVentas,
      transacciones: ventas?.length ?? 0,
      data: (ventas || []).map(v => ({
        fecha: new Date(v.created_at).toLocaleDateString("es-CL"),
        numero: v.id.slice(0, 8),
        cliente: (v.clientes as { nombre: string } | null)?.nombre ?? "Mostrador",
        total: Number(v.total),
        metodo: v.metodo_pago ?? "—",
      })),
    });

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="ventas-${desdeStr}-${hastaStr}.pdf"`,
      },
    });
  }

  if (tipo === "pdf-prediccion") {
    if (!producto_id) return NextResponse.json({ error: "producto_id requerido" }, { status: 400 });

    const [prediccion, { data: producto }] = await Promise.all([
      predictDemand(producto_id, ctx.storeId, 30),
      supabase.from("productos").select("nombre").eq("id", producto_id).single(),
    ]);

    const pdf = generatePrediccionPDF({
      producto: producto?.nombre ?? "Producto",
      tendencia: prediccion.tendencia,
      confianza: prediccion.confianza,
      prediccion: prediccion.prediccion.map((cant, i) => ({ dia: i + 1, cantidad: cant })),
    });

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="prediccion-${producto_id.slice(0, 8)}.pdf"`,
      },
    });
  }

  return NextResponse.json({ error: "tipo no soportado" }, { status: 400 });
}
```

#### 3.3.5 Paso 5: Tests Unitarios

**Archivo nuevo**: `tests/unit/lib/reports-pdf-generator.test.ts`

```typescript
import { generateVentasPDF, generatePrediccionPDF } from "@/lib/reports/pdf-generator";

describe("generateVentasPDF", () => {
  it("retorna un Buffer con contenido", () => {
    const pdf = generateVentasPDF({
      titulo: "Test",
      desde: "2024-01-01",
      hasta: "2024-01-31",
      totalVentas: 100_000,
      transacciones: 50,
      data: [
        { fecha: "2024-01-15", numero: "001", cliente: "Cliente Test", total: 5000, metodo: "efectivo" },
      ],
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
  });

  it("maneja data vacía sin lanzar error", () => {
    expect(() =>
      generateVentasPDF({ titulo: "T", desde: "2024-01-01", hasta: "2024-01-31", totalVentas: 0, transacciones: 0, data: [] })
    ).not.toThrow();
  });
});

describe("generatePrediccionPDF", () => {
  it("retorna un Buffer con contenido", () => {
    const pdf = generatePrediccionPDF({
      producto: "Producto Test",
      tendencia: "alta",
      confianza: 0.85,
      prediccion: [{ dia: 1, cantidad: 10 }, { dia: 2, cantidad: 12 }],
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
  });
});
```

**Archivo nuevo**: `tests/unit/lib/excel-generator.test.ts`

```typescript
import { generateExcelMultiSheet, generateReporteEjecutivo } from "@/lib/reports/excel-generator";

describe("generateExcelMultiSheet", () => {
  it("retorna un Buffer con contenido", () => {
    const result = generateExcelMultiSheet([
      { name: "Hoja1", headers: ["A", "B"], rows: [["x", 1], ["y", 2]] },
    ]);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("generateReporteEjecutivo", () => {
  it("genera Excel con tres hojas sin error", () => {
    expect(() =>
      generateReporteEjecutivo({
        mes: "2024-01",
        ventas: 500_000,
        transacciones: 120,
        ticketPromedio: 4166,
        topProductos: [{ nombre: "Producto A", cantidad: 30, revenue: 150_000 }],
        ventasPorDia: [{ dia: "2024-01-01", total: 20_000 }],
      })
    ).not.toThrow();
  });
});
```

---

## 4. Resumen de Archivos a Crear/Modificar

### Archivos Nuevos

| Ruta | Descripción |
|------|-------------|
| `migrations/018_ventas_historico.sql` | Tabla `ventas_historico` + función de sync diario |
| `migrations/019_reorder_fields.sql` | Columnas de reorder en `productos` |
| `src/lib/analytics/demand-forecasting.ts` | Algoritmos: regresión lineal, WMA, predicción |
| `src/lib/analytics/reorder-suggestions.ts` | ROP, EOQ, sugerencias de recompra |
| `src/lib/reports/pdf-generator.ts` | Generador PDF (ventas + predicción) |
| `src/lib/reports/excel-generator.ts` | Excel multi-hoja (proveedor + ejecutivo) |
| `src/app/api/reports/prediccion/route.ts` | GET `/api/reports/prediccion?producto_id=&dias=` |
| `src/app/api/analytics/recompras-avanzadas/route.ts` | GET `/api/analytics/recompras-avanzadas` |
| `src/app/api/reports/export-full/route.ts` | GET `/api/reports/export-full?tipo=&...` |
| `src/app/(app)/reportes/prediccion/page.tsx` | Página de predicción de demanda |
| `tests/unit/lib/analytics-demand-forecasting.test.ts` | Tests de predicción |
| `tests/unit/lib/analytics-reorder.test.ts` | Tests de ROP y EOQ |
| `tests/unit/lib/reports-pdf-generator.test.ts` | Tests de generación PDF |
| `tests/unit/lib/excel-generator.test.ts` | Tests de generación Excel |

### Archivos a Modificar

| Ruta | Cambio |
|------|--------|
| `src/app/(app)/purchases/page.tsx` | Agregar toggle básico/avanzado |

---

## 5. Dependencias Requeridas

```bash
npm install jspdf xlsx
npm install --save-dev @types/jspdf
```

---

## 6. Correcciones Aplicadas a Este Documento

Errores del borrador original que fueron corregidos aquí:

| # | Error | Corrección |
|---|-------|------------|
| 1 | Tests importaban `{ describe, it, expect }` de `"vitest"` | El proyecto usa Jest con globals implícitos — no importar |
| 2 | `linearRegression`, `weightedMovingAverage`, `calculateSeasonality` no exportadas pero sí importadas en tests | Todas marcadas como `export` |
| 3 | Typo: `prediccio:` en fallback de `predictDemand` | Corregido a `prediccion:` |
| 4 | `calculateSeasonality` declarada como `Record<string, number[]>` pero retorna promedios (`number`) | Firma corregida a `Record<string, number>` |
| 5 | `GET_PREDICCION` no es un export válido de Next.js | Reemplazado por archivo propio `src/app/api/reports/prediccion/route.ts` con `export async function GET` |
| 6 | `getDemandaDiaria` fallback usaba `.gte("ventas.created_at", ...)` sobre relación embebida (no soportado por cliente Supabase JS) | Reescrito como dos queries separadas |
| 7 | `pdf-generator.ts` casteaba `doc.output("arraybuffer") as unknown as Buffer` | Corregido a `Buffer.from(doc.output("arraybuffer") as ArrayBuffer)` |
| 8 | `excel-generator.ts` usaba tabla `pedidos` (no existe) | Corregido a `ordenes_compra` con sus columnas reales |
| 9 | `generateProveedorExcel` incluía columna `sku_proveedor` (no existe en `proveedor_productos`) | Eliminada del select y de la hoja Excel |
| 10 | EOQ test esperaba 224 (cálculo incorrecto) | Corregido: con D=1000, S=50, precio=100, H=0.2 → EOQ = 71 |
| 11 | `generateProveedorExcel` sin import de `createServiceClient` | Import agregado |

---

## 7. Orden de Implementación Sugerido

1. **Paso 1**: Migración 018 (`ventas_historico`) — sin esto, `predictDemand` siempre devuelve ceros
2. **Paso 2**: `demand-forecasting.ts` + `src/app/api/reports/prediccion/route.ts` + tests
3. **Paso 3**: Migración 019 (`reorder_fields`) + `reorder-suggestions.ts` + API + tests
4. **Paso 4**: `pdf-generator.ts` + `excel-generator.ts` + `export-full/route.ts` + tests
5. **Paso 5**: Frontend — página predicción + actualizar recompras page
