import { GET } from "@/app/api/dashboard/stock-alertas/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

describe("GET /api/dashboard/stock-alertas", () => {
  const mockStoreId = "store-1";

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId });
  });

  it("retorna productos con stock por debajo o igual al mínimo", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(function() { return this; }),
    };
    (chain as any).then = function(resolve: any) {
      return resolve({
        data: [
          {
            id: "prod-1",
            nombre: "Producto A",
            sku: "SKU-A",
            stock: 2,
            stock_minimo: 5,
          },
          {
            id: "prod-2",
            nombre: "Producto B",
            sku: "SKU-B",
            stock: 100,
            stock_minimo: 5,
          },
        ],
        error: null,
      });
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/dashboard/stock-alertas");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.total).toBe(1);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].nombre).toBe("Producto A");
  });

  it("considera productos con stock exactamente igual al mínimo como alerta (regresión: operador < vs <=)", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(function() { return this; }),
    };
    (chain as any).then = function(resolve: any) {
      return resolve({
        data: [
          {
            id: "prod-igual",
            nombre: "Collar Ajustable M",
            sku: "COLLAR-M",
            stock: 5,
            stock_minimo: 5,
          },
          {
            id: "prod-sobre",
            nombre: "Producto OK",
            sku: "OK-001",
            stock: 10,
            stock_minimo: 5,
          },
        ],
        error: null,
      });
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].nombre).toBe("Collar Ajustable M");
  });

  it("considera productos con stock=0 y mínimo=0 como alerta", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(function() { return this; }),
    };
    (chain as any).then = function(resolve: any) {
      return resolve({
        data: [
          {
            id: "prod-cero",
            nombre: "Sin stock",
            sku: "ZERO-001",
            stock: 0,
            stock_minimo: 0,
          },
        ],
        error: null,
      });
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].nombre).toBe("Sin stock");
  });

  it("limita a 10 resultados máximo", async () => {
    const products = Array.from({ length: 15 }, (_, i) => ({
      id: `prod-${i}`,
      nombre: `Producto ${i}`,
      sku: `SKU-${i}`,
      stock: i,
      stock_minimo: 10,
    }));

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(function() { return this; }),
    };
    (chain as any).then = function(resolve: any) {
      return resolve({ data: products, error: null });
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/dashboard/stock-alertas");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.items).toHaveLength(10);
    // REGRESIÓN: de los 15 productos, 11 están realmente bajo mínimo
    // (stock 0..10 <= stock_minimo=10; stock 11..14 están sobre el mínimo).
    // total debe reflejar esos 11, no los 10 que se muestran en la lista —
    // si el widget usara items.length como contador (en vez de total),
    // mostraría "10" en vez de "11", discrepando con Inventario igual que
    // el bug original reportado.
    expect(data.total).toBe(11);
  });

  it("ordena por stock ASC (menor stock primero)", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    };
    (chain as any).then = function(resolve: any) {
      return resolve({
        data: [
          { id: "prod-1", nombre: "Crítico", stock: 1, stock_minimo: 5 },
          { id: "prod-2", nombre: "Bajo", stock: 3, stock_minimo: 5 },
          { id: "prod-3", nombre: "Medio", stock: 4, stock_minimo: 5 },
        ],
        error: null,
      });
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/dashboard/stock-alertas");
    const res = await GET();
    const data = await res.json();

    expect(chain.order).toHaveBeenCalledWith("stock", { ascending: true });
    expect(data.items[0].nombre).toBe("Crítico");
    expect(data.items[1].nombre).toBe("Bajo");
  });

  it("filtra solo productos activos", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(function() { return this; }),
    };
    (chain as any).then = function(resolve: any) {
      return resolve({
        data: [
          { id: "prod-1", nombre: "Activo", stock: 2, stock_minimo: 5 },
        ],
        error: null,
      });
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/dashboard/stock-alertas");
    const res = await GET();

    expect(chain.eq).toHaveBeenCalledWith("activo", true);
  });

  it("respeta store_id (solo alertas de su tienda)", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(function() { return this; }),
    };
    (chain as any).then = function(resolve: any) {
      return resolve({ data: [], error: null });
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/dashboard/stock-alertas");
    await GET();

    expect(chain.eq).toHaveBeenCalledWith("store_id", mockStoreId);
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/dashboard/stock-alertas");
    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("retorna 500 si hay error en Supabase", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(function() { return this; }),
    };
    (chain as any).then = function(resolve: any) {
      return resolve({ data: null, error: { message: "Database error" } });
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/dashboard/stock-alertas");
    const res = await GET();

    expect(res.status).toBe(500);
  });
});
