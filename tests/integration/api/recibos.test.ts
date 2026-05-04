import { GET } from "@/app/api/recibos/[ventaId]/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

describe("GET /api/recibos/[ventaId]", () => {
  const mockStoreId = "store-1";
  const mockVentaId = "venta-1";

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId });
  });

  it("genera HTML de recibo exitosamente", async () => {
    const mockVenta = {
      id: mockVentaId,
      store_id: mockStoreId,
      numero_comprobante: "20260417-ABC123D1",
      total: 25000,
      subtotal: 21008,
      descuento: 0,
      impuesto: 3992,
      estado: "pagada",
      created_at: "2026-04-17T10:00:00Z",
      clientes: {
        id: "client-1",
        nombre: "Juan Pérez",
        rut: "12345678-9",
        email: "juan@example.com",
        telefono: "+56912345678",
      },
      worker: { nombre: "Carlos" },
      venta_items: [
        {
          cantidad: 2,
          precio_unitario: 10500,
          subtotal: 21000,
          productos: { nombre: "Alimento Premium", sku: "ALI001" },
        },
      ],
    };

    const mockStore = {
      name: "Tienda El Mejor Alimento",
      rut: "98765432-1",
      email: "store@example.com",
      telefono: "+56223456789",
    };

    const mockPagos = [
      {
        id: "pago-1",
        metodo: "efectivo",
        monto: 25000,
        numero_transaccion: null,
        created_at: "2026-04-17T10:05:00Z",
      },
    ];

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
      order: jest.fn().mockReturnThis(),
    };

    let callCount = 0;
    chain.single.mockImplementation(function () {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ data: mockVenta, error: null });
      }
      if (callCount === 2) {
        return Promise.resolve({ data: mockStore, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    // Mock order para pagos
    const pagosChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: mockPagos, error: null }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "pagos") return pagosChain;
        return chain;
      }),
    });

    const req = new NextRequest(`http://localhost/api/recibos/${mockVentaId}`);
    const res = await GET(req, { params: { ventaId: mockVentaId } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.html).toBeTruthy();
    expect(data.html).toContain("20260417-ABC123D1");
    expect(data.html).toContain("Juan Pérez");
    expect(data.html).toContain("$25.000");
    expect(data.numeroComprobante).toBe("20260417-ABC123D1");
    expect(data.total).toBe(25000);
  });

  it("incluye múltiples métodos de pago en recibo", async () => {
    const mockVenta = {
      id: mockVentaId,
      store_id: mockStoreId,
      numero_comprobante: "20260417-ABC123D2",
      total: 20000,
      subtotal: 16806,
      descuento: 0,
      impuesto: 3194,
      estado: "pagada",
      created_at: "2026-04-17T10:00:00Z",
      clientes: {
        id: "client-2",
        nombre: "María González",
        rut: "98765432-1",
        email: null,
        telefono: null,
      },
      worker: null,
      venta_items: [],
    };

    const mockStore = {
      name: "Tienda Pets",
      rut: "11111111-1",
      email: "contact@pets.cl",
      telefono: "+56998765432",
    };

    const mockPagos = [
      {
        id: "pago-1",
        metodo: "efectivo",
        monto: 10000,
        numero_transaccion: null,
        created_at: "2026-04-17T10:05:00Z",
      },
      {
        id: "pago-2",
        metodo: "credito",
        monto: 10000,
        numero_transaccion: "000789456123",
        created_at: "2026-04-17T10:06:00Z",
      },
    ];

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };

    let callCount = 0;
    chain.single.mockImplementation(function () {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ data: mockVenta, error: null });
      }
      if (callCount === 2) {
        return Promise.resolve({ data: mockStore, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const pagosChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: mockPagos, error: null }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "pagos") return pagosChain;
        return chain;
      }),
    });

    const req = new NextRequest(`http://localhost/api/recibos/${mockVentaId}`);
    const res = await GET(req, { params: { ventaId: mockVentaId } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.html).toContain("Efectivo");
    expect(data.html).toContain("Credito");
    expect(data.html).toContain("000789456123");
  });

  it("retorna 400 sin ventaId", async () => {
    const req = new NextRequest("http://localhost/api/recibos/");
    const res = await GET(req, { params: { ventaId: "" } });
    expect(res.status).toBe(400);
  });

  it("retorna 404 si venta no existe", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest(`http://localhost/api/recibos/invalid-venta`);
    const res = await GET(req, { params: { ventaId: "invalid-venta" } });
    expect(res.status).toBe(404);
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(`http://localhost/api/recibos/${mockVentaId}`);
    const res = await GET(req, { params: { ventaId: mockVentaId } });
    expect(res.status).toBe(401);
  });

  it("HTML incluye información completa de venta", async () => {
    const mockVenta = {
      id: mockVentaId,
      store_id: mockStoreId,
      numero_comprobante: "20260417-TEST001",
      total: 50000,
      subtotal: 42016,
      descuento: 2100,
      impuesto: 7984,
      estado: "pagada",
      created_at: "2026-04-17T14:30:00Z",
      worker_clerk_id: null,
      clientes: {
        id: "client-3",
        nombre: "Empresa XYZ",
        rut: "77777777-7",
        email: "empresa@xyz.cl",
        telefono: "+56234567890",
      },
      venta_items: [
        {
          cantidad: 1,
          precio_unitario: 20000,
          subtotal: 20000,
          productos: { nombre: "Producto A", sku: "SKU-A" },
        },
        {
          cantidad: 2,
          precio_unitario: 11000,
          subtotal: 22000,
          productos: { nombre: "Producto B", sku: "SKU-B" },
        },
      ],
    };

    const mockStore = {
      name: "Mi Tienda",
      rut: "12345678-0",
      email: "info@mitienda.cl",
      telefono: "+56912345678",
    };

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };

    let callCount = 0;
    chain.single.mockImplementation(function () {
      callCount++;
      if (callCount === 1) return Promise.resolve({ data: mockVenta, error: null });
      if (callCount === 2) return Promise.resolve({ data: mockStore, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const pagosChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "pagos") return pagosChain;
        return chain;
      }),
    });

    const req = new NextRequest(`http://localhost/api/recibos/${mockVentaId}`);
    const res = await GET(req, { params: { ventaId: mockVentaId } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.html).toContain("Mi Tienda");
    expect(data.html).toContain("RUT: 12345678-0");
    expect(data.html).toContain("Empresa XYZ");
    expect(data.html).toContain("77777777-7");
    expect(data.html).toContain("Producto A");
    expect(data.html).toContain("Producto B");
    expect(data.html).toContain("$50.000");
    expect(data.html).toContain("Subtotal:");
    expect(data.html).toContain("Descuento:");
    expect(data.html).toContain("IVA (19%):");
  });
});
