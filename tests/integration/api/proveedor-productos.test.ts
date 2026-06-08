import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const PROVEEDOR_ID = "123e4567-e89b-12d3-a456-426614174001";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174002";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

function makeRequest(method: string, body?: object, search = "") {
  return new NextRequest(`http://localhost/api/proveedor-productos${search}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/proveedor-productos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("I-263: retorna 401 si no autenticado", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/proveedor-productos/route");
    const res = await POST(makeRequest("POST", { proveedor_id: PROVEEDOR_ID, producto_id: PRODUCTO_ID }));
    expect(res.status).toBe(401);
  });

  it("I-264: retorna 404 si proveedor no pertenece a la tienda", async () => {
    mockFrom.mockReturnValue({
      data: null, error: null,
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    const { POST } = await import("@/app/api/proveedor-productos/route");
    const res = await POST(makeRequest("POST", { proveedor_id: PROVEEDOR_ID, producto_id: PRODUCTO_ID }));
    expect(res.status).toBe(404);
  });

  it("I-265: crea asociación proveedor-producto correctamente", async () => {
    const result = { id: "pp1", proveedor_id: PROVEEDOR_ID, producto_id: PRODUCTO_ID, costo: null };
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { id: PROVEEDOR_ID }, error: null }),
        };
      }
      return {
        upsert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: result, error: null }),
      };
    });
    const { POST } = await import("@/app/api/proveedor-productos/route");
    const res = await POST(makeRequest("POST", { proveedor_id: PROVEEDOR_ID, producto_id: PRODUCTO_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proveedor_id).toBe(PROVEEDOR_ID);
  });
});

describe("DELETE /api/proveedor-productos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("I-266: retorna 400 si no se provee id", async () => {
    const { DELETE } = await import("@/app/api/proveedor-productos/route");
    const res = await DELETE(makeRequest("DELETE"));
    expect(res.status).toBe(400);
  });

  it("I-267: retorna 403 si el proveedor no pertenece a la tienda", async () => {
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { id: "pp1", proveedor_id: PROVEEDOR_ID }, error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });
    const { DELETE } = await import("@/app/api/proveedor-productos/route");
    const res = await DELETE(makeRequest("DELETE", undefined, "?id=pp1"));
    expect(res.status).toBe(403);
  });
});
