import { GET, POST } from "@/app/api/ordenes-compra/route";
import { GET as GET_BY_ID, PATCH } from "@/app/api/ordenes-compra/[id]/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/contabilidad/generador-asientos");
jest.mock("@/lib/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn(() => ({ ipAddress: "127.0.0.1", userAgent: "test" })),
}));
jest.mock("@/lib/email");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";
import * as auditModule from "@/lib/audit";
import * as asientosModule from "@/lib/contabilidad/generador-asientos";
import * as emailModule from "@/lib/email";

describe("Órdenes de Compra API", () => {
  const mockStoreId = "a57ace69-a5f4-4089-83e9-04d92c27dd43";
  const mockOrden = {
    id: "a57ace69-a5f4-4089-83e9-04d92c27dd43",
    numero: "OC-20260424-ABC123",
    estado: "pendiente",
    total: 3800,
    fecha_estimada: "2026-05-01",
    created_at: "2026-04-24T10:00:00Z",
    proveedor_id: "d93cfe99-3abf-4255-8f5f-be40d3d452a0",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId, userId: "80e6c208-9e4c-40db-be09-f070a4c5b7a3" });
    (asientosModule.crearAsiento as jest.Mock).mockResolvedValue(undefined);
    (emailModule.sendOrdenCompraEmail as jest.Mock).mockResolvedValue(true);
    (emailModule.sendOrdenCompraCancelacionEmail as jest.Mock).mockResolvedValue(true);
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
        body: JSON.stringify({ proveedor_id: "d93cfe99-3abf-4255-8f5f-be40d3d452a0", items: [] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/ordenes-compra/[id] — recibir sin lotes", () => {
    it("funciona sin lotes (stock directo)", async () => {
      const ordenChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
      };
      (ordenChain as any).single = jest.fn().mockReturnThis();
      (ordenChain as any).then = function(resolve: any) {
        return resolve({ data: mockOrden, error: null });
      };

      const fromMock = jest.fn((table: string) => {
        if (table === "ordenes_compra") return ordenChain;
        if (table === "ordenes_compra_items") {
          return {
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: {}, error: null }); },
          };
        }
        if (table === "stock_movements") {
          return {
            insert: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: {}, error: null }); },
          };
        }
        if (table === "cuentas_pagar") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: null, error: null }); },
          };
        }
      });
      const rpcMock = jest.fn().mockResolvedValue({ data: null, error: null });

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: fromMock, rpc: rpcMock });

      const req = new NextRequest("http://localhost/api/ordenes-compra/a57ace69-a5f4-4089-83e9-04d92c27dd43", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recibir",
          items: [{ id: "df50e110-0482-4450-8745-42c54006d902", cantidad_recibida: 10, precio_unitario: 50, producto_id: "24ab45db-484f-4e24-9c22-fe9c0894e2b5" }],
        }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });
      expect(res.status).toBe(200);
      expect(rpcMock).toHaveBeenCalledWith("increment_stock", {
        p_producto_id: "24ab45db-484f-4e24-9c22-fe9c0894e2b5",
        p_cantidad: 10,
      });
    });

    // I-455 — REGRESIÓN (investigado a raíz del ticket Trello
    // 6a61a6136d3d8009490d7113): el incremento de stock sin fecha de
    // vencimiento debe ser atómico (RPC increment_stock), no un SELECT stock
    // + UPDATE stock=leído+cantidad en dos statements separados — ese patrón
    // pierde incrementos bajo dos recepciones concurrentes del mismo
    // producto. El fromMock de este test NO define un caso para la tabla
    // "productos": si el código volviera al patrón viejo (select/update
    // directo), fromMock("productos") devolvería undefined y el acceso a
    // .select() lanzaría un TypeError, fallando el test.
    it("I-455: REGRESIÓN — incremento de stock sin vencimiento usa RPC atómico increment_stock, no SELECT+UPDATE", async () => {
      const ordenChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
      };
      (ordenChain as any).single = jest.fn().mockReturnThis();
      (ordenChain as any).then = function(resolve: any) {
        return resolve({ data: mockOrden, error: null });
      };

      const fromMock = jest.fn((table: string) => {
        if (table === "ordenes_compra") return ordenChain;
        if (table === "ordenes_compra_items") {
          return {
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: {}, error: null }); },
          };
        }
        if (table === "stock_movements") {
          return {
            insert: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: {}, error: null }); },
          };
        }
        if (table === "cuentas_pagar") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: null, error: null }); },
          };
        }
        // Sin caso para "productos" a propósito — ver comentario del test.
      });
      const rpcMock = jest.fn().mockResolvedValue({ data: null, error: null });

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: fromMock, rpc: rpcMock });

      const req = new NextRequest("http://localhost/api/ordenes-compra/a57ace69-a5f4-4089-83e9-04d92c27dd43", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recibir",
          items: [{ id: "df50e110-0482-4450-8745-42c54006d902", cantidad_recibida: 5, precio_unitario: 20, producto_id: "24ab45db-484f-4e24-9c22-fe9c0894e2b5" }],
        }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });

      expect(res.status).toBe(200);
      expect(fromMock).not.toHaveBeenCalledWith("productos");
      expect(rpcMock).toHaveBeenCalledWith("increment_stock", {
        p_producto_id: "24ab45db-484f-4e24-9c22-fe9c0894e2b5",
        p_cantidad: 5,
      });
    });
  });

  describe("PATCH /api/ordenes-compra/[id] — recibir con lotes", () => {
    it("crea lote cuando se proporciona lotes[]", async () => {
      const itemsLoteInsert: any[] = [];

      const ordenChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
      };
      (ordenChain as any).single = jest.fn().mockReturnThis();
      (ordenChain as any).then = function(resolve: any) {
        return resolve({ data: mockOrden, error: null });
      };

      const fromMock = jest.fn((table: string) => {
        if (table === "ordenes_compra") return ordenChain;
        if (table === "ordenes_compra_items") {
          return {
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: {}, error: null }); },
          };
        }
        if (table === "lotes_producto") {
          return {
            insert: jest.fn().mockImplementation((data) => {
              itemsLoteInsert.push(data);
              return {
                select: jest.fn().mockReturnThis(),
                single: jest.fn().mockReturnThis(),
                then: function(resolve: any) {
                  return resolve({ data: { ...data, id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }, error: null });
                },
              };
            }),
          };
        }
        if (table === "productos") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            update: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: {}, error: null }); },
          };
        }
        if (table === "stock_movements") {
          return {
            insert: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: {}, error: null }); },
          };
        }
        if (table === "cuentas_pagar") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: null, error: null }); },
          };
        }
      });

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: fromMock });

      const req = new NextRequest("http://localhost/api/ordenes-compra/oc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recibir",
          items: [{
            id: "df50e110-0482-4450-8745-42c54006d902",
            cantidad_recibida: 20,
            precio_unitario: 100,
            producto_id: "6b63b917-9abb-466f-8b1b-a81c5329e199",
            fecha_vencimiento: "2026-12-31",
            numero_lote: "LOTE-A",
          }],
        }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });

      expect(res.status).toBe(200);
      expect(itemsLoteInsert.length).toBe(1);
      expect(itemsLoteInsert[0]).toMatchObject({
        producto_id: "6b63b917-9abb-466f-8b1b-a81c5329e199",
        cantidad_inicial: 20,
        cantidad_actual: 20,
        numero_lote: "LOTE-A",
        fecha_vencimiento: "2026-12-31",
      });
    });

    it("omite lote cuando cantidad_recibida = 0", async () => {
      const itemsLoteInsert: any[] = [];

      const ordenChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
      };
      (ordenChain as any).single = jest.fn().mockReturnThis();
      (ordenChain as any).then = function(resolve: any) {
        return resolve({ data: mockOrden, error: null });
      };

      const fromMock = jest.fn((table: string) => {
        if (table === "ordenes_compra") return ordenChain;
        if (table === "ordenes_compra_items") {
          return {
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: {}, error: null }); },
          };
        }
        if (table === "lotes_producto") {
          return {
            insert: jest.fn().mockImplementation((data) => {
              itemsLoteInsert.push(data);
              return {
                select: jest.fn().mockReturnThis(),
                single: jest.fn().mockReturnThis(),
                then: function(resolve: any) {
                  return resolve({ data: { ...data, id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }, error: null });
                },
              };
            }),
          };
        }
        if (table === "stock_movements") {
          return {
            insert: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: {}, error: null }); },
          };
        }
        if (table === "cuentas_pagar") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: null, error: null }); },
          };
        }
      });

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: fromMock });

      const req = new NextRequest("http://localhost/api/ordenes-compra/oc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recibir",
          items: [{
            id: "df50e110-0482-4450-8745-42c54006d902",
            cantidad_recibida: 0,
            precio_unitario: 0,
            producto_id: "6b63b917-9abb-466f-8b1b-a81c5329e199",
            fecha_vencimiento: "2026-12-31",
          }],
        }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });

      expect(res.status).toBe(200);
      expect(itemsLoteInsert.length).toBe(0);
    });

    it("retorna 500 si falla la creación del lote", async () => {
      const ordenChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
      };
      (ordenChain as any).single = jest.fn().mockReturnThis();
      (ordenChain as any).then = function(resolve: any) {
        return resolve({ data: mockOrden, error: null });
      };

      let lotesCalls = 0;
      const fromMock = jest.fn((table: string) => {
        if (table === "ordenes_compra") return ordenChain;
        if (table === "ordenes_compra_items") {
          return {
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: {}, error: null }); },
          };
        }
        if (table === "lotes_producto") {
          lotesCalls++;
          if (lotesCalls === 1) {
            // Count query for auto-numbering
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              then: function(resolve: any) { return resolve({ count: 1, error: null }); },
            };
          }
          // Insert query — simulate failure
          return {
            insert: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockReturnThis(),
            then: function(resolve: any) {
              return resolve({ data: null, error: { message: "FK violation" } });
            },
          };
        }
      });

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: fromMock });

      const req = new NextRequest("http://localhost/api/ordenes-compra/oc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recibir",
          items: [{
            id: "df50e110-0482-4450-8745-42c54006d902",
            cantidad_recibida: 5,
            precio_unitario: 100,
            producto_id: "6b63b917-9abb-466f-8b1b-a81c5329e199",
            fecha_vencimiento: "2026-12-31",
          }],
        }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("Error al crear lote");
    });
  });

  describe("PATCH /api/ordenes-compra/[id] — cambio de estado", () => {
    function makeOrdenUpdateChain(estadoResult: string) {
      return {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation((resolve: any) =>
          resolve({ data: { ...mockOrden, estado: estadoResult }, error: null })
        ),
      };
    }

    function makeProveedorChain(email: string | null) {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation((resolve: any) =>
          resolve({ data: { nombre: "Proveedor Test", email }, error: null })
        ),
      };
    }

    function makeStoreChain() {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation((resolve: any) =>
          resolve({ data: { name: "Mi Tienda", address: "Calle 123", resend_from_email: null }, error: null })
        ),
      };
    }

    it("schema inválido → 400", async () => {
      const req = new NextRequest("http://localhost/api/ordenes-compra/oc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "invalido" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });
      expect(res.status).toBe(400);
    });

    it("estado: 'recibida' vía PATCH simple → 400 (debe usar action:'recibir')", async () => {
      const req = new NextRequest("http://localhost/api/ordenes-compra/oc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "recibida" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/recibir/i);
    });

    // I-426: REGRESIÓN — el flujo "recibir" legítimo aceptaba precio_unitario=0
    // silenciosamente (z.number().nonnegative() en vez de exigir >0 cuando
    // cantidad_recibida>0), dejando la OC "recibida" con subtotal/total en $0.
    // Bug real confirmado en producción: OC-20260518-EFC839 y OC-20260505-D0EAE0
    // (precio_unitario=0.00, no NULL — por eso la migración 055, que solo
    // busca precio_unitario IS NULL, no las corrigió).
    it("I-426: REGRESIÓN — recibir con cantidad_recibida>0 y precio_unitario=0 → 400", async () => {
      const req = new NextRequest("http://localhost/api/ordenes-compra/a57ace69-a5f4-4089-83e9-04d92c27dd43", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recibir",
          items: [{ id: "df50e110-0482-4450-8745-42c54006d902", cantidad_recibida: 10, precio_unitario: 0, producto_id: "24ab45db-484f-4e24-9c22-fe9c0894e2b5" }],
        }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/precio_unitario/i);
    });

    // I-427: cantidad_recibida=0 (item no llegó en esta entrega parcial) no
    // requiere precio — no debe bloquear la recepción de los demás items.
    it("I-427: recibir con cantidad_recibida=0 y precio_unitario=0 → 200 (item no recibido, no requiere precio)", async () => {
      const ordenChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
      };
      (ordenChain as any).single = jest.fn().mockReturnThis();
      (ordenChain as any).then = function(resolve: any) {
        return resolve({ data: mockOrden, error: null });
      };

      const fromMock = jest.fn((table: string) => {
        if (table === "ordenes_compra") return ordenChain;
        if (table === "ordenes_compra_items") {
          return {
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: {}, error: null }); },
          };
        }
        if (table === "cuentas_pagar") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            then: function(resolve: any) { return resolve({ data: null, error: null }); },
          };
        }
      });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: fromMock });

      const req = new NextRequest("http://localhost/api/ordenes-compra/a57ace69-a5f4-4089-83e9-04d92c27dd43", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recibir",
          items: [{ id: "df50e110-0482-4450-8745-42c54006d902", cantidad_recibida: 0, precio_unitario: 0, producto_id: "24ab45db-484f-4e24-9c22-fe9c0894e2b5" }],
        }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });
      expect(res.status).toBe(200);
    });

    // I-442 — REGRESIÓN (ticket Trello 6a5f9af49b22d1d60a11747d): precio_unitario
    // acepta decimales (Zod solo exige nonnegative, no .int()) y antes de este
    // fix totalNeto no se redondeaba por ítem — el impuesto ya se redondeaba
    // (043e378) pero total = totalNeto + impuesto heredaba el decimal residual
    // de totalNeto. Bug real confirmado en producción: OC-20260329-E299AC
    // mostraba total "$1.503.077,1" en vez de "$1.503.077".
    it("I-442: recibir con precio_unitario decimal → subtotal/impuesto/total quedan en pesos enteros", async () => {
      type Resolver = (result: { data: unknown; error: null }) => unknown;

      let ordenUpdatePayload: Record<string, unknown> | null = null;
      const itemUpdates: Record<string, unknown>[] = [];

      const ordenChain: Record<string, unknown> = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn((data: Record<string, unknown>) => { ordenUpdatePayload = data; return ordenChain; }),
      };
      ordenChain.single = jest.fn().mockReturnThis();
      ordenChain.then = (resolve: Resolver) => resolve({ data: mockOrden, error: null });

      const fromMock = jest.fn((table: string) => {
        if (table === "ordenes_compra") return ordenChain;
        if (table === "ordenes_compra_items") {
          return {
            update: jest.fn((data: Record<string, unknown>) => {
              itemUpdates.push(data);
              return { eq: jest.fn().mockReturnThis(), then: (resolve: Resolver) => resolve({ data: {}, error: null }) };
            }),
          };
        }
        if (table === "stock_movements") {
          return {
            insert: jest.fn().mockReturnThis(),
            then: (resolve: Resolver) => resolve({ data: {}, error: null }),
          };
        }
        if (table === "cuentas_pagar") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            then: (resolve: Resolver) => resolve({ data: null, error: null }),
          };
        }
      });
      const rpcMock = jest.fn().mockResolvedValue({ data: null, error: null });

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: fromMock, rpc: rpcMock });

      const req = new NextRequest("http://localhost/api/ordenes-compra/a57ace69-a5f4-4089-83e9-04d92c27dd43", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recibir",
          items: [
            { id: "df50e110-0482-4450-8745-42c54006d902", cantidad_recibida: 3, precio_unitario: 100.33, producto_id: "24ab45db-484f-4e24-9c22-fe9c0894e2b5" },
            { id: "e1a1a1a1-0482-4450-8745-42c54006d903", cantidad_recibida: 2, precio_unitario: 50.5, producto_id: "24ab45db-484f-4e24-9c22-fe9c0894e2b6" },
          ],
        }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });

      expect(res.status).toBe(200);
      // subtotalItem redondeado por ítem: round(3*100.33)=301, round(2*50.5)=101
      expect(itemUpdates[0].subtotal).toBe(301);
      expect(itemUpdates[1].subtotal).toBe(101);

      const payload = ordenUpdatePayload as unknown as { subtotal: number; impuesto: number; total: number };
      expect(payload.subtotal).toBe(402);
      expect(Number.isInteger(payload.subtotal)).toBe(true);
      expect(Number.isInteger(payload.impuesto)).toBe(true);
      expect(Number.isInteger(payload.total)).toBe(true);
      expect(payload.total).toBe(payload.subtotal + payload.impuesto);
    });

    it("cancelar OC sin notificar_proveedor → 200, no envía email de cancelación", async () => {
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(makeOrdenUpdateChain("cancelada")),
      });

      const req = new NextRequest("http://localhost/api/ordenes-compra/oc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "cancelada" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });

      expect(res.status).toBe(200);
      expect(emailModule.sendOrdenCompraCancelacionEmail).not.toHaveBeenCalled();
    });

    it("cancelar OC con notificar_proveedor y proveedor tiene email → 200, envía email de cancelación", async () => {
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === "ordenes_compra") return makeOrdenUpdateChain("cancelada");
          if (table === "proveedores") return makeProveedorChain("prov@test.com");
          if (table === "stores") return makeStoreChain();
        }),
      });

      const req = new NextRequest("http://localhost/api/ordenes-compra/oc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "cancelada", notificar_proveedor: true }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });

      expect(res.status).toBe(200);
      expect(emailModule.sendOrdenCompraCancelacionEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "prov@test.com",
          proveedorNombre: "Proveedor Test",
          storeName: "Mi Tienda",
          orden: expect.objectContaining({ numero: mockOrden.numero }),
        })
      );
    });

    it("cancelar OC con notificar_proveedor pero sin email → 200, omite el envío silenciosamente", async () => {
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === "ordenes_compra") return makeOrdenUpdateChain("cancelada");
          if (table === "proveedores") return makeProveedorChain(null);
          if (table === "stores") return makeStoreChain();
        }),
      });

      const req = new NextRequest("http://localhost/api/ordenes-compra/oc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "cancelada", notificar_proveedor: true }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });

      expect(res.status).toBe(200);
      expect(emailModule.sendOrdenCompraCancelacionEmail).not.toHaveBeenCalled();
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
              id: "df50e110-0482-4450-8745-42c54006d902",
              cantidad_solicitada: 10,
              cantidad_recibida: null,
              precio_unitario: 100,
              subtotal: 1000,
              productos: { id: "24ab45db-484f-4e24-9c22-fe9c0894e2b5", nombre: "Producto A", sku: "SKU-A" },
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
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.items)).toBe(true);
    });
  });

  describe("PATCH /api/ordenes-compra/[id] — edit_items", () => {
    function makeOrdenBaseChain(estado: string) {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation((resolve: any) =>
          resolve({ data: { id: mockOrden.id, estado, numero: mockOrden.numero }, error: null })
        ),
      };
    }

    function makeItemsChain() {
      return {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation((resolve: any) =>
          resolve({ data: {}, error: null })
        ),
      };
    }

    it("retorna 400 si items está vacío", async () => {
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(makeItemsChain()),
      });

      const req = new NextRequest("http://localhost/api/ordenes-compra/oc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit_items", items: [] }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });
      expect(res.status).toBe(400);
    });

    it("edita items correctamente en OC pendiente", async () => {
      let capturedDelete = false;
      let capturedInsert: any[] = [];

      const fromMock = jest.fn((table: string) => {
        if (table === "ordenes_compra") return makeOrdenBaseChain("pendiente");
        if (table === "ordenes_compra_items") {
          return {
            delete: jest.fn(() => {
              capturedDelete = true;
              return { eq: jest.fn().mockReturnThis(), then: jest.fn().mockImplementation((resolve: any) => resolve({ data: {}, error: null })) };
            }),
            insert: jest.fn((data: any) => {
              capturedInsert = data;
              return { then: jest.fn().mockImplementation((resolve: any) => resolve({ data: {}, error: null })) };
            }),
            eq: jest.fn().mockReturnThis(),
          };
        }
      });

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: fromMock });

      const req = new NextRequest("http://localhost/api/ordenes-compra/oc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit_items",
          items: [
            { producto_id: "24ab45db-484f-4e24-9c22-fe9c0894e2b5", cantidad_solicitada: 15 },
            { nombre_nuevo: "Producto Nuevo", cantidad_solicitada: 3 },
          ],
        }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });

      expect(res.status).toBe(200);
      expect(capturedDelete).toBe(true);
      expect(capturedInsert).toHaveLength(2);
      expect(capturedInsert[0]).toMatchObject({ producto_id: "24ab45db-484f-4e24-9c22-fe9c0894e2b5", cantidad_solicitada: 15 });
      expect(capturedInsert[0]).toHaveProperty("precio_unitario", null);
      expect(capturedInsert[1]).toMatchObject({ nombre_nuevo: "Producto Nuevo", cantidad_solicitada: 3 });
    });

    it("retorna 400 si la OC no está pendiente", async () => {
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === "ordenes_compra") return makeOrdenBaseChain("enviada");
          if (table === "ordenes_compra_items") return makeItemsChain();
        }),
      });

      const req = new NextRequest("http://localhost/api/ordenes-compra/oc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit_items",
          items: [{ producto_id: "24ab45db-484f-4e24-9c22-fe9c0894e2b5", cantidad_solicitada: 5 }],
        }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "a57ace69-a5f4-4089-83e9-04d92c27dd43" }) });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("pendientes");
    });
  });
});

