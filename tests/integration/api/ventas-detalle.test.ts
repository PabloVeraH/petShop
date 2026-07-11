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
// Router de mocks por tabla: en vez de un callCount global sobre .from()
// (frágil ante cualquier reordenamiento de queries), cada tabla se resuelve
// de forma independiente. Una entrada puede ser un chain único (siempre se
// retorna igual) o un array de chains (se dispensan en orden POR TABLA, no
// globalmente) — lanza un error explícito si se llama más veces de las
// configuradas, en vez de fallar en silencio con undefined.
function makeTableRouter(config: Record<string, unknown>) {
  const counters: Record<string, number> = {};
  return jest.fn((table: string) => {
    if (!(table in config)) {
      throw new Error(`[test] tabla no configurada en el router: "${table}"`);
    }
    const entry = config[table];
    if (!Array.isArray(entry)) return entry;
    const idx = counters[table] ?? 0;
    counters[table] = idx + 1;
    if (idx >= entry.length) {
      throw new Error(
        `[test] llamada extra no esperada a "${table}" (índice ${idx}, solo se configuraron ${entry.length})`
      );
    }
    return entry[idx];
  });
}

function ventaSelectChain(data: Record<string, unknown> | null, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error }),
  };
}

function ventaUpdateChain(data: Record<string, unknown> = { id: "venta-1", estado: "anulada" }) {
  return {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error: null }),
  };
}

function listChain(data: unknown[] | null, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue({ data, error }),
  };
}

function prodReadChain(stock: number, costo: number) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { stock, costo }, error: null }),
  };
}

function simpleUpdateChain(error: unknown = null) {
  return {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue({ error }),
  };
}

function insertOkChain() {
  return { insert: jest.fn().mockResolvedValue({ error: null }) };
}

function singleSelectChain(data: Record<string, unknown> | null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error: null }),
  };
}

