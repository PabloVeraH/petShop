/**
 * Tests S-01 a S-08: Seguridad OWASP
 */
import { NextRequest } from "next/server";

// ── mocks globales ─────────────────────────────────────────────────────────

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/whatsapp", () => ({ sendWhatsAppText: jest.fn(), buildReceiptMessage: jest.fn() }));
jest.mock("@/lib/hub-sync", () => ({ syncPurchaseToHub: jest.fn() }));

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

function req(url: string, method = "GET", body?: object) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ── S-01: endpoints autenticados sin token → 401 ───────────────────────────

describe("S-01: endpoints sin auth → 401", () => {
  beforeEach(() => {
    mockGetStoreId.mockResolvedValue(null); // sin autenticación
  });

  it("GET /api/clientes sin auth → 401", async () => {
    const { GET } = await import("@/app/api/clientes/route");
    const res = await GET(req("/api/clientes"));
    expect(res.status).toBe(401);
  });

  it("GET /api/productos sin auth → 401", async () => {
    const { GET } = await import("@/app/api/productos/route");
    const res = await GET(req("/api/productos"));
    expect(res.status).toBe(401);
  });

  it("GET /api/inventario sin auth → 401", async () => {
    const { GET } = await import("@/app/api/inventario/route");
    const res = await GET(req("/api/inventario"));
    expect(res.status).toBe(401);
  });

  it("POST /api/ventas sin auth → 401", async () => {
    const { POST } = await import("@/app/api/ventas/route");
    const res = await POST(req("/api/ventas", "POST", { items: [], metodoPago: "efectivo" }));
    expect(res.status).toBe(401);
  });

  it("GET /api/dashboard sin auth → 401", async () => {
    const { GET } = await import("@/app/api/dashboard/route");
    const res = await GET(req("/api/dashboard"));
    expect(res.status).toBe(401);
  });
});

// ── S-03: mass assignment en settings ─────────────────────────────────────

describe("S-03: mass assignment en PATCH /api/settings", () => {
  const mockUpdate = jest.fn().mockReturnThis();
  const mockChain = {
    select: jest.fn().mockReturnThis(),
    update: mockUpdate,
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: { id: STORE_ID, name: "Test Store" },
      error: null,
    }),
  };

  beforeEach(() => {
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(mockChain);
    mockUpdate.mockReturnValue(mockChain);
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(mockChain);
    mockUpdate.mockReturnValue(mockChain);
    mockChain.select.mockReturnThis();
    mockChain.eq.mockReturnThis();
    mockChain.single.mockResolvedValue({ data: { id: STORE_ID, name: "Test" }, error: null });
  });

  it("S-03: campo 'store_id' en body no se pasa al update", async () => {
    const { PATCH } = await import("@/app/api/settings/route");
    await PATCH(req("/api/settings", "PATCH", { name: "Nuevo", store_id: "atacante-uuid" }));
    const updateArg = mockUpdate.mock.calls[0]?.[0];
    expect(updateArg).toBeDefined();
    expect(updateArg).not.toHaveProperty("store_id");
  });

  it("S-03b: campo 'id' en body no se pasa al update", async () => {
    const { PATCH } = await import("@/app/api/settings/route");
    await PATCH(req("/api/settings", "PATCH", { name: "Test", id: "injected" }));
    const updateArg = mockUpdate.mock.calls[0]?.[0];
    expect(updateArg).not.toHaveProperty("id");
  });
});

// ── S-05: sanitización de search params ────────────────────────────────────

describe("S-05: sanitización de parámetros de búsqueda", () => {
  const mockSearchChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    ilike: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  };

  beforeEach(() => {
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(mockSearchChain);
    mockSearchChain.select.mockReturnThis();
    mockSearchChain.eq.mockReturnThis();
    mockSearchChain.or.mockReturnThis();
    mockSearchChain.limit.mockResolvedValue({ data: [], error: null, count: 0 });
  });

  it("S-05: search con caracteres especiales no produce 500", async () => {
    const { GET } = await import("@/app/api/clientes/route");
    const res = await GET(req("/api/clientes?search=a%25b%28c%29"));
    expect(res.status).not.toBe(500);
  });

  it("S-05b: search con coma y paréntesis no produce 500", async () => {
    const { GET } = await import("@/app/api/productos/route");
    const res = await GET(req("/api/productos?search=a,b(c)"));
    expect(res.status).not.toBe(500);
  });
});
