import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/validation", () => ({
  ...jest.requireActual("@/lib/validation"),
}));

const mockWorkers = [
  { clerk_id: "c1", nombre: "Worker 1", email: "w1@test.com", rut: null, meta_ventas: null, store_admin: false, store_worker: true },
];

function makeWorkerChain() {
  return {
    data: mockWorkers,
    error: null,
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  };
}

function makeVentasChain() {
  return {
    data: [],
    error: null,
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
  };
}

function makeUpdateChain() {
  return {
    error: null,
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
  };
}

describe("GET /api/workers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("I-256: retorna 401 si no autenticado", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/workers/route");
    const req = new NextRequest("http://localhost/api/workers");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("I-257: retorna lista de workers con totales de ventas del mes y del día", async () => {
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) return makeWorkerChain();
      return makeVentasChain();
    });
    const { GET } = await import("@/app/api/workers/route");
    const req = new NextRequest("http://localhost/api/workers");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toHaveProperty("ventas_mes");
    expect(body[0]).toHaveProperty("ventas_hoy");
  });
});

describe("PATCH /api/workers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("I-258: retorna 400 si clerk_id falta en el body", async () => {
    const { PATCH } = await import("@/app/api/workers/route");
    const req = new NextRequest("http://localhost/api/workers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta_ventas: 100000 }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("I-259: actualiza meta_ventas correctamente", async () => {
    const captured: Record<string, unknown>[] = [];
    mockFrom.mockReturnValue({
      ...makeUpdateChain(),
      update: jest.fn((data) => { captured.push(data); return { eq: jest.fn().mockReturnThis(), error: null }; }),
    });
    const { PATCH } = await import("@/app/api/workers/route");
    const req = new NextRequest("http://localhost/api/workers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clerk_id: "c1", meta_ventas: 500000 }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(captured[0]).toHaveProperty("meta_ventas", 500000);
  });
});
