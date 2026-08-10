/**
 * Tests para FIFO en POST /api/ventas, devoluciones y protección de stock.
 *
 * Patrones de mock:
 *  - Objeto plano con mockReturnValue(self) para tablas con conditional query building
 *    (notas-credito usa: let q = select("*"); if (cond) q = q.eq(...); await q.single())
 *  - Cadenas explícitas con mockResolvedValue en el método terminal para el resto
 *  - Contador de llamadas para tablas que se llaman dos veces con cadenas distintas
 *    (productos: precio → .select().in().eq(); hub-sync → .select().eq().in())
 */
import { NextRequest } from "next/server";

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    after: jest.fn((cb: () => void) => cb()),
  };
});

const STORE_ID      = "123e4567-e89b-12d3-a456-426614174000";
const PRODUCTO_ID   = "123e4567-e89b-12d3-a456-426614174010";
const VENTA_ID      = "123e4567-e89b-12d3-a456-426614174030";
const VENTA_ITEM_ID = "123e4567-e89b-12d3-a456-426614174040";

const mockFrom = jest.fn();
const mockRpc   = jest.fn().mockResolvedValue({ error: null });

jest.mock("@/lib/auth", () => ({
  getStoreId: jest.fn().mockResolvedValue({ userId: "user-1", storeId: STORE_ID }),
}));

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));

jest.mock("@/lib/whatsapp", () => ({
  sendWhatsAppText:    jest.fn().mockResolvedValue(undefined),
  buildReceiptMessage: jest.fn().mockReturnValue("receipt"),
}));

jest.mock("@/lib/hub-sync", () => ({
  syncPurchaseToHub: jest.fn(),
  syncProductsToHub: jest.fn(),
}));

jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler) => handler,
  logAudit:           jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn().mockResolvedValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

