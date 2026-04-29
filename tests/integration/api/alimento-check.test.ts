/**
 * Tests I-211 to I-212: GET /api/inventario/alimento-check
 */
import { NextRequest } from "next/server";

const mockGetStoreId = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(),
}));

describe("GET /api/inventario/alimento-check", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: "store-1" });
  });

  it("I-211: sin ids retorna array vacío", async () => {
    const { GET } = await import("@/app/api/inventario/alimento-check/route");
    const req = new NextRequest("http://localhost/api/inventario/alimento-check");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("I-212: sin authorization retorna 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/inventario/alimento-check/route");
    const req = new NextRequest("http://localhost/api/inventario/alimento-check?ids=p1,p2");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});