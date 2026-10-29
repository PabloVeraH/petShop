import { GET } from "@/app/api/recibos/[ventaId]/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
// Sesión de Clerk (admin-check real): storeAdmin de la tienda por defecto.
const ADMIN_CLAIMS = { sub: "user-1", publicMetadata: { storeId: "store-1", storeAdmin: true } };
let mockClaims: Record<string, unknown> = ADMIN_CLAIMS;
jest.mock("@clerk/nextjs/server", () => ({ auth: () => Promise.resolve({ sessionClaims: mockClaims }) }));
// usuarioDeshabilitado lo consulta autorizarCanales: usuario habilitado por defecto.
const mockDeshabilitado = jest.fn().mockResolvedValue(false);
jest.mock("@/lib/usuario-habilitado", () => ({ usuarioDeshabilitado: (...a: unknown[]) => mockDeshabilitado(...a) }));
// registrarConsulta se observa (su INSERT se prueba en tests/unit/lib/audit-registro.test.ts).
const mockRegistrarConsulta = jest.fn();
jest.mock("@/lib/audit", () => ({
  ...jest.requireActual("@/lib/audit"),
  registrarConsulta: (...a: unknown[]) => mockRegistrarConsulta(...a),
}));

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

describe("GET /api/recibos/[ventaId]", () => {
  const mockStoreId = "store-1";
  const mockVentaId = "venta-1";

  beforeEach(() => {
    jest.clearAllMocks();
    mockClaims = ADMIN_CLAIMS;
    mockDeshabilitado.mockResolvedValue(false);
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId, userId: "user-1" });
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
    const res = await GET(req, { params: Promise.resolve({ ventaId: mockVentaId }) });
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

  it("I-765: generar el recibo queda registrado como consulta (VIEW) de esa venta y de quien lo pidió", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId, userId: "user-1" });
    const venta = {
      id: mockVentaId, store_id: mockStoreId, numero_comprobante: "20260417-ABC123D1",
      total: 1000, subtotal: 840, descuento: 0, impuesto: 160, estado: "pagada",
      created_at: "2026-04-17T10:00:00Z", clientes: null, worker_clerk_id: null,
      venta_items: [{ cantidad: 1, precio_unitario: 1000, subtotal: 1000, productos: { nombre: "Snack", sku: "S1" } }],
    };
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn()
        .mockResolvedValueOnce({ data: venta, error: null })
        .mockResolvedValue({ data: { name: "Tienda" }, error: null }),
    };
    const pagosChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => (table === "pagos" ? pagosChain : chain)),
    });

    const req = new NextRequest(`http://localhost/api/recibos/${mockVentaId}`);
    const res = await GET(req, { params: Promise.resolve({ ventaId: mockVentaId }) });

    expect(res.status).toBe(200);
    expect(mockRegistrarConsulta).toHaveBeenCalledTimes(1);
    expect(mockRegistrarConsulta).toHaveBeenCalledWith(req, expect.objectContaining({
      storeId: mockStoreId,
      userId: "user-1",
      entityType: "venta",
      entityId: mockVentaId,
    }));
  });

  // I-754 — REGRESIÓN: toLocaleDateString/TimeString sin timeZone usaban el
  // huso del servidor (UTC en Vercel): una venta de las 22:30 de Chile salía
  // impresa el día siguiente a la 01:30. created_at llega de la BD sin zona
  // (timestamp without time zone en UTC).
  it("I-754: el recibo muestra fecha y hora de Chile de la venta", async () => {
    const venta = {
      id: mockVentaId, store_id: mockStoreId, numero_comprobante: "20261022-NOCHE001",
      total: 1000, subtotal: 840, descuento: 0, impuesto: 160, estado: "completada",
      created_at: "2026-10-23T01:30:00.123456",
      clientes: null, worker: null,
      venta_items: [{ cantidad: 1, precio_unitario: 1000, subtotal: 1000, productos: { nombre: "Snack", sku: "S1" } }],
    };
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn()
        .mockResolvedValueOnce({ data: venta, error: null })
        .mockResolvedValue({ data: { name: "Tienda" }, error: null }),
    };
    const pagosChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => (table === "pagos" ? pagosChain : chain)),
    });

    const res = await GET(new NextRequest(`http://localhost/api/recibos/${mockVentaId}`), { params: Promise.resolve({ ventaId: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.html).toContain("22-10-2026");
    expect(data.html).toMatch(/10:30:00/); // es-CL: "10:30:00 p. m."
    expect(data.html).not.toContain("23-10-2026");
    expect(data.html).not.toMatch(/0?1:30:00/);
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
    const res = await GET(req, { params: Promise.resolve({ ventaId: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.html).toContain("Efectivo");
    expect(data.html).toContain("Credito");
    expect(data.html).toContain("000789456123");
  });

  it("retorna 400 sin ventaId", async () => {
    const req = new NextRequest("http://localhost/api/recibos/");
    const res = await GET(req, { params: Promise.resolve({ ventaId: "" }) });
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
    const res = await GET(req, { params: Promise.resolve({ ventaId: "invalid-venta" }) });
    expect(res.status).toBe(404);
    expect(mockRegistrarConsulta).not.toHaveBeenCalled();
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(`http://localhost/api/recibos/${mockVentaId}`);
    const res = await GET(req, { params: Promise.resolve({ ventaId: mockVentaId }) });
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
    const res = await GET(req, { params: Promise.resolve({ ventaId: mockVentaId }) });
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
    expect(data.html).toContain("$35.308");     // 42016 / 1.19 = 35308
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
    const res = await GET(req, { params: Promise.resolve({ ventaId: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    // Debe mostrar neto = 34918 - 5575 = 29343
    expect(data.html).toContain("Neto (sin IVA):");
    expect(data.html).toContain("$29.343");
    expect(data.html).toContain("IVA (19%):");
    expect(data.html).toContain("$5.575");
    expect(data.html).toContain("$34.918");
    // Sin descuento NO debe aparecer "Subtotal:" (solo se muestra con descuento)
    expect(data.html).not.toContain("Subtotal:");
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
    const res = await GET(req, { params: Promise.resolve({ ventaId: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.html).toContain("Subtotal:");
    expect(data.html).toContain("$31.933"); // 38000 / 1.19 = 31933
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
    const res = await GET(req, { params: Promise.resolve({ ventaId: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    // Label debe incluir el porcentaje
    expect(data.html).toContain("Descuento (10%):");
    // Monto debe ser pesos: 44800 × 10% = 4480
    expect(data.html).toContain("$4.480");
    // NO debe aparecer como si 10 fuera pesos
    expect(data.html).not.toContain(">-$10<");
  });

  // I-735 — REGRESIÓN: el recibo pedía `telefono` y `whatsapp_phone`, columnas
  // que no existen en `stores`; PostgREST rechaza la consulta, `store` queda
  // null y el recibo salía con "Tienda" / "RUT: N/A". El mock de `stores`
  // emula ese rechazo ante columnas inexistentes.
  it("I-735: el recibo muestra nombre, RUT y dirección reales de la tienda", async () => {
    // Columnas reales de stores relevantes (information_schema, 2026-10-11)
    const COLUMNAS_STORES = new Set(["id", "name", "rut", "address", "phone", "email", "direccion", "ciudad"]);
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: mockVentaId, store_id: mockStoreId, numero_comprobante: "20261011-REC0001",
          total: 11900, subtotal: 10000, descuento: 0, impuesto: 1900, estado: "pagada",
          created_at: "2026-10-11T10:00:00Z", worker_clerk_id: null, clientes: null, venta_items: [],
        },
        error: null,
      }),
    };
    let columnas = "";
    const storeChain: Record<string, jest.Mock> = {
      select: jest.fn((cols: string) => { columnas = cols; return storeChain; }),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(() => {
        const invalidas = columnas.split(",").map((c) => c.trim()).filter((c) => !COLUMNAS_STORES.has(c));
        return Promise.resolve(invalidas.length
          ? { data: null, error: { message: `column stores.${invalidas[0]} does not exist` } }
          : { data: { name: "Tienda Real", rut: "76.123.456-0", address: "Av. Ossa 123" }, error: null });
      }),
    };
    const pagosChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) =>
        table === "stores" ? storeChain : table === "pagos" ? pagosChain : ventaChain),
    });

    const res = await GET(new NextRequest(`http://localhost/api/recibos/${mockVentaId}`), { params: Promise.resolve({ ventaId: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(storeChain.eq).toHaveBeenCalledWith("id", mockStoreId);
    expect(data.html).toContain("Tienda Real");
    expect(data.html).toContain("RUT: 76.123.456-0");
    expect(data.html).toContain("Av. Ossa 123");
    expect(data.html).not.toContain("RUT: N/A");
  });

  // I-REC-13: REGRESIÓN (revisión de lint/seguridad 2026-10-13) — el HTML del
  // recibo interpolaba nombres de cliente, producto, tienda y vendedor sin
  // escapar: un nombre con <script> quedaba como HTML ejecutable.
  it("I-REC-13: REGRESIÓN — escapa los datos de usuario en el HTML del recibo", async () => {
    const xss = '<img src=x onerror="alert(1)">';
    const mockVenta = {
      id: mockVentaId, store_id: mockStoreId, numero_comprobante: "N-1", total: 1000, subtotal: 1000,
      descuento: 0, impuesto: 160, estado: "pagada", created_at: "2026-04-17T10:00:00Z", worker_clerk_id: "w1",
      clientes: { nombre: `Cliente ${xss}`, rut: null, email: null, telefono: null },
      venta_items: [{ cantidad: 1, precio_unitario: 1000, subtotal: 1000, productos: { nombre: `Prod ${xss}` }, servicios: null }],
    };
    const singles = [
      { data: mockVenta, error: null },
      { data: { nombre: `Vend ${xss}`, email: null }, error: null },
      { data: { name: `Tienda ${xss}`, rut: "1-9", address: null }, error: null },
    ];
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(() => Promise.resolve(singles.shift() ?? { data: null, error: null })),
    };
    const pagosChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [{ metodo: `efectivo${xss}`, monto: 1000, numero_transaccion: null }], error: null }),
    };
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => (table === "pagos" ? pagosChain : chain)),
    });

    const res = await GET(new NextRequest(`http://localhost/api/recibos/${mockVentaId}`), { params: Promise.resolve({ ventaId: mockVentaId }) });
    const { html } = await res.json();

    expect(html).not.toContain("<img");
    for (const t of ["Cliente &lt;img", "Prod &lt;img", "Tienda &lt;img", "Vend &lt;img", "Efectivo&lt;img"]) expect(html).toContain(t);
  });
});

// SEC-36 — el recibo tiene el mismo alcance que GET /api/ventas/[id] (SEC-14):
// el worker solo obtiene recibos de ventas de hoy o aquellas en que él es el
// vendedor. Antes bastaba una sesión de la tienda: un worker obtenía el
// recibo (con RUT, email y teléfono del cliente) de cualquier venta.
describe("SEC-36: GET /api/recibos/[ventaId] — alcance del worker", () => {
  const WORKER = "user-worker";
  const ANTIGUA = "2025-01-15T15:00:00Z";

  function montar(venta: Record<string, unknown>) {
    const ventaCompleta = {
      id: "venta-1", store_id: "store-1", numero_comprobante: "20250115-AAA", total: 1000, subtotal: 840,
      descuento: 0, impuesto: 160, estado: "pagada",
      clientes: { id: "c1", nombre: "Juan Pérez", rut: "12.345.678-5", email: "juan@cliente.cl", telefono: "+56911112222" },
      venta_items: [{ cantidad: 1, precio_unitario: 1000, subtotal: 1000, productos: { nombre: "Snack", sku: "S1" } }],
      ...venta,
    } as Record<string, unknown>;
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn((): Promise<unknown> => Promise.resolve({ data: null, error: null })),
    };
    let llamadas = 0;
    chain.single.mockImplementation(() => {
      llamadas++;
      if (llamadas === 1) return Promise.resolve({ data: ventaCompleta, error: null });
      if (llamadas === 2 && ventaCompleta.worker_clerk_id) return Promise.resolve({ data: { nombre: null, email: "ana@tienda.cl" }, error: null });
      return Promise.resolve({ data: { name: "Tienda" }, error: null });
    });
    const pagos = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockResolvedValue({ data: [], error: null }) };
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((t: string) => (t === "pagos" ? pagos : chain)),
    });
    return chain;
  }
  const get = () => GET(new NextRequest("http://localhost/api/recibos/venta-1"), { params: Promise.resolve({ ventaId: "venta-1" }) });

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: "store-1", userId: WORKER });
    mockClaims = { sub: WORKER, publicMetadata: { storeId: "store-1", storeWorker: true } };
    mockDeshabilitado.mockResolvedValue(false);
  });
  afterEach(() => { mockClaims = ADMIN_CLAIMS; });

  it("SEC-36: venta antigua de OTRO vendedor → 404 genérico, sin datos del cliente", async () => {
    montar({ created_at: ANTIGUA, worker_clerk_id: "otro-vendedor" });
    const res = await get();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Venta no encontrada" });
    expect(JSON.stringify(body)).not.toContain("juan@cliente.cl");
    expect(mockRegistrarConsulta).not.toHaveBeenCalled();
  });

  it("SEC-36: venta antigua sin vendedor → 404", async () => {
    montar({ created_at: ANTIGUA, worker_clerk_id: null });
    expect((await get()).status).toBe(404);
  });

  it("SEC-36: venta de hoy de otro vendedor → 200 (recibo del cajero), sin el email del vendedor", async () => {
    montar({ created_at: new Date().toISOString(), worker_clerk_id: "otro-vendedor" });
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).html).not.toContain("ana@tienda.cl");
  });

  it("SEC-36: venta antigua en que él es el vendedor → 200", async () => {
    montar({ created_at: ANTIGUA, worker_clerk_id: WORKER });
    expect((await get()).status).toBe(200);
  });

  it("SEC-36: el admin obtiene cualquier recibo de su tienda, aunque sea antiguo y de otro", async () => {
    mockClaims = ADMIN_CLAIMS;
    montar({ created_at: ANTIGUA, worker_clerk_id: "otro-vendedor" });
    expect((await get()).status).toBe(200);
  });

  it("SEC-36: worker deshabilitado → 403", async () => {
    mockDeshabilitado.mockResolvedValue(true);
    montar({ created_at: new Date().toISOString(), worker_clerk_id: WORKER });
    expect((await get()).status).toBe(403);
  });
});
