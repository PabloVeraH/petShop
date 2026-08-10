import { GET } from "@/app/api/inventario/route";
import { NextRequest } from "next/server";

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    // after() requiere request scope real (lanza fuera de él). Los Route
    // Handlers ahora usan withErrorLogging (src/lib/audit.ts), que agenda el
    // log de errores vía after() — mismo patrón que tests/integration/api/
    // ventas*.test.ts.
    after: jest.fn((cb: () => void) => cb()),
  };
});
jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

describe("GET /api/inventario", () => {
  const mockStoreId = "store-1";

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId });
  });

  it("retorna listado de productos activos", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          {
            id: "prod-1",
            nombre: "Producto A",
            sku: "SKU-A",
            precio: 10000,
            costo: 5000,
            stock: 20,
            stock_minimo: 5,
            marca: "Marca X",
            peso_gramos: 500,
            fecha_vencimiento: null,
            dias_alerta_expira: 30,
            precio_oferta: null,
            en_oferta: false,
          },
        ],
        error: null,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/inventario");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].nombre).toBe("Producto A");
  });

  it("filtra por búsqueda en nombre o SKU", async () => {
    const result = {
      data: [
        {
          id: "prod-1",
          nombre: "Producto A",
          sku: "SKU-A",
          precio: 10000,
          costo: 5000,
          stock: 20,
          stock_minimo: 5,
          marca: "Marca X",
          peso_gramos: 500,
          fecha_vencimiento: null,
          dias_alerta_expira: 30,
          precio_oferta: null,
          en_oferta: false,
        },
      ],
      error: null,
    };

    const chain = {
      select: jest.fn(function() { return this; }),
      eq: jest.fn(function() { return this; }),
      order: jest.fn(function() { return this; }),
      or: jest.fn(function() { return this; }),
    };
    Object.defineProperty(chain, Symbol.toStringTag, { value: "Promise" });
    (chain as any).then = function(resolve: any) { return resolve(result); };
    (chain as any).catch = function() { return this; };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/inventario?search=Producto");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(1);
  });

  it("sanitiza búsqueda para evitar inyección", async () => {
    const result = { data: [], error: null };
    const chain = {
      select: jest.fn(function() { return this; }),
      eq: jest.fn(function() { return this; }),
      order: jest.fn(function() { return this; }),
      or: jest.fn(function() { return this; }),
    };
    (chain as any).then = function(resolve: any) { return resolve(result); };
    (chain as any).catch = function() { return this; };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/inventario?search=test(drop)%comma");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(chain.or).toHaveBeenCalled();
    const callArgs = (chain.or as jest.Mock).mock.calls[0][0];
    expect(callArgs).toContain("testdropcomma");
    expect(callArgs).not.toContain("(drop)");
  });

  it("filtra por alertas de stock (stock <= stock_minimo)", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          {
            id: "prod-1",
            nombre: "Producto A",
            sku: "SKU-A",
            precio: 10000,
            costo: 5000,
            stock: 3,
            stock_minimo: 5,
            marca: "Marca X",
            peso_gramos: 500,
            fecha_vencimiento: null,
            dias_alerta_expira: 30,
            precio_oferta: null,
            en_oferta: false,
          },
          {
            id: "prod-2",
            nombre: "Producto B",
            sku: "SKU-B",
            precio: 20000,
            costo: 10000,
            stock: 100,
            stock_minimo: 5,
            marca: "Marca Y",
            peso_gramos: 1000,
            fecha_vencimiento: null,
            dias_alerta_expira: 30,
            precio_oferta: null,
            en_oferta: false,
          },
        ],
        error: null,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/inventario?alertas=1");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].nombre).toBe("Producto A");
  });

  it("filtra por vencimientos (fecha_vencimiento NOT NULL)", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          {
            id: "prod-1",
            nombre: "Producto Perecedero",
            sku: "SKU-P",
            precio: 5000,
            costo: 2500,
            stock: 10,
            stock_minimo: 2,
            marca: "Marca Z",
            peso_gramos: 200,
            fecha_vencimiento: "2026-04-20",
            dias_alerta_expira: 7,
            precio_oferta: null,
            en_oferta: false,
          },
          {
            id: "prod-2",
            nombre: "Producto No Perecedero",
            sku: "SKU-NP",
            precio: 15000,
            costo: 8000,
            stock: 50,
            stock_minimo: 10,
            marca: "Marca W",
            peso_gramos: 500,
            fecha_vencimiento: null,
            dias_alerta_expira: 30,
            precio_oferta: null,
            en_oferta: false,
          },
        ],
        error: null,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/inventario?vencimiento=1");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].nombre).toBe("Producto Perecedero");
    expect(data[0].fecha_vencimiento).toBe("2026-04-20");
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/inventario");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("retorna 500 si hay error en Supabase", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "Database error" },
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/inventario");
    const res = await GET(req);

    expect(res.status).toBe(500);
  });

  it("combina filtros alertas + vencimiento", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          {
            id: "prod-1",
            nombre: "Producto Perecedero con Baja",
            sku: "SKU-PB",
            precio: 5000,
            costo: 2500,
            stock: 2,
            stock_minimo: 5,
            marca: "Marca Z",
            peso_gramos: 200,
            fecha_vencimiento: "2026-04-20",
            dias_alerta_expira: 7,
            precio_oferta: null,
            en_oferta: false,
          },
          {
            id: "prod-2",
            nombre: "Producto Perecedero Sin Baja",
            sku: "SKU-PSB",
            precio: 5000,
            costo: 2500,
            stock: 100,
            stock_minimo: 5,
            marca: "Marca Z",
            peso_gramos: 200,
            fecha_vencimiento: "2026-04-20",
            dias_alerta_expira: 7,
            precio_oferta: null,
            en_oferta: false,
          },
        ],
        error: null,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/inventario?alertas=1&vencimiento=1");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].nombre).toBe("Producto Perecedero con Baja");
  });
});
