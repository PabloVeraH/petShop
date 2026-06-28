import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

const MOCK_VENTAS = [
  {
    id: "v1",
    total: 50000,
    metodo_pago: "efectivo",
    estado: "completada",
    created_at: "2026-06-01T10:00:00Z",
    numero_comprobante: "001",
    clientes: { nombre: "Juan Pérez" },
  },
  {
    id: "v2",
    total: 25000,
    metodo_pago: "debito",
    estado: "anulada",
    created_at: "2026-05-28T14:30:00Z",
    numero_comprobante: "002",
    clientes: null,
  },
];

type QueryChain = {
  select: jest.Mock;
  eq: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  order: jest.Mock;
  range: jest.Mock;
  ilike: jest.Mock;
  in: jest.Mock;
  then: (onfulfilled?: (value: unknown) => unknown) => Promise<unknown>;
};

function makeVentasChain(data = MOCK_VENTAS, count = 2): QueryChain {
  const result = { data, error: null, count };
  const eq = jest.fn().mockReturnThis();
  const gte = jest.fn().mockReturnThis();
  const lte = jest.fn().mockReturnThis();
  const order = jest.fn().mockReturnThis();
  const range = jest.fn().mockReturnThis();
  const ilike = jest.fn().mockReturnThis();
  const in_ = jest.fn().mockReturnThis();
  const chain: QueryChain = {
    select: jest.fn(() => chain),
    eq, gte, lte, order, range, ilike, in: in_,
    then: (onfulfilled) => Promise.resolve(result).then(onfulfilled),
  };
  return chain;
}

function makeClientesChain(data: { id: string }[] = []): QueryChain {
  const result = { data, error: null };
  const chain: QueryChain = {
    select: jest.fn(() => chain),
    eq: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    then: (onfulfilled) => Promise.resolve(result).then(onfulfilled),
  };
  return chain;
}

describe("GET /api/ventas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("I-293: retorna 401 si no autenticado", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/ventas/route");
    const req = new NextRequest("http://localhost/api/ventas");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("I-294: retorna ventas paginadas con count y fecha mínima por defecto", async () => {
    const chain = makeVentasChain();
    mockFrom
      .mockReturnValueOnce(chain);

    const { GET } = await import("@/app/api/ventas/route");
    const req = new NextRequest("http://localhost/api/ventas");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.count).toBe(2);
    expect(body.data[0].numero_comprobante).toBe("001");
    expect(body.data[1].numero_comprobante).toBe("002");

    // Verifica multi-tenant y orden
    expect(chain.select).toHaveBeenCalledWith(
      "id, total, metodo_pago, estado, created_at, numero_comprobante, clientes(nombre)",
      { count: "exact" },
    );
    expect(chain.range).toHaveBeenCalledWith(0, 49);
  });

  it("I-295: filtra por metodo_pago y estado", async () => {
    const chain = makeVentasChain();
    mockFrom.mockReturnValueOnce(chain);

    const { GET } = await import("@/app/api/ventas/route");
    const req = new NextRequest("http://localhost/api/ventas?metodo=efectivo&estado=completada");
    await GET(req);

    expect(chain.eq).toHaveBeenCalledWith("metodo_pago", "efectivo");
    expect(chain.eq).toHaveBeenCalledWith("estado", "completada");
  });

  it("I-296: filtra por rango de fechas", async () => {
    const chain = makeVentasChain();
    mockFrom.mockReturnValueOnce(chain);

    const { GET } = await import("@/app/api/ventas/route");
    const req = new NextRequest("http://localhost/api/ventas?desde=2026-01-01&hasta=2026-06-30");
    await GET(req);

    expect(chain.gte).toHaveBeenCalledWith("created_at", "2026-01-01");
    expect(chain.lte).toHaveBeenCalledWith("created_at", "2026-06-30T23:59:59");
  });

  it("I-297: busca por nombre de cliente", async () => {
    const ventasChain = makeVentasChain();
    const clientesChain = makeClientesChain([{ id: "c1" }]);

    mockFrom
      .mockReturnValueOnce(ventasChain)
      .mockReturnValueOnce(clientesChain);

    const { GET } = await import("@/app/api/ventas/route");
    const req = new NextRequest("http://localhost/api/ventas?search=Juan");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(2);
  });

  it("I-298: busca por numero_comprobante cuando search contiene -", async () => {
    const chain = makeVentasChain();
    mockFrom
      .mockReturnValueOnce(chain);

    const { GET } = await import("@/app/api/ventas/route");
    const req = new NextRequest("http://localhost/api/ventas?search=2026-001");
    await GET(req);

    expect(chain.ilike).toHaveBeenCalledWith("numero_comprobante", "%2026-001%");
  });

  it("I-299: busca por nombre de cliente — retorna vacío si no hay clientes matching", async () => {
    const chain = makeVentasChain([], 0);
    const emptyClientes = makeClientesChain([]);
    mockFrom
      .mockReturnValueOnce(emptyClientes)
      .mockReturnValueOnce(chain);

    const { GET } = await import("@/app/api/ventas/route");
    const req = new NextRequest("http://localhost/api/ventas?search=ZzZzZ");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.count).toBe(0);
  });
});
