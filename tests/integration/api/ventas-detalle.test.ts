import { GET, PATCH } from "@/app/api/ventas/[id]/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/contabilidad/generador-asientos", () => ({
  crearAsiento: jest.fn().mockResolvedValue("asiento-id"),
  lineasAnulacionVentaCanal: jest.fn().mockReturnValue([]),
  lineasAnulacionCOGS: jest.fn().mockReturnValue([]),
}));

import * as contabilidad from "@/lib/contabilidad/generador-asientos";

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

describe("GET /api/ventas/[id]", () => {
  const mockStoreId = "store-1";
  const mockVentaId = "venta-1";

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId });
  });

  it("obtiene venta con items, cliente y worker", async () => {
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
          worker_clerk_id: "clerk-pedro",
          clientes: { id: "cli-1", nombre: "Juan", rut: "12345678-K", telefono: "98765432" },
        },
        error: null,
      }),
    };

    const workerChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { nombre: "Pedro", email: "pedro@example.com" },
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
        if (table === "ventas") return ventaChain;
        if (table === "clerk_users") return workerChain;
        return itemsChain;
      }),
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-1");
    const res = await GET(req, { params: Promise.resolve({ id: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.numero_comprobante).toBe("20260417-ABC123");
    expect(data.clientes.nombre).toBe("Juan");
    expect(data.worker.nombre).toBe("Pedro");
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
          worker_clerk_id: null,
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
    expect(data.worker).toBeNull();
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
        data: { id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 20000, impuesto: 2520, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "20260417-ABC123", created_at: "2026-04-17T10:00:00Z" },
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
        data: { id: "prod-1", stock: 10, costo: 5000 },
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

    const storesChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { fidelizacion_niveles: null }, error: null }),
    };

    const defaultChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockResolvedValue({ error: null }),
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
        if (table === "stores") return storesChain;
        if (table === "ventas" && callCount > 4) return ventaUpdateChain;
        return defaultChain;
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

    // Verifica contra-asientos contables (reverso de venta + reverso COGS)
    expect(contabilidad.crearAsiento).toHaveBeenCalledTimes(2);
    expect(contabilidad.lineasAnulacionVentaCanal).toHaveBeenCalledWith({
      canal: "pos",
      metodoPago: "efectivo",
      montoNeto: 17480,
      iva: 2520,
      total: 20000,
    });
    expect(contabilidad.lineasAnulacionCOGS).toHaveBeenCalledWith(10000);
    expect(contabilidad.crearAsiento).toHaveBeenNthCalledWith(1, expect.objectContaining({
      storeId: mockStoreId,
      tipoMovimiento: "ANULACION_VENTA",
      referenciaNomero: "20260417-ABC123",
      fecha: "2026-04-17",
    }));
    expect(contabilidad.crearAsiento).toHaveBeenNthCalledWith(2, expect.objectContaining({
      storeId: mockStoreId,
      tipoMovimiento: "ANULACION_VENTA",
      descripcion: expect.stringContaining("COGS"),
      fecha: "2026-04-17",
    }));
  });

  // REGRESIÓN: Estado de Resultado incluía venta anulada como ingreso cuando
  // la anulación ocurre en un período (mes) distinto al de la venta original.
  // El contra-asiento debe fechearse con venta.created_at, NO con la fecha
  // de hoy — de lo contrario el reverso cae en el mes de la anulación y
  // nunca netea contra el asiento original del mes de la venta.
  it("I-305: REGRESIÓN — contra-asiento de anulación usa la fecha ORIGINAL de la venta, no la fecha de hoy", async () => {
    const ventaAntigua = "2026-01-15T10:00:00Z"; // mes distinto al mes actual (julio 2026)

    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: mockVentaId,
          estado: "pagada",
          cliente_id: null,
          total: 10000,
          impuesto: 1596,
          metodo_pago: "efectivo",
          canal: "pos",
          numero_comprobante: "20260115-XYZ",
          created_at: ventaAntigua,
        },
        error: null,
      }),
    };

    const itemsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
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

    // El contra-asiento debe quedar en enero (mes de la venta), no en julio (mes de hoy)
    expect(contabilidad.crearAsiento).toHaveBeenCalledWith(
      expect.objectContaining({ fecha: "2026-01-15" })
    );
    const fechasUsadas = (contabilidad.crearAsiento as jest.Mock).mock.calls.map((c) => c[0].fecha);
    expect(fechasUsadas.every((f) => f === "2026-01-15")).toBe(true);
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
        data: { id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 60000, impuesto: 0, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "NC-789", created_at: "2026-04-17T10:00:00Z" },
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

    const storesChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { fidelizacion_niveles: null }, error: null }),
    };

    const defaultChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockResolvedValue({ error: null }),
    };

    let callCount = 0;
    const mockFrom = jest.fn((table: string) => {
      callCount++;
      if (table === "ventas" && callCount === 1) return ventaChain;
      if (table === "venta_items") return itemsChain;
      if (table === "fidelizacion") return fidelChain;
      if (table === "stores") return storesChain;
      if (table === "ventas") return updateChain;
      return defaultChain;
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

    const req = new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "anular" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });

    expect(res.status).toBe(200);
    expect(contabilidad.crearAsiento).toHaveBeenCalledTimes(1);
  });

  it("I-319: retorna 500 si falla la restauración de stock durante anulación", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "pagada", cliente_id: null, total: 20000, impuesto: 2520, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "CMP-001", created_at: "2026-04-17T10:00:00Z" },
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
        data: { id: "prod-1", stock: 10, costo: 5000 },
        error: null,
      }),
    };

    const prodUpdateErrorChain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: null, error: { message: "Stock update failed" } }),
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

    let callCount = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        callCount++;
        if (table === "ventas" && callCount === 1) return ventaChain;
        if (table === "venta_items") return itemsChain;
        if (table === "productos" && callCount === 3) return prodChain;
        if (table === "productos" && callCount === 4) return prodUpdateErrorChain;
        if (table === "stock_movements") return insertChain;
        if (table === "ventas" && callCount > 4) return ventaUpdateChain;
      }),
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "anular" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Error restaurando stock");
  });

  it("retorna 404 si venta no existe", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "pagada", cliente_id: null, total: 20000, impuesto: 0, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "NC-456", created_at: "2026-04-17T10:00:00Z" },
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
    expect(contabilidad.crearAsiento).toHaveBeenCalledTimes(1);
  });

  it("I-328: anular venta con NC activa (saldo_a_favor) cancela NC y revierte saldo", async () => {
    const mockNCId = "nc-active-1";
    const mockSaldoDisponible = 30000;
    const ncMonto = 20000;

    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 100000, impuesto: 15966, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-001", created_at: "2026-07-10T10:00:00Z" },
        error: null,
      }),
    };

    const itemsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    };

    const fidelChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };

    const storesChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: {}, error: null }),
    };

    const ncsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    };

    const saldoChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { saldo_disponible: mockSaldoDisponible },
        error: null,
      }),
    };

    const saldoUpdateChain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn()
        .mockImplementationOnce(() => saldoUpdateChain)
        .mockResolvedValue({ error: null }),
    };

    const ncUpdateChain = {
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

    let callCount = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        callCount++;
        if (table === "ventas" && callCount === 1) return ventaChain;
        if (table === "venta_items") return itemsChain;
        if (table === "fidelizacion") return fidelChain;
        if (table === "stores") return storesChain;
        if (table === "notas_credito" && callCount === 5) return ncsChain;
        if (table === "saldos_a_favor" && callCount === 6) return saldoChain;
        if (table === "saldos_a_favor" && callCount === 7) return saldoUpdateChain;
        if (table === "notas_credito" && callCount === 8) return ncUpdateChain;
        if (table === "ventas" && callCount >= 9) return ventaUpdateChain;
      }),
    });

    ncsChain.eq.mockImplementation((col: string, val: string) => {
      if (col === "estado" && val === "activa") {
        return Promise.resolve({
          data: [{ id: mockNCId, tipo_reembolso: "saldo_a_favor", monto_total: ncMonto }],
          error: null,
        });
      }
      return ncsChain;
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "anular" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);

    const saldoUpdateCalls = (saldoUpdateChain.update as jest.Mock).mock.calls;
    expect(saldoUpdateCalls.length).toBeGreaterThanOrEqual(1);
    const updateArg = saldoUpdateCalls[0][0];
    expect(updateArg.saldo_disponible).toBe(mockSaldoDisponible - ncMonto);

    const ncUpdateCalls = (ncUpdateChain.update as jest.Mock).mock.calls;
    expect(ncUpdateCalls.length).toBeGreaterThanOrEqual(1);
    expect(ncUpdateCalls[0][0].estado).toBe("anulada");
  });

  it("I-329: anular venta con NC activa (reembolso_directo) solo cancela NC, sin tocar saldo", async () => {
    const mockNCId = "nc-direct-1";

    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 50000, impuesto: 7983, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-002", created_at: "2026-07-10T10:00:00Z" },
        error: null,
      }),
    };

    const itemsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    };

    const ncsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    };

    const ncUpdateChain = {
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

    const fidelChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    };

    const storesChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: {}, error: null }),
    };

    let callCount = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        callCount++;
        if (table === "ventas" && callCount === 1) return ventaChain;
        if (table === "venta_items") return itemsChain;
        if (table === "fidelizacion") return fidelChain;
        if (table === "stores") return storesChain;
        if (table === "notas_credito" && callCount === 5) return ncsChain;
        if (table === "notas_credito" && callCount > 5) return ncUpdateChain;
        if (table === "ventas") return ventaUpdateChain;
      }),
    });

    // Mock the NC query to return a reembolso_directo NC
    ncsChain.eq.mockImplementation((col: string, val: string) => {
      if (col === "estado" && val === "activa") {
        return Promise.resolve({
          data: [{ id: mockNCId, tipo_reembolso: "reembolso_directo", monto_total: 20000 }],
          error: null,
        });
      }
      return ncsChain;
    });

    const saldoSpy = jest.spyOn(supabaseModule.createServiceClient(), "from");

    const req = new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "anular" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);

    // Verificar que la NC se marcó como anulada
    const ncUpdateCalls = (ncUpdateChain.update as jest.Mock).mock.calls;
    expect(ncUpdateCalls.length).toBeGreaterThanOrEqual(1);
    expect(ncUpdateCalls[0][0].estado).toBe("anulada");

    saldoSpy.mockRestore();
  });

  it("I-330: anular venta con NC ya usada no la modifica", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 100000, impuesto: 15966, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-003", created_at: "2026-07-10T10:00:00Z" },
        error: null,
      }),
    };

    const itemsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    };

    const ncsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
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

    const fidelChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    };

    const storesChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: {}, error: null }),
    };

    let callCount = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        callCount++;
        if (table === "ventas" && callCount === 1) return ventaChain;
        if (table === "venta_items") return itemsChain;
        if (table === "fidelizacion") return fidelChain;
        if (table === "stores") return storesChain;
        if (table === "notas_credito" && callCount === 5) return ncsChain;
        if (table === "ventas") return ventaUpdateChain;
      }),
    });

    // Mock the NC query to return NO active NCs
    ncsChain.eq.mockImplementation((col: string, val: string) => {
      if (col === "estado" && val === "activa") {
        return Promise.resolve({
          data: [],
          error: null,
        });
      }
      return ncsChain;
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "anular" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);
    // Ninguna NC debería haberse actualizado (no hay activas)
  });

  it("I-331: anular venta sin NCs no falla ni toca NCs ni saldo", async () => {
    const ventaChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 100000, impuesto: 15966, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-004", created_at: "2026-07-10T10:00:00Z" },
        error: null,
      }),
    };

    const itemsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    };

    const ncsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
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

    const fidelChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    };

    const storesChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: {}, error: null }),
    };

    let callCount = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        callCount++;
        if (table === "ventas" && callCount === 1) return ventaChain;
        if (table === "venta_items") return itemsChain;
        if (table === "fidelizacion") return fidelChain;
        if (table === "stores") return storesChain;
        if (table === "notas_credito" && callCount === 5) return ncsChain;
        if (table === "ventas") return ventaUpdateChain;
      }),
    });

    // Mock the NC query to return null (no NCs at all)
    ncsChain.eq.mockImplementation((col: string, val: string) => {
      if (col === "estado" && val === "activa") {
        return Promise.resolve({
          data: null,
          error: null,
        });
      }
      return ncsChain;
    });

    const req = new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "anular" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);
  });
});
