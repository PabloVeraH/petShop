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

// ── PATCH /api/ventas/[id] — Anular venta ─────────────────────────────────────
//
// Desde la migración 053, toda la lógica de anulación (reclamo atómico de
// estado, restauración de stock, decremento de fidelización, cancelación de
// NCs activas y reversión de saldo_a_favor) vive en la función SQL
// anular_venta_tx, llamada en una única transacción vía RPC — ver
// migrations/053_anular_venta_tx.sql. La ruta ya NO contiene esa lógica de
// negocio: solo llama al RPC, mapea el error a un status HTTP, y usa
// venta/costo_total del resultado para los asientos contables
// (fire-and-forget). Estos tests verifican el CONTRATO de la ruta con el RPC
// (parámetros, mapeo de errores, uso de la respuesta) — la corrección de la
// lógica de negocio NC-aware (stock parcial, fidelización neta, reversión de
// saldo, reclamo atómico ante concurrencia) se verificó directamente contra
// la función real en Supabase (infraestructura real, no mock — ver
// migrations/053_anular_venta_tx.sql y AGENTS.md §22.5/§22.6 para el detalle
// de los escenarios verificados). Los IDs I-328 a I-336, que antes probaban
// esa lógica vía mocks de .from(), se retiran de este archivo por la misma
// razón: dejaron de ejercitar código de la ruta.

function mockAnularVentaTxSuccess(overrides: Record<string, unknown> = {}, costoTotal = 0) {
  return {
    data: {
      venta: {
        id: "venta-1",
        estado: "anulada",
        total: 20000,
        impuesto: 2520,
        metodo_pago: "efectivo",
        canal: "pos",
        numero_comprobante: "20260417-ABC123",
        created_at: "2026-04-17T10:00:00Z",
        ...overrides,
      },
      costo_total: costoTotal,
    },
    error: null,
  };
}

function mockAnularVentaTxError(message: string) {
  return { data: null, error: { message } };
}

describe("PATCH /api/ventas/[id] - Anular venta", () => {
  const mockStoreId = "store-1";
  const mockVentaId = "venta-1";
  const mockUserId = "user-1";

  let mockRpc: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId, userId: mockUserId });
    mockRpc = jest.fn().mockResolvedValue(mockAnularVentaTxSuccess());
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => {
        throw new Error("[test] la ruta no debería llamar a .from() directamente — toda la lógica vive en el RPC");
      }),
      rpc: mockRpc,
    });
  });

  function makeReq(body: object = { action: "anular" }) {
    return new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  it("llama a anular_venta_tx con store_id, venta_id y user_id correctos", async () => {
    await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });

    expect(mockRpc).toHaveBeenCalledWith("anular_venta_tx", {
      p_store_id: mockStoreId,
      p_venta_id: mockVentaId,
      p_user_id: mockUserId,
    });
  });

  it("anula venta exitosamente y genera asientos contables (ingreso + COGS)", async () => {
    mockRpc.mockResolvedValue(mockAnularVentaTxSuccess({}, 10000));

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.estado).toBe("anulada");

    expect(contabilidad.crearAsiento).toHaveBeenCalledTimes(2);
    expect(contabilidad.lineasAnulacionVentaCanal).toHaveBeenCalledWith({
      canal: "pos",
      metodoPago: "efectivo",
      montoNeto: 17480,
      iva: 2520,
      total: 20000,
    });
    // El reverso COGS usa el costo_total devuelto por el RPC — la ruta ya no
    // lo calcula, solo lo pasa (la exclusión NC-aware ocurre dentro del RPC).
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

  it("no genera reverso COGS cuando costo_total es 0 (sin stock que restaurar)", async () => {
    mockRpc.mockResolvedValue(mockAnularVentaTxSuccess({}, 0));

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);
    expect(contabilidad.crearAsiento).toHaveBeenCalledTimes(1);
    expect(contabilidad.lineasAnulacionCOGS).not.toHaveBeenCalled();
  });

  // REGRESIÓN: Estado de Resultado incluía venta anulada como ingreso cuando
  // la anulación ocurre en un período (mes) distinto al de la venta original.
  // El contra-asiento debe fechearse con venta.created_at, NO con la fecha
  // de hoy — de lo contrario el reverso cae en el mes de la anulación y
  // nunca netea contra el asiento original del mes de la venta.
  it("I-305: REGRESIÓN — contra-asiento de anulación usa la fecha ORIGINAL de la venta, no la fecha de hoy", async () => {
    const ventaAntigua = "2026-01-15T10:00:00Z"; // mes distinto al mes actual (julio 2026)
    mockRpc.mockResolvedValue(mockAnularVentaTxSuccess({
      total: 10000, impuesto: 1596, numero_comprobante: "20260115-XYZ", created_at: ventaAntigua,
    }));

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);

    expect(contabilidad.crearAsiento).toHaveBeenCalledWith(
      expect.objectContaining({ fecha: "2026-01-15" })
    );
    const fechasUsadas = (contabilidad.crearAsiento as jest.Mock).mock.calls.map((c) => c[0].fecha);
    expect(fechasUsadas.every((f) => f === "2026-01-15")).toBe(true);
  });

  it("retorna 404 si venta no existe", async () => {
    mockRpc.mockResolvedValue(mockAnularVentaTxError("Venta no encontrada"));

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: "venta-no-existe" }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toContain("no encontrada");
    expect(contabilidad.crearAsiento).not.toHaveBeenCalled();
  });

  // I-411: cubre tanto la doble-anulación secuencial (click repetido) como la
  // concurrente (dos requests simultáneos para la misma venta) — el reclamo
  // atómico dentro de anular_venta_tx (UPDATE ... WHERE estado != 'anulada')
  // produce el mismo error en ambos casos, así que un solo status HTTP (409)
  // cubre ambas variantes correctamente sin distinguirlas.
  it("I-411: retorna 409 si la venta ya está anulada (incluye anulación concurrente)", async () => {
    mockRpc.mockResolvedValue(mockAnularVentaTxError("La venta ya está anulada"));

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toContain("ya está anulada");
    expect(contabilidad.crearAsiento).not.toHaveBeenCalled();
  });

  it("retorna 400 si action no es válido", async () => {
    const req = makeReq({ action: "rechazar" });
    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("no válida");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // I-412: cualquier error del RPC que no sea "no encontrada" ni "ya está
  // anulada" (ej. una violación de constraint dentro de la transacción) se
  // trata como error interno genérico — la transacción ya hizo ROLLBACK
  // automático en Postgres, así que no hay estado parcial que reportar con
  // más detalle.
  it("I-412: retorna 500 ante un error inesperado del RPC (rollback automático de la transacción)", async () => {
    mockRpc.mockResolvedValue(mockAnularVentaTxError("insert or update on table violates foreign key constraint"));

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Error interno del servidor");
  });
});
