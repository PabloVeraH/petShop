import { GET as GET_BY_ID, PATCH } from "@/app/api/proveedores/[id]/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

describe("Proveedores API [id] Endpoints", () => {
  const mockStoreId = "store-1";
  const mockProveedor = { id: "prov-1", nombre: "ACME Supply", rut: "12.345.678-9", contacto: "John", telefono: "+56912345678", email: "john@acme.com" };

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId, userId: "user-1" });
  });

  describe("GET /api/proveedores/[id]", () => {
    it("retorna detalle del proveedor con productos", async () => {
      const provChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };
      (provChain as any).single = jest.fn(function() { return this; });
      (provChain as any).then = function(resolve: any) {
        return resolve({ data: mockProveedor, error: null });
      };

      const prodChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };
      (prodChain as any).then = function(resolve: any) {
        return resolve({ data: [], error: null });
      };

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === "proveedores") return provChain;
          if (table === "proveedor_productos") return prodChain;
        }),
      });

      const req = new NextRequest("http://localhost/api/proveedores/prov-1");
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: "prov-1" }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.nombre).toBe("ACME Supply");
    });
  });

  describe("PATCH /api/proveedores/[id]", () => {
    it("actualiza datos del proveedor correctamente", async () => {
      const checkChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };
      (checkChain as any).single = jest.fn(function() { return this; });
      (checkChain as any).then = function(resolve: any) {
        return resolve({ data: { id: "prov-1" }, error: null });
      };

      const updateChain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
      };
      (updateChain as any).single = jest.fn(function() { return this; });
      (updateChain as any).then = function(resolve: any) {
        return resolve({ data: { ...mockProveedor, nombre: "ACME Supply Updated" }, error: null });
      };

      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === "proveedores") {
            if (callCount === 0) { callCount++; return checkChain; }
            return updateChain;
          }
        }),
      });

      const req = new NextRequest("http://localhost/api/proveedores/prov-1", {
        method: "PATCH",
        body: JSON.stringify({ nombre: "ACME Supply Updated" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "prov-1" }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.nombre).toBe("ACME Supply Updated");
    });

    it("retorna 404 si proveedor no existe", async () => {
      const checkChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };
      (checkChain as any).single = jest.fn(function() { return this; });
      (checkChain as any).then = function(resolve: any) {
        return resolve({ data: null, error: null });
      };

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(checkChain),
      });

      const req = new NextRequest("http://localhost/api/proveedores/nonexistent", {
        method: "PATCH",
        body: JSON.stringify({ nombre: "Test" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "nonexistent" }) });

      expect(res.status).toBe(404);
    });
  });
});
