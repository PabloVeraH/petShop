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
const ENCARGADO_ID = "123e4567-e89b-12d3-a456-426614174500";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();
const mockSingle = jest.fn();
const mockRpc = jest.fn();
const mockCrearAsiento = jest.fn();
const mockLineasVentaServicio = jest.fn();
const mockLineasVentaServicioConNc = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));
// Asiento de contabilidad del cobro de cita: se mockea para capturar el
// payload (descripción, líneas, referencia) sin insertar en BD. Las funciones
// de líneas devuelven objetos mínimos — su exactitud contable está cubierta
// por los unit tests de lib/contabilidad/generador-asientos.
jest.mock("@/lib/contabilidad/generador-asientos", () => ({
  crearAsiento: (...args: unknown[]) => mockCrearAsiento(...args),
  lineasVentaServicio: (...args: unknown[]) => mockLineasVentaServicio(...args),
  lineasVentaServicioConNc: (...args: unknown[]) => mockLineasVentaServicioConNc(...args),
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
  encargado_id: ENCARGADO_ID,
  mascota_id: MASCOTA_ID,
  fecha: "2026-08-10",
  hora_inicio: "10:00",
};

const idParams = Promise.resolve({ id: CITA_ID });

// citaBody.fecha ("2026-08-10") es una fecha fija de fixture, no relativa a
// "hoy" — CitaCreateSchema ahora rechaza fechas pasadas (Zod, no solo el
// min= del date picker). Se fija el reloj ANTES de esa fecha en todo el
// archivo para que estos tests no se vuelvan frágiles cuando el calendario
// real la sobrepase (no hay otro uso de Date en este archivo — verificado).
beforeAll(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-08-01T12:00:00Z"));
});
afterAll(() => {
  jest.useRealTimers();
});

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
      p_encargado_id: ENCARGADO_ID,
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
      encargado_id: citaBody.encargado_id,
      fecha: citaBody.fecha,
      hora_inicio: citaBody.hora_inicio,
    };
    const res = await POST(req("/api/citas", "POST", sinMascota));
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith("crear_cita_tx", expect.objectContaining({ p_mascota_id: null }));
  });

  // I-CITA-46
  it("I-CITA-46: POST sin encargado_id → 400 (ahora obligatorio, Fase 3)", async () => {
    const { POST } = await import("@/app/api/citas/route");
    const sinEncargado = { ...citaBody, encargado_id: undefined };
    const res = await POST(req("/api/citas", "POST", sinEncargado));
    expect(res.status).toBe(400);
  });

  // I-CITA-47
  it("I-CITA-47: POST encargado_id de otra tienda (RPC P0002) → 404", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "Encargado no encontrado o inactivo" } });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", citaBody));
    expect(res.status).toBe(404);
  });

  // I-CITA-48
  it("I-CITA-48: POST encargado_id inactivo (RPC P0002) → 404", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "Encargado no encontrado o inactivo" } });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", citaBody));
    expect(res.status).toBe(404);
  });

  // I-CITA-49
  it("I-CITA-49: mismo encargado, horarios traslapados (RPC PS004) → 409", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS004", message: "El encargado ya tiene otra cita en ese horario" } });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", citaBody));
    expect(res.status).toBe(409);
  });

  // I-CITA-50
  it("I-CITA-50: mismo encargado, mismo horario, DISTINTO servicio (RPC PS004) → 409", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS004", message: "El encargado ya tiene otra cita en ese horario" } });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", { ...citaBody, servicio_id: "223e4567-e89b-12d3-a456-426614174100" }));
    expect(res.status).toBe(409);
  });

  // I-CITA-51
  it("I-CITA-51: dos encargados distintos, mismo servicio, mismo horario (RPC PS002) → 409 por el límite de servicio_id (diseño confirmado)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS002", message: "El horario solicitado ya está reservado" } });
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", citaBody));
    expect(res.status).toBe(409);
  });

  // I-CITA-56
  it("I-CITA-56: fecha anterior a hoy → 400 (Zod, no llega a invocar el RPC)", async () => {
    const { POST } = await import("@/app/api/citas/route");
    const res = await POST(req("/api/citas", "POST", { ...citaBody, fecha: "2026-07-31" }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
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

  // I-CITA-53
  it("I-CITA-53: GET filtra por encargado_id", async () => {
    const eqCalls: Array<{ col: string; val: unknown }> = [];
    const c = chain();
    c.eq = jest.fn().mockImplementation((col: string, val: unknown) => { eqCalls.push({ col, val }); return c; });
    c.order = jest.fn().mockReturnValue(c);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/citas/route");
    await GET(req(`/api/citas?encargado_id=${ENCARGADO_ID}`));
    expect(eqCalls.find((x) => x.col === "encargado_id")?.val).toBe(ENCARGADO_ID);
  });

  // I-CITA-16
  it("I-CITA-16: query param con formato inválido → 400", async () => {
    const { GET } = await import("@/app/api/citas/route");
    const res = await GET(req("/api/citas?fecha=no-es-fecha"));
    expect(res.status).toBe(400);
  });

  // I-CITA-73 — ticket 6a7160fe621dcf1dba95b92f: el listado debe traer los
  // campos de cancelación (el select usa `*`, no una lista cerrada) y pasarlos
  // intactos al cliente — la UI los muestra en la tarjeta y el detalle.
  it("I-CITA-73: listado incluye cancelado_at/motivo_cancelacion de citas canceladas", async () => {
    const cancelada = {
      id: CITA_ID,
      estado: "cancelada",
      motivo_cancelacion: "Cliente no puede asistir",
      cancelado_at: "2026-08-04T03:47:13.243579+00:00",
      cancelado_por: "u1",
      cliente: null,
      mascota: null,
      servicio: { nombre: "Consulta" },
      encargado: null,
    };
    const c = chain();
    // order("fecha") devuelve la query; order("hora_inicio") es el await final.
    c.order = jest.fn()
      .mockReturnValueOnce(c)
      .mockReturnValueOnce(Promise.resolve({ data: [cancelada], error: null }));
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/citas/route");
    const res = await GET(req("/api/citas"));
    expect(res.status).toBe(200);

    // El select debe traer TODAS las columnas (`*`), no una lista cerrada que
    // deje fuera cancelado_at/motivo_cancelacion.
    const selectArg = c.select.mock.calls[0][0] as string;
    expect(selectArg.startsWith("*")).toBe(true);

    const body = await res.json();
    expect(body[0].motivo_cancelacion).toBe("Cliente no puede asistir");
    expect(body[0].cancelado_at).toBe("2026-08-04T03:47:13.243579+00:00");
    expect(body[0].cancelado_por).toBe("u1");
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
    // Claves en singular: el select real usa alias (cliente:clientes(...), etc.)
    // para que coincida con el tipo Cita y con CitasTab.tsx — sin el alias,
    // Supabase embebe bajo el nombre de tabla en plural (clientes/mascotas/
    // servicios), lo que dejaba c.cliente/c.mascota/c.servicio siempre
    // undefined en la UI (bug real, reportado por el usuario en /citas).
    mockSingle.mockResolvedValue({
      data: {
        id: CITA_ID,
        ...citaBody,
        hora_fin: "10:30:00",
        estado: "confirmada",
        cliente: { nombre: "María", telefono: "555-1234" },
        mascota: { nombre: "Firulais" },
        servicio: { nombre: "Corte básico" },
      },
      error: null,
    });
    const { GET } = await import("@/app/api/citas/[id]/route");
    const res = await GET(req(`/api/citas/${CITA_ID}`), { params: idParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cliente.nombre).toBe("María");
    expect(body.mascota.nombre).toBe("Firulais");
    expect(body.servicio.nombre).toBe("Corte básico");
  });

  // I-CITA-52
  it("I-CITA-52: GET lista incluye encargado.nombre vía join", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: CITA_ID,
        ...citaBody,
        hora_fin: "10:30:00",
        estado: "confirmada",
        encargado: { nombre: "Juan Pérez" },
      },
      error: null,
    });
    const { GET } = await import("@/app/api/citas/[id]/route");
    const res = await GET(req(`/api/citas/${CITA_ID}`), { params: idParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.encargado.nombre).toBe("Juan Pérez");
  });

  // I-CITA-74 — ticket 6a7160fe621dcf1dba95b92f: el detalle de una cita
  // cancelada debe devolver motivo y fecha de cancelación (el modal
  // DetalleCita los muestra; antes ninguna vista los exponía).
  it("I-CITA-74: detalle de cita cancelada devuelve motivo_cancelacion y cancelado_at", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: CITA_ID,
        ...citaBody,
        hora_fin: "10:30:00",
        estado: "cancelada",
        motivo_cancelacion: "Cliente no puede asistir",
        cancelado_at: "2026-08-04T03:47:13.243579+00:00",
        cancelado_por: "u1",
        cliente: { nombre: "María", telefono: "555-1234" },
        mascota: null,
        servicio: { nombre: "Consulta" },
        encargado: null,
      },
      error: null,
    });
    const { GET } = await import("@/app/api/citas/[id]/route");
    const res = await GET(req(`/api/citas/${CITA_ID}`), { params: idParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.estado).toBe("cancelada");
    expect(body.motivo_cancelacion).toBe("Cliente no puede asistir");
    expect(body.cancelado_at).toBe("2026-08-04T03:47:13.243579+00:00");
    expect(body.cancelado_por).toBe("u1");
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

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/citas/[id] — completar con cobro (Fase 4, plan_valorServicio)
// ──────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/citas/[id] — completar con cobro (I-CITA-57+)", () => {
  const CITA_CON_PRECIO = { id: CITA_ID, estado: "confirmada", precio: 15000 };
  const NC_ID = "123e4567-e89b-12d3-a456-426614174600";
  const VENTA_RESULT = {
    cita: { id: CITA_ID, estado: "completada", venta_id: "venta-1" },
    venta: { id: "venta-1", numero_comprobante: "V-0001", created_at: "2026-08-10T12:00:00Z" },
  };
  const DEFAULT_NIVELES = [
    { monto: 50000, descuento: 5 },
    { monto: 150000, descuento: 10 },
    { monto: 300000, descuento: 20 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
    mockCrearAsiento.mockResolvedValue({ id: "asiento-1" });
    mockLineasVentaServicio.mockReturnValue([{ cuentaCodigo: "x", debito: 0, credito: 0 }]);
    mockLineasVentaServicioConNc.mockReturnValue([{ cuentaCodigo: "x", debito: 0, credito: 0 }]);
  });

  // I-CITA-57
  it("I-CITA-57: cita con precio completada SIN metodoPago → 400 (el cobro es obligatorio)", async () => {
    mockSingle.mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "completar" }), { params: idParams });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalledWith("completar_cita_tx", expect.anything());
  });

  // I-CITA-58
  it("I-CITA-58: cita con precio + efectivo → 200, RPC con impuesto extraído y asiento VENTA_SERVICIOS", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })       // SELECT cita
      .mockResolvedValueOnce({ data: { fidelizacion_niveles: null }, error: null }); // SELECT stores
    mockRpc.mockResolvedValue({ data: VENTA_RESULT, error: null });

    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "completar", metodoPago: "efectivo" }), { params: idParams });
    expect(res.status).toBe(200);

    expect(mockRpc).toHaveBeenCalledWith("completar_cita_tx", {
      p_cita_id: CITA_ID,
      p_store_id: STORE_ID,
      p_metodo_pago: "efectivo",
      p_numero_transaccion: null,
      p_impuesto: 2395, // extraerIva(15000) — fórmula única de tax.ts, §23.3
      p_pago_nc: null,
      p_fidelizacion_niveles: DEFAULT_NIVELES,
      p_completado_por: "u1",
    });

    // mockCrearAsiento se invoca sincronamente durante el PATCH (la IIFE del
    // asiento corre hasta su primer await antes de responder).
    const arg = mockCrearAsiento.mock.calls[0][0];
    expect(arg.tipoMovimiento).toBe("VENTA");
    expect(arg.canal).toBe("pos");
    expect(arg.referenciaId).toBe("venta-1");
    expect(arg.descripcion).toBe("Cobro cita (servicio) efectivo");
    expect(arg.lineas).toBe(mockLineasVentaServicio.mock.results[0].value);
  });

  // I-CITA-59
  it("I-CITA-59: pagoNc de una NC inexistente → 404 antes de abrir la transacción", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })       // SELECT cita
      .mockResolvedValueOnce({ data: null, error: null });                  // SELECT notas_credito
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", {
        accion: "completar",
        metodoPago: "efectivo",
        pagoNc: { nota_credito_id: NC_ID, numero_nc: "NC-001", monto: 5000 },
      }),
      { params: idParams }
    );
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalledWith("completar_cita_tx", expect.anything());
  });

  // I-CITA-60
  it("I-CITA-60: pagoNc de NC usada/inactiva → 409", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })
      .mockResolvedValueOnce({ data: { id: NC_ID, monto_total: 15000, fecha_vencimiento: null, estado: "usada" }, error: null });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", {
        accion: "completar",
        metodoPago: "efectivo",
        pagoNc: { nota_credito_id: NC_ID, numero_nc: "NC-001", monto: 5000 },
      }),
      { params: idParams }
    );
    expect(res.status).toBe(409);
  });

  // I-CITA-61
  it("I-CITA-61: pagoNc de NC vencida → 410", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })
      .mockResolvedValueOnce({ data: { id: NC_ID, monto_total: 15000, fecha_vencimiento: "2026-01-01", estado: "activa" }, error: null });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", {
        accion: "completar",
        metodoPago: "efectivo",
        pagoNc: { nota_credito_id: NC_ID, numero_nc: "NC-001", monto: 5000 },
      }),
      { params: idParams }
    );
    expect(res.status).toBe(410);
  });

  // I-CITA-62
  it("I-CITA-62: pagoNc.monto mayor al monto_total de la NC → 400", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })
      .mockResolvedValueOnce({ data: { id: NC_ID, monto_total: 3000, fecha_vencimiento: null, estado: "activa" }, error: null });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", {
        accion: "completar",
        metodoPago: "efectivo",
        pagoNc: { nota_credito_id: NC_ID, numero_nc: "NC-001", monto: 5000 },
      }),
      { params: idParams }
    );
    expect(res.status).toBe(400);
  });

  // I-CITA-63
  it("I-CITA-63: NC que cubre TODO el total → RPC recibe p_pago_nc, asiento ConNc sin resto", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })
      .mockResolvedValueOnce({ data: { id: NC_ID, monto_total: 15000, fecha_vencimiento: null, estado: "activa" }, error: null })
      .mockResolvedValueOnce({ data: { fidelizacion_niveles: null }, error: null });
    mockRpc.mockResolvedValue({ data: VENTA_RESULT, error: null });

    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", {
        accion: "completar",
        metodoPago: "efectivo",
        pagoNc: { nota_credito_id: NC_ID, numero_nc: "NC-001", monto: 15000 },
      }),
      { params: idParams }
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("completar_cita_tx", expect.objectContaining({
      p_pago_nc: { nota_credito_id: NC_ID, numero_nc: "NC-001", monto: 15000 },
    }));

    // mockCrearAsiento se invoca sincronamente durante el PATCH (la IIFE del
    // asiento corre hasta su primer await antes de responder).
    const arg = mockCrearAsiento.mock.calls[0][0];
    expect(arg.descripcion).toBe("Cobro cita (servicio)"); // NC total: sin sufijo de método
    expect(mockLineasVentaServicioConNc).toHaveBeenCalledWith({
      montoNeto: 12605, // 15000 - 2395
      iva: 2395,
      total: 15000,
      montoNc: 15000,
      montoResto: 0,
      metodoPagoResto: "efectivo",
    });
  });

  // I-CITA-64
  it("I-CITA-64: NC parcial (mixto) → asiento ConNc con montoResto > 0", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })
      .mockResolvedValueOnce({ data: { id: NC_ID, monto_total: 15000, fecha_vencimiento: null, estado: "activa" }, error: null })
      .mockResolvedValueOnce({ data: { fidelizacion_niveles: null }, error: null });
    mockRpc.mockResolvedValue({ data: VENTA_RESULT, error: null });

    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", {
        accion: "completar",
        metodoPago: "efectivo",
        pagoNc: { nota_credito_id: NC_ID, numero_nc: "NC-001", monto: 6000 },
      }),
      { params: idParams }
    );
    expect(res.status).toBe(200);

    // mockCrearAsiento se invoca sincronamente durante el PATCH (la IIFE del
    // asiento corre hasta su primer await antes de responder).
    const arg = mockCrearAsiento.mock.calls[0][0];
    expect(arg.descripcion).toBe("Cobro cita (servicio)"); // mixto: sin sufijo de método (igual que nota_credito)
    expect(mockLineasVentaServicioConNc).toHaveBeenCalledWith({
      montoNeto: 12605,
      iva: 2395,
      total: 15000,
      montoNc: 6000,
      montoResto: 9000,
      metodoPagoResto: "efectivo",
    });
  });

  // I-CITA-65
  it("I-CITA-65: completar sobre cita ya completada (RPC PS003) → 409", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })
      .mockResolvedValueOnce({ data: { fidelizacion_niveles: null }, error: null });
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS003", message: "La cita ya fue completada" } });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "completar", metodoPago: "efectivo" }), { params: idParams });
    expect(res.status).toBe(409);
  });

  // I-CITA-66
  it("I-CITA-66: cita borrada entre el SELECT y el RPC (RPC P0002) → 404", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })
      .mockResolvedValueOnce({ data: { fidelizacion_niveles: null }, error: null });
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "Cita no encontrada" } });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "completar", metodoPago: "efectivo" }), { params: idParams });
    expect(res.status).toBe(404);
  });

  // I-CITA-67
  it("I-CITA-67: RPC PS005 (cita legado con precio) → 400 defensivo", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })
      .mockResolvedValueOnce({ data: { fidelizacion_niveles: null }, error: null });
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS005", message: "La cita no tiene precio configurado" } });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "completar", metodoPago: "efectivo" }), { params: idParams });
    expect(res.status).toBe(400);
  });

  // I-CITA-68
  it("I-CITA-68: completar con débito SIN numeroTransaccion → 400 (Zod superRefine)", async () => {
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "completar", metodoPago: "debito" }), { params: idParams });
    expect(res.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalledWith("citas");
  });

  // I-CITA-69 — REGRESIÓN: una cita legado (precio NULL) enviada con un body
  // de pago NO debe cobrarse ni fallar; sigue el camino legado sin cobro.
  it("I-CITA-69: cita legado (precio null) con body de pago → 200, UPDATE simple, sin RPC", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: CITA_ID, estado: "confirmada", precio: null }, error: null })
      .mockResolvedValueOnce({ data: { id: CITA_ID, estado: "completada" }, error: null });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", { accion: "completar", metodoPago: "efectivo" }),
      { params: idParams }
    );
    expect(res.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalledWith("completar_cita_tx", expect.anything());
    expect(mockCrearAsiento).not.toHaveBeenCalled();
  });

  // I-CITA-70 — REGRESIÓN (mejora sobre completar_cita_tx, hallazgo de
  // revisión posterior al plan): pagoNc.monto no puede exceder el total de
  // la cita, no solo el monto_total de la propia NC — evita consumir
  // crédito de más. Se rechaza ANTES de abrir la transacción.
  it("I-CITA-70: pagoNc.monto mayor al total de la cita (aunque no exceda la NC) → 400 sin llamar al RPC", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })
      .mockResolvedValueOnce({ data: { id: NC_ID, monto_total: 50000, fecha_vencimiento: null, estado: "activa" }, error: null });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", {
        accion: "completar",
        metodoPago: "efectivo",
        pagoNc: { nota_credito_id: NC_ID, numero_nc: "NC-001", monto: 20000 }, // > 15000 (precio), <= 50000 (NC)
      }),
      { params: idParams }
    );
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalledWith("completar_cita_tx", expect.anything());
  });

  // I-CITA-71 — REGRESIÓN: reclamo atómico de la NC en completar_cita_tx.
  // Si el RPC devuelve PS006 (otra operación concurrente ya la usó entre la
  // pre-validación y la transacción), la ruta responde 409, no 500.
  it("I-CITA-71: RPC PS006 (NC reclamada por otra operación concurrente) → 409", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })
      .mockResolvedValueOnce({ data: { id: NC_ID, monto_total: 15000, fecha_vencimiento: null, estado: "activa" }, error: null })
      .mockResolvedValueOnce({ data: { fidelizacion_niveles: null }, error: null });
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS006", message: "La nota de crédito ya no está disponible (fue usada por otra operación)" } });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", {
        accion: "completar",
        metodoPago: "efectivo",
        pagoNc: { nota_credito_id: NC_ID, numero_nc: "NC-001", monto: 15000 },
      }),
      { params: idParams }
    );
    expect(res.status).toBe(409);
  });

  // I-CITA-72 — defensa en profundidad: si PS007 llega desde el RPC (no
  // debería, la ruta ya lo filtra en I-CITA-70), se mapea a 400, no 500.
  it("I-CITA-72: RPC PS007 (defensa en profundidad, monto NC excede el total) → 400", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: CITA_CON_PRECIO, error: null })
      .mockResolvedValueOnce({ data: { id: NC_ID, monto_total: 15000, fecha_vencimiento: null, estado: "activa" }, error: null })
      .mockResolvedValueOnce({ data: { fidelizacion_niveles: null }, error: null });
    mockRpc.mockResolvedValue({ data: null, error: { code: "PS007", message: "El monto de la nota de crédito no puede exceder el total a cobrar" } });
    const { PATCH } = await import("@/app/api/citas/[id]/route");
    const res = await PATCH(
      req(`/api/citas/${CITA_ID}`, "PATCH", {
        accion: "completar",
        metodoPago: "efectivo",
        pagoNc: { nota_credito_id: NC_ID, numero_nc: "NC-001", monto: 15000 },
      }),
      { params: idParams }
    );
    expect(res.status).toBe(400);
  });
});

