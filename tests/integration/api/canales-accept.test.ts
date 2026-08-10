/**
 * Tests I-325 a I-327: POST /api/canales/orders/[id]/accept
 *
 * Regresión IVA: la venta creada al aceptar una orden de canal debe persistir
 * `impuesto` con la fórmula de extracción (los precios de canal son brutos,
 * IVA incluido — misma regla que el POS). Antes del fix la venta quedaba con
 * impuesto NULL, y el insert de venta_items usaba la columna inexistente
 * `precio` (precio_unitario es NOT NULL), fallando siempre en silencio.
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const ORDEN_ID = "123e4567-e89b-12d3-a456-426614174050";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";
const VENTA_ID = "123e4567-e89b-12d3-a456-426614174030";

// total bruto = 2×10.000 + 1×5.458 = 25.458 → IVA extraído = round(25458×0.19/1.19) = 4.065
const ORDEN = {
  id: ORDEN_ID,
  store_id: STORE_ID,
  canal_id: "rappi",
  estado: "pending",
  external_order_id: "EXT-001",
  raw_payload: {
    items: [
      { id: "SKU-1", quantity: 2, unit_price: 10000 },
      { id: "SKU-2", quantity: 1, unit_price: 5458 },
    ],
  },
  canal_config: null,
};

const mockVentaInsert = jest.fn();
const mockVentaItemsInsert = jest.fn();
const mockCanalOrdenUpdate = jest.fn();
const mockRpc = jest.fn().mockResolvedValue({ data: null, error: null });
const mockFrom = jest.fn();

jest.mock("@/lib/auth", () => ({
  getStoreId: jest.fn().mockResolvedValue({ userId: "user-1", storeId: "123e4567-e89b-12d3-a456-426614174000" }),
}));

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));

jest.mock("@/lib/canales/registry", () => ({
  getChannel: jest.fn(() => ({ confirmOrder: jest.fn().mockResolvedValue(undefined) })),
}));

jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler) => handler,
  logAudit: jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn().mockResolvedValue({ ipAddress: "127.0.0.1", userAgent: "jest" }),
}));

import { POST } from "@/app/api/canales/orders/[id]/accept/route";

function setupMocks() {
  mockVentaInsert.mockClear();
  mockVentaItemsInsert.mockClear();
  mockCanalOrdenUpdate.mockClear();
  mockRpc.mockClear();

  mockFrom.mockImplementation((table: string) => {
    if (table === "canal_ordenes") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: ORDEN, error: null }),
        update: mockCanalOrdenUpdate.mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      };
    }
    if (table === "ventas") {
      return {
        insert: mockVentaInsert.mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: VENTA_ID }, error: null }),
          }),
        }),
      };
    }
    if (table === "productos") {
      // select("id").eq("store_id").eq("sku") — el builder completo se awaitea
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: [{ id: PRODUCTO_ID }], error: null }),
      };
    }
    if (table === "venta_items") {
      return {
        insert: mockVentaItemsInsert.mockResolvedValue({ data: null, error: null }),
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

describe("POST /api/canales/orders/[id]/accept — IVA en venta de canal", () => {
  beforeEach(setupMocks);

  // I-325: REGRESIÓN — la venta debe persistir impuesto con extracción
  it("I-325: la venta creada incluye impuesto extraído del total bruto", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(mockVentaInsert).toHaveBeenCalledTimes(1);
    const venta = mockVentaInsert.mock.calls[0][0];
    expect(venta.total).toBe(25458);
    // extracción: round(25458 × 0.19/1.19) = 4065 — NO 4837 (aditiva) ni undefined
    expect(venta.impuesto).toBe(4065);
  });

  // I-326: REGRESIÓN — venta_items usa la columna real precio_unitario
  it("I-326: los items se insertan con precio_unitario (no la columna inexistente precio)", async () => {
    await POST(makeRequest());

    expect(mockVentaItemsInsert).toHaveBeenCalledTimes(2);
    for (const call of mockVentaItemsInsert.mock.calls) {
      const item = call[0];
      expect(item.precio_unitario).toBeGreaterThan(0);
      expect(item).not.toHaveProperty("precio");
      expect(item.venta_id).toBe(VENTA_ID);
    }
  });

  // I-327: la orden queda aceptada y vinculada a la venta
  it("I-327: responde accepted y marca la orden con venta_id", async () => {
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.status).toBe("accepted");
    expect(body.ventaId).toBe(VENTA_ID);
    expect(mockCanalOrdenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "accepted", venta_id: VENTA_ID })
    );
  });
});
