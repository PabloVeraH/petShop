/**
 * Tests F-01 a F-06: GET /api/fidelizacion
 * Verifica autenticación, validación, retorno de niveles configurables y fallback a defaults.
 */
import { NextRequest } from "next/server";

const STORE_ID   = "123e4567-e89b-12d3-a456-426614174000";
const CLIENTE_ID = "123e4567-e89b-12d3-a456-426614174020";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetStoreId = jest.fn();
const mockFrom       = jest.fn();

jest.mock("@/lib/auth",     () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/fidelizacion");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function clientesChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error: null }),
  };
}

function fidelChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error: data ? null : { message: "not found" } }),
  };
}

function storesChain(niveles: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { fidelizacion_niveles: niveles }, error: null }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/fidelizacion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("F-01: retorna 401 sin autenticación", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/fidelizacion/route");
    const res = await GET(makeRequest({ clienteId: CLIENTE_ID }));
    expect(res.status).toBe(401);
  });

  it("F-02: retorna 400 sin clienteId", async () => {
    const { GET } = await import("@/app/api/fidelizacion/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
  });

  it("F-03: retorna null si el cliente no pertenece al store", async () => {
    mockFrom.mockReturnValue(clientesChain(null));
    const { GET } = await import("@/app/api/fidelizacion/route");
    const res = await GET(makeRequest({ clienteId: CLIENTE_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it("F-04: retorna null si el cliente no tiene registro de fidelización", async () => {
    let call = 0;
    mockFrom.mockImplementation((table: string) => {
      call++;
      if (table === "clientes") return clientesChain({ id: CLIENTE_ID });
      if (table === "fidelizacion") return fidelChain(null);
      return storesChain(null);
    });
    const { GET } = await import("@/app/api/fidelizacion/route");
    const res = await GET(makeRequest({ clienteId: CLIENTE_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
    void call;
  });

  it("F-05: retorna datos de fidelización con los niveles configurados en el store", async () => {
    const customNiveles = [
      { monto: 100_000, descuento: 8 },
      { monto: 500_000, descuento: 15 },
    ];
    mockFrom.mockImplementation((table: string) => {
      if (table === "clientes")    return clientesChain({ id: CLIENTE_ID });
      if (table === "fidelizacion") return fidelChain({ total_historico: 120_000, frecuencia_compras: 3, descuento_actual: 8 });
      if (table === "stores")      return storesChain(customNiveles);
      return clientesChain(null);
    });

    const { GET } = await import("@/app/api/fidelizacion/route");
    const res = await GET(makeRequest({ clienteId: CLIENTE_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_historico).toBe(120_000);
    expect(body.descuento_actual).toBe(8);
    expect(body.niveles).toEqual(customNiveles);
  });

  it("F-06: usa niveles por defecto cuando el store no tiene fidelizacion_niveles", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "clientes")    return clientesChain({ id: CLIENTE_ID });
      if (table === "fidelizacion") return fidelChain({ total_historico: 30_000, frecuencia_compras: 1, descuento_actual: 0 });
      if (table === "stores")      return storesChain(null);
      return clientesChain(null);
    });

    const { GET } = await import("@/app/api/fidelizacion/route");
    const res = await GET(makeRequest({ clienteId: CLIENTE_ID }));
    const body = await res.json();
    expect(body.niveles).toEqual([
      { monto: 50_000,  descuento: 5  },
      { monto: 150_000, descuento: 10 },
      { monto: 300_000, descuento: 20 },
    ]);
  });
});
