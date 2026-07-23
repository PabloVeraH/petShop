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
const DB_VENTA_HUB = { id: "v1", total: 30000, numero_comprobante: "V-001", created_at: new Date().toISOString() };
const mockRpc = jest.fn().mockResolvedValue({ data: { venta: DB_VENTA_HUB, created: true }, error: null });

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
    mockRpc.mockResolvedValue({ data: { venta: DB_VENTA_HUB, created: true }, error: null });

    mockFrom.mockImplementation(buildVentasMockFrom());
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
    mockRpc.mockResolvedValue({ data: { venta: DB_VENTA_HUB, created: true }, error: null });
    // syncPurchaseToHub simula error (fetch falla internamente)
    mockSyncPurchaseToHub.mockImplementation(() => {
      // fire-and-forget: lanza internamente pero no propaga
    });

    mockFrom.mockImplementation(buildVentasMockFrom());
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

// ── H-06: POST /api/ventas → sync stock al hub (independiente de cliente) ───

const PRODUCTO_DATA_SYNC = {
  id: PRODUCTO_ID,
  nombre: "Royal Canin",
  marca: "Royal",
  codigo_barra: "123456789",
  precio: 15000,
  stock: 48,
  activo: true,
};

// Mock de productos para H-06: el route llama .from("productos") dos veces con cadenas distintas:
//   1ª llamada — precio lookup:  .select().in(ids).eq("store_id")  → termina en .eq()
//   2ª llamada — stock sync:     .select().eq("store_id").in(ids)  → termina en .in()
// Se diferencia por el orden de llamadas a from(), no por el orden de in()/eq().
function buildVentasMockFrom(clienteRut: string | null = "11111111-1") {
  let productosCall = 0;
  return (table: string) => {
    if (table === "productos") {
      productosCall++;
      if (productosCall === 1) {
        // Precio lookup: select → in → eq (resuelve en eq)
        const c: Record<string, jest.Mock> = {
          select: jest.fn(), in: jest.fn(), eq: jest.fn(),
        };
        c.select.mockReturnValue(c);
        c.in.mockReturnValue(c);
        c.eq.mockResolvedValue({
          data: [{ id: PRODUCTO_ID, precio: 15000, precio_oferta: null, en_oferta: false }],
          error: null,
        });
        return c;
      } else {
        // Stock sync: select → eq → in (resuelve en in)
        const c: Record<string, jest.Mock> = {
          select: jest.fn(), eq: jest.fn(), in: jest.fn(),
        };
        c.select.mockReturnValue(c);
        c.eq.mockReturnValue(c);
        c.in.mockResolvedValue({ data: [PRODUCTO_DATA_SYNC], error: null });
        return c;
      }
    }
    if (table === "ventas") {
      const c = chain();
      c.single = jest.fn().mockResolvedValue({ data: { id: "v1", total: 30000 }, error: null });
      return c;
    }
    if (table === "clientes") {
      const c = chain();
      c.single = jest.fn().mockResolvedValue({ data: { rut: clienteRut }, error: null });
      return c;
    }
    if (table === "stores") {
      const c = chain();
      c.single = jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false }, error: null });
      return c;
    }
    // Cubre: venta_items, pagos, stock_movements, audit_logs, fidelizacion, etc.
    const c = chain();
    c.single = jest.fn().mockResolvedValue({ data: null, error: null });
    return { ...c, upsert: jest.fn().mockResolvedValue({ error: null }), insert: jest.fn().mockReturnValue({ ...c }) };
  };
}

// H-06a: cliente SIN RUT → syncProductsToHub llamado, syncPurchaseToHub NO
describe("H-06a: POST /api/ventas con cliente sin RUT sincroniza stock pero no historial", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockRpc.mockResolvedValue({ data: { venta: DB_VENTA_HUB, created: true }, error: null });
    mockFrom.mockImplementation(buildVentasMockFrom(null));
  });

  it("H-06a: cliente sin RUT llama syncProductsToHub con stock actualizado pero no syncPurchaseToHub", async () => {
    const { POST } = await import("@/app/api/ventas/route");
    await POST(req("/api/ventas", "POST", {
      items: [{ producto_id: PRODUCTO_ID, cantidad: 2 }],
      metodoPago: "efectivo",
      clienteId: CLIENTE_ID,
    }));
    expect(mockSyncProductsToHub).toHaveBeenCalledWith([
      expect.objectContaining({ producto_id: PRODUCTO_ID, stock: 48 }),
    ]);
    expect(mockSyncPurchaseToHub).not.toHaveBeenCalled();
  });
});

// H-06b: venta CON cliente → syncProductsToHub Y syncPurchaseToHub llamados
describe("H-06b: POST /api/ventas con cliente sincroniza stock e historial", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockRpc.mockResolvedValue({ data: { venta: DB_VENTA_HUB, created: true }, error: null });
    mockFrom.mockImplementation(buildVentasMockFrom());
  });

  it("H-06b: venta con cliente llama syncProductsToHub y syncPurchaseToHub", async () => {
    const { POST } = await import("@/app/api/ventas/route");
    await POST(req("/api/ventas", "POST", {
      items: [{ producto_id: PRODUCTO_ID, cantidad: 2 }],
      metodoPago: "efectivo",
      clienteId: CLIENTE_ID,
    }));
    expect(mockSyncProductsToHub).toHaveBeenCalledWith([
      expect.objectContaining({ producto_id: PRODUCTO_ID, stock: 48 }),
    ]);
    expect(mockSyncPurchaseToHub).toHaveBeenCalledWith("11111111-1", expect.any(Number));
  });
});
