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
jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler) => handler, logAudit: jest.fn() }));
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

type VentaRow = { id: string; worker_clerk_id: string | null; total: number };
function makeVentasChain(data: VentaRow[] = []) {
  return {
    data,
    error: null,
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  };
}

type NCRow = { monto_total: number; venta_id: string };
function makeNCChain(data: NCRow[] = []) {
  return {
    data,
    error: null,
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
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
    mockFrom.mockImplementation((table: string) => {
      if (table === "clerk_users") return makeWorkerChain();
      if (table === "notas_credito") return makeNCChain([]);
      return makeVentasChain([]);
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

  const WORKERS_MULTI = [
    { clerk_id: "w1", nombre: "Worker Uno", email: "w1@test.com", rut: null, meta_ventas: null, store_admin: false, store_worker: true },
    { clerk_id: "w2", nombre: "Worker Dos", email: "w2@test.com", rut: null, meta_ventas: null, store_admin: false, store_worker: true },
  ];

  function makeWorkersMultiChain() {
    return {
      data: WORKERS_MULTI,
      error: null,
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    };
  }

  function makeSUT(ventas: VentaRow[], ncs: NCRow[] = []) {
    mockFrom.mockImplementation((table: string) => {
      if (table === "clerk_users") return makeWorkersMultiChain();
      if (table === "notas_credito") return makeNCChain(ncs);
      return makeVentasChain(ventas);
    });
  }

  it("I-409: ventas con worker_clerk_id asignado se suman correctamente al total del vendedor correspondiente", async () => {
    const VENTAS: VentaRow[] = [
      { id: "v1", worker_clerk_id: "w1", total: 15000 },
      { id: "v2", worker_clerk_id: "w1", total: 5000 },
      { id: "v3", worker_clerk_id: "w2", total: 20000 },
    ];
    makeSUT(VENTAS);
    const { GET } = await import("@/app/api/workers/route");
    const req = new NextRequest("http://localhost/api/workers");
    const res = await GET(req);
    const body = await res.json();

    const w1 = body.find((w: { clerk_id: string }) => w.clerk_id === "w1");
    const w2 = body.find((w: { clerk_id: string }) => w.clerk_id === "w2");
    expect(w1.ventas_hoy).toBe(20000); // 15000 + 5000, no $0
    expect(w2.ventas_hoy).toBe(20000);
  });

  it("I-410: venta con worker_clerk_id null no se atribuye a ningún vendedor y no rompe el cálculo de los demás", async () => {
    const VENTAS: VentaRow[] = [
      { id: "v1", worker_clerk_id: "w1", total: 10000 },
      { id: "v2", worker_clerk_id: null, total: 99999 },
    ];
    makeSUT(VENTAS);
    const { GET } = await import("@/app/api/workers/route");
    const req = new NextRequest("http://localhost/api/workers");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    const w1 = body.find((w: { clerk_id: string }) => w.clerk_id === "w1");
    const w2 = body.find((w: { clerk_id: string }) => w.clerk_id === "w2");
    expect(w1.ventas_hoy).toBe(10000);
    expect(w2.ventas_hoy).toBe(0);
  });

  // I-425: REGRESIÓN — venta devuelta vía NC descuenta el monto devuelto del total del vendedor
  it("I-425: NC reduce ventas_mes y ventas_hoy del vendedor", async () => {
    const VENTAS: VentaRow[] = [
      { id: "v1", worker_clerk_id: "w1", total: 30000 },
      { id: "v2", worker_clerk_id: "w1", total: 20000 },
    ];
    const NCS: NCRow[] = [
      { monto_total: 15000, venta_id: "v1" }, // v1 devuelta parcialmente
    ];
    makeSUT(VENTAS, NCS);
    const { GET } = await import("@/app/api/workers/route");
    const req = new NextRequest("http://localhost/api/workers");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    const w1 = body.find((w: { clerk_id: string }) => w.clerk_id === "w1");
    // Bruto: 30000 + 20000 = 50000. NC: -15000. Neto: 35000
    expect(w1.ventas_mes).toBe(35000);
    expect(w1.ventas_hoy).toBe(35000);
  });

  it("I-425b: NC no reduce por debajo de 0", async () => {
    const VENTAS: VentaRow[] = [
      { id: "v1", worker_clerk_id: "w1", total: 10000 },
    ];
    const NCS: NCRow[] = [
      { monto_total: 20000, venta_id: "v1" }, // NC mayor que la venta
    ];
    makeSUT(VENTAS, NCS);
    const { GET } = await import("@/app/api/workers/route");
    const req = new NextRequest("http://localhost/api/workers");
    const res = await GET(req);
    const body = await res.json();
    const w1 = body.find((w: { clerk_id: string }) => w.clerk_id === "w1");
    expect(w1.ventas_mes).toBe(0); // clamped a 0
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

  it("I-406: retorna 401 si no hay sesión", async () => {
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

  it("I-407: retorna 403 si no es admin", async () => {
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

  // I-457 — REGRESIÓN (ticket Trello 6a61a7d503d4609a4cea7cdc): "Meta mensual
  // acepta valores negativos sin validación, generando % de avance absurdo".
  // El bug real está en el frontend (VendedoresPage V-10): el onChange del
  // input descartaba silenciosamente el signo "-" antes de que el valor
  // llegara a este endpoint. Este test documenta y fija la defensa de
  // profundidad server-side (WorkerUpdateSchema.meta_ventas usa .min(0)) que
  // ya existía pero no estaba cubierta por ningún test — si alguien llama a
  // este endpoint directamente (sin pasar por el formulario), sigue
  // bloqueado.
  it("I-457: PATCH con meta_ventas negativo → 400 (WorkerUpdateSchema rechaza valores negativos)", async () => {
    const { PATCH } = await import("@/app/api/workers/route");
    const req = new NextRequest("http://localhost/api/workers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clerk_id: "c1", meta_ventas: -1000 }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });
});
