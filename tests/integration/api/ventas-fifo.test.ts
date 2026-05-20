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

/**
 * Mock de lotes_producto para el query de COUNT.
 * Cadena: .select().eq().eq().eq().gt()  → resuelve con { count }
 */
function lotesCountMock(count: number) {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            gt: jest.fn().mockResolvedValue({ count, data: null, error: null }),
          }),
        }),
      }),
    }),
  };
}

/**
 * Configura mockFrom para un request de venta completo.
 * - productos: llamada 1 → .select().in().eq()  (precio)
 *              llamada 2 → .select().eq().in()  (hub-sync)
 */
function buildVentaMock({ tieneLoots = false, cantidad = 2 }: { tieneLoots?: boolean; cantidad?: number } = {}) {
  let productosCall = 0;

  mockFrom.mockImplementation((table: string) => {
    // ── productos ── (dos llamadas con cadenas distintas)
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

    // ── ventas ──
    if (table === "ventas") {
      return {
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: VENTA_ID, subtotal: 20000, impuesto: 0,
                descuento: 0, total: 20000, estado: "completada",
                created_at: new Date().toISOString(), numero_comprobante: "V-001",
              },
              error: null,
            }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      };
    }

    // ── venta_items ──
    if (table === "venta_items") {
      return {
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: VENTA_ITEM_ID, producto_id: PRODUCTO_ID, cantidad }],
            error: null,
          }),
        }),
      };
    }

    // ── pagos ──
    if (table === "pagos") {
      return { insert: jest.fn().mockResolvedValue({ error: null }) };
    }

    // ── lotes_producto ──
    if (table === "lotes_producto") {
      return lotesCountMock(tieneLoots ? 1 : 0);
    }

    // ── stock_movements ──
    if (table === "stock_movements") {
      return { insert: jest.fn().mockResolvedValue({ error: null }) };
    }

    // ── stores (opcional, sólo si cliente) ──
    if (table === "stores") {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      };
    }

    return {};
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Checkout con producto que tiene lotes (FIFO)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // mockReset limpia la cola de "Once" pendientes de tests anteriores
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ error: null });
  });

  it("descuenta del lote más antiguo primero", async () => {
    buildVentaMock({ tieneLoots: true });

    const res = await VentaPost(makeVentaRequest({
      items:       [{ producto_id: PRODUCTO_ID, cantidad: 2 }],
      metodoPago:  "efectivo",
      canal:       "pos",
      procedencia: "presencial",
    }));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("deducir_stock_fifo", expect.objectContaining({
      p_producto_id:   PRODUCTO_ID,
      p_store_id:      STORE_ID,
      p_cantidad:      2,
      p_venta_item_id: VENTA_ITEM_ID,
    }));
  });

  it("422 si stock total de lotes es insuficiente", async () => {
    buildVentaMock({ tieneLoots: true, cantidad: 999 });
    // Primera llamada a rpc será deducir_stock_fifo → falla
    mockRpc.mockResolvedValueOnce({ error: { message: "Stock insuficiente: disponible 0 vigentes, requerido 999" } });

    const res = await VentaPost(makeVentaRequest({
      items:       [{ producto_id: PRODUCTO_ID, cantidad: 999 }],
      metodoPago:  "efectivo",
      canal:       "pos",
      procedencia: "presencial",
    }));

    expect(res.status).toBe(422);
  });

  it("crea registros en venta_item_lotes cuando hay lotes", async () => {
    buildVentaMock({ tieneLoots: true });

    const res = await VentaPost(makeVentaRequest({
      items:       [{ producto_id: PRODUCTO_ID, cantidad: 2 }],
      metodoPago:  "efectivo",
      canal:       "pos",
      procedencia: "presencial",
    }));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("deducir_stock_fifo", expect.objectContaining({
      p_venta_item_id: VENTA_ITEM_ID,
    }));
  });
});

describe("Checkout con producto SIN lotes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ error: null });
  });

  it("usa lógica de deducción existente (decrement_stock)", async () => {
    buildVentaMock({ tieneLoots: false });

    const res = await VentaPost(makeVentaRequest({
      items:       [{ producto_id: PRODUCTO_ID, cantidad: 2 }],
      metodoPago:  "efectivo",
      canal:       "pos",
      procedencia: "presencial",
    }));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("decrement_stock", expect.objectContaining({
      p_producto_id: PRODUCTO_ID,
      p_cantidad:    2,
    }));
  });
});

describe("Devolución con trazabilidad de lotes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ error: null });
  });

  it("devuelve stock a lotes originales si hay venta_item_lotes", async () => {
    const ventaData    = { id: VENTA_ID, cliente_id: null, total: 20000, subtotal: 20000, estado: "pagada" };
    const ventaItemData = { id: VENTA_ITEM_ID, producto_id: PRODUCTO_ID, cantidad: 2, precio_unitario: 10000 };

    // ventas: patrón condicional → objeto plano con todos los métodos
    const ventasMock = flatQueryMock(ventaData);
    // venta_items: mismo patrón
    const ventaItemsMock = flatQueryMock(ventaItemData);

    mockFrom.mockImplementation((table: string) => {
      if (table === "ventas")            return ventasMock;
      if (table === "venta_items")       return ventaItemsMock;

      if (table === "notas_credito") {
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: "nc-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "nota_credito_items") {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      }

      // venta_item_lotes: .select().eq().limit()
      if (table === "venta_item_lotes") {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: [{ id: "vil-1" }], error: null }),
            }),
          }),
        };
      }

      if (table === "stock_movements") {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "saldos_a_favor") {
        const m = flatQueryMock(null);
        m.upsert = jest.fn().mockResolvedValue({ error: null });
        return m;
      }
      if (table === "fidelizacion") {
        const m = flatQueryMock(null);
        m.update = jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        });
        return m;
      }

      return {};
    });

    const res = await NotaCreditoPost(makeNCRequest({
      ventaId:       VENTA_ID,
      items:         [{ ventaItemId: VENTA_ITEM_ID, cantidadDevuelta: 2, restituirStock: true }],
      tipoReembolso: "reembolso_directo",
      motivo:        "Producto defectuoso",
    }));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("devolver_stock_a_lotes", {
      p_venta_item_id: VENTA_ITEM_ID,
    });
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
