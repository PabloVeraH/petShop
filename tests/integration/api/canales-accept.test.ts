/**
 * Tests I-519 a I-528: POST /api/canales/orders/[id]/accept
 *
 * Reemplaza la suite anterior (I-325 a I-327). La implementación anterior
 * insertaba `ventas`/`venta_items` directamente y tenía cuatro problemas
 * verificados (ver docs/revision_claude_shopify.md §2):
 *   1. No pasaba por `crear_venta_tx` (sin FIFO, sin idempotencia).
 *   2. No generaba asiento contable — la venta nunca llegaba al Libro Diario.
 *   3. Leía `orden.raw_payload`, columna inexistente (la real es `payload`)
 *      — en producción, aceptar CUALQUIER orden fallaba con 400 "Orden sin items".
 *   4. Un SKU no encontrado se saltaba en silencio, dejando una venta con
 *      menos items de los que el total cobrado implicaba.
 *
 * La implementación actual delega a `aceptarOrdenExterna()` (src/lib/canales/hub.ts),
 * que usa el mismo RPC `crear_venta_tx` que POST /api/ventas y genera el
 * asiento vía `crearAsiento(lineasVentaCanal(...))`.
 */
import { NextRequest, after } from "next/server";

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    // after() requiere request scope — en tests se ejecuta el callback en el
    // momento, mismo patrón que tests/integration/api/ventas.post.test.ts.
    after: jest.fn((cb: () => void) => cb()),
  };
});

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const ORDEN_ID = "123e4567-e89b-12d3-a456-426614174050";
const PRODUCTO_1 = "123e4567-e89b-12d3-a456-426614174010";
const PRODUCTO_2 = "123e4567-e89b-12d3-a456-426614174011";
const VENTA_ID = "123e4567-e89b-12d3-a456-426614174030";

// total bruto = 2×10.000 + 1×5.458 = 25.458 → IVA extraído = round(25458×0.19/1.19) = 4.065
const ORDEN_PENDING = {
  id: ORDEN_ID,
  store_id: STORE_ID,
  canal_id: "rappi",
  estado: "pending",
  external_order_id: "EXT-001",
  payload: {
    items: [
      { id: "SKU-1", quantity: 2, unit_price: 10000 },
      { id: "SKU-2", quantity: 1, unit_price: 5458 },
    ],
  },
};

const PRODUCTOS_DB = [
  { id: PRODUCTO_1, sku: "SKU-1", stock: 50, costo: 4000 },
  { id: PRODUCTO_2, sku: "SKU-2", stock: 50, costo: 2000 },
];

const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockConfirmOrder = jest.fn().mockResolvedValue(undefined);
const mockLogAudit = jest.fn().mockResolvedValue(undefined);

let ordenActual: typeof ORDEN_PENDING & { estado: string } = { ...ORDEN_PENDING };
let productosDisponibles = PRODUCTOS_DB;
const canalOrdenUpdateCalls: Record<string, unknown>[] = [];

jest.mock("@/lib/auth", () => ({
  getStoreId: jest.fn().mockResolvedValue({ userId: "user-1", storeId: STORE_ID }),
}));

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));

jest.mock("@/lib/canales/registry", () => ({
  getChannel: jest.fn(() => ({ confirmOrder: mockConfirmOrder })),
}));

jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler: unknown) => handler,
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
  getRequestMetadata: jest.fn().mockResolvedValue({ ipAddress: "127.0.0.1", userAgent: "jest" }),
}));

jest.mock("@/lib/contabilidad/generador-asientos", () => {
  const actual = jest.requireActual("@/lib/contabilidad/generador-asientos");
  return {
    ...actual,
    crearAsiento: jest.fn().mockResolvedValue("asiento-uuid"),
  };
});

import { POST } from "@/app/api/canales/orders/[id]/accept/route";
import { crearAsiento } from "@/lib/contabilidad/generador-asientos";
import { getChannel } from "@/lib/canales/registry";

function setupMocks(overrides?: { orden?: Partial<typeof ORDEN_PENDING & { estado: string }> }) {
  ordenActual = { ...ORDEN_PENDING, ...overrides?.orden };
  productosDisponibles = PRODUCTOS_DB;
  canalOrdenUpdateCalls.length = 0;

  mockRpc.mockReset();
  mockRpc.mockResolvedValue({
    data: {
      venta: { id: VENTA_ID, total: 25458, numero_comprobante: "20260828-ABCD1234", created_at: "2026-08-28T12:00:00Z" },
      created: true,
    },
    error: null,
  });

  mockConfirmOrder.mockClear();
  mockLogAudit.mockClear();
  (crearAsiento as jest.Mock).mockClear();

  mockFrom.mockImplementation((table: string) => {
    if (table === "canal_ordenes") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: ordenActual, error: null }),
        update: jest.fn((vals: Record<string, unknown>) => {
          canalOrdenUpdateCalls.push(vals);
          return { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
        }),
      };
    }
    if (table === "productos") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: productosDisponibles, error: null }),
      };
    }
    if (table === "stock_reservas") {
      return {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    }
    throw new Error(`tabla no mockeada: ${table}`);
  });
}

function makeRequest() {
  return new NextRequest(`http://localhost/api/canales/orders/${ORDEN_ID}/accept`, {
    method: "POST",
  });
}

