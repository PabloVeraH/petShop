const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

function alertasChain(data: unknown) {
  return {
    data,
    error: null,
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
  };
}

describe("GET /api/recompras", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("I-253: retorna 401 si no autenticado", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/recompras/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("I-254: retorna arreglo vacío cuando no hay alertas de consumo", async () => {
    mockFrom.mockReturnValue(alertasChain([]));
    const { GET } = await import("@/app/api/recompras/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("I-255: filtra sugerencias con hasta 14 días de anticipación", async () => {
    const hoy = new Date();
    const en3dias = new Date(hoy.getTime() + 3 * 86400000).toISOString();
    const en20dias = new Date(hoy.getTime() + 20 * 86400000).toISOString();
    const alertas = [
      { producto_id: "p1", fecha_estimada_termino: en3dias, mascotas: null, clientes: null },
      { producto_id: "p2", fecha_estimada_termino: en20dias, mascotas: null, clientes: null },
    ];
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) return alertasChain(alertas);
      // proveedor_productos: .select().in()  | productos: .select().in().eq()
      return { data: [], error: null, select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis() };
    });
    const { GET } = await import("@/app/api/recompras/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    // Solo p1 está dentro de 14 días
    expect(body.some((s: { producto_id: string }) => s.producto_id === "p1")).toBe(true);
    expect(body.some((s: { producto_id: string }) => s.producto_id === "p2")).toBe(false);
  });
});
