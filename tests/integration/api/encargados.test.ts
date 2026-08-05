/**
 * Tests I-ENC-01 a I-ENC-10: GET, POST, PATCH, DELETE /api/encargados.
 *
 * Encargados solo administrados por storeAdmin y systemAdmin (plan §4).
 * GET incluye conteos de citas agregados server-side (citas_totales /
 * citas_completadas), igual que /api/workers con ventas_mes/ventas_hoy.
 * DELETE es soft delete (activo=false), nunca .delete() — las citas
 * históricas referencian encargados (FK ON DELETE RESTRICT).
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const ENCARGADO_ID = "123e4567-e89b-12d3-a456-426614174500";

const mockGetStoreId = jest.fn();
const mockAuth = jest.fn();
const mockGetAdminStatus = jest.fn();
const mockRequireStoreAdmin = jest.fn(() => {});
const mockFrom = jest.fn();
const mockSingle = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
jest.mock("@/lib/admin-check", () => ({
  getAdminStatus: mockGetAdminStatus,
  requireStoreAdmin: mockRequireStoreAdmin,
}));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom })),
}));

function chain() {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    eq: jest.fn(),
    not: jest.fn(),
    order: jest.fn(),
    single: mockSingle,
  };
  ["select", "insert", "update", "eq", "not", "order"].forEach((k) => c[k].mockReturnValue(c));
  return c;
}

function req(url: string, method = "GET", body?: object) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

const idParams = Promise.resolve({ id: ENCARGADO_ID });

function adminBeforeEach() {
  jest.clearAllMocks();
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  mockAuth.mockResolvedValue({
    userId: "u1",
    sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
  });
  mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: true, storeId: STORE_ID, userId: "u1" });
  mockRequireStoreAdmin.mockImplementation(() => {});
  mockFrom.mockReturnValue(chain());
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/encargados
// ──────────────────────────────────────────────────────────────────────────────

describe("GET /api/encargados", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  // I-ENC-05
  it("I-ENC-05: lista solo encargados activos de la tienda propia (aislamiento tenant)", async () => {
    const eqCalls: Array<{ col: string; val: unknown }> = [];
    mockFrom.mockImplementation((tabla: string) => {
      const c = chain();
      if (tabla === "encargados") {
        c.eq = jest.fn().mockImplementation((col: string, val: unknown) => { eqCalls.push({ col, val }); return c; });
        c.order = jest.fn().mockResolvedValue({
          data: [
            { id: ENCARGADO_ID, nombre: "Juan Pérez", activo: true },
            { id: "otro-id", nombre: "María López", activo: true },
          ],
          error: null,
        });
      } else if (tabla === "citas") {
        c.not = jest.fn().mockResolvedValue({ data: [], error: null });
      }
      return c;
    });

    const { GET } = await import("@/app/api/encargados/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    // tenant-scoped: store_id filtrado con el storeId del contexto
    expect(eqCalls.find((x) => x.col === "store_id")?.val).toBe(STORE_ID);
    expect(eqCalls.find((x) => x.col === "activo")?.val).toBe(true);
  });

  // I-ENC-06
  it("I-ENC-06: GET incluye citas_totales/citas_completadas correctos", async () => {
    mockFrom.mockImplementation((tabla: string) => {
      const c = chain();
      if (tabla === "encargados") {
        c.order = jest.fn().mockResolvedValue({
          data: [{ id: ENCARGADO_ID, nombre: "Juan Pérez", activo: true }],
          error: null,
        });
      } else if (tabla === "citas") {
        c.not = jest.fn().mockResolvedValue({
          data: [
            { encargado_id: ENCARGADO_ID, estado: "completada" },
            { encargado_id: ENCARGADO_ID, estado: "confirmada" },
            { encargado_id: ENCARGADO_ID, estado: "completada" },
            { encargado_id: null, estado: "completada" }, // sin asignar — no cuenta
          ],
          error: null,
        });
      }
      return c;
    });

    const { GET } = await import("@/app/api/encargados/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].citas_totales).toBe(3);
    expect(body[0].citas_completadas).toBe(2);
  });

  // I-ENC-02 (parcial)
  it("I-ENC-02: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/encargados/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/encargados
// ──────────────────────────────────────────────────────────────────────────────

describe("POST /api/encargados", () => {
  beforeEach(adminBeforeEach);

  // I-ENC-01
  it("I-ENC-01: POST crea encargado (storeAdmin) → 201", async () => {
    mockSingle.mockResolvedValue({
      data: { id: ENCARGADO_ID, store_id: STORE_ID, nombre: "Juan Pérez", activo: true },
      error: null,
    });
    const { POST } = await import("@/app/api/encargados/route");
    const res = await POST(req("/api/encargados", "POST", { nombre: "Juan Pérez" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.nombre).toBe("Juan Pérez");
  });

  // I-ENC-03
  it("I-ENC-03: rol worker (sin admin) → 403", async () => {
    mockRequireStoreAdmin.mockImplementation(() => { throw new Error("Store admin required"); });
    const { POST } = await import("@/app/api/encargados/route");
    const res = await POST(req("/api/encargados", "POST", { nombre: "Juan Pérez" }));
    expect(res.status).toBe(403);
  });

  // I-ENC-04
  it("I-ENC-04: nombre duplicado en la misma tienda → 409", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "23505" } });
    const { POST } = await import("@/app/api/encargados/route");
    const res = await POST(req("/api/encargados", "POST", { nombre: "Juan Pérez" }));
    expect(res.status).toBe(409);
  });

  it("I-ENC-02 (POST): sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/encargados/route");
    const res = await POST(req("/api/encargados", "POST", { nombre: "Juan Pérez" }));
    expect(res.status).toBe(401);
  });

  it("I-ENC-01 (adicional): body con store_id de otra tienda → se ignora, persiste con el del contexto", async () => {
    mockSingle.mockResolvedValue({
      data: { id: ENCARGADO_ID, store_id: STORE_ID, nombre: "Juan Pérez", activo: true },
      error: null,
    });
    const { POST } = await import("@/app/api/encargados/route");
    const res = await POST(req("/api/encargados", "POST", {
      nombre: "Juan Pérez",
      store_id: "malicious-store-id",
    }));
    expect(res.status).toBe(201);
  });

  it("I-ENC-01 (adicional): nombre con 1 carácter → 400 (Zod)", async () => {
    const { POST } = await import("@/app/api/encargados/route");
    const res = await POST(req("/api/encargados", "POST", { nombre: "A" }));
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/encargados/[id]
// ──────────────────────────────────────────────────────────────────────────────

describe("GET /api/encargados/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  it("I-ENC-08: encargado de otra tienda (PGRST116) → 404", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const { GET } = await import("@/app/api/encargados/[id]/route");
    const res = await GET(new NextRequest("http://localhost"), { params: idParams });
    expect(res.status).toBe(404);
  });

  it("I-ENC-07 (adicional): encargado existente → 200", async () => {
    mockSingle.mockResolvedValue({
      data: { id: ENCARGADO_ID, store_id: STORE_ID, nombre: "Juan Pérez", activo: true },
      error: null,
    });
    const { GET } = await import("@/app/api/encargados/[id]/route");
    const res = await GET(new NextRequest("http://localhost"), { params: idParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nombre).toBe("Juan Pérez");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/encargados/[id]
// ──────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/encargados/[id]", () => {
  beforeEach(adminBeforeEach);

  // I-ENC-07
  it("I-ENC-07: PATCH actualiza nombre/activo (storeAdmin) → 200", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: ENCARGADO_ID, nombre: "Juan", activo: true }, error: null }) // fetch previo
      .mockResolvedValueOnce({ data: { id: ENCARGADO_ID, nombre: "Juan Pérez", activo: false }, error: null }); // update
    const { PATCH } = await import("@/app/api/encargados/[id]/route");
    const res = await PATCH(
      req(`/api/encargados/${ENCARGADO_ID}`, "PATCH", { nombre: "Juan Pérez", activo: false }),
      { params: idParams }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nombre).toBe("Juan Pérez");
    expect(body.activo).toBe(false);
  });

  // I-ENC-08
  it("I-ENC-08: PATCH encargado de otra tienda → 404 (IDOR)", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null }); // fetch previo falla por .eq("store_id", ...)
    const { PATCH } = await import("@/app/api/encargados/[id]/route");
    const res = await PATCH(
      req(`/api/encargados/${ENCARGADO_ID}`, "PATCH", { nombre: "Hack" }),
      { params: idParams }
    );
    expect(res.status).toBe(404);
  });

  it("I-ENC-07 (adicional): PATCH sin campos → 400", async () => {
    const { PATCH } = await import("@/app/api/encargados/[id]/route");
    const res = await PATCH(req(`/api/encargados/${ENCARGADO_ID}`, "PATCH", {}), { params: idParams });
    expect(res.status).toBe(400);
  });

  it("I-ENC-07 (adicional): nombre duplicado en PATCH → 409", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: ENCARGADO_ID, nombre: "Juan", activo: true }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    const { PATCH } = await import("@/app/api/encargados/[id]/route");
    const res = await PATCH(
      req(`/api/encargados/${ENCARGADO_ID}`, "PATCH", { nombre: "María López" }),
      { params: idParams }
    );
    expect(res.status).toBe(409);
  });

  it("I-ENC-03 (adicional): PATCH rol worker → 403", async () => {
    mockRequireStoreAdmin.mockImplementation(() => { throw new Error("Store admin required"); });
    const { PATCH } = await import("@/app/api/encargados/[id]/route");
    const res = await PATCH(
      req(`/api/encargados/${ENCARGADO_ID}`, "PATCH", { nombre: "Juan" }),
      { params: idParams }
    );
    expect(res.status).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/encargados/[id]
// ──────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/encargados/[id]", () => {
  beforeEach(() => {
    adminBeforeEach();
    mockSingle.mockReset();
  });

  // I-ENC-09
  it("I-ENC-09: soft delete — update({activo:false}), nunca .delete()", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: ENCARGADO_ID, nombre: "Juan Pérez", activo: true },
      error: null,
    });

    const finalEq = jest.fn().mockResolvedValue({ error: null });
    const firstEq = jest.fn().mockReturnValue({ eq: finalEq });
    const c = chain();
    c.update = jest.fn().mockReturnValue({ eq: firstEq });
    mockFrom.mockReturnValue(c);

    const { DELETE } = await import("@/app/api/encargados/[id]/route");
    const res = await DELETE(req(`/api/encargados/${ENCARGADO_ID}`, "DELETE"), { params: idParams });
    expect(res.status).toBe(204);
    expect(c.update).toHaveBeenCalledWith({ activo: false });
  });

  // I-ENC-10
  it("I-ENC-10: DELETE id inexistente → 404", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const { DELETE } = await import("@/app/api/encargados/[id]/route");
    const res = await DELETE(req(`/api/encargados/${ENCARGADO_ID}`, "DELETE"), { params: idParams });
    expect(res.status).toBe(404);
  });
});
