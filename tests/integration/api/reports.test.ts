/**
 * Tests I-79 a I-83, I-433 a I-435: GET /api/reports y /api/reports/export
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

function chain(data: unknown[] = []) {
  const resolved = Promise.resolve({ data, error: null, count: data.length });
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    eq: jest.fn(),
    neq: jest.fn(),
    gte: jest.fn(),
    lte: jest.fn(),
    in: jest.fn(),
    not: jest.fn(),
    gt: jest.fn(),
    order: jest.fn(),
    limit: jest.fn().mockReturnValue(resolved),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    then: jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data, error: null, count: data.length })
    ),
  };
  ["select","eq","neq","gte","lte","in","not","gt","order"].forEach(k => c[k].mockReturnValue(c));
  return c;
}

describe("GET /api/reports", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-79
  it("I-79: sin params → 200", async () => {
    const { GET } = await import("@/app/api/reports/route");
    const res = await GET(new NextRequest("http://localhost/api/reports"));
    expect(res.status).toBe(200);
  });

  // I-80
  it("I-80: ?periodo=7 → 200", async () => {
    const { GET } = await import("@/app/api/reports/route");
    const res = await GET(new NextRequest("http://localhost/api/reports?periodo=7"));
    expect(res.status).toBe(200);
  });

  it("sin auth → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/reports/route");
    const res = await GET(new NextRequest("http://localhost/api/reports"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/reports — predicción (I-433 a I-435)", () => {
  function daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  function setupVentas(ventasRows: Array<{ created_at: string; total: number; id: string }>) {
    mockFrom.mockImplementation((table: string) => {
      if (table === "ventas") return chain(ventasRows);
      return chain([]);
    });
  }

  // I-433 — REGRESIÓN (ticket Trello 6a5e96c9b7ce6c36cc926e1b):
  // Con 30 días de datos y ventas solo en 5 de esos días, la predicción
  // debe usar el promedio diario del período COMPLETO (incluye días sin
  // ventas). Antes del fix, Object.entries(ventasPorDia) devolvía solo días
  // con ventas, slice(-7) tomaba los últimos 7 días CON venta, y ese promedio
  // inflado se proyectaba a 7 días — sobreestimación ~3-6x.
  it("I-433: REGRESIÓN — 30 días con ventas solo en 5 días usa promedio del período completo (incluye días sin venta)", async () => {
    const ventas = [
      { created_at: daysAgo(25), total: 10000, id: "v1" },
      { created_at: daysAgo(25), total: 10000, id: "v2" },
      { created_at: daysAgo(18), total: 10000, id: "v3" },
      { created_at: daysAgo(18), total: 10000, id: "v4" },
      { created_at: daysAgo(11), total: 10000, id: "v5" },
      { created_at: daysAgo(11), total: 10000, id: "v6" },
      { created_at: daysAgo(4), total: 10000, id: "v7" },
      { created_at: daysAgo(4), total: 10000, id: "v8" },
      { created_at: daysAgo(2), total: 10000, id: "v9" },
      { created_at: daysAgo(2), total: 10000, id: "v10" },
    ];
    setupVentas(ventas);

    const { GET } = await import("@/app/api/reports/route");
    const res = await GET(new NextRequest("http://localhost/api/reports?periodo=30"));
    const body: Record<string, unknown> = await res.json();

    expect(res.status).toBe(200);
    expect(body.totalPeriodo).toBe(100000);
    expect(body.totalTransacciones).toBe(10);
    // promedio = 100000/30 ≈ 3333.33 → Math.round = 3333
    expect(body.promedioDiario).toBe(3333);
    // prediccion = round(100000/30 * 7) = round(23333.33) = 23333
    expect(body.prediccion7dias).toBe(23333);
  });

  // I-434 — caso normal: ventas en todos los 7 días del período de 7 días,
  // con suficientes transacciones (≥10) para activar la predicción.
  // La empresa vende 2 veces al día: 14 transacciones en 7 días.
  it("I-434: 7 días con ventas en todos los días y ≥10 transacciones, predicción muestra valor correcto", async () => {
    const ventas = [6,5,4,3,2,1,0].flatMap(n =>
      Array.from({ length: 2 }, (_, i) => ({
        created_at: daysAgo(n),
        total: 10000,
        id: `v-${n}-${i}`,
      }))
    );
    setupVentas(ventas);

    const { GET } = await import("@/app/api/reports/route");
    const res = await GET(new NextRequest("http://localhost/api/reports?periodo=7"));
    const body: Record<string, unknown> = await res.json();

    expect(res.status).toBe(200);
    expect(body.totalPeriodo).toBe(140000);
    expect(body.totalTransacciones).toBe(14);
    // promedio = 140000 / 7 = 20000 por día (2 ventas de $10k cada una)
    expect(body.promedioDiario).toBe(20000);
    expect(body.prediccion7dias).toBe(140000);
  });

  // I-435 — umbral mínimo de transacciones
  it("I-435: menos de 10 transacciones → prediccion7dias es null", async () => {
    const ventas = [20,18,16,14,12].map(n => ({
      created_at: daysAgo(n),
      total: 10000,
      id: `v-${n}`,
    }));
    setupVentas(ventas);

    const { GET } = await import("@/app/api/reports/route");
    const res = await GET(new NextRequest("http://localhost/api/reports?periodo=30"));
    const body: Record<string, unknown> = await res.json();

    expect(res.status).toBe(200);
    expect(body.totalTransacciones).toBe(5);
    expect(body.prediccion7dias).toBeNull();
  });
});

describe("GET /api/reports/export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-81
  it("I-81: ?tipo=ventas → Content-Type text/csv", async () => {
    const { GET } = await import("@/app/api/reports/export/route");
    const res = await GET(new NextRequest("http://localhost/api/reports/export?tipo=ventas"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  // I-82
  it("I-82: exportación sin auth → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/reports/export/route");
    const res = await GET(new NextRequest("http://localhost/api/reports/export?tipo=ventas"));
    expect(res.status).toBe(401);
  });

  // I-83
  it("I-83: campo con coma en CSV → entre comillas", async () => {
    mockFrom.mockReturnValue(chain([{
      created_at: "2026-01-01",
      total: 1000,
      metodo_pago: "efectivo",
      estado: "completada",
      numero_comprobante: "OC-001",
      clientes: { nombre: "Pérez, Juan" },
    }]));
    const { GET } = await import("@/app/api/reports/export/route");
    const res = await GET(new NextRequest("http://localhost/api/reports/export?tipo=ventas"));
    const text = await res.text();
    expect(text).toContain('"Pérez, Juan"');
  });
});
