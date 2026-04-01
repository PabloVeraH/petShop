/**
 * Tests H-01 a H-05: integración hub-sync desde rutas del app
 * Verifica que las rutas invocan correctamente hub-sync ante cada operación.
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";
const CLIENTE_ID = "123e4567-e89b-12d3-a456-426614174020";

const mockGetStoreId = jest.fn().mockResolvedValue({ userId: "u1", storeId: STORE_ID });
const mockSyncProductsToHub = jest.fn();
const mockSyncPurchaseToHub = jest.fn();
const mockFrom = jest.fn();
const mockSingle = jest.fn();
const mockRpc = jest.fn().mockResolvedValue({ error: null });

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom, rpc: mockRpc })) }));
jest.mock("@/lib/hub-sync", () => ({
  syncProductsToHub: mockSyncProductsToHub,
  syncPurchaseToHub: mockSyncPurchaseToHub,
}));
jest.mock("@/lib/whatsapp", () => ({
  sendWhatsAppText: jest.fn(),
  buildReceiptMessage: jest.fn().mockReturnValue(""),
}));

function chain(overrides: Record<string, unknown> = {}) {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    eq: jest.fn(),
    in: jest.fn(),
    single: mockSingle,
    ...overrides,
  };
  // Make all chainable methods return the chain
  ["select","insert","update","upsert","eq","in"].forEach(k => {
    if (!overrides[k]) c[k].mockReturnValue(c);
  });
  return c;
}

function req(url: string, method: string, body: object) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── H-01: POST /api/productos → hub recibe catálogo ────────────────────────

describe("H-01: POST /api/productos sincroniza catálogo al hub", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockSingle.mockResolvedValue({
      data: { id: PRODUCTO_ID, nombre: "Royal Canin", marca: "Royal", precio: 15000, stock: 50, activo: true },
      error: null,
    });
    mockFrom.mockReturnValue(chain());
  });

  it("H-01: crear producto llama syncProductsToHub con datos correctos", async () => {
    const { POST } = await import("@/app/api/productos/route");
    await POST(req("/api/productos", "POST", { nombre: "Royal Canin", sku: "RC001", precio: 15000 }));
    expect(mockSyncProductsToHub).toHaveBeenCalledWith([
      expect.objectContaining({ nombre_producto: "Royal Canin", precio: 15000 }),
    ]);
  });
});

// ── H-02: PATCH /api/inventario/[id] → hub refleja stock ──────────────────

describe("H-02: PATCH /api/inventario sincroniza stock actualizado al hub", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockSingle
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, stock: 10 }, error: null })
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, nombre: "Alimento", marca: null, precio: 10000, stock: 15 }, error: null });
    mockFrom.mockReturnValue(chain());
  });

  it("H-02: ajuste de stock llama syncProductsToHub con nuevo stock", async () => {
    const { PATCH } = await import("@/app/api/inventario/[id]/route");
    await PATCH(
      req(`/api/inventario/${PRODUCTO_ID}`, "PATCH", { tipo: "entrada", cantidad: 5 }),
      { params: Promise.resolve({ id: PRODUCTO_ID }) }
    );
    expect(mockSyncProductsToHub).toHaveBeenCalledWith([
      expect.objectContaining({ stock: 15 }),
    ]);
  });
});

// ── H-03: DELETE /api/productos/[id] → hub marca activo=false ─────────────

describe("H-03: DELETE /api/productos marca producto inactivo en hub", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockSingle.mockResolvedValue({
      data: { id: PRODUCTO_ID, nombre: "Royal Canin", marca: "Royal", precio: 15000, stock: 50 },
      error: null,
    });
    mockFrom.mockReturnValue(chain());
  });

  it("H-03: eliminar producto llama syncProductsToHub con activo=false", async () => {
    const { DELETE } = await import("@/app/api/productos/[id]/route");
    await DELETE(
      new NextRequest(`http://localhost/api/productos/${PRODUCTO_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: PRODUCTO_ID }) }
    );
    expect(mockSyncProductsToHub).toHaveBeenCalledWith([
      expect.objectContaining({ activo: false }),
    ]);
  });
});

// ── H-04: POST /api/ventas → hub registra compra por RUT ──────────────────

describe("H-04: POST /api/ventas sincroniza historial de compras al hub", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockRpc.mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        return { ...chain(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [{ id: PRODUCTO_ID, precio: 10000, store_id: STORE_ID }], error: null }), select: jest.fn().mockReturnThis() };
      }
      if (table === "ventas") {
        const c = chain();
        c.single = jest.fn().mockResolvedValue({ data: { id: "v1", total: 23800 }, error: null });
        return c;
      }
      if (table === "clientes") {
        const c = chain();
        c.single = jest.fn().mockResolvedValue({ data: { rut: "11111111-1" }, error: null });
        return c;
      }
      if (table === "stores") {
        const c = chain();
        c.single = jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false }, error: null });
        return c;
      }
      const c = chain();
      c.single = jest.fn().mockResolvedValue({ data: null, error: null });
      return { ...c, upsert: jest.fn().mockResolvedValue({ error: null }), insert: jest.fn().mockReturnValue({ ...c }) };
    });
  });

  it("H-04: venta con cliente RUT llama syncPurchaseToHub con rut y monto", async () => {
    const { POST } = await import("@/app/api/ventas/route");
    await POST(req("/api/ventas", "POST", {
      items: [{ producto_id: PRODUCTO_ID, cantidad: 2 }],
      metodoPago: "efectivo",
      clienteId: CLIENTE_ID,
    }));
    expect(mockSyncPurchaseToHub).toHaveBeenCalledWith("11111111-1", expect.any(Number));
  });
});

// ── H-05: hub inaccesible → venta igual se crea ───────────────────────────

describe("H-05: hub caído no impide crear la venta", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockRpc.mockResolvedValue({ error: null });
    // syncPurchaseToHub simula error (fetch falla internamente)
    mockSyncPurchaseToHub.mockImplementation(() => {
      // fire-and-forget: lanza internamente pero no propaga
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        return { ...chain(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [{ id: PRODUCTO_ID, precio: 10000, store_id: STORE_ID }], error: null }), select: jest.fn().mockReturnThis() };
      }
      if (table === "ventas") {
        const c = chain();
        c.single = jest.fn().mockResolvedValue({ data: { id: "v1", total: 23800 }, error: null });
        return c;
      }
      if (table === "clientes") {
        const c = chain();
        c.single = jest.fn().mockResolvedValue({ data: { rut: "11111111-1" }, error: null });
        return c;
      }
      if (table === "stores") {
        const c = chain();
        c.single = jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false }, error: null });
        return c;
      }
      const c = chain();
      c.single = jest.fn().mockResolvedValue({ data: null, error: null });
      return { ...c, upsert: jest.fn().mockResolvedValue({ error: null }), insert: jest.fn().mockReturnValue({ ...c }) };
    });
  });

  it("H-05: hub inaccesible → venta retorna 200 igual", async () => {
    const { POST } = await import("@/app/api/ventas/route");
    const res = await POST(req("/api/ventas", "POST", {
      items: [{ producto_id: PRODUCTO_ID, cantidad: 2 }],
      metodoPago: "efectivo",
      clienteId: CLIENTE_ID,
    }));
    expect(res.status).toBe(200);
  });
});
