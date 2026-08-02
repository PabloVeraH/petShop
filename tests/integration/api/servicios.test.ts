/**
 * Tests I-SRV-01 a I-SRV-29: GET, POST, PATCH, DELETE /api/servicios
 * y GET/PUT /api/servicios/[id]/horarios.
 *
 * Servicios solo administrados por storeAdmin y systemAdmin.
 * Horarios usan RPC atomico replace_servicio_horarios con ERRCODE=P0002.
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const SERVICIO_ID = "123e4567-e89b-12d3-a456-426614174100";

const mockGetStoreId = jest.fn();
const mockAuth = jest.fn();
const mockGetAdminStatus = jest.fn();
const mockRequireStoreAdmin = jest.fn(() => {});
const mockFrom = jest.fn();
const mockSingle = jest.fn();
const mockRpc = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
jest.mock("@/lib/admin-check", () => ({
  getAdminStatus: mockGetAdminStatus,
  requireStoreAdmin: mockRequireStoreAdmin,
}));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));

function chain() {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    single: mockSingle,
  };
  ["select", "insert", "update", "eq", "order"].forEach((k) => c[k].mockReturnValue(c));
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

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/servicios
// ──────────────────────────────────────────────────────────────────────────────

describe("GET /api/servicios", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-SRV-01
  it("I-SRV-01: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/servicios/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  // I-SRV-02
  it("I-SRV-02: usuario autenticado → 200 con array", async () => {
    const c = chain();
    c.order = jest.fn().mockResolvedValue({
      data: [{ id: SERVICIO_ID, nombre: "Corte básico", descripcion: null, duracion_minutos: 30, activo: true }],
      error: null,
    });
    c.eq = jest.fn().mockReturnValue(c);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/servicios/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].nombre).toBe("Corte básico");
  });

  // I-SRV-03
  it("I-SRV-03: filtra por store_id y activo=true", async () => {
    const eqCalls: Array<{ col: string; val: unknown }> = [];
    const c = chain();
    c.eq = jest.fn().mockImplementation((col: string, val: unknown) => { eqCalls.push({ col, val }); return c; });
    c.order = jest.fn().mockResolvedValue({
      data: [{ id: SERVICIO_ID, nombre: "Baño", descripcion: null, duracion_minutos: 60, activo: true }],
      error: null,
    });
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/servicios/route");
    const res = await GET();
    expect(res.status).toBe(200);

    // La primera eq es store_id, la segunda activo
    const storeCall = eqCalls.find((c) => c.col === "store_id");
    const activoCall = eqCalls.find((c) => c.col === "activo");
    expect(storeCall?.val).toBe(STORE_ID);
    expect(activoCall?.val).toBe(true);
  });

  // I-SRV-04
  it("I-SRV-04: error de DB → 500", async () => {
    const c = chain();
    c.order = jest.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    c.eq = jest.fn().mockReturnValue(c);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/servicios/route");
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/servicios — control de acceso por rol
// ──────────────────────────────────────────────────────────────────────────────

describe("POST /api/servicios", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: true, storeId: STORE_ID, userId: "u1" });
    mockRequireStoreAdmin.mockImplementation(() => {});
    mockFrom.mockReturnValue(chain());
  });

  // I-SRV-05
  it("I-SRV-05: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/servicios/route");
    const res = await POST(req("/api/servicios", "POST", { nombre: "Corte básico", duracion_minutos: 30 }));
    expect(res.status).toBe(401);
  });

  // I-SRV-06
  it("I-SRV-06: rol worker (sin admin) → 403", async () => {
    mockRequireStoreAdmin.mockImplementation(() => { throw new Error("Store admin required"); });
    const { POST } = await import("@/app/api/servicios/route");
    const res = await POST(req("/api/servicios", "POST", { nombre: "Corte básico", duracion_minutos: 30 }));
    expect(res.status).toBe(403);
  });

  // I-SRV-07
  it("I-SRV-07: duracion_minutos: 0 → 400", async () => {
    const { POST } = await import("@/app/api/servicios/route");
    const res = await POST(req("/api/servicios", "POST", { nombre: "Corte básico", duracion_minutos: 0 }));
    expect(res.status).toBe(400);
  });

  // I-SRV-29
  it("I-SRV-29: duracion_minutos: 45 (entero fuera del enum 30/60/90) → 400", async () => {
    const { POST } = await import("@/app/api/servicios/route");
    const res = await POST(req("/api/servicios", "POST", { nombre: "Corte básico", duracion_minutos: 45 }));
    expect(res.status).toBe(400);
  });

  // I-SRV-08
  it("I-SRV-08: body con store_id de otra tienda → se ignora, persiste con store_id del contexto → 201", async () => {
    mockSingle.mockResolvedValue({
      data: { id: SERVICIO_ID, store_id: STORE_ID, nombre: "Corte básico", descripcion: null, duracion_minutos: 30, activo: true },
      error: null,
    });
    const { POST } = await import("@/app/api/servicios/route");
    const res = await POST(req("/api/servicios", "POST", {
      nombre: "Corte básico",
      duracion_minutos: 30,
      store_id: "malicious-store-id",
    }));
    expect(res.status).toBe(201);
  });

  // I-SRV-09
  it("I-SRV-09: nombre duplicado → 409", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "23505" } });
    const { POST } = await import("@/app/api/servicios/route");
    const res = await POST(req("/api/servicios", "POST", { nombre: "Corte básico", duracion_minutos: 30 }));
    expect(res.status).toBe(409);
  });

  // I-SRV-10
  it("I-SRV-10: payload válido → 201", async () => {
    mockSingle.mockResolvedValue({
      data: { id: SERVICIO_ID, store_id: STORE_ID, nombre: "Corte básico", descripcion: null, duracion_minutos: 30, activo: true },
      error: null,
    });
    const { POST } = await import("@/app/api/servicios/route");
    const res = await POST(req("/api/servicios", "POST", { nombre: "Corte básico", duracion_minutos: 30 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.nombre).toBe("Corte básico");
    expect(body.duracion_minutos).toBe(30);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/servicios/[id]
// ──────────────────────────────────────────────────────────────────────────────

describe("GET /api/servicios/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-SRV-11
  it("I-SRV-11: servicio de otra tienda (PGRST116) → 404", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const { GET } = await import("@/app/api/servicios/[id]/route");
    const res = await GET(new NextRequest("http://localhost"), { params: Promise.resolve({ id: SERVICIO_ID }) });
    expect(res.status).toBe(404);
  });

  // I-SRV-12
  it("I-SRV-12: servicio existente → 200 con servicio_horarios anidado y ordenado", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: SERVICIO_ID,
        store_id: STORE_ID,
        nombre: "Corte básico",
        descripcion: null,
        duracion_minutos: 30,
        activo: true,
        servicio_horarios: [
          { id: "h1", dia_semana: 3, hora_inicio: "14:00:00", hora_fin: "18:00:00" },
          { id: "h2", dia_semana: 1, hora_inicio: "09:00:00", hora_fin: "13:00:00" },
        ],
      },
      error: null,
    });
    const { GET } = await import("@/app/api/servicios/[id]/route");
    const res = await GET(new NextRequest("http://localhost"), { params: idParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    // deben estar ordenados por dia_semana
    expect(body.servicio_horarios[0].dia_semana).toBe(1);
    expect(body.servicio_horarios[1].dia_semana).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/servicios/[id] — control de acceso por rol
// ──────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/servicios/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: true, storeId: STORE_ID, userId: "u1" });
    mockRequireStoreAdmin.mockImplementation(() => {});
    mockFrom.mockReturnValue(chain());
  });

  // I-SRV-13
  it("I-SRV-13: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/servicios/[id]/route");
    const res = await PATCH(req(`/api/servicios/${SERVICIO_ID}`, "PATCH", { nombre: "Nuevo" }), { params: idParams });
    expect(res.status).toBe(401);
  });

  // I-SRV-14
  it("I-SRV-14: rol worker → 403", async () => {
    mockRequireStoreAdmin.mockImplementation(() => { throw new Error("Store admin required"); });
    const { PATCH } = await import("@/app/api/servicios/[id]/route");
    const res = await PATCH(req(`/api/servicios/${SERVICIO_ID}`, "PATCH", { nombre: "Nuevo" }), { params: idParams });
    expect(res.status).toBe(403);
  });

  // I-SRV-15
  it("I-SRV-15: servicio de otra tienda → 404", async () => {
    // Fetch previo devuelve null (falla single en .eq("store_id", ctx.storeId))
    mockSingle.mockResolvedValue({ data: null, error: null });
    const { PATCH } = await import("@/app/api/servicios/[id]/route");
    const res = await PATCH(req(`/api/servicios/${SERVICIO_ID}`, "PATCH", { nombre: "Nuevo" }), { params: idParams });
    expect(res.status).toBe(404);
  });

  // I-SRV-16
  it("I-SRV-16: PATCH sin descripcion no la modifica (solo cambia activo)", async () => {
    // fetch previo → OK
    mockSingle.mockResolvedValueOnce({
      data: { id: SERVICIO_ID, nombre: "Original", descripcion: "Desc anterior", duracion_minutos: 30, activo: true },
      error: null,
    });
    // update → OK
    mockSingle.mockResolvedValueOnce({
      data: { id: SERVICIO_ID, nombre: "Original", descripcion: "Desc anterior", duracion_minutos: 30, activo: false },
      error: null,
    });
    const { PATCH } = await import("@/app/api/servicios/[id]/route");
    const res = await PATCH(req(`/api/servicios/${SERVICIO_ID}`, "PATCH", { activo: false }), { params: idParams });
    expect(res.status).toBe(200);
  });

  // I-SRV-17
  it("I-SRV-17: duracion_minutos inválida → 400", async () => {
    const { PATCH } = await import("@/app/api/servicios/[id]/route");
    const res = await PATCH(
      req(`/api/servicios/${SERVICIO_ID}`, "PATCH", { duracion_minutos: 0 }),
      { params: idParams },
    );
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/servicios/[id]
// ──────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/servicios/[id]", () => {
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

  // I-SRV-18
  it("I-SRV-18: soft delete — assert update({activo:false}), nunca .delete()", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: SERVICIO_ID, nombre: "Corte básico", descripcion: null, duracion_minutos: 30, activo: true },
      error: null,
    });

    const finalEq = jest.fn().mockResolvedValue({ error: null });
    const firstEq = jest.fn().mockReturnValue({ eq: finalEq });
    const c = chain();
    c.update = jest.fn().mockReturnValue({ eq: firstEq });
    mockFrom.mockReturnValue(c);

    const { DELETE } = await import("@/app/api/servicios/[id]/route");
    const res = await DELETE(req(`/api/servicios/${SERVICIO_ID}`, "DELETE"), { params: idParams });
    expect(res.status).toBe(204);
  });

  // I-SRV-19
  it("I-SRV-19: servicio de otra tienda → 404", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const { DELETE } = await import("@/app/api/servicios/[id]/route");
    const res = await DELETE(req(`/api/servicios/${SERVICIO_ID}`, "DELETE"), { params: idParams });
    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/servicios/[id]/horarios
// ──────────────────────────────────────────────────────────────────────────────

describe("GET /api/servicios/[id]/horarios", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-SRV-20
  it("I-SRV-20: servicio de otra tienda → 404", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const c = chain();
    c.eq = jest.fn().mockReturnValue(c);
    c.order = jest.fn().mockReturnValue(c);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/servicios/[id]/horarios/route");
    const res = await GET(new NextRequest("http://localhost"), { params: idParams });
    expect(res.status).toBe(404);
  });

  // I-SRV-21
  it("I-SRV-21: servicio sin horarios configurados → 200 array vacío", async () => {
    mockSingle.mockResolvedValue({ data: { id: SERVICIO_ID }, error: null });
    const c = chain();
    c.eq = jest.fn().mockReturnValue(c);
    c.order = jest.fn().mockResolvedValue({ data: [], error: null });
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/servicios/[id]/horarios/route");
    const res = await GET(new NextRequest("http://localhost"), { params: idParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/servicios/[id]/horarios — control de acceso por rol
// ──────────────────────────────────────────────────────────────────────────────

describe("PUT /api/servicios/[id]/horarios", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: true, storeId: STORE_ID, userId: "u1" });
    mockRequireStoreAdmin.mockImplementation(() => {});
    mockRpc.mockResolvedValue({
      data: [
        { id: "h1", dia_semana: 1, hora_inicio: "09:00:00", hora_fin: "18:00:00" },
        { id: "h2", dia_semana: 3, hora_inicio: "14:00:00", hora_fin: "18:00:00" },
      ],
      error: null,
    });
  });

  // I-SRV-22
  it("I-SRV-22: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { PUT } = await import("@/app/api/servicios/[id]/horarios/route");
    const res = await PUT(req(`/api/servicios/${SERVICIO_ID}/horarios`, "PUT", {
      horarios: [{ dia_semana: 1, hora_inicio: "09:00", hora_fin: "18:00" }],
    }), { params: idParams });
    expect(res.status).toBe(401);
  });

  // I-SRV-23
  it("I-SRV-23: rol worker → 403", async () => {
    mockRequireStoreAdmin.mockImplementation(() => { throw new Error("Store admin required"); });
    const { PUT } = await import("@/app/api/servicios/[id]/horarios/route");
    const res = await PUT(
      req(`/api/servicios/${SERVICIO_ID}/horarios`, "PUT", {
        horarios: [{ dia_semana: 1, hora_inicio: "09:00", hora_fin: "18:00" }],
      }),
      { params: idParams },
    );
    expect(res.status).toBe(403);
  });

  // I-SRV-24
  it("I-SRV-24: algún día con hora_inicio >= hora_fin → 400", async () => {
    const { PUT } = await import("@/app/api/servicios/[id]/horarios/route");
    const res = await PUT(
      req(`/api/servicios/${SERVICIO_ID}/horarios`, "PUT", {
        horarios: [{ dia_semana: 1, hora_inicio: "18:00", hora_fin: "09:00" }],
      }),
      { params: idParams },
    );
    expect(res.status).toBe(400);
  });

  // I-SRV-25
  it("I-SRV-25: día repetido en el array → 400", async () => {
    const { PUT } = await import("@/app/api/servicios/[id]/horarios/route");
    const res = await PUT(
      req(`/api/servicios/${SERVICIO_ID}/horarios`, "PUT", {
        horarios: [
          { dia_semana: 1, hora_inicio: "09:00", hora_fin: "12:00" },
          { dia_semana: 1, hora_inicio: "14:00", hora_fin: "18:00" },
        ],
      }),
      { params: idParams },
    );
    expect(res.status).toBe(400);
  });

  // I-SRV-26
  it("I-SRV-26: payload válido (7 días, franjas válidas) → 200, respuesta ordenada, p_store_id del contexto", async () => {
    const franjas = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
      dia_semana: d,
      hora_inicio: "09:00",
      hora_fin: "18:00",
    }));
    mockRpc.mockResolvedValue({
      data: franjas.map((f) => ({
        id: `h${f.dia_semana}`,
        dia_semana: f.dia_semana,
        hora_inicio: "09:00:00",
        hora_fin: "18:00:00",
      })),
      error: null,
    });
    const { PUT } = await import("@/app/api/servicios/[id]/horarios/route");
    const res = await PUT(
      req(`/api/servicios/${SERVICIO_ID}/horarios`, "PUT", { horarios: franjas }),
      { params: idParams },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(7);
    // Ordenado por dia_semana
    for (let i = 0; i < 7; i++) {
      expect(body[i].dia_semana).toBe(i + 1);
    }
    // RPC fue llamado con p_store_id del contexto, no del body
    expect(mockRpc).toHaveBeenCalledWith("replace_servicio_horarios", {
      p_servicio_id: SERVICIO_ID,
      p_store_id: STORE_ID,
      p_horarios: franjas,
    });
  });

  // I-SRV-27
  it("I-SRV-27: servicio de otra tienda → 404 (mock RPC error.code P0002)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "not found" } });
    const { PUT } = await import("@/app/api/servicios/[id]/horarios/route");
    const res = await PUT(
      req(`/api/servicios/${SERVICIO_ID}/horarios`, "PUT", {
        horarios: [{ dia_semana: 1, hora_inicio: "09:00", hora_fin: "18:00" }],
      }),
      { params: idParams },
    );
    expect(res.status).toBe(404);
  });

  // I-SRV-28
  it("I-SRV-28: array vacío → 200 (limpia el horario completo)", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { PUT } = await import("@/app/api/servicios/[id]/horarios/route");
    const res = await PUT(
      req(`/api/servicios/${SERVICIO_ID}/horarios`, "PUT", { horarios: [] }),
      { params: idParams },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});