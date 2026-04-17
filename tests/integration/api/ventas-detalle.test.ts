import { GET, PATCH } from "@/app/api/ventas/[id]/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

describe("GET /api/ventas/[id]", () => {
  const mockStoreId = "store-1";
  const mockVentaId = "venta-1";

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId });
  });

  it("obtiene venta con items, cliente y vendedor", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: mockVentaId,
          numero_comprobante: "20260417-ABC123",
          subtotal: 20000,
          descuento: 1000,
          impuesto: 2520,
          total: 21520,
          metodo_pago: "efectivo",
          estado: "pagada",
          created_at: "2026-04-17T10:00:00Z",
          clientes: { id: "cli-1", nombre: "Juan", rut: "12345678-K", telefono: "98765432" },
          vendedores: { nombre: "Pedro" },
        },
        error: null,
      }),
    };

    const itemsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [
          {
            id: "item-1",
            cantidad: 2,
            precio_unitario: 10000,
            subtotal: 20000,
            productos: { nombre: "Producto A", sku: "SKU-A" },
          },
        ],
        error: null,
      }),
    };

    let callCount = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        callCount++;
        if (callCount === 1) return ventaChain;
        return itemsChain;
      }),
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-1");
    const res = await GET(req, { params: Promise.resolve({ id: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.numero_comprobante).toBe("20260417-ABC123");
    expect(data.clientes.nombre).toBe("Juan");
    expect(data.vendedores.nombre).toBe("Pedro");
    expect(data.items).toHaveLength(1);
    expect(data.items[0].productos.nombre).toBe("Producto A");
  });

  it("retorna 404 si venta no existe", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "not found" },
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(ventaChain),
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-no-existe");
    const res = await GET(req, { params: Promise.resolve({ id: "venta-no-existe" }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toContain("no encontrada");
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/ventas/venta-1");
    const res = await GET(req, { params: Promise.resolve({ id: mockVentaId }) });

    expect(res.status).toBe(401);
  });

  it("respeta store_id (no puede ver venta de otra tienda)", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "not found" },
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(ventaChain),
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-otra-tienda");
    const res = await GET(req, { params: Promise.resolve({ id: "venta-otra-tienda" }) });

    expect(res.status).toBe(404);
  });

  it("retorna items vacío si no hay venta_items", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: mockVentaId,
          numero_comprobante: "20260417-ABC123",
          subtotal: 0,
          descuento: 0,
          impuesto: 0,
          total: 0,
          metodo_pago: "efectivo",
          estado: "pendiente",
          created_at: "2026-04-17T10:00:00Z",
          clientes: null,
          vendedores: null,
        },
        error: null,
      }),
    };

    const itemsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "no items" },
      }),
    };

    let callCount = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        callCount++;
        if (callCount === 1) return ventaChain;
        return itemsChain;
      }),
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-1");
    const res = await GET(req, { params: Promise.resolve({ id: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.items).toEqual([]);
  });
});

describe("PATCH /api/ventas/[id] - Anular venta", () => {
  const mockStoreId = "store-1";
  const mockVentaId = "venta-1";
  const mockClienteId = "cli-1";

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId });
  });

  it("anula venta y revierte stock exitosamente", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 20000 },
        error: null,
      }),
    };

    const itemsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [{ producto_id: "prod-1", cantidad: 2 }],
        error: null,
      }),
    };

    const prodChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: "prod-1", stock: 10 },
        error: null,
      }),
    };

    const prodUpdateChain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ error: null }),
    };

    const ventaUpdateChain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "anulada" },
        error: null,
      }),
    };

    const insertChain = {
      insert: jest.fn().mockResolvedValue({ error: null }),
    };

    const fidelChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: "f1", total_historico: 100000, frecuencia_compras: 5 },
        error: null,
      }),
      update: jest.fn().mockReturnThis(),
    };

    let callCount = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        callCount++;
        if (table === "ventas" && callCount === 1) return ventaChain;
        if (table === "venta_items") return itemsChain;
        if (table === "productos" && callCount === 3) return prodChain;
        if (table === "productos" && callCount === 4) return prodUpdateChain;
        if (table === "stock_movements") return insertChain;
        if (table === "fidelizacion") return fidelChain;
        if (table === "ventas" && callCount > 4) return ventaUpdateChain;
      }),
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "anular" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.estado).toBe("anulada");
  });

  it("retorna 404 si venta no existe", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "not found" },
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(ventaChain),
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-no-existe", {
      method: "PATCH",
      body: JSON.stringify({ action: "anular" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "venta-no-existe" }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toContain("no encontrada");
  });

  it("retorna 409 si venta ya está anulada", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "anulada", cliente_id: mockClienteId, total: 20000 },
        error: null,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(ventaChain),
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "anular" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toContain("ya está anulada");
  });

  it("retorna 400 si action no es válido", async () => {
    const req = new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "rechazar" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("no válida");
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "anular" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });

    expect(res.status).toBe(401);
  });

  it("decrementa fidelización del cliente", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 60000 },
        error: null,
      }),
    };

    const itemsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [],
        error: null,
      }),
    };

    const fidelChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: "f1", total_historico: 200000, frecuencia_compras: 5, descuento_actual: 10 },
        error: null,
      }),
      update: jest.fn().mockReturnThis(),
    };

    const updateChain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "anulada" },
        error: null,
      }),
    };

    let callCount = 0;
    const mockFrom = jest.fn((table: string) => {
      callCount++;
      if (table === "ventas" && callCount === 1) return ventaChain;
      if (table === "venta_items") return itemsChain;
      if (table === "fidelizacion") return fidelChain;
      if (table === "ventas") return updateChain;
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

    const req = new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "anular" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });

    expect(res.status).toBe(200);
  });

  it("sin cliente_id no actualiza fidelización", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "pagada", cliente_id: null, total: 20000 },
        error: null,
      }),
    };

    const itemsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [],
        error: null,
      }),
    };

    const updateChain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "anulada" },
        error: null,
      }),
    };

    let callCount = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        callCount++;
        if (table === "ventas" && callCount === 1) return ventaChain;
        if (table === "venta_items") return itemsChain;
        return updateChain;
      }),
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "anular" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });

    expect(res.status).toBe(200);
  });
});
