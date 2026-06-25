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
      descuento: 5,       // porcentaje (5%)
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
    expect(data.html).toContain("Subtotal (c/IVA):");
    expect(data.html).toContain("Descuento (5%):");
    expect(data.html).toContain("Neto (sin IVA):");
    expect(data.html).toContain("IVA (19%):");
  });

  // REGRESIÓN: sin descuento el recibo muestra Neto y no confunde Subtotal = Total
  it("I-REC-11: sin descuento el recibo muestra 'Neto (sin IVA)' correcto y no duplica TOTAL como Subtotal", async () => {
    // total=$34.918 con IVA incluido → neto=$29.343, iva=$5.575
    const mockVenta = {
      id: mockVentaId,
      store_id: mockStoreId,
      numero_comprobante: "20260624-NETO001",
      subtotal: 34918, // precio con IVA (igual al total cuando no hay descuento)
      descuento: 0,
      impuesto: 5575,  // round(34918 * 19/119)
      total: 34918,
      estado: "pagada",
      created_at: "2026-06-24T10:00:00Z",
      worker_clerk_id: null,
      clientes: null,
      venta_items: [
        { cantidad: 1, precio_unitario: 34918, subtotal: 34918, productos: { nombre: "Alimento Royal Canin 4kg", sku: "RC4K" } },
      ],
    };
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
      order: jest.fn().mockReturnThis(),
    };
    let callCount = 0;
    chain.single.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ data: mockVenta, error: null });
      if (callCount === 2) return Promise.resolve({ data: { name: "PetShop", rut: null }, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const pagosChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [{ id: "p1", metodo: "efectivo", monto: 34918, numero_transaccion: null, created_at: "2026-06-24T10:00:00Z" }], error: null }),
    };
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => table === "pagos" ? pagosChain : chain),
    });

    const req = new NextRequest(`http://localhost/api/recibos/${mockVentaId}`);
    const res = await GET(req, { params: { ventaId: mockVentaId } });
    const data = await res.json();

    expect(res.status).toBe(200);
    // Debe mostrar neto = 34918 - 5575 = 29343
    expect(data.html).toContain("Neto (sin IVA):");
    expect(data.html).toContain("$29.343");
    expect(data.html).toContain("IVA (19%):");
    expect(data.html).toContain("$5.575");
    expect(data.html).toContain("$34.918");
    // Sin descuento NO debe aparecer "Subtotal (c/IVA):"
    expect(data.html).not.toContain("Subtotal (c/IVA):");
  });

  // REGRESIÓN: con descuento el recibo muestra Subtotal, Descuento, Neto y Total consistentes
  it("I-REC-12: con descuento el recibo muestra subtotal c/IVA, descuento, neto y total coherentes", async () => {
    // subtotal=$38.000, 10% desc → total=$34.200, impuesto=5.461, neto=28.739
    const mockVenta = {
      id: mockVentaId,
      store_id: mockStoreId,
      numero_comprobante: "20260624-DESC002",
      subtotal: 38000, // precio con IVA antes del descuento
      descuento: 10,
      impuesto: 5461,  // round(34200 * 19/119)
      total: 34200,    // round(38000 * 0.9)
      estado: "pagada",
      created_at: "2026-06-24T10:00:00Z",
      worker_clerk_id: null,
      clientes: null,
      venta_items: [
        { cantidad: 1, precio_unitario: 38000, subtotal: 38000, productos: { nombre: "Cama Deluxe XL", sku: "CDX" } },
      ],
    };
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
      order: jest.fn().mockReturnThis(),
    };
    let callCount = 0;
    chain.single.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ data: mockVenta, error: null });
      if (callCount === 2) return Promise.resolve({ data: { name: "PetShop", rut: null }, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const pagosChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [{ id: "p1", metodo: "debito", monto: 34200, numero_transaccion: "TRX123", created_at: "2026-06-24T10:00:00Z" }], error: null }),
    };
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => table === "pagos" ? pagosChain : chain),
    });

    const req = new NextRequest(`http://localhost/api/recibos/${mockVentaId}`);
    const res = await GET(req, { params: { ventaId: mockVentaId } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.html).toContain("Subtotal (c/IVA):");
    expect(data.html).toContain("$38.000");
    expect(data.html).toContain("Descuento (10%):");
    expect(data.html).toContain("$3.800"); // 38000 * 10/100
    expect(data.html).toContain("Neto (sin IVA):");
    expect(data.html).toContain("$28.739"); // 34200 - 5461
    expect(data.html).toContain("IVA (19%):");
    expect(data.html).toContain("$5.461");
    expect(data.html).toContain("$34.200"); // TOTAL
  });

  // REGRESIÓN: descuento almacenado como porcentaje debe mostrarse como monto en pesos
  it("I-REC-10: descuento 10% sobre $44.800 muestra '(10%)' y '-$4.480' en el HTML, no '-$10'", async () => {
    const mockVenta = {
      id: mockVentaId,
      store_id: mockStoreId,
      numero_comprobante: "20260620-DESC001",
      subtotal: 44800,
      descuento: 10,       // porcentaje en DB
      impuesto: 7654,
      total: 40320,        // 44800 × 0.9
      estado: "pagada",
      created_at: "2026-06-20T10:00:00Z",
      clientes: null,
      worker: null,
      venta_items: [
        { cantidad: 1, precio_unitario: 44800, subtotal: 44800, productos: { nombre: "Alimento Pro Plan 3kg", sku: "PP3K" } },
      ],
    };

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
      order: jest.fn().mockReturnThis(),
    };
    let callCount = 0;
    chain.single.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ data: mockVenta, error: null });
      if (callCount === 2) return Promise.resolve({ data: { name: "PetShop", rut: null }, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const pagosChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [{ id: "p1", metodo: "efectivo", monto: 40320, numero_transaccion: null, created_at: "2026-06-20T10:00:00Z" }], error: null }),
    };
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => table === "pagos" ? pagosChain : chain),
    });

    const req = new NextRequest(`http://localhost/api/recibos/${mockVentaId}`);
    const res = await GET(req, { params: { ventaId: mockVentaId } });
    const data = await res.json();

    expect(res.status).toBe(200);
    // Label debe incluir el porcentaje
    expect(data.html).toContain("Descuento (10%):");
    // Monto debe ser pesos: 44800 × 10% = 4480
    expect(data.html).toContain("$4.480");
    // NO debe aparecer como si 10 fuera pesos
    expect(data.html).not.toContain(">-$10<");
  });
});
