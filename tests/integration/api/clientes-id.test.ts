/**
 * Tests CG-01 a CG-10: GET, PATCH y DELETE /api/clientes/[id]
 * CG-03 cubre la regresión: gramos_porcion y veces_dia deben incluirse
 * en las mascotas del detalle del cliente para que el formulario de edición
 * las pre-cargue correctamente.
 */
import { NextRequest } from "next/server";

const STORE_ID   = "123e4567-e89b-12d3-a456-426614174000";
const CLIENTE_ID = "123e4567-e89b-12d3-a456-426614174020";
const MASCOTA_ID = "123e4567-e89b-12d3-a456-426614174030";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetStoreId = jest.fn();
const mockFrom       = jest.fn();

jest.mock("@/lib/auth",     () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/audit",    () => ({
  logAudit:           jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn().mockResolvedValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function chain(overrides: Record<string, unknown> = {}) {
  const c: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    neq:    jest.fn().mockReturnThis(),
    order:  jest.fn().mockReturnThis(),
    limit:  jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  ["select", "update", "delete", "eq", "neq", "order", "limit"].forEach(
    (k) => { if (!overrides[k]) c[k].mockReturnValue(c); }
  );
  return c;
}

// ── GET /api/clientes/[id] ────────────────────────────────────────────────────

describe("GET /api/clientes/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("CG-01: retorna 401 sin autenticación", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/clientes/[id]/route");
    const res = await GET(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(401);
  });

  it("CG-02: retorna 404 si el cliente no existe en el store", async () => {
    mockFrom.mockReturnValue(
      chain({ single: jest.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }) })
    );
    const { GET } = await import("@/app/api/clientes/[id]/route");
    const res = await GET(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(404);
  });

  it("CG-03: retorna mascotas con gramos_porcion y veces_dia (regresión: campos de consumo)", async () => {
    const mascota = {
      id:                  MASCOTA_ID,
      nombre:              "Grizzly",
      tipo:                "perro",
      raza:                "Shitsue",
      peso_kg:             8,
      alimento_habitual_id: null,
      gramos_porcion:      25,
      veces_dia:           3,
    };
    const clienteChain = chain({
      single: jest.fn().mockResolvedValue({
        data: { id: CLIENTE_ID, nombre: "Juan", rut: "15.855.267-1", mascotas: [mascota] },
        error: null,
      }),
    });
    const ventasChain = chain({
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "clientes") return clienteChain;
      if (table === "ventas")   return ventasChain;
      return chain();
    });

    const { GET } = await import("@/app/api/clientes/[id]/route");
    const res = await GET(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mascotas[0].gramos_porcion).toBe(25);
    expect(body.mascotas[0].veces_dia).toBe(3);
  });

  it("CG-04: mascotas sin consumo retornan gramos_porcion y veces_dia como null", async () => {
    const mascota = {
      id:                  MASCOTA_ID,
      nombre:              "Luna",
      tipo:                "gato",
      raza:                null,
      peso_kg:             4,
      alimento_habitual_id: null,
      gramos_porcion:      null,
      veces_dia:           null,
    };
    const clienteChain = chain({
      single: jest.fn().mockResolvedValue({
        data: { id: CLIENTE_ID, nombre: "María", rut: "15.855.267-1", mascotas: [mascota] },
        error: null,
      }),
    });
    const ventasChain = chain({
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "clientes") return clienteChain;
      if (table === "ventas")   return ventasChain;
      return chain();
    });

    const { GET } = await import("@/app/api/clientes/[id]/route");
    const res = await GET(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mascotas[0].gramos_porcion).toBeNull();
    expect(body.mascotas[0].veces_dia).toBeNull();
  });

  it("CG-05: incluye las últimas ventas del cliente en la respuesta", async () => {
    const venta = { id: "v-1", total: 15000, metodo_pago: "efectivo", created_at: "2026-05-01T10:00:00Z" };
    const clienteChain = chain({
      single: jest.fn().mockResolvedValue({
        data: { id: CLIENTE_ID, nombre: "Juan", mascotas: [] },
        error: null,
      }),
    });
    const ventasChain = chain({
      limit: jest.fn().mockResolvedValue({ data: [venta], error: null }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "clientes") return clienteChain;
      if (table === "ventas")   return ventasChain;
      return chain();
    });

    const { GET } = await import("@/app/api/clientes/[id]/route");
    const res = await GET(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`),
      makeParams(CLIENTE_ID)
    );
    const body = await res.json();
    expect(body.ventas).toHaveLength(1);
    expect(body.ventas[0].total).toBe(15000);
  });

  it("CG-14: incluye saldo_disponible del cliente en la respuesta", async () => {
    const clienteChain = chain({
      single: jest.fn().mockResolvedValue({
        data: { id: CLIENTE_ID, nombre: "Juan", mascotas: [] },
        error: null,
      }),
    });
    const ventasChain = chain({
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    });
    const saldoChain = chain({
      single: jest.fn().mockResolvedValue({
        data: { saldo_disponible: 8990 },
        error: null,
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "clientes")       return clienteChain;
      if (table === "ventas")         return ventasChain;
      if (table === "saldos_a_favor") return saldoChain;
      return chain();
    });

    const { GET } = await import("@/app/api/clientes/[id]/route");
    const res = await GET(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saldo_disponible).toBe(8990);
  });

  it("CG-15: saldo_disponible es 0 cuando el cliente no tiene registro en saldos_a_favor", async () => {
    const clienteChain = chain({
      single: jest.fn().mockResolvedValue({
        data: { id: CLIENTE_ID, nombre: "Juan", mascotas: [] },
        error: null,
      }),
    });
    const ventasChain = chain({
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    });
    const saldoChain = chain({
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "No rows found" },
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "clientes")       return clienteChain;
      if (table === "ventas")         return ventasChain;
      if (table === "saldos_a_favor") return saldoChain;
      return chain();
    });

    const { GET } = await import("@/app/api/clientes/[id]/route");
    const res = await GET(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saldo_disponible).toBe(0);
  });
});

// ── PATCH /api/clientes/[id] ──────────────────────────────────────────────────

describe("PATCH /api/clientes/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("CG-06: retorna 401 sin autenticación", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/clientes/[id]/route");
    const res = await PATCH(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "Juan" }),
      }),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(401);
  });

  it("CG-07: retorna 400 con nombre inválido (menos de 3 chars)", async () => {
    const { PATCH } = await import("@/app/api/clientes/[id]/route");
    const res = await PATCH(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "Ju" }),
      }),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(400);
  });

  it("CG-12: PATCH con RUT válido normaliza y almacena el RUT formateado", async () => {
    // 76.354.771-K: RUT de empresa verificado (DV=K matemáticamente correcto)
    const readChain = chain({
      single: jest.fn().mockResolvedValue({ data: { nombre: "Juan", email: null, telefono: null, rut: "76.354.771-K" }, error: null }),
    });
    const updateChain = chain({
      single: jest.fn().mockResolvedValue({ data: { id: CLIENTE_ID, rut: "76.354.771-K" }, error: null }),
    });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? readChain : updateChain;
    });

    const { PATCH } = await import("@/app/api/clientes/[id]/route");
    const res = await PATCH(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rut: "76354771-K" }),  // sin puntos → debe normalizarse
      }),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(200);
    // El handler debe haber llamado .update() con el RUT normalizado con puntos
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ rut: "76.354.771-K" })
    );
  });

  it("CG-13: PATCH con RUT inválido retorna 400", async () => {
    const { PATCH } = await import("@/app/api/clientes/[id]/route");
    const res = await PATCH(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rut: "12.345.678-9" }),  // DV incorrecto
      }),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(400);
  });

  it("CG-08: actualiza nombre del cliente y retorna 200", async () => {
    const readChain = chain({
      single: jest.fn().mockResolvedValue({ data: { nombre: "Viejo", email: null, telefono: null }, error: null }),
    });
    const updateChain = chain({
      single: jest.fn().mockResolvedValue({ data: { id: CLIENTE_ID, nombre: "Nuevo Nombre" }, error: null }),
    });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? readChain : updateChain;
    });

    const { PATCH } = await import("@/app/api/clientes/[id]/route");
    const res = await PATCH(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "Nuevo Nombre" }),
      }),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nombre).toBe("Nuevo Nombre");
  });
});

// ── DELETE /api/clientes/[id] ─────────────────────────────────────────────────

describe("DELETE /api/clientes/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("CG-09: retorna 401 sin autenticación", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/clientes/[id]/route");
    const res = await DELETE(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`, { method: "DELETE" }),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(401);
  });

  it("CG-10: retorna 404 si el cliente no existe", async () => {
    mockFrom.mockReturnValue(
      chain({ single: jest.fn().mockResolvedValue({ data: null, error: null }) })
    );
    const { DELETE } = await import("@/app/api/clientes/[id]/route");
    const res = await DELETE(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`, { method: "DELETE" }),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(404);
  });

  it("CG-11: elimina el cliente y retorna ok: true", async () => {
    const readChain = chain({
      single: jest.fn().mockResolvedValue({
        data: { id: CLIENTE_ID, nombre: "Juan", rut: "15.855.267-1", email: null, telefono: null },
        error: null,
      }),
    });
    // DELETE chain: .delete().eq("id",...).eq("store_id",...) → resolves directly
    const deleteResult = { error: null };
    const deleteChain = {
      select:  jest.fn().mockReturnThis(),
      delete:  jest.fn().mockReturnThis(),
      eq:      jest.fn().mockReturnThis(),
      // Last call in the chain resolves the promise
      then:    undefined as unknown,
    };
    // Make the chain thenable on the last eq call
    const innerEq = jest.fn().mockResolvedValue(deleteResult);
    deleteChain.eq = jest.fn().mockReturnValueOnce({ ...deleteChain, eq: innerEq }).mockReturnValueOnce(deleteResult);

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? readChain : deleteChain;
    });

    const { DELETE } = await import("@/app/api/clientes/[id]/route");
    const res = await DELETE(
      new NextRequest(`http://localhost/api/clientes/${CLIENTE_ID}`, { method: "DELETE" }),
      makeParams(CLIENTE_ID)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
