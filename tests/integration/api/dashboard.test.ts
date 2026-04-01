/**
 * Tests I-77 a I-78: GET /api/dashboard y /api/dashboard/stock-alertas
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

// Chain que soporta todos los métodos comunes y siempre resuelve vacío
function chain() {
  const resolved = Promise.resolve({ data: [], error: null, count: 0 });
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    eq: jest.fn(),
    neq: jest.fn(),
    gte: jest.fn(),
    lte: jest.fn(),
    gt: jest.fn(),
    order: jest.fn(),
    limit: jest.fn().mockReturnValue(resolved),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    then: undefined as unknown as jest.Mock,
  };
  // Todos los chainables devuelven el mismo objeto (thenable)
  ["select","eq","neq","gte","lte","gt","order"].forEach(k => c[k].mockReturnValue(c));
  // Hacer el chain thenable para que Promise.all funcione
  c.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 })
  );
  return c;
}

describe("GET /api/dashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(chain());
  });

  // I-77
  it("I-77: sin auth → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/dashboard/route");
    const res = await GET(new NextRequest("http://localhost/api/dashboard"));
    expect(res.status).toBe(401);
  });

  // I-77b
  it("I-77b: con auth → 200 y contiene clave ventasHoy", async () => {
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    const { GET } = await import("@/app/api/dashboard/route");
    const res = await GET(new NextRequest("http://localhost/api/dashboard"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("ventasHoy");
  });
});

describe("GET /api/dashboard/stock-alertas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-78
  it("I-78: retorna 200 con array de alertas", async () => {
    const { GET } = await import("@/app/api/dashboard/stock-alertas/route");
    const res = await GET(new NextRequest("http://localhost/api/dashboard/stock-alertas"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
