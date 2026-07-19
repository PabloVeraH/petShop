import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

const mockVentas = [
  { id: "v1", numero_comprobante: "001", total: 50000, metodo_pago: "efectivo", estado: "completada", created_at: "2026-06-01T10:00:00Z", clientes: null },
];

function makeVentasChain(data = mockVentas) {
  return {
    data,
    error: null,
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  };
}

function makeNCChain(data: Array<{ monto_total: number; venta_id: string }> = []) {
  return {
    data,
    error: null,
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  };
}

describe("GET /api/workers/[clerkId]/ventas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  function makeSUT(ventasData = mockVentas, ncData: Array<{ monto_total: number; venta_id: string }> = []) {
    mockFrom.mockImplementation((table: string) => {
      if (table === "notas_credito") return makeNCChain(ncData);
      return makeVentasChain(ventasData);
    });
  }

  it("I-260: retorna 401 si no autenticado", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/workers/[clerkId]/ventas/route");
    const req = new NextRequest("http://localhost/api/workers/c1/ventas");
    const res = await GET(req, { params: Promise.resolve({ clerkId: "c1" }) });
    expect(res.status).toBe(401);
  });

  it("I-261: retorna ventas del worker identificado por clerkId", async () => {
    makeSUT();
    const { GET } = await import("@/app/api/workers/[clerkId]/ventas/route");
    const req = new NextRequest("http://localhost/api/workers/c1/ventas");
    const res = await GET(req, { params: Promise.resolve({ clerkId: "c1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].id).toBe("v1");
  });

  it("I-262: filtra por rango de fechas cuando se proveen desde y hasta", async () => {
    const chain = makeVentasChain([]);
    const gtespy = chain.gte as jest.Mock;
    const ltespy = chain.lte as jest.Mock;
    mockFrom.mockImplementation((table: string) => {
      if (table === "notas_credito") return makeNCChain([]);
      return chain;
    });
    const { GET } = await import("@/app/api/workers/[clerkId]/ventas/route");
    const req = new NextRequest("http://localhost/api/workers/c1/ventas?desde=2026-06-01&hasta=2026-06-07");
    await GET(req, { params: Promise.resolve({ clerkId: "c1" }) });
    expect(gtespy).toHaveBeenCalled();
    expect(ltespy).toHaveBeenCalled();
  });

  it("I-425c: cada venta incluye monto_devuelto (0 si sin NC, >0 si tiene NC)", async () => {
    const VENTAS = [
      { id: "v1", numero_comprobante: "001", total: 50000, metodo_pago: "efectivo", estado: "completada", created_at: "2026-06-01T10:00:00Z", clientes: null },
      { id: "v2", numero_comprobante: "002", total: 30000, metodo_pago: "debito", estado: "completada", created_at: "2026-06-02T10:00:00Z", clientes: null },
    ];
    const NC = [
      { monto_total: 20000, venta_id: "v1" },
    ];
    makeSUT(VENTAS, NC);
    const { GET } = await import("@/app/api/workers/[clerkId]/ventas/route");
    const req = new NextRequest("http://localhost/api/workers/c1/ventas");
    const res = await GET(req, { params: Promise.resolve({ clerkId: "c1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    const v1 = body.find((v: { id: string }) => v.id === "v1");
    const v2 = body.find((v: { id: string }) => v.id === "v2");
    expect(v1.monto_devuelto).toBe(20000);
    expect(v2.monto_devuelto).toBe(0);
  });
});
