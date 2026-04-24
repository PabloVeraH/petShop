import { GET, POST } from "@/app/api/ordenes-compra/route";
import { GET as GET_BY_ID } from "@/app/api/ordenes-compra/[id]/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/contabilidad/generador-asientos");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

describe("Órdenes de Compra API", () => {
  const mockStoreId = "store-1";
  const mockOrden = {
    id: "oc-1",
    numero: "OC-20260424-ABC123",
    estado: "pendiente",
    total: 3800,
    fecha_estimada: "2026-05-01",
    created_at: "2026-04-24T10:00:00Z",
    proveedor_id: "prov-1",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId, userId: "user-1" });
  });

  describe("GET /api/ordenes-compra", () => {
    it("retorna lista de todas las órdenes sin filtro", async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn(function() { return this; }),
      };
      (chain as any).then = function(resolve: any) {
        return resolve({ data: [mockOrden], error: null });
      };

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(chain),
      });

      const req = new NextRequest("http://localhost/api/ordenes-compra");
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("filtra órdenes por estado", async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn(function() { return this; }),
      };
      (chain as any).then = function(resolve: any) {
        return resolve({ data: [mockOrden], error: null });
      };

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(chain),
      });

      const req = new NextRequest("http://localhost/api/ordenes-compra?estado=pendiente");
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("filtra órdenes por proveedor_id", async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn(function() { return this; }),
      };
      (chain as any).then = function(resolve: any) {
        return resolve({ data: [mockOrden], error: null });
      };

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(chain),
      });

      const req = new NextRequest("http://localhost/api/ordenes-compra?proveedor_id=prov-1");
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe("POST /api/ordenes-compra", () => {
    it("retorna 400 si no hay items", async () => {
      const req = new NextRequest("http://localhost/api/ordenes-compra", {
        method: "POST",
        body: JSON.stringify({ proveedor_id: "prov-1", items: [] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/ordenes-compra/[id]", () => {
    it("retorna detalle de la orden con items", async () => {
      const ordenChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };
      (ordenChain as any).single = jest.fn(function() { return this; });
      (ordenChain as any).then = function(resolve: any) {
        return resolve({ data: mockOrden, error: null });
      };

      const itemsChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };
      (itemsChain as any).then = function(resolve: any) {
        return resolve({
          data: [
            {
              id: "item-1",
              cantidad_solicitada: 10,
              cantidad_recibida: null,
              precio_unitario: 100,
              subtotal: 1000,
              productos: { id: "prod-1", nombre: "Producto A", sku: "SKU-A" },
            },
          ],
          error: null,
        });
      };

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === "ordenes_compra") return ordenChain;
          if (table === "ordenes_compra_items") return itemsChain;
        }),
      });

      const req = new NextRequest("http://localhost/api/ordenes-compra/oc-1");
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: "oc-1" }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.items)).toBe(true);
    });
  });
});
