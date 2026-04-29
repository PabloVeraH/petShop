/**
 * Tests I-221 to I-222: GET /api/consumo-configs/cliente
 */
import { NextRequest } from "next/server";

const mockGetStoreId = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(),
}));

describe("GET /api/consumo-configs/cliente", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: "store-1" });
  });

  it("I-221: sin clienteId retorna 400", async () => {
    const { GET } = await import("@/app/api/consumo-configs/cliente/route");
    const req = new NextRequest("http://localhost/api/consumo-configs/cliente");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("I-222: sin authorization retorna 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/consumo-configs/cliente/route");
    const req = new NextRequest("http://localhost/api/consumo-configs/cliente?clienteId=c1");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});