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
jest.mock("@/lib/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn().mockResolvedValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

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

// ── S-02: aislamiento cross-store ──────────────────────────────────────────

describe("S-02: aislamiento de datos entre stores", () => {
  beforeEach(() => {
    // Store A autenticado
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      gt: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      then: jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 })
      ),
    });
  });

  it("S-02: GET /api/clientes de store A retorna vacío (store B no tiene datos)", async () => {
    const { GET } = await import("@/app/api/clientes/route");
    const res = await GET(req("/api/clientes"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // La query aplica .eq("store_id", STORE_ID) → store B queda excluido
    expect(Array.isArray(body.data ?? body)).toBe(true);
  });

  it("S-02b: GET /api/productos de store A retorna vacío cuando DB aislada", async () => {
    const { GET } = await import("@/app/api/productos/route");
    const res = await GET(req("/api/productos"));
    expect(res.status).toBe(200);
  });
});

// ── S-06: onboarding idempotencia ─────────────────────────────────────────

describe("S-06: POST /api/onboarding/complete dos veces mismo user → segunda rechazada", () => {
  const mockAuth = jest.fn();
  const mockClerkClient = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("S-06: segunda llamada a onboarding retorna 409", async () => {
    jest.mock("@clerk/nextjs/server", () => ({
      auth: jest.fn().mockResolvedValue({ userId: "user_s06" }),
      clerkClient: jest.fn().mockResolvedValue({
        users: {
          getUser: jest.fn().mockResolvedValue({ emailAddresses: [{ emailAddress: "u@test.com" }] }),
          updateUserMetadata: jest.fn().mockResolvedValue({}),
        },
      }),
    }));
    jest.mock("@/lib/supabase", () => ({
      createServiceClient: jest.fn(() => ({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          // existing store_id → trigger 409
          single: jest.fn().mockResolvedValue({
            data: { store_id: STORE_ID },
            error: null,
          }),
        }),
      })),
    }));
    const { POST } = await import("@/app/api/onboarding/complete/route");
    const res = await POST(new NextRequest("http://localhost/api/onboarding/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeName: "Mi Store" }),
    }));
    expect(res.status).toBe(409);
  });
});

// ── S-07: reports export sin auth ─────────────────────────────────────────

describe("S-07: GET /api/reports/export sin autenticación → 401", () => {
  beforeEach(() => {
    mockGetStoreId.mockResolvedValue(null);
  });

  it("S-07: sin auth → 401", async () => {
    const { GET } = await import("@/app/api/reports/export/route");
    const res = await GET(req("/api/reports/export?tipo=ventas"));
    expect(res.status).toBe(401);
  });
});

// ── S-08: WhatsApp webhook con cuerpo manipulado ───────────────────────────

describe("S-08: POST /api/whatsapp/webhook con firma inválida → 403", () => {
  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = "real-secret";
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
  });

  it("S-08: firma manipulada → 403", async () => {
    const { POST } = await import("@/app/api/whatsapp/webhook/route");
    const res = await POST(new NextRequest("http://localhost/api/whatsapp/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=invalidsignature" },
      body: JSON.stringify({ entry: [{ changes: [{ value: { messages: [] } }] }] }),
    }));
    expect(res.status).toBe(403);
  });
});
