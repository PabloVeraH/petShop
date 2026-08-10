/**
 * Tests I-CAT-01 a I-CAT-14: GET, POST, PATCH, DELETE /api/categorias
 * Categorías solo administradas por storeAdmin y systemAdmin.
 */
import { NextRequest } from "next/server";

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    // after() requiere request scope real (lanza fuera de él). Los Route
    // Handlers ahora usan withErrorLogging (src/lib/audit.ts), que agenda el
    // log de errores vía after() — mismo patrón que tests/integration/api/
    // ventas*.test.ts.
    after: jest.fn((cb: () => void) => cb()),
  };
});

const STORE_ID    = "123e4567-e89b-12d3-a456-426614174000";
const CAT_ID      = "123e4567-e89b-12d3-a456-426614174099";

const mockGetStoreId   = jest.fn();
const mockAuth         = jest.fn();
const mockGetAdminStatus = jest.fn();
const mockFrom         = jest.fn();
const mockSingle       = jest.fn();

jest.mock("@/lib/auth",    () => ({ getStoreId: mockGetStoreId }));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
jest.mock("@/lib/admin-check", () => ({ getAdminStatus: mockGetAdminStatus }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

function chain() {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    eq:     jest.fn(),
    order:  jest.fn().mockResolvedValue({ data: [], error: null }),
    single: mockSingle,
  };
  ["select","insert","update","eq","order"].forEach(k => c[k].mockReturnValue(c));
  return c;
}

function req(url: string, method = "GET", body?: object) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

const idParams = Promise.resolve({ id: CAT_ID });

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/categorias
// ──────────────────────────────────────────────────────────────────────────────

describe("GET /api/categorias", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-CAT-01
  it("I-CAT-01: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/categorias/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  // I-CAT-02
  it("I-CAT-02: usuario autenticado → 200 con array", async () => {
    const c = chain();
    c.order = jest.fn().mockResolvedValue({ data: [{ id: CAT_ID, nombre: "Alimentos", descripcion: null, activo: true }], error: null });
    c.eq = jest.fn().mockReturnValue(c);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/categorias/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].nombre).toBe("Alimentos");
  });

  // I-CAT-03
  it("I-CAT-03: error de DB → 500", async () => {
    const c = chain();
    c.order = jest.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    c.eq = jest.fn().mockReturnValue(c);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/categorias/route");
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/categorias
// ──────────────────────────────────────────────────────────────────────────────

describe("POST /api/categorias", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: true, storeId: STORE_ID, userId: "u1" });
    mockFrom.mockReturnValue(chain());
  });

  // I-CAT-04
  it("I-CAT-04: sin sesión → 401", async () => {
    mockAuth.mockResolvedValue({ userId: null, sessionClaims: null });
    const { POST } = await import("@/app/api/categorias/route");
    const res = await POST(req("/api/categorias", "POST", { nombre: "Accesorios" }));
    expect(res.status).toBe(401);
  });

  // I-CAT-05
  it("I-CAT-05: rol worker (sin admin) → 403", async () => {
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: false, storeId: STORE_ID, userId: "u1" });
    const { POST } = await import("@/app/api/categorias/route");
    const res = await POST(req("/api/categorias", "POST", { nombre: "Accesorios" }));
    expect(res.status).toBe(403);
  });

  // I-CAT-06
  it("I-CAT-06: nombre faltante → 400", async () => {
    const { POST } = await import("@/app/api/categorias/route");
    const res = await POST(req("/api/categorias", "POST", { descripcion: "sin nombre" }));
    expect(res.status).toBe(400);
  });

  // I-CAT-07
  it("I-CAT-07: nombre < 2 chars → 400", async () => {
    const { POST } = await import("@/app/api/categorias/route");
    const res = await POST(req("/api/categorias", "POST", { nombre: "A" }));
    expect(res.status).toBe(400);
  });

  // I-CAT-08
  it("I-CAT-08: nombre duplicado → 409", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "23505" } });
    const { POST } = await import("@/app/api/categorias/route");
    const res = await POST(req("/api/categorias", "POST", { nombre: "Alimentos" }));
    expect(res.status).toBe(409);
  });

  // I-CAT-09
  it("I-CAT-09: storeAdmin crea categoría válida → 201", async () => {
    mockSingle.mockResolvedValue({
      data: { id: CAT_ID, store_id: STORE_ID, nombre: "Accesorios", descripcion: null, activo: true },
      error: null,
    });
    const { POST } = await import("@/app/api/categorias/route");
    const res = await POST(req("/api/categorias", "POST", { nombre: "Accesorios" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.nombre).toBe("Accesorios");
  });

  // I-CAT-10
  it("I-CAT-10: systemAdmin crea categoría válida → 201", async () => {
    mockAuth.mockResolvedValue({
      userId: "admin1",
      sessionClaims: { publicMetadata: { storeId: STORE_ID, systemAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: true, isStoreAdmin: false, storeId: STORE_ID, userId: "admin1" });
    mockSingle.mockResolvedValue({
      data: { id: CAT_ID, store_id: STORE_ID, nombre: "Medicamentos", descripcion: "Productos veterinarios", activo: true },
      error: null,
    });
    const { POST } = await import("@/app/api/categorias/route");
    const res = await POST(req("/api/categorias", "POST", { nombre: "Medicamentos", descripcion: "Productos veterinarios" }));
    expect(res.status).toBe(201);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/categorias/[id]
// ──────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/categorias/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: true, storeId: STORE_ID, userId: "u1" });
    mockFrom.mockReturnValue(chain());
  });

  // I-CAT-11
  it("I-CAT-11: rol worker → 403", async () => {
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: false, storeId: STORE_ID, userId: "u1" });
    const { PATCH } = await import("@/app/api/categorias/[id]/route");
    const res = await PATCH(req(`/api/categorias/${CAT_ID}`, "PATCH", { nombre: "Nuevo" }), { params: idParams });
    expect(res.status).toBe(403);
  });

  // I-CAT-12
  it("I-CAT-12: admin actualiza nombre → 200", async () => {
    mockSingle.mockResolvedValue({
      data: { id: CAT_ID, store_id: STORE_ID, nombre: "Alimentos Premium", descripcion: null, activo: true },
      error: null,
    });
    const { PATCH } = await import("@/app/api/categorias/[id]/route");
    const res = await PATCH(req(`/api/categorias/${CAT_ID}`, "PATCH", { nombre: "Alimentos Premium" }), { params: idParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nombre).toBe("Alimentos Premium");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/categorias/[id]
// ──────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/categorias/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: true, storeId: STORE_ID, userId: "u1" });
    mockFrom.mockReturnValue(chain());
  });

  // I-CAT-13
  it("I-CAT-13: rol worker → 403", async () => {
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: false, storeId: STORE_ID, userId: "u1" });
    const { DELETE } = await import("@/app/api/categorias/[id]/route");
    const res = await DELETE(req(`/api/categorias/${CAT_ID}`, "DELETE"), { params: idParams });
    expect(res.status).toBe(403);
  });

  // I-CAT-14
  it("I-CAT-14: admin elimina (soft-delete) → 204", async () => {
    // update().eq("id").eq("store_id") debe resolver con { error: null }
    const finalEq = jest.fn().mockResolvedValue({ error: null });
    const firstEq = jest.fn().mockReturnValue({ eq: finalEq });
    const c = chain();
    c.update = jest.fn().mockReturnValue({ eq: firstEq });
    mockFrom.mockReturnValue(c);

    const { DELETE } = await import("@/app/api/categorias/[id]/route");
    const res = await DELETE(req(`/api/categorias/${CAT_ID}`, "DELETE"), { params: idParams });
    expect(res.status).toBe(204);
  });
});
