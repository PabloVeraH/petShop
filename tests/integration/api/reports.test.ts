/**
 * Tests I-79 a I-83: GET /api/reports y /api/reports/export
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
    order: jest.fn(),
    limit: jest.fn().mockReturnValue(resolved),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    then: jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data, error: null, count: data.length })
    ),
  };
  ["select","eq","neq","gte","lte","in","order"].forEach(k => c[k].mockReturnValue(c));
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
