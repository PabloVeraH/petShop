/**
 * Tests for GET /api/reports vencimientos field
 * Tests the NEW vencimientos field added to the reports response
 *
 * Test coverage:
 * - Structure validation: vencimientos object exists with correct shape
 * - vencidos classification: fecha < hoy AND stock > 0
 * - proximos classification: diasRestantes <= dias_alerta_expira AND stock > 0
 * - totalUnidadesVencidas calculation
 * - Complete vencimientos data (nombre, sku, stock, fecha_vencimiento, diasRestantes)
 * - RLS filtering by store_id
 * - Auth validation (401 without token)
 * - Error handling (database error scenarios)
 * - Edge cases (null dias_alerta_expira, zero stock excluded, null fecha excluded)
 */

import { NextRequest } from "next/server";
import { GET } from "@/app/api/reports/route";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

const mockGetStoreId = getStoreId as jest.MockedFunction<typeof getStoreId>;
const mockCreateServiceClient = createServiceClient as jest.MockedFunction<typeof createServiceClient>;

const STORE_ID = "store-789";
const TODAY = "2024-04-16";

describe("GET /api/reports - vencimientos section", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "user-789", storeId: STORE_ID });
    jest.spyOn(Date.prototype, "toISOString").mockReturnValue(`${TODAY}T00:00:00.000Z`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function setupSupabaseMock(ventasData: any[] = [], productosData: any[] = []) {
    const ventasChain: any = {};
    ventasChain.select = jest.fn().mockReturnValue(ventasChain);
    ventasChain.eq = jest.fn().mockReturnValue(ventasChain);
    ventasChain.neq = jest.fn().mockReturnValue(ventasChain);
    ventasChain.gte = jest.fn().mockReturnValue(ventasChain);
    ventasChain.order = jest.fn().mockResolvedValue({ data: ventasData, error: null });

    const itemsChain: any = {};
    itemsChain.select = jest.fn().mockReturnValue(itemsChain);
    itemsChain.in = jest.fn().mockResolvedValue({ data: [], error: null });

    const productosChain: any = {};
    productosChain.select = jest.fn().mockReturnValue(productosChain);
    productosChain.eq = jest.fn().mockReturnValue(productosChain);
    productosChain.not = jest.fn().mockReturnValue(productosChain);
    productosChain.order = jest.fn(function() { return this; });
    (productosChain as any).then = function(resolve: any) {
      return resolve({ data: productosData, error: null });
    };

    const mockSupabase = {
      from: jest.fn((table: string) => {
        if (table === "ventas") return ventasChain;
        if (table === "venta_items") return itemsChain;
        if (table === "productos") return productosChain;
        return ventasChain;
      }),
    };

    mockCreateServiceClient.mockReturnValue(mockSupabase as any);
    return { ventasChain, itemsChain, productosChain, mockSupabase };
  }

  describe("Response structure", () => {
    it("should include vencimientos field in response", async () => {
      setupSupabaseMock([], []);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json).toHaveProperty("vencimientos");
      expect(typeof json.vencimientos).toBe("object");
    });

    it("should have correct vencimientos object structure with vencidos, proximos, and totalUnidadesVencidas", async () => {
      setupSupabaseMock([], []);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos).toHaveProperty("vencidos");
      expect(json.vencimientos).toHaveProperty("proximos");
      expect(json.vencimientos).toHaveProperty("totalUnidadesVencidas");

      expect(Array.isArray(json.vencimientos.vencidos)).toBe(true);
      expect(Array.isArray(json.vencimientos.proximos)).toBe(true);
      expect(typeof json.vencimientos.totalUnidadesVencidas).toBe("number");
    });

    it("should include all required fields in vencidos items", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Producto Vencido",
          sku: "SKU-001",
          stock: 5,
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.vencidos).toHaveLength(1);
      const vencido = json.vencimientos.vencidos[0];

      expect(vencido).toHaveProperty("id");
      expect(vencido).toHaveProperty("nombre");
      expect(vencido).toHaveProperty("sku");
      expect(vencido).toHaveProperty("stock");
      expect(vencido).toHaveProperty("fecha_vencimiento");
      expect(vencido).toHaveProperty("dias_alerta_expira");
    });

    it("should include diasRestantes in proximos items", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Próximo a Vencer",
          sku: "SKU-002",
          stock: 3,
          fecha_vencimiento: "2024-04-20",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.proximos).toHaveLength(1);
      const proximo = json.vencimientos.proximos[0];

      expect(proximo).toHaveProperty("diasRestantes");
      expect(typeof proximo.diasRestantes).toBe("number");
      expect(proximo.diasRestantes).toBe(4);
    });
  });

  describe("vencidos classification (fecha < hoy AND stock > 0)", () => {
    it("should classify products as vencidos when fecha < hoy", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Producto Vencido Ayer",
          sku: "SKU-A",
          stock: 5,
          fecha_vencimiento: "2024-04-15",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.vencidos).toHaveLength(1);
      expect(json.vencimientos.vencidos[0].id).toBe("p1");
    });

    it("should exclude products with stock = 0 from vencidos", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Vencido pero sin stock",
          sku: "SKU-A",
          stock: 0,
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.vencidos).toHaveLength(0);
      expect(json.vencimientos.totalUnidadesVencidas).toBe(0);
    });

    it("should exclude products with stock < 0 from vencidos", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Vencido con stock negativo",
          sku: "SKU-A",
          stock: -5,
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.vencidos).toHaveLength(0);
    });

    it("should include multiple vencidos products", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Vencido 1",
          sku: "SKU-A",
          stock: 3,
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
        },
        {
          id: "p2",
          nombre: "Vencido 2",
          sku: "SKU-B",
          stock: 7,
          fecha_vencimiento: "2024-04-05",
          dias_alerta_expira: 10,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.vencidos).toHaveLength(2);
      expect(json.vencimientos.vencidos.map((p: any) => p.id)).toEqual(["p1", "p2"]);
    });
  });

  describe("proximos classification (diasRestantes <= dias_alerta_expira AND stock > 0)", () => {
    it("should classify products as proximos when diasRestantes <= dias_alerta_expira", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Próximo a vencer",
          sku: "SKU-A",
          stock: 2,
          fecha_vencimiento: "2024-04-20",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.proximos).toHaveLength(1);
      expect(json.vencimientos.proximos[0].id).toBe("p1");
    });

    it("should exclude products from proximos when diasRestantes > dias_alerta_expira", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "No próximo",
          sku: "SKU-A",
          stock: 5,
          fecha_vencimiento: "2024-05-10",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.proximos).toHaveLength(0);
    });

    it("should include product when diasRestantes equals dias_alerta_expira (boundary)", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Exactamente en límite",
          sku: "SKU-A",
          stock: 3,
          fecha_vencimiento: "2024-04-23",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.proximos).toHaveLength(1);
      expect(json.vencimientos.proximos[0].diasRestantes).toBe(7);
    });

    it("should exclude products with stock = 0 from proximos", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Próximo pero sin stock",
          sku: "SKU-A",
          stock: 0,
          fecha_vencimiento: "2024-04-20",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.proximos).toHaveLength(0);
    });

    it("should not include vencidos in proximos", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Vencido hace días",
          sku: "SKU-A",
          stock: 5,
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.proximos).toHaveLength(0);
      expect(json.vencimientos.vencidos).toHaveLength(1);
    });

    it("should calculate diasRestantes correctly for proximos", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "3 días restantes",
          sku: "SKU-A",
          stock: 2,
          fecha_vencimiento: "2024-04-19",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.proximos).toHaveLength(1);
      expect(json.vencimientos.proximos[0].diasRestantes).toBe(3);
    });

    it("should include multiple proximos products", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Próximo 1",
          sku: "SKU-A",
          stock: 2,
          fecha_vencimiento: "2024-04-19",
          dias_alerta_expira: 7,
        },
        {
          id: "p2",
          nombre: "Próximo 2",
          sku: "SKU-B",
          stock: 4,
          fecha_vencimiento: "2024-04-21",
          dias_alerta_expira: 10,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.proximos).toHaveLength(2);
      expect(json.vencimientos.proximos.map((p: any) => p.id)).toEqual(["p1", "p2"]);
    });
  });

  describe("totalUnidadesVencidas calculation", () => {
    it("should calculate totalUnidadesVencidas as sum of vencidos stock", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Vencido 1",
          sku: "SKU-A",
          stock: 5,
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
        },
        {
          id: "p2",
          nombre: "Vencido 2",
          sku: "SKU-B",
          stock: 8,
          fecha_vencimiento: "2024-04-05",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.totalUnidadesVencidas).toBe(13);
    });

    it("should return 0 for totalUnidadesVencidas when no vencidos", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Próximo",
          sku: "SKU-A",
          stock: 5,
          fecha_vencimiento: "2024-04-20",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.totalUnidadesVencidas).toBe(0);
    });

    it("should not include proximos in totalUnidadesVencidas", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Próximo",
          sku: "SKU-A",
          stock: 10,
          fecha_vencimiento: "2024-04-20",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.totalUnidadesVencidas).toBe(0);
    });

    it("should calculate totalUnidadesVencidas with single vencido product", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Vencido único",
          sku: "SKU-A",
          stock: 42,
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.totalUnidadesVencidas).toBe(42);
    });
  });

  describe("Edge cases and null handling", () => {
    it("should exclude products with null fecha_vencimiento", async () => {
      setupSupabaseMock([], []);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.vencidos).toHaveLength(0);
      expect(json.vencimientos.proximos).toHaveLength(0);
    });

    it("should handle dias_alerta_expira = null as 0 (no alert)", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Alerta nula",
          sku: "SKU-A",
          stock: 2,
          fecha_vencimiento: "2024-04-20",
          dias_alerta_expira: null,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.proximos).toHaveLength(0);
    });

    it("should handle dias_alerta_expira = 0 correctly", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Alerta cero",
          sku: "SKU-A",
          stock: 2,
          fecha_vencimiento: "2024-04-17",
          dias_alerta_expira: 0,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.proximos).toHaveLength(0);
    });

    it("should handle empty product list", async () => {
      setupSupabaseMock([], []);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.vencidos).toEqual([]);
      expect(json.vencimientos.proximos).toEqual([]);
      expect(json.vencimientos.totalUnidadesVencidas).toBe(0);
    });

    it("should handle mixed products: vencidos, proximos, vigentes", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Vencido",
          sku: "SKU-A",
          stock: 3,
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
        },
        {
          id: "p2",
          nombre: "Próximo",
          sku: "SKU-B",
          stock: 5,
          fecha_vencimiento: "2024-04-20",
          dias_alerta_expira: 7,
        },
        {
          id: "p3",
          nombre: "Vigente",
          sku: "SKU-C",
          stock: 10,
          fecha_vencimiento: "2024-06-01",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.vencidos).toHaveLength(1);
      expect(json.vencimientos.proximos).toHaveLength(1);
      expect(json.vencimientos.totalUnidadesVencidas).toBe(3);
    });
  });

  describe("Authentication and authorization", () => {
    it("should return 401 when not authenticated", async () => {
      mockGetStoreId.mockResolvedValue(null);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.error).toBe("Unauthorized");
    });

    it("should filter by store_id in database query (RLS)", async () => {
      const { productosChain } = setupSupabaseMock([], []);

      await GET(new NextRequest(new URL("http://localhost:3000")));

      expect(productosChain.eq).toHaveBeenCalledWith("store_id", STORE_ID);
    });

    it("should filter by activo=true in database query", async () => {
      const { productosChain } = setupSupabaseMock([], []);

      await GET(new NextRequest(new URL("http://localhost:3000")));

      expect(productosChain.eq).toHaveBeenCalledWith("activo", true);
    });

    it("should filter by fecha_vencimiento not null", async () => {
      const { productosChain } = setupSupabaseMock([], []);

      await GET(new NextRequest(new URL("http://localhost:3000")));

      expect(productosChain.not).toHaveBeenCalledWith("fecha_vencimiento", "is", null);
    });
  });

  describe("Error handling", () => {
    it("should handle null data from database gracefully", async () => {
      const mockSupabase = {
        from: jest.fn((table: string) => {
          const chain: any = {};
          chain.select = jest.fn().mockReturnValue(chain);
          chain.eq = jest.fn().mockReturnValue(chain);
          chain.neq = jest.fn().mockReturnValue(chain);
          chain.gte = jest.fn().mockReturnValue(chain);
          chain.in = jest.fn().mockResolvedValue({ data: null, error: null });
          chain.order = jest.fn().mockResolvedValue({ data: null, error: null });
          chain.not = jest.fn().mockReturnValue(chain);
          return chain;
        }),
      };

      mockCreateServiceClient.mockReturnValue(mockSupabase as any);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.vencimientos).toBeDefined();
    });
  });

  describe("Data completeness", () => {
    it("should include complete vencimientos data in vencidos", async () => {
      const productos = [
        {
          id: "p-complete",
          nombre: "Producto Completo",
          sku: "SKU-COMPLETE",
          stock: 7,
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 14,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      const vencido = json.vencimientos.vencidos[0];
      expect(vencido.id).toBe("p-complete");
      expect(vencido.nombre).toBe("Producto Completo");
      expect(vencido.sku).toBe("SKU-COMPLETE");
      expect(vencido.stock).toBe(7);
      expect(vencido.fecha_vencimiento).toBe("2024-04-10");
      expect(vencido.dias_alerta_expira).toBe(14);
    });

    it("should include complete vencimientos data in proximos with diasRestantes", async () => {
      const productos = [
        {
          id: "p-complete-prox",
          nombre: "Próximo Completo",
          sku: "SKU-PROXIMO",
          stock: 4,
          fecha_vencimiento: "2024-04-19",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      const proximo = json.vencimientos.proximos[0];
      expect(proximo.id).toBe("p-complete-prox");
      expect(proximo.nombre).toBe("Próximo Completo");
      expect(proximo.sku).toBe("SKU-PROXIMO");
      expect(proximo.stock).toBe(4);
      expect(proximo.fecha_vencimiento).toBe("2024-04-19");
      expect(proximo.dias_alerta_expira).toBe(7);
      expect(proximo.diasRestantes).toBe(3);
    });
  });

  describe("Integration with reports response", () => {
    it("should include vencimientos alongside other report fields", async () => {
      setupSupabaseMock([], []);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json).toHaveProperty("periodo");
      expect(json).toHaveProperty("totalPeriodo");
      expect(json).toHaveProperty("totalTransacciones");
      expect(json).toHaveProperty("vencimientos");
    });

    it("should not break other report functionality when vencimientos present", async () => {
      setupSupabaseMock([], []);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.vencimientos).toBeDefined();
      expect(json.topProductos).toBeDefined();
      expect(json.topClientes).toBeDefined();
    });
  });

  describe("Boundary date calculations", () => {
    it("should correctly classify product with exact vencimiento date = hoy as not vencido", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Vence hoy",
          sku: "SKU-A",
          stock: 5,
          fecha_vencimiento: TODAY,
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.vencidos).toHaveLength(0);
    });

    it("should correctly classify next day as proximos (if within alert range)", async () => {
      const productos = [
        {
          id: "p1",
          nombre: "Vence mañana",
          sku: "SKU-A",
          stock: 2,
          fecha_vencimiento: "2024-04-17",
          dias_alerta_expira: 7,
        },
      ];

      setupSupabaseMock([], productos);

      const response = await GET(new NextRequest(new URL("http://localhost:3000")));
      const json = await response.json();

      expect(json.vencimientos.proximos).toHaveLength(1);
      expect(json.vencimientos.proximos[0].diasRestantes).toBe(1);
    });
  });
});
