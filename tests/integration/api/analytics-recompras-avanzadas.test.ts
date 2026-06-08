import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockGetReorderSuggestions = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/analytics/reorder-suggestions", () => ({
  getReorderSuggestions: mockGetReorderSuggestions,
}));

describe("GET /api/analytics/recompras-avanzadas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("I-277: retorna 401 si no autenticado", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/analytics/recompras-avanzadas/route");
    const res = await GET(new NextRequest("http://localhost/api/analytics/recompras-avanzadas"));
    expect(res.status).toBe(401);
  });

  it("I-278: delega al servicio y retorna sugerencias envueltas en {sugerencias}", async () => {
    const sugerencias = [{ producto_id: "p1", nombre: "Croquetas", score: 0.9 }];
    mockGetReorderSuggestions.mockResolvedValue(sugerencias);
    const { GET } = await import("@/app/api/analytics/recompras-avanzadas/route");
    const res = await GET(new NextRequest("http://localhost/api/analytics/recompras-avanzadas"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sugerencias).toEqual(sugerencias);
    expect(mockGetReorderSuggestions).toHaveBeenCalledWith(STORE_ID);
  });
});