describe("POST /api/canales/orders/[id]/accept", () => {
  beforeEach(() => setupMocks());

  it("I-519: acepta la orden — el RPC crear_venta_tx recibe el total y el IVA extraído (no aditivo)", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fn, args] = mockRpc.mock.calls[0];
    expect(fn).toBe("crear_venta_tx");
    expect(args.p_total).toBe(25458);
    expect(args.p_subtotal).toBe(25458);
    // extracción: round(25458 × 0.19/1.19) = 4065 — no 4837 (aditiva)
    expect(args.p_impuesto).toBe(4065);
    expect(args.p_canal).toBe("rappi");
    expect(args.p_metodo_pago).toBe("plataforma");
  });

  it("I-530: p_procedencia usa el canalId real (no 'presencial') — distingue ventas con conexión sistémica de las manuales", async () => {
    await POST(makeRequest());
    const args = mockRpc.mock.calls[0][1];
    expect(args.p_procedencia).toBe("rappi");
  });

  it("I-520: los items enviados al RPC usan producto_id resuelto por SKU y precio_unitario (no `precio`)", async () => {
    await POST(makeRequest());

    const args = mockRpc.mock.calls[0][1];
    expect(args.p_items).toHaveLength(2);
    expect(args.p_items[0]).toEqual({
      producto_id: PRODUCTO_1,
      cantidad: 2,
      precio_unitario: 10000,
      subtotal: 20000,
      mascota_id: null,
    });
    expect(args.p_items[1].producto_id).toBe(PRODUCTO_2);
    expect(args.p_items[0]).not.toHaveProperty("precio");
  });

  it("I-521: responde accepted, vincula venta_id y actualiza canal_ordenes", async () => {
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.status).toBe("accepted");
    expect(body.ventaId).toBe(VENTA_ID);
    expect(body.total).toBe(25458);
    expect(canalOrdenUpdateCalls[0]).toEqual(
      expect.objectContaining({ estado: "accepted", venta_id: VENTA_ID })
    );
    expect(getChannel).toHaveBeenCalledWith("rappi");
    expect(mockConfirmOrder).toHaveBeenCalledTimes(1);
  });

  it("I-522: genera el asiento contable de la venta vía crearAsiento(lineasVentaCanal) — antes del fix nunca se llamaba", async () => {
    await POST(makeRequest());

    expect(after).toHaveBeenCalled();
    // Asiento de ingreso + asiento COGS (costoTotal = 2×4000 + 1×2000 = 10000 > 0)
    expect(crearAsiento).toHaveBeenCalledTimes(2);
    const [ingresoCall, cogsCall] = (crearAsiento as jest.Mock).mock.calls.map((c) => c[0]);
    expect(ingresoCall.canal).toBe("rappi");
    expect(ingresoCall.tipoMovimiento).toBe("VENTA");
    expect(ingresoCall.lineas.reduce((s: number, l: { debito: number }) => s + l.debito, 0)).toBe(25458);
    expect(cogsCall.lineas.reduce((s: number, l: { debito: number }) => s + l.debito, 0)).toBe(10000);
  });

  it("I-523: idempotency_key enviado al RPC es determinístico por canal + external_order_id", async () => {
    await POST(makeRequest());
    const args = mockRpc.mock.calls[0][1];
    expect(args.p_idempotency_key).toBe("canal:rappi:EXT-001");
  });

  it("I-524: reintento idempotente (RPC created=false) no repite auditoría, confirmación al canal ni asiento", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        venta: { id: VENTA_ID, total: 25458, numero_comprobante: "20260828-ABCD1234", created_at: "2026-08-28T12:00:00Z" },
        created: false,
      },
      error: null,
    });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ventaId).toBe(VENTA_ID);
    expect(mockConfirmOrder).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
    expect(crearAsiento).not.toHaveBeenCalled();
    expect(canalOrdenUpdateCalls).toHaveLength(0);
  });

  it("I-525: SKU no encontrado en el catálogo → 422, el RPC nunca se invoca (antes: se saltaba el item en silencio)", async () => {
    setupMocks();
    productosDisponibles = [PRODUCTOS_DB[0]]; // falta SKU-2
    mockFrom.mockImplementation((table: string) => {
      if (table === "canal_ordenes") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: ordenActual, error: null }),
          update: jest.fn().mockReturnValue({ eq: jest.fn() }),
        };
      }
      if (table === "productos") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: productosDisponibles, error: null }),
        };
      }
      throw new Error(`tabla no mockeada: ${table}`);
    });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toMatch(/SKU-2/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-526: stock insuficiente → 422, el RPC nunca se invoca", async () => {
    productosDisponibles = [
      { id: PRODUCTO_1, sku: "SKU-1", stock: 1, costo: 4000 }, // se piden 2
      PRODUCTOS_DB[1],
    ];
    mockFrom.mockImplementation((table: string) => {
      if (table === "canal_ordenes") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: ordenActual, error: null }),
          update: jest.fn().mockReturnValue({ eq: jest.fn() }),
        };
      }
      if (table === "productos") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: productosDisponibles, error: null }),
        };
      }
      throw new Error(`tabla no mockeada: ${table}`);
    });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toMatch(/Stock insuficiente/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-527: orden ya procesada (estado accepted) → 400, sin efectos secundarios", async () => {
    setupMocks({ orden: { estado: "accepted" } });

    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-529: orden inexistente o de otra tienda (filtro store_id sin match) → 404, sin efectos secundarios", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "canal_ordenes") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
          update: jest.fn(),
        };
      }
      throw new Error(`tabla no mockeada: ${table}`);
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-528: sin sesión → 401", async () => {
    const authModule = jest.requireMock("@/lib/auth") as { getStoreId: jest.Mock };
    authModule.getStoreId.mockResolvedValueOnce(null);

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
