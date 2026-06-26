import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();

const mockAuth = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/validation", () => ({
  ...jest.requireActual("@/lib/validation"),
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
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

function makeSelectChain(returnData: unknown) {
  return {
    data: returnData,
    error: null,
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockReturnThis(),
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
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {
        sub: "u1",
        publicMetadata: { storeId: STORE_ID, storeAdmin: true },
      },
    });
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
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeSelectChain({ rut: null, meta_ventas: 500000 });
      return {
        ...makeUpdateChain(),
        update: jest.fn((data) => { captured.push(data); return { eq: jest.fn().mockReturnThis(), error: null }; }),
      };
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
    expect(captured[0]).toHaveProperty("updated_at");
  });

  it("I-260: retorna 401 si no hay sesión", async () => {
    mockAuth.mockResolvedValue({ userId: null, sessionClaims: null });
    const { PATCH } = await import("@/app/api/workers/route");
    const req = new NextRequest("http://localhost/api/workers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clerk_id: "c1", meta_ventas: 100000 }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it("I-261: retorna 403 si no es admin", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {
        sub: "u1",
        publicMetadata: { storeId: STORE_ID, storeWorker: true },
      },
    });
    const { PATCH } = await import("@/app/api/workers/route");
    const req = new NextRequest("http://localhost/api/workers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clerk_id: "c1", meta_ventas: 100000 }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(403);
  });

  it("I-293: PATCH retorna 400 si rut tiene formato inválido", async () => {
    const { PATCH } = await import("@/app/api/workers/route");
    const req = new NextRequest("http://localhost/api/workers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clerk_id: "c1", rut: "12.345.678-9" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("RUT");
  });
});
