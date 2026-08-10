/**
 * Tests M-01 a M-20: /api/mascotas (GET, POST, PATCH, DELETE)
 * Incluye campos de consumo: gramos_porcion y veces_dia (migración 032)
 */
import { NextRequest } from "next/server";

const STORE_ID    = "123e4567-e89b-12d3-a456-426614174000";
const CLIENTE_ID  = "123e4567-e89b-12d3-a456-426614174020";
const MASCOTA_ID  = "123e4567-e89b-12d3-a456-426614174030";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSingle = jest.fn();
const mockMaybeSingle = jest.fn();
const mockFrom   = jest.fn();
const mockChain  = {
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq:     jest.fn().mockReturnThis(),
  ilike:  jest.fn().mockReturnThis(),
  neq:    jest.fn().mockReturnThis(),
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
};
mockFrom.mockReturnValue(mockChain);

jest.mock("@/lib/auth", () => ({
  getStoreId: jest.fn().mockResolvedValue({ userId: "user-1", storeId: STORE_ID }),
}));

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom })),
}));

jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler) => handler,
  logAudit:           jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn().mockResolvedValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGetRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/mascotas");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function makePostRequest(body: object) {
  return new NextRequest("http://localhost/api/mascotas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(id: string, body: object) {
  return new NextRequest(`http://localhost/api/mascotas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const DB_MASCOTA = {
  id: MASCOTA_ID,
  cliente_id: CLIENTE_ID,
  nombre: "Grizzly",
  tipo: "perro",
  raza: "Shitsue",
  peso_kg: 8,
  alimento_habitual_id: PRODUCTO_ID,
  gramos_porcion: 25,
  veces_dia: 3,
};

// ── GET /api/mascotas ─────────────────────────────────────────────────────────

describe("GET /api/mascotas", () => {
  const { getStoreId } = require("@/lib/auth");

  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(mockChain);
    mockChain.select.mockReturnThis();
    mockChain.eq.mockReturnThis();
    getStoreId.mockResolvedValue({ userId: "user-1", storeId: STORE_ID });
  });

  it("M-01: retorna 400 sin clienteId", async () => {
    const { GET } = await import("@/app/api/mascotas/route");
    const res = await GET(makeGetRequest({}));
    expect(res.status).toBe(400);
  });

  it("M-02: retorna 401 sin auth", async () => {
    getStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/mascotas/route");
    const res = await GET(makeGetRequest({ clienteId: CLIENTE_ID }));
    expect(res.status).toBe(401);
  });

  it("M-03: retorna [] si el cliente no pertenece al store", async () => {
    // first eq → cliente lookup → returns null (no found)
    mockSingle.mockResolvedValue({ data: null, error: null });
    const { GET } = await import("@/app/api/mascotas/route");
    const res = await GET(makeGetRequest({ clienteId: CLIENTE_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("M-04: retorna mascotas incluyendo gramos_porcion y veces_dia", async () => {
    const clientesChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: CLIENTE_ID }, error: null }),
    };
    clientesChain.eq.mockReturnValue(clientesChain);

    const mascotasChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [DB_MASCOTA], error: null }),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "clientes") return clientesChain;
      if (table === "mascotas") return mascotasChain;
      return mockChain;
    });

    const { GET } = await import("@/app/api/mascotas/route");
    const res = await GET(makeGetRequest({ clienteId: CLIENTE_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].gramos_porcion).toBe(25);
    expect(body[0].veces_dia).toBe(3);
  });

  // M-15: REGRESIÓN — duplicados por doble-guardado se filtran por (nombre, tipo)
  it("M-15: deduplica mascotas con mismo nombre y tipo (doble-guardado accidental)", async () => {
    const LUNA_1 = { ...DB_MASCOTA, id: "m-dup-1", nombre: "Luna", tipo: "gato" };
    const LUNA_2 = { ...DB_MASCOTA, id: "m-dup-2", nombre: "Luna", tipo: "gato" };

    const clientesChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: CLIENTE_ID }, error: null }),
    };
    clientesChain.eq.mockReturnValue(clientesChain);

    const mascotasChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [LUNA_1, LUNA_2], error: null }),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "clientes") return clientesChain;
      if (table === "mascotas") return mascotasChain;
      return mockChain;
    });

    const { GET } = await import("@/app/api/mascotas/route");
    const res = await GET(makeGetRequest({ clienteId: CLIENTE_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Solo debe aparecer una vez — la primera por orden de llegada
    expect(body).toHaveLength(1);
    expect(body[0].nombre).toBe("Luna");
  });

  // M-16: mascotas con mismo nombre pero distinto tipo SÍ aparecen ambas
  it("M-16: no deduplica mascotas con mismo nombre pero distinto tipo", async () => {
    const LUNA_GATO  = { ...DB_MASCOTA, id: "m-1", nombre: "Luna", tipo: "gato" };
    const LUNA_PERRO = { ...DB_MASCOTA, id: "m-2", nombre: "Luna", tipo: "perro" };

    const clientesChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: CLIENTE_ID }, error: null }),
    };
    clientesChain.eq.mockReturnValue(clientesChain);

    const mascotasChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [LUNA_GATO, LUNA_PERRO], error: null }),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "clientes") return clientesChain;
      if (table === "mascotas") return mascotasChain;
      return mockChain;
    });

    const { GET } = await import("@/app/api/mascotas/route");
    const res = await GET(makeGetRequest({ clienteId: CLIENTE_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
  });
});

// ── POST /api/mascotas ────────────────────────────────────────────────────────

describe("POST /api/mascotas", () => {
  const { getStoreId } = require("@/lib/auth");

  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(mockChain);
    mockChain.select.mockReturnThis();
    mockChain.insert.mockReturnThis();
    mockChain.eq.mockReturnThis();
    mockChain.ilike.mockReturnThis();
    getStoreId.mockResolvedValue({ userId: "user-1", storeId: STORE_ID });
  });

  // M-21: POST con mascota duplicada retorna 409
  it("M-21: retorna 409 si ya existe mascota con mismo nombre para el cliente", async () => {
    mockSingle.mockResolvedValue({ data: { id: CLIENTE_ID }, error: null });  // cliente lookup
    mockMaybeSingle.mockResolvedValue({ data: { id: MASCOTA_ID }, error: null });  // duplicate found
    const { POST } = await import("@/app/api/mascotas/route");
    const res = await POST(makePostRequest({
      cliente_id: CLIENTE_ID,
      nombre: "Grizzly",
      tipo: "perro",
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Ya existe");
  });

  it("M-22: retorna 409 si el nombre difiere solo en mayúsculas/minúsculas (case-insensitive)", async () => {
    mockSingle.mockResolvedValue({ data: { id: CLIENTE_ID }, error: null });
    mockMaybeSingle.mockResolvedValue({ data: { id: MASCOTA_ID }, error: null });
    const { POST } = await import("@/app/api/mascotas/route");
    const res = await POST(makePostRequest({
      cliente_id: CLIENTE_ID,
      nombre: "grizzly",  // DB tiene "Grizzly" — case-insensitive match
      tipo: "perro",
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Ya existe");
  });

  it("M-05: retorna 401 sin auth", async () => {
    getStoreId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/mascotas/route");
    const res = await POST(makePostRequest({ cliente_id: CLIENTE_ID, nombre: "Grizzly", tipo: "perro" }));
    expect(res.status).toBe(401);
  });

  it("M-06: retorna 400 con nombre inválido (menos de 2 chars)", async () => {
    const { POST } = await import("@/app/api/mascotas/route");
    const res = await POST(makePostRequest({ cliente_id: CLIENTE_ID, nombre: "G", tipo: "perro" }));
    expect(res.status).toBe(400);
  });

  it("M-07: retorna 404 si el cliente no existe en el store", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const { POST } = await import("@/app/api/mascotas/route");
    const res = await POST(makePostRequest({ cliente_id: CLIENTE_ID, nombre: "Grizzly", tipo: "perro" }));
    expect(res.status).toBe(404);
  });

  it("M-08: crea mascota sin consumo y retorna 201", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: CLIENTE_ID }, error: null })  // cliente lookup
      .mockResolvedValueOnce({ data: DB_MASCOTA, error: null });          // insert
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });   // no duplicate
    const { POST } = await import("@/app/api/mascotas/route");
    const res = await POST(makePostRequest({
      cliente_id: CLIENTE_ID,
      nombre: "Grizzly",
      tipo: "perro",
    }));
    expect(res.status).toBe(201);
  });

  it("M-09: crea mascota CON gramos_porcion y veces_dia y los incluye en el insert", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: CLIENTE_ID }, error: null })
      .mockResolvedValueOnce({ data: { ...DB_MASCOTA, gramos_porcion: 30, veces_dia: 2 }, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });   // no duplicate
    const { POST } = await import("@/app/api/mascotas/route");
    const res = await POST(makePostRequest({
      cliente_id: CLIENTE_ID,
      nombre: "Grizzly",
      tipo: "perro",
      gramos_porcion: 30,
      veces_dia: 2,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.gramos_porcion).toBe(30);
    expect(body.veces_dia).toBe(2);

    const insertCall = mockChain.insert.mock.calls[0][0];
    expect(insertCall.gramos_porcion).toBe(30);
    expect(insertCall.veces_dia).toBe(2);
  });
});

// ── PATCH /api/mascotas/[id] ─────────────────────────────────────────────────

describe("PATCH /api/mascotas/[id]", () => {
  const { getStoreId } = require("@/lib/auth");

  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(mockChain);
    mockChain.select.mockReturnThis();
    mockChain.update.mockReturnThis();
    mockChain.eq.mockReturnThis();
    mockChain.ilike.mockReturnThis();
    mockChain.neq.mockReturnThis();
    getStoreId.mockResolvedValue({ userId: "user-1", storeId: STORE_ID });
  });

  async function doPatch(id: string, body: object) {
    const { PATCH } = await import("@/app/api/mascotas/[id]/route");
    return PATCH(makePatchRequest(id, body), { params: Promise.resolve({ id }) });
  }

  it("M-10: retorna 401 sin auth", async () => {
    getStoreId.mockResolvedValue(null);
    const res = await doPatch(MASCOTA_ID, { nombre: "Max" });
    expect(res.status).toBe(401);
  });

  it("M-11: retorna 404 si mascota no existe", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const res = await doPatch(MASCOTA_ID, { nombre: "Max" });
    expect(res.status).toBe(404);
  });

  it("M-12: retorna 403 si mascota no pertenece al store", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: MASCOTA_ID, cliente_id: CLIENTE_ID }, error: null })
      .mockResolvedValueOnce({ data: null, error: null }); // cliente not in store
    const res = await doPatch(MASCOTA_ID, { nombre: "Max" });
    expect(res.status).toBe(403);
  });

  it("M-13: actualiza gramos_porcion y veces_dia correctamente", async () => {
    const updated = { ...DB_MASCOTA, gramos_porcion: 40, veces_dia: 2 };
    mockSingle
      .mockResolvedValueOnce({ data: { id: MASCOTA_ID, cliente_id: CLIENTE_ID }, error: null })
      .mockResolvedValueOnce({ data: { id: CLIENTE_ID }, error: null })
      .mockResolvedValueOnce({ data: { gramos_porcion: 25, veces_dia: 3 }, error: null })
      .mockResolvedValueOnce({ data: updated, error: null });

    const res = await doPatch(MASCOTA_ID, { gramos_porcion: 40, veces_dia: 2 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gramos_porcion).toBe(40);
    expect(body.veces_dia).toBe(2);
  });

  it("M-14: gramos_porcion y veces_dia son opcionales — PATCH sin ellos retorna 200", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: MASCOTA_ID, cliente_id: CLIENTE_ID }, error: null })
      .mockResolvedValueOnce({ data: { id: CLIENTE_ID }, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null }); // no duplicate
    mockSingle
      .mockResolvedValueOnce({ data: { ...DB_MASCOTA }, error: null })
      .mockResolvedValueOnce({ data: { ...DB_MASCOTA, nombre: "Max" }, error: null });

    const res = await doPatch(MASCOTA_ID, { nombre: "Max" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nombre).toBe("Max");
  });

  it("M-23: retorna 409 si se renombra a un nombre ya existente (case-insensitive)", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: MASCOTA_ID, cliente_id: CLIENTE_ID }, error: null })
      .mockResolvedValueOnce({ data: { id: CLIENTE_ID }, error: null });
    // duplicate check — maybeSingle returns existing mascota
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "other-mascota-id" }, error: null });

    const res = await doPatch(MASCOTA_ID, { nombre: "Grizzly" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Ya existe");
  });

  it("M-24: PATCH sin nombre no verifica duplicados — retorna 200", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: MASCOTA_ID, cliente_id: CLIENTE_ID }, error: null })
      .mockResolvedValueOnce({ data: { id: CLIENTE_ID }, error: null })
      .mockResolvedValueOnce({ data: { ...DB_MASCOTA, gramos_porcion: 25, veces_dia: 3 }, error: null })
      .mockResolvedValueOnce({ data: { ...DB_MASCOTA, gramos_porcion: 50, veces_dia: 2 }, error: null });

    const res = await doPatch(MASCOTA_ID, { gramos_porcion: 50, veces_dia: 2 });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.gramos_porcion).toBe(50);
    expect(body.veces_dia).toBe(2);
    // maybeSingle no debe haberse llamado (no hay verificación de duplicado)
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });
});

// ── DELETE /api/mascotas/[id] ──────────────────────────────────────────────

describe("DELETE /api/mascotas/[id]", () => {
  const { getStoreId } = require("@/lib/auth");

  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(mockChain);
    mockChain.select.mockReturnThis();
    mockChain.delete = jest.fn().mockReturnThis();
    mockChain.eq.mockReturnThis();
    getStoreId.mockResolvedValue({ userId: "user-1", storeId: STORE_ID });
  });

  async function doDelete(id: string) {
    const { DELETE } = await import("@/app/api/mascotas/[id]/route");
    const req = new NextRequest(`http://localhost/api/mascotas/${id}`, { method: "DELETE" });
    return DELETE(req, { params: Promise.resolve({ id }) });
  }

  it("M-17: retorna 401 sin auth", async () => {
    getStoreId.mockResolvedValue(null);
    const res = await doDelete(MASCOTA_ID);
    expect(res.status).toBe(401);
  });

  it("M-18: retorna 404 si mascota no existe", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const res = await doDelete(MASCOTA_ID);
    expect(res.status).toBe(404);
  });

  it("M-19: retorna 403 si mascota no pertenece al store", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: MASCOTA_ID, cliente_id: CLIENTE_ID }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const res = await doDelete(MASCOTA_ID);
    expect(res.status).toBe(403);
  });

  it("M-20: elimina mascota correctamente y retorna 200", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: MASCOTA_ID, cliente_id: CLIENTE_ID, nombre: "Grizzly", tipo: "perro" }, error: null })
      .mockResolvedValueOnce({ data: { id: CLIENTE_ID }, error: null });

    const { logAudit } = require("@/lib/audit");

    const res = await doDelete(MASCOTA_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DELETE",
        entityType: "mascota",
        entityId: MASCOTA_ID,
        changeDescription: "Mascota eliminada: Grizzly (perro)",
      })
    );
  });
});
