import { GET } from "@/app/api/stock-movements/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

describe("GET /api/stock-movements", () => {
  const mockStoreId = "store-1";
  const mockProductId = "123e4567-e89b-12d3-a456-426614174010";
  const mockUserId = "user_2abc123";

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ userId: mockUserId, storeId: mockStoreId });
  });

  function buildMovChain(data: any[]) {
    const movChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn(function() { return this; }),
    };
    (movChain as any).then = function(resolve: any) {
      return resolve({ data, error: null });
    };
    return movChain;
  }

  function buildProdChain() {
    const prodChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockProductId },
        error: null,
      }),
    };
    return prodChain;
  }

  function makeClient(fromMock: jest.Mock) {
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: fromMock,
    });
  }

  it("retorna movimientos de stock de un producto (últimos 50, DESC) con user_name enriquecido", async () => {
    const prodChain = buildProdChain();
    const movChain = buildMovChain([
      {
        id: "mov-1",
        tipo: "entrada",
        cantidad: 5,
        notas: "Compra",
        created_at: "2026-04-17T10:00:00Z",
        user_id: mockUserId,
      },
      {
        id: "mov-2",
        tipo: "salida",
        cantidad: 2,
        notas: "Venta",
        created_at: "2026-04-16T15:00:00Z",
        user_id: null,
      },
    ]);

    const usersChain = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
    };
    (usersChain as any).then = function(resolve: any) {
      return resolve({
        data: [{ clerk_id: mockUserId, nombre: "Pablo Vera", email: "pablo@example.com" }],
        error: null,
      });
    };

    let callCount = 0;
    makeClient(jest.fn((table: string) => {
      callCount++;
      if (table === "productos") return prodChain;
      if (table === "stock_movements") return movChain;
      if (table === "clerk_users") return usersChain;
    }));

    const req = new NextRequest(`http://localhost/api/stock-movements?productoId=${mockProductId}`);
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe("mov-1");
    // Enrichment: known user → nombre
    expect(data[0].user_name).toBe("Pablo Vera");
    // Enrichment: null user_id → "Sistema"
    expect(data[1].user_name).toBe("Sistema");
  });

  it("retorna 400 si falta productoId", async () => {
    const req = new NextRequest("http://localhost/api/stock-movements");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("productoId requerido");
  });

  it("retorna 404 si producto no existe", async () => {
    const prodChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "not found" },
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(prodChain),
    });

    const req = new NextRequest("http://localhost/api/stock-movements?productoId=inexistente");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe("Producto no encontrado");
  });

  it("retorna 404 si producto pertenece a otra tienda (RLS)", async () => {
    const prodChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "not found" },
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(prodChain),
    });

    const req = new NextRequest(`http://localhost/api/stock-movements?productoId=prod-otra-tienda`);
    const res = await GET(req);

    expect(res.status).toBe(404);
  });

  it("ordena movimientos por created_at DESC (más recientes primero)", async () => {
    const prodChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockProductId },
        error: null,
      }),
    };

    const movChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn(function() { return this; }),
    };
    (movChain as any).then = function(resolve: any) {
      return resolve({ data: [], error: null });
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "productos") return prodChain;
        if (table === "stock_movements") return movChain;
      }),
    });

    const req = new NextRequest(`http://localhost/api/stock-movements?productoId=${mockProductId}`);
    await GET(req);

    expect(movChain.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("limita a 50 movimientos", async () => {
    const prodChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockProductId },
        error: null,
      }),
    };

    const movChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn(function() { return this; }),
    };
    (movChain as any).then = function(resolve: any) {
      return resolve({ data: [], error: null });
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "productos") return prodChain;
        if (table === "stock_movements") return movChain;
      }),
    });

    const req = new NextRequest(`http://localhost/api/stock-movements?productoId=${mockProductId}`);
    await GET(req);

    expect(movChain.limit).toHaveBeenCalledWith(50);
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(`http://localhost/api/stock-movements?productoId=${mockProductId}`);
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("retorna 500 si hay error en Supabase", async () => {
    const prodChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockProductId },
        error: null,
      }),
    };

    const movChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn(function() { return this; }),
    };
    (movChain as any).then = function(resolve: any) {
      return resolve({ data: null, error: { message: "Database error" } });
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "productos") return prodChain;
        if (table === "stock_movements") return movChain;
      }),
    });

    const req = new NextRequest(`http://localhost/api/stock-movements?productoId=${mockProductId}`);
    const res = await GET(req);

    expect(res.status).toBe(500);
  });
});