import { POST as VentaPost }      from "@/app/api/ventas/route";
import { POST as NotaCreditoPost } from "@/app/api/notas-credito/route";
import { PATCH as PatchProducto }  from "@/app/api/productos/[id]/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeVentaRequest(body: object) {
  return new NextRequest("http://localhost/api/ventas", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

function makeNCRequest(body: object) {
  return new NextRequest("http://localhost/api/notas-credito", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

/**
 * Mock plano con todos los métodos que se referencian entre sí.
 * Permite: let q = table.select(); q = q.eq(...); await q.single()
 * (patrón usado en notas-credito para ventas y venta_items).
 */
function flatQueryMock(resolvedData: object | null) {
  const m: Record<string, jest.Mock> = {} as Record<string, jest.Mock>;
  (["select", "eq", "in", "gt", "order", "limit", "upsert", "update", "insert"] as const).forEach((method) => {
    m[method] = jest.fn().mockReturnValue(m);
  });
  m.single = jest.fn().mockResolvedValue({ data: resolvedData, error: null });
  return m;
}

const DB_VENTA_FIFO = {
  id: VENTA_ID, total: 20000, subtotal: 20000, impuesto: 0, descuento: 0,
  estado: "pagada", created_at: new Date().toISOString(), numero_comprobante: "V-001",
};

/**
 * Configura mockFrom para un request de venta.
 * El stored procedure crear_venta_tx gestiona ventas, items, pagos, stock y lotes
 * internamente; el route solo consulta productos (precio + hub-sync) y stores (config).
 */
function buildVentaMock() {
  let productosCall = 0;

  mockFrom.mockImplementation((table: string) => {
    if (table === "productos") {
      productosCall++;
      const m = { select: jest.fn(), in: jest.fn(), eq: jest.fn() };
      m.select.mockReturnValue(m);

      if (productosCall === 1) {
        // precio: .select().in().eq() → eq es el terminal
        m.in.mockReturnValue(m);
        m.eq.mockResolvedValue({
          data: [{ id: PRODUCTO_ID, precio: 10000, precio_oferta: null, en_oferta: false }],
          error: null,
        });
      } else {
        // hub-sync: .select().eq().in() → in es el terminal
        m.eq.mockReturnValue(m);
        m.in.mockResolvedValue({ data: [], error: null });
      }
      return m;
    }

    if (table === "stores") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false, email_reminder_dias_aviso: 5, fidelizacion_niveles: null }, error: null }),
      };
    }

    // catch-all para audit_logs, etc.
    return flatQueryMock(null);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// La lógica FIFO (deducir_stock_fifo / decrement_stock) es ahora interna al stored
// procedure crear_venta_tx. Estos tests verifican que el route invoca el SP con los
// datos correctos y responde apropiadamente ante errores de stock.

describe("Checkout — venta delega stock al stored procedure crear_venta_tx", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: { venta: DB_VENTA_FIFO, created: true }, error: null });
    buildVentaMock();
  });

  it("descuenta stock vía crear_venta_tx con store_id, items y método de pago", async () => {
    const res = await VentaPost(makeVentaRequest({
      items:       [{ producto_id: PRODUCTO_ID, cantidad: 2 }],
      metodoPago:  "efectivo",
      canal:       "pos",
      procedencia: "presencial",
    }));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_store_id:    STORE_ID,
      p_metodo_pago: "efectivo",
      p_items: expect.arrayContaining([
        expect.objectContaining({ producto_id: PRODUCTO_ID, cantidad: 2 }),
      ]),
    }));
  });

  it("422 si el stored procedure devuelve error de stock insuficiente", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Stock insuficiente: disponible 0 vigentes, requerido 999" },
    });

    const res = await VentaPost(makeVentaRequest({
      items:       [{ producto_id: PRODUCTO_ID, cantidad: 999 }],
      metodoPago:  "efectivo",
      canal:       "pos",
      procedencia: "presencial",
    }));

    expect(res.status).toBe(422);
  });

  it("pasa items con precio calculado desde BD (no del body)", async () => {
    const res = await VentaPost(makeVentaRequest({
      items:       [{ producto_id: PRODUCTO_ID, cantidad: 2, precio_unitario: 1 }],
      metodoPago:  "efectivo",
      canal:       "pos",
      procedencia: "presencial",
    }));

    expect(res.status).toBe(200);
    // precio_unitario debe ser 10000 (de BD), no 1 (del body)
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_items: expect.arrayContaining([
        expect.objectContaining({ precio_unitario: 10000 }),
      ]),
    }));
  });
});

describe("Devolución con trazabilidad de lotes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ error: null });
  });

  it("devuelve stock a lotes originales si hay venta_item_lotes", async () => {
    mockRpc.mockResolvedValue({
      data: { id: "nc-1", monto_total: 2000, costo_total: 500, venta_cliente_id: null },
      error: null,
    });

    const res = await NotaCreditoPost(makeNCRequest({
      ventaId:       VENTA_ID,
      items:         [{ ventaItemId: VENTA_ITEM_ID, cantidadDevuelta: 2, restituirStock: true }],
      tipoReembolso: "reembolso_directo",
      motivo:        "Producto defectuoso",
    }));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_nota_credito_tx", expect.objectContaining({
      p_venta_id: VENTA_ID,
      p_items: expect.arrayContaining([
        expect.objectContaining({ venta_item_id: VENTA_ITEM_ID, cantidad_devuelta: 2 }),
      ]),
    }));
  });
});

describe("Protección de stock en PATCH /api/productos/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("422 al intentar actualizar stock si el producto tiene lotes activos", async () => {
    // Cadena: .select().eq().eq().eq()  → tercer eq resuelve con count > 0
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { id: "some-product-id", nombre: "Test", stock: 5 }, error: null }),
        };
      }
      if (table === "lotes_producto") {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ count: 2, data: null, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const req = new NextRequest("http://localhost/api/productos/some-id", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ stock: 100 }),
    });

    const res = await PatchProducto(req, { params: Promise.resolve({ id: "some-product-id" }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("lotes");
  });
});