describe("PATCH /api/ventas/[id] - Anular venta", () => {
  const mockStoreId = "store-1";
  const mockVentaId = "venta-1";
  const mockClienteId = "cli-1";

  let mockRpc: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId, userId: "user-1" });
    mockRpc = jest.fn().mockResolvedValue({ data: null, error: null });
  });

  function mockClient(config: Record<string, unknown>) {
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: makeTableRouter(config),
      rpc: mockRpc,
    });
  }

  function makeReq(body: object = { action: "anular" }) {
    return new NextRequest("http://localhost/api/ventas/venta-1", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  it("anula venta y revierte stock exitosamente", async () => {
    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 20000, impuesto: 2520, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "20260417-ABC123", created_at: "2026-04-17T10:00:00Z" }),
        ventaUpdateChain({ id: mockVentaId, estado: "anulada" }),
      ],
      venta_items: listChain([{ id: "item-1", producto_id: "prod-1", cantidad: 2 }]),
      notas_credito: listChain([]),
      productos: [prodReadChain(10, 5000), simpleUpdateChain()],
      stock_movements: insertOkChain(),
      fidelizacion: [singleSelectChain({ id: "f1", total_historico: 100000, frecuencia_compras: 5 }), simpleUpdateChain()],
      stores: singleSelectChain({ fidelizacion_niveles: null }),
    });

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

    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: null, total: 10000, impuesto: 1596, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "20260115-XYZ", created_at: ventaAntigua }),
        ventaUpdateChain(),
      ],
      venta_items: listChain([]),
      notas_credito: listChain([]),
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);

    expect(contabilidad.crearAsiento).toHaveBeenCalledWith(
      expect.objectContaining({ fecha: "2026-01-15" })
    );
    const fechasUsadas = (contabilidad.crearAsiento as jest.Mock).mock.calls.map((c) => c[0].fecha);
    expect(fechasUsadas.every((f) => f === "2026-01-15")).toBe(true);
  });

  it("retorna 404 si venta no existe", async () => {
    mockClient({ ventas: ventaSelectChain(null, { message: "not found" }) });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: "venta-no-existe" }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toContain("no encontrada");
  });

  it("retorna 409 si venta ya está anulada", async () => {
    mockClient({
      ventas: ventaSelectChain({ id: mockVentaId, estado: "anulada", cliente_id: mockClienteId, total: 20000 }),
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toContain("ya está anulada");
  });

  it("retorna 400 si action no es válido", async () => {
    const req = makeReq({ action: "rechazar" });
    const res = await PATCH(req, { params: Promise.resolve({ id: mockVentaId }) });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("no válida");
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(401);
  });

  it("decrementa fidelización del cliente", async () => {
    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 60000, impuesto: 0, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "NC-789", created_at: "2026-04-17T10:00:00Z" }),
        ventaUpdateChain(),
      ],
      venta_items: listChain([]),
      notas_credito: listChain([]),
      fidelizacion: [
        singleSelectChain({ id: "f1", total_historico: 200000, frecuencia_compras: 5, descuento_actual: 10 }),
        simpleUpdateChain(),
      ],
      stores: singleSelectChain({ fidelizacion_niveles: null }),
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);
    expect(contabilidad.crearAsiento).toHaveBeenCalledTimes(1);
  });

  it("I-319: retorna 500 si falla la restauración de stock durante anulación", async () => {
    mockClient({
      ventas: ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: null, total: 20000, impuesto: 2520, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "CMP-001", created_at: "2026-04-17T10:00:00Z" }),
      venta_items: listChain([{ id: "item-1", producto_id: "prod-1", cantidad: 2 }]),
      notas_credito: listChain([]),
      productos: [prodReadChain(10, 5000), simpleUpdateChain({ message: "Stock update failed" })],
      stock_movements: insertOkChain(),
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Error restaurando stock");
  });

  it("anula venta sin cliente ni items sin fallar", async () => {
    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: null, total: 20000, impuesto: 0, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "NC-456", created_at: "2026-04-17T10:00:00Z" }),
        ventaUpdateChain(),
      ],
      venta_items: listChain([]),
      notas_credito: listChain([]),
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });

    expect(res.status).toBe(200);
    expect(contabilidad.crearAsiento).toHaveBeenCalledTimes(1);
  });

  it("I-328: anular venta con NC activa (saldo_a_favor) cancela NC y revierte saldo", async () => {
    const mockNCId = "nc-active-1";
    const ncMonto = 20000;

    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 100000, impuesto: 15966, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-001", created_at: "2026-07-10T10:00:00Z" }),
        ventaUpdateChain(),
      ],
      venta_items: listChain([]),
      notas_credito: [
        listChain([{ id: mockNCId, estado: "activa", tipo_reembolso: "saldo_a_favor", monto_total: ncMonto, nota_credito_items: [] }]),
        simpleUpdateChain(), // cancelar la NC (estado='anulada')
      ],
      fidelizacion: singleSelectChain(null),
      stores: singleSelectChain({}),
    });
    mockRpc.mockResolvedValue({ data: null, error: null });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);

    expect(mockRpc).toHaveBeenCalledWith("revertir_saldo_a_favor", {
      p_store_id: mockStoreId,
      p_cliente_id: mockClienteId,
      p_monto: ncMonto,
    });
  });

  it("I-329: anular venta con NC activa (reembolso_directo) solo cancela NC, sin tocar saldo", async () => {
    const mockNCId = "nc-direct-1";

    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 50000, impuesto: 7983, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-002", created_at: "2026-07-10T10:00:00Z" }),
        ventaUpdateChain(),
      ],
      venta_items: listChain([]),
      notas_credito: [
        listChain([{ id: mockNCId, estado: "activa", tipo_reembolso: "reembolso_directo", monto_total: 20000, nota_credito_items: [] }]),
        simpleUpdateChain(),
      ],
      fidelizacion: singleSelectChain(null),
      stores: singleSelectChain({}),
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);

    expect(mockRpc).not.toHaveBeenCalledWith("revertir_saldo_a_favor", expect.anything());
  });

  it("I-330: anular venta con NC ya usada no revierte saldo (ya fue consumida por otra venta)", async () => {
    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 100000, impuesto: 15966, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-003", created_at: "2026-07-10T10:00:00Z" }),
        ventaUpdateChain(),
      ],
      venta_items: listChain([]),
      notas_credito: listChain([{ id: "nc-usada-1", estado: "usada", tipo_reembolso: "saldo_a_favor", monto_total: 20000, nota_credito_items: [] }]),
      fidelizacion: singleSelectChain(null),
      stores: singleSelectChain({}),
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);

    // NC "usada" no es "activa" — no se cancela ni se revierte su saldo
    expect(mockRpc).not.toHaveBeenCalledWith("revertir_saldo_a_favor", expect.anything());
  });

  it("I-331: anular venta sin NCs no falla ni toca NCs ni saldo", async () => {
    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 100000, impuesto: 15966, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-004", created_at: "2026-07-10T10:00:00Z" }),
        ventaUpdateChain(),
      ],
      venta_items: listChain([]),
      notas_credito: listChain(null),
      fidelizacion: singleSelectChain(null),
      stores: singleSelectChain({}),
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ── Regresión: doble crédito también en inventario y fidelización ──────────
  //
  // El fix original (revertir NCs activas + saldo_a_favor al anular venta) no
  // cubría dos manifestaciones adyacentes de la MISMA causa raíz: anular una
  // venta con una NC parcial ya emitida re-aplicaba efectos que la NC YA
  // había aplicado una vez al crearse — no solo el saldo_a_favor, sino también
  // el stock físico restituido y el descuento de fidelización. Ver AGENTS.md §22.5.

  it("I-332: REGRESIÓN — NC parcial con restituir_stock=true no duplica la restitución de stock al anular", async () => {
    // Venta de 5 unidades. NC devolvió 2 (restituir_stock=true, ya sumadas a
    // stock cuando se creó la NC). Al anular, solo deben restaurarse las 3
    // unidades restantes — no las 5 originales.
    const prodUpdate = simpleUpdateChain();
    const movInsert = insertOkChain();
    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: null, total: 50000, impuesto: 7983, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-005", created_at: "2026-07-10T10:00:00Z" }),
        ventaUpdateChain(),
      ],
      venta_items: listChain([{ id: "item-1", producto_id: "prod-1", cantidad: 5 }]),
      notas_credito: [
        listChain([
          {
            id: "nc-parcial-1",
            estado: "activa",
            tipo_reembolso: "reembolso_directo",
            monto_total: 8000,
            nota_credito_items: [{ venta_item_id: "item-1", cantidad_devuelta: 2, restituir_stock: true }],
          },
        ]),
        simpleUpdateChain(),
      ],
      productos: [prodReadChain(10, 1000), prodUpdate],
      stock_movements: movInsert,
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);

    // stock 10 + pendiente(5-2=3) = 13 — nunca 10+5=15
    expect(prodUpdate.update).toHaveBeenCalledWith({ stock: 13 });
    expect(movInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ cantidad: 3 }));
    expect(contabilidad.lineasAnulacionCOGS).toHaveBeenCalledWith(3000); // costo 1000 x pendiente 3, no x 5
  });

  it("I-333: REGRESIÓN — item totalmente devuelto vía NC (restituir_stock=true) no restaura stock al anular", async () => {
    // Las 5 unidades ya fueron devueltas en su totalidad vía NC — pendiente=0,
    // no debe tocarse productos ni insertarse stock_movements para ese item.
    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: null, total: 50000, impuesto: 7983, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-006", created_at: "2026-07-10T10:00:00Z" }),
        ventaUpdateChain(),
      ],
      venta_items: listChain([{ id: "item-1", producto_id: "prod-1", cantidad: 5 }]),
      notas_credito: [
        listChain([
          {
            id: "nc-total-1",
            estado: "activa",
            tipo_reembolso: "reembolso_directo",
            monto_total: 20000,
            nota_credito_items: [{ venta_item_id: "item-1", cantidad_devuelta: 5, restituir_stock: true }],
          },
        ]),
        simpleUpdateChain(),
      ],
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);
    // No se configuró chain para "productos" ni "stock_movements": si el
    // código intentara llamarlos, makeTableRouter lanzaría "tabla no configurada".
    expect(contabilidad.lineasAnulacionCOGS).not.toHaveBeenCalled();
  });

  it("I-334: REGRESIÓN — item devuelto con restituir_stock=false NO se descuenta de la restauración (no se sumó a stock al crear la NC)", async () => {
    // NC devolvió 2 unidades dañadas (restituir_stock=false) — esas 2 NUNCA
    // llegaron a incrementar stock. Al anular, se restauran las 5 originales
    // completas: no hay nada que restar, porque nada se sumó por esa NC.
    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: null, total: 50000, impuesto: 7983, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-007", created_at: "2026-07-10T10:00:00Z" }),
        ventaUpdateChain(),
      ],
      venta_items: listChain([{ id: "item-1", producto_id: "prod-1", cantidad: 5 }]),
      notas_credito: [
        listChain([
          {
            id: "nc-danado-1",
            estado: "activa",
            tipo_reembolso: "reembolso_directo",
            monto_total: 8000,
            nota_credito_items: [{ venta_item_id: "item-1", cantidad_devuelta: 2, restituir_stock: false }],
          },
        ]),
        simpleUpdateChain(),
      ],
      productos: [prodReadChain(10, 1000), simpleUpdateChain()],
      stock_movements: insertOkChain(),
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);
    expect(contabilidad.lineasAnulacionCOGS).toHaveBeenCalledWith(5000); // costo 1000 x 5 completas
  });

  it("I-335: REGRESIÓN — NC parcial no duplica el decremento de fidelización al anular", async () => {
    // Venta $100.000. NC parcial de $30.000 ya restó $30.000 de fidelización
    // al crearse. Al anular, debe restarse solo el neto: 100000-30000=70000.
    const fidelUpdate = simpleUpdateChain();
    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 100000, impuesto: 15966, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-008", created_at: "2026-07-10T10:00:00Z" }),
        ventaUpdateChain(),
      ],
      venta_items: listChain([]),
      notas_credito: [
        listChain([
          { id: "nc-fidel-1", estado: "activa", tipo_reembolso: "reembolso_directo", monto_total: 30000, nota_credito_items: [] },
        ]),
        simpleUpdateChain(),
      ],
      fidelizacion: [
        singleSelectChain({ id: "f1", total_historico: 500000, frecuencia_compras: 10 }),
        fidelUpdate,
      ],
      stores: singleSelectChain({ fidelizacion_niveles: null }),
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);

    // total_historico esperado: 500000 - (100000-30000) = 430000, no 400000
    expect(fidelUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ total_historico: 430000 })
    );
  });

  it("I-336: REGRESIÓN — NC usada cuenta para stock y fidelización aunque no se le revierta el saldo", async () => {
    // La NC está "usada" (consumida como pago de otra venta) pero su efecto de
    // stock/fidelización sí ocurrió una vez al crearse — debe seguir contando
    // para el cálculo neto, aunque no se cancele ni se revierta su saldo.
    const fidelUpdate = simpleUpdateChain();
    mockClient({
      ventas: [
        ventaSelectChain({ id: mockVentaId, estado: "pagada", cliente_id: mockClienteId, total: 50000, impuesto: 7983, metodo_pago: "efectivo", canal: "pos", numero_comprobante: "VT-009", created_at: "2026-07-10T10:00:00Z" }),
        ventaUpdateChain(),
      ],
      venta_items: listChain([{ id: "item-1", producto_id: "prod-1", cantidad: 5 }]),
      notas_credito: listChain([
        {
          id: "nc-usada-2",
          estado: "usada",
          tipo_reembolso: "saldo_a_favor",
          monto_total: 20000,
          nota_credito_items: [{ venta_item_id: "item-1", cantidad_devuelta: 2, restituir_stock: true }],
        },
      ]),
      productos: [prodReadChain(10, 1000), simpleUpdateChain()],
      stock_movements: insertOkChain(),
      fidelizacion: [
        singleSelectChain({ id: "f1", total_historico: 500000, frecuencia_compras: 10 }),
        fidelUpdate,
      ],
      stores: singleSelectChain({ fidelizacion_niveles: null }),
    });

    const res = await PATCH(makeReq(), { params: Promise.resolve({ id: mockVentaId }) });
    expect(res.status).toBe(200);

    // Stock: pendiente = 5-2=3 (cuenta la NC usada para el neto de stock)
    expect(contabilidad.lineasAnulacionCOGS).toHaveBeenCalledWith(3000);
    // Fidelización: neto = 50000-20000=30000 → 500000-30000=470000
    expect(fidelUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ total_historico: 470000 })
    );
    // Saldo: NC "usada" no es "activa" — nunca se llama revertir_saldo_a_favor
    expect(mockRpc).not.toHaveBeenCalledWith("revertir_saldo_a_favor", expect.anything());
  });
});
