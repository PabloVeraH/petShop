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
  };
}

describe("GET /api/workers/[clerkId]/ventas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("I-260: retorna 401 si no autenticado", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/workers/[clerkId]/ventas/route");
    const req = new NextRequest("http://localhost/api/workers/c1/ventas");
    const res = await GET(req, { params: Promise.resolve({ clerkId: "c1" }) });
    expect(res.status).toBe(401);
  });

  it("I-261: retorna ventas del worker identificado por clerkId", async () => {
    mockFrom.mockReturnValue(makeVentasChain());
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
    mockFrom.mockReturnValue(chain);
    const { GET } = await import("@/app/api/workers/[clerkId]/ventas/route");
    const req = new NextRequest("http://localhost/api/workers/c1/ventas?desde=2026-06-01&hasta=2026-06-07");
    await GET(req, { params: Promise.resolve({ clerkId: "c1" }) });
    expect(gtespy).toHaveBeenCalled();
    expect(ltespy).toHaveBeenCalled();
  });
});
