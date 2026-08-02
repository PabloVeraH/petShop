/**
 * Tests I-CITA-01 a I-CITA-29: GET/POST /api/citas y GET/PATCH /api/citas/[id].
 * Crear/cancelar/completar una cita NO requiere rol admin (decisión §9a del
 * plan — operación de staff, como registrar una venta en el POS).
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const SERVICIO_ID = "123e4567-e89b-12d3-a456-426614174100";
const CLIENTE_ID = "123e4567-e89b-12d3-a456-426614174200";
const MASCOTA_ID = "123e4567-e89b-12d3-a456-426614174300";
const CITA_ID = "123e4567-e89b-12d3-a456-426614174400";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();
const mockSingle = jest.fn();
const mockRpc = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));

function chain() {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    eq: jest.fn(),
    neq: jest.fn(),
    order: jest.fn(),
    single: mockSingle,
  };
  ["select", "insert", "update", "eq", "neq", "order"].forEach((k) => c[k].mockReturnValue(c));
  return c;
}

function req(url: string, method = "GET", body?: object) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

const citaBody = {
  servicio_id: SERVICIO_ID,
  cliente_id: CLIENTE_ID,
  mascota_id: MASCOTA_ID,
  fecha: "2026-08-10",
  hora_inicio: "10:00",
};

const idParams = Promise.resolve({ id: CITA_ID });

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/citas
// ──────────────────────────────────────────────────────────────────────────────

describe("POST /api/citas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-CITA-01
  it("I-CITA-01: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", citaBody));
    expect(res.status).toBe(401);
  });

  // I-CITA-02
  it("I-CITA-02: cliente_id de otra tienda (RPC P0002) → 404", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "Cliente no encontrado" } });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", citaBody));
    expect(res.status).toBe(404);
  });

  // I-CITA-03
  it("I-CITA-03: servicio_id de otra tienda o inactivo (RPC P0002) → 404", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "Servicio no encontrado o inactivo" } });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", citaBody));
    expect(res.status).toBe(404);
  });

  // I-CITA-04
  it("I-CITA-04: mascota_id que no pertenece al cliente (RPC P0002) → 404", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "La mascota no pertenece al cliente indicado" } });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", citaBody));
    expect(res.status).toBe(404);
  });

  // I-CITA-05
  it("I-CITA-05: horario fuera de la ventana (RPC PS001) → 422", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS001", message: "El horario solicitado está fuera del rango habilitado" } });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", citaBody));
    expect(res.status).toBe(422);
  });

  // I-CITA-06
  it("I-CITA-06: día sin horario configurado (RPC PS001) → 422", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS001", message: "El servicio no atiende ese día de la semana" } });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", citaBody));
    expect(res.status).toBe(422);
  });

  // I-CITA-07
  it("I-CITA-07: excepción cerrado=true ese día (RPC PS001) → 422", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS001", message: "El servicio no atiende ese día (excepción/feriado)" } });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", citaBody));
    expect(res.status).toBe(422);
  });

  // I-CITA-08
  it("I-CITA-08: conflicto — horario ya ocupado (RPC PS002) → 409", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS002", message: "El horario solicitado ya está reservado" } });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", citaBody));
    expect(res.status).toBe(409);
  });

  // I-CITA-09
  it("I-CITA-09: payload válido → 201; p_store_id y p_created_by del contexto, no del body", async () => {
    mockRpc.mockResolvedValue({
      data: { id: CITA_ID, ...citaBody, hora_fin: "10:30:00", estado: "confirmada", created_by: "u1" },
      error: null,
    });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", { ...citaBody, store_id: "otra-tienda", created_by: "otro-user" }));
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith("crear_cita_tx", {
      p_store_id: STORE_ID,
      p_servicio_id: SERVICIO_ID,
      p_cliente_id: CLIENTE_ID,
      p_mascota_id: MASCOTA_ID,
      p_fecha: "2026-08-10",
      p_hora_inicio: "10:00",
      p_notas: null,
      p_created_by: "u1",
    });
  });

  // I-CITA-10
  it("I-CITA-10: hora_inicio con formato inválido → 400", async () => {
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", { ...citaBody, hora_inicio: "25:00" }));
    expect(res.status).toBe(400);
  });

  // I-CITA-11
  it("I-CITA-11: fecha con formato inválido → 400", async () => {
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", { ...citaBody, fecha: "10-08-2026" }));
    expect(res.status).toBe(400);
  });

  // I-CITA-12
  it("I-CITA-12: mascota_id ausente → 201 (opcional, decisión §9d)", async () => {
    mockRpc.mockResolvedValue({
      data: { id: CITA_ID, ...citaBody, mascota_id: null, hora_fin: "10:30:00", estado: "confirmada", created_by: "u1" },
      error: null,
    });
    const { POST } = await import("@/app/api/citas/route");
    const sinMascota = {
      servicio_id: citaBody.servicio_id,
      cliente_id: citaBody.cliente_id,
      fecha: citaBody.fecha,
      hora_inicio: citaBody.hora_inicio,
    };
    const res = await POST(req("/api/citas", "POST", sinMascota));
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith("crear_cita_tx", expect.objectContaining({ p_mascota_id: null }));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/citas
// ──────────────────────────────────────────────────────────────────────────────

describe("GET /api/citas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-CITA-13
  it("I-CITA-13: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/citas/route");
    const res = await GET(req("/api/citas"));
    expect(res.status).toBe(401);
  });

  // I-CITA-14
  it("I-CITA-14: filtra por store_id", async () => {
    const eqCalls: Array<{ col: string; val: unknown }> = [];
    const c = chain();
    c.eq = jest.fn().mockImplementation((col: string, val: unknown) => { eqCalls.push({ col, val }); return c; });
    c.order = jest.fn().mockReturnValue(c);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/citas/route");
    await GET(req("/api/citas"));
    const storeCall = eqCalls.find((x) => x.col === "store_id");
    expect(storeCall?.val).toBe(STORE_ID);
  });

  // I-CITA-15
  it("I-CITA-15: filtros opcionales se aplican como .eq() adicionales", async () => {
    const eqCalls: Array<{ col: string; val: unknown }> = [];
    const c = chain();
    c.eq = jest.fn().mockImplementation((col: string, val: unknown) => { eqCalls.push({ col, val }); return c; });
    c.order = jest.fn().mockReturnValue(c);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/citas/route");
    await GET(req(`/api/citas?fecha=2026-08-10&servicio_id=${SERVICIO_ID}&cliente_id=${CLIENTE_ID}&estado=confirmada`));
    expect(eqCalls.find((x) => x.col === "fecha")?.val).toBe("2026-08-10");
    expect(eqCalls.find((x) => x.col === "servicio_id")?.val).toBe(SERVICIO_ID);
    expect(eqCalls.find((x) => x.col === "cliente_id")?.val).toBe(CLIENTE_ID);
    expect(eqCalls.find((x) => x.col === "estado")?.val).toBe("confirmada");
  });

  // I-CITA-16
  it("I-CITA-16: query param con formato inválido → 400", async () => {
    const { GET } = await import("@/app/api/citas/route");
    const res = await GET(req("/api/citas?fecha=no-es-fecha"));
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/citas/[id]
// ──────────────────────────────────────────────────────────────────────────────

describe("GET /api/citas/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-CITA-17
  it("I-CITA-17: cita de otra tienda (PGRST116) → 404", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const { GET } = await import("@/app/api/citas/[id]/route");
    const res = await GET(req(`/api/citas/${CITA_ID}`), { params: idParams });
    expect(res.status).toBe(404);
  });

  // I-CITA-18
  it("I-CITA-18: cita existente → 200 con joins de cliente/mascota/servicio", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: CITA_ID,
        ...citaBody,
        hora_fin: "10:30:00",
        estado: "confirmada",
        clientes: { nombre: "María", telefono: "555-1234" },
        mascotas: { nombre: "Firulais" },
        servicios: { nombre: "Corte básico" },
      },
      error: null,
    });
    const { GET } = await import("@/app/api/citas/[id]/route");
    const res = await GET(req(`/api/citas/${CITA_ID}`), { params: idParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clientes.nombre).toBe("María");
    expect(body.mascotas.nombre).toBe("Firulais");
    expect(body.servicios.nombre).toBe("Corte básico");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/citas/[id]
// ──────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/citas/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockSingle.mockReset();
    mockFrom.mockReturnValue(chain());
  });

  // I-CITA-19
  it("I-CITA-19: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "completar" }), { params: idParams });
    expect(res.status).toBe(401);
  });

  // I-CITA-20
  it("I-CITA-20: accion cancelar con motivo → 200, estado cancelada", async () => {
    mockRpc.mockResolvedValue({
      data: { id: CITA_ID, estado: "cancelada", motivo_cancelacion: "Cliente no puede asistir" },
      error: null,
    });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "cancelar", motivo: "Cliente no puede asistir" }),
      { params: idParams }
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("cancelar_cita_tx", {
      p_cita_id: CITA_ID,
      p_store_id: STORE_ID,
      p_motivo: "Cliente no puede asistir",
      p_cancelado_por: "u1",
    });
  });

  // I-CITA-21
  it("I-CITA-21: cancelar una cita ya cancelada (RPC PS003) → 409", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS003", message: "No se puede cancelar una cita en estado cancelada" } });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "cancelar", motivo: "Duplicado de prueba" }),
      { params: idParams }
    );
    expect(res.status).toBe(409);
  });

  // I-CITA-22
  it("I-CITA-22: cancelar una cita ya completada (RPC PS003) → 409", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS003", message: "No se puede cancelar una cita en estado completada" } });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "cancelar", motivo: "Cliente se fue" }),
      { params: idParams }
    );
    expect(res.status).toBe(409);
  });

  // I-CITA-23
  it("I-CITA-23: cancelar cita de otra tienda (RPC P0002) → 404", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "Cita no encontrada" } });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "cancelar", motivo: "Otra tienda" }),
      { params: idParams }
    );
    expect(res.status).toBe(404);
  });

  // I-CITA-24
  it("I-CITA-24: cancelar sin motivo → 400 (Zod)", async () => {
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "cancelar" }),
      { params: idParams }
    );
    expect(res.status).toBe(400);
  });

  // I-CITA-25
  it("I-CITA-25: accion completar sobre cita confirmada → 200", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: CITA_ID, estado: "confirmada" }, error: null })
      .mockResolvedValueOnce({ data: { id: CITA_ID, estado: "completada" }, error: null });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "completar" }), { params: idParams });
    expect(res.status).toBe(200);
  });

  // I-CITA-26
  it("I-CITA-26: accion no_show sobre cita confirmada → 200", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: CITA_ID, estado: "confirmada" }, error: null })
      .mockResolvedValueOnce({ data: { id: CITA_ID, estado: "no_show" }, error: null });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "no_show" }), { params: idParams });
    expect(res.status).toBe(200);
  });

  // I-CITA-27
  it("I-CITA-27: accion completar sobre cita ya cancelada → 409", async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: CITA_ID, estado: "cancelada" }, error: null });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "completar" }), { params: idParams });
    expect(res.status).toBe(409);
  });

  // I-CITA-28
  it("I-CITA-28: accion no reconocida → 400 (Zod)", async () => {
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "borrar" }), { params: idParams });
    expect(res.status).toBe(400);
  });

  // I-CITA-29
  it("I-CITA-29: cita de otra tienda con accion completar → 404", async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "completar" }), { params: idParams });
    expect(res.status).toBe(404);
  });
});
