/**
 * Tests I-CITA-37 a I-CITA-45: GET/POST /api/servicios/[id]/excepciones y
 * DELETE /api/servicios/[id]/excepciones/[excepcionId].
 * GET abierto a la tienda; POST/DELETE solo admin (configuración).
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const SERVICIO_ID = "123e4567-e89b-12d3-a456-426614174100";
const EXCEPCION_ID = "123e4567-e89b-12d3-a456-426614174500";

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
    delete: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    single: mockSingle,
  };
  ["select", "insert", "update", "delete", "eq", "order"].forEach((k) => c[k].mockReturnValue(c));
  return c;
}

function req(url: string, method = "GET", body?: object) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

const idParams = Promise.resolve({ id: SERVICIO_ID });
const excepcionParams = Promise.resolve({ id: SERVICIO_ID, excepcionId: EXCEPCION_ID });

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/servicios/[id]/excepciones
// ──────────────────────────────────────────────────────────────────────────────

describe("GET /api/servicios/[id]/excepciones", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockSingle.mockReset();
    mockFrom.mockReturnValue(chain());
  });

  // I-CITA-37
  it("I-CITA-37: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/servicios/[id]/excepciones/route");
    const res = await GET(req(`/api/servicios/${SERVICIO_ID}/excepciones`), { params: idParams });
    expect(res.status).toBe(401);
  });

  // I-CITA-38
  it("I-CITA-38: lista excepciones del servicio ordenadas por fecha", async () => {
    // 1ra llamada single: ownership del servicio
    mockSingle.mockResolvedValueOnce({ data: { id: SERVICIO_ID }, error: null });
    const c = chain();
    c.eq = jest.fn().mockReturnValue(c);
    c.order = jest.fn().mockResolvedValue({
      data: [
        { id: "e1", fecha: "2026-12-25", cerrado: true, hora_inicio: null, hora_fin: null },
        { id: "e2", fecha: "2026-12-31", cerrado: false, hora_inicio: "09:00:00", hora_fin: "12:00:00" },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/servicios/[id]/excepciones/route");
    const res = await GET(req(`/api/servicios/${SERVICIO_ID}/excepciones`), { params: idParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].fecha).toBe("2026-12-25");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/servicios/[id]/excepciones
// ──────────────────────────────────────────────────────────────────────────────

describe("POST /api/servicios/[id]/excepciones", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: true, storeId: STORE_ID, userId: "u1" });
    mockRequireStoreAdmin.mockImplementation(() => {});
    mockSingle.mockReset();
    mockFrom.mockReturnValue(chain());
  });

  // I-CITA-39
  it("I-CITA-39: POST sin rol admin → 403", async () => {
    mockRequireStoreAdmin.mockImplementation(() => { throw new Error("Store admin required"); });
    const { POST } = await import("@/app/api/servicios/[id]/excepciones/route");
    const res = await POST(req(`/api/servicios/${SERVICIO_ID}/excepciones`, "POST", { fecha: "2026-12-25", cerrado: true }), { params: idParams });
    expect(res.status).toBe(403);
  });

  // I-CITA-40
  it("I-CITA-40: POST cerrado:true con horas enviadas → 400 (Zod refine)", async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: SERVICIO_ID }, error: null });
    const { POST } = await import("@/app/api/servicios/[id]/excepciones/route");
    const res = await POST(
      req(`/api/servicios/${SERVICIO_ID}/excepciones`, "POST", {
        fecha: "2026-12-25",
        cerrado: true,
        hora_inicio: "09:00",
        hora_fin: "12:00",
      }),
      { params: idParams }
    );
    expect(res.status).toBe(400);
  });

  // I-CITA-41
  it("I-CITA-41: POST cerrado:false sin horas → 400 (Zod refine)", async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: SERVICIO_ID }, error: null });
    const { POST } = await import("@/app/api/servicios/[id]/excepciones/route");
    const res = await POST(
      req(`/api/servicios/${SERVICIO_ID}/excepciones`, "POST", { fecha: "2026-12-25", cerrado: false }),
      { params: idParams }
    );
    expect(res.status).toBe(400);
  });

  // I-CITA-42
  it("I-CITA-42: POST válido → 201", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: SERVICIO_ID }, error: null }) // ownership
      .mockResolvedValueOnce({
        data: { id: EXCEPCION_ID, fecha: "2026-12-25", cerrado: true, hora_inicio: null, hora_fin: null },
        error: null,
      }); // insert
    const { POST } = await import("@/app/api/servicios/[id]/excepciones/route");
    const res = await POST(
      req(`/api/servicios/${SERVICIO_ID}/excepciones`, "POST", { fecha: "2026-12-25", cerrado: true }),
      { params: idParams }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.fecha).toBe("2026-12-25");
  });

  // I-CITA-43
  it("I-CITA-43: POST fecha duplicada (error 23505) → 409", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: SERVICIO_ID }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    const { POST } = await import("@/app/api/servicios/[id]/excepciones/route");
    const res = await POST(
      req(`/api/servicios/${SERVICIO_ID}/excepciones`, "POST", { fecha: "2026-12-25", cerrado: true }),
      { params: idParams }
    );
    expect(res.status).toBe(409);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/servicios/[id]/excepciones/[excepcionId]
// ──────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/servicios/[id]/excepciones/[excepcionId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: true, storeId: STORE_ID, userId: "u1" });
    mockRequireStoreAdmin.mockImplementation(() => {});
    mockSingle.mockReset();
    mockFrom.mockReturnValue(chain());
  });

  // I-CITA-44
  it("I-CITA-44: excepción de otra tienda/servicio → 404", async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null });
    const { DELETE } = await import("@/app/api/servicios/[id]/excepciones/[excepcionId]/route");
    const res = await DELETE(req(`/api/servicios/${SERVICIO_ID}/excepciones/${EXCEPCION_ID}`, "DELETE"), { params: excepcionParams });
    expect(res.status).toBe(404);
  });

  // I-CITA-45
  it("I-CITA-45: DELETE válido → 204 (hard delete)", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: EXCEPCION_ID, fecha: "2026-12-25", cerrado: true, hora_inicio: null, hora_fin: null },
      error: null,
    });
    const finalEq = jest.fn().mockResolvedValue({ error: null });
    const secondEq = jest.fn().mockReturnValue({ eq: finalEq });
    const firstEq = jest.fn().mockReturnValue({ eq: secondEq });
    const c = chain();
    c.delete = jest.fn().mockReturnValue({ eq: firstEq });
    mockFrom.mockReturnValue(c);

    const { DELETE } = await import("@/app/api/servicios/[id]/excepciones/[excepcionId]/route");
    const res = await DELETE(req(`/api/servicios/${SERVICIO_ID}/excepciones/${EXCEPCION_ID}`, "DELETE"), { params: excepcionParams });
    expect(res.status).toBe(204);
  });
});
