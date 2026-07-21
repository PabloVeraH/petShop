/**
 * Tests I-233 a I-238: Cobertura de logAudit en endpoints modificados
 * Verifica que logAudit se llama correctamente con action, entityType y result.
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const USER_ID = "u1";
const VENTA_ID = "323e4567-e89b-12d3-a456-426614174002";
const CLIENTE_ID = "223e4567-e89b-12d3-a456-426614174001";
const CAT_ID = "123e4567-e89b-12d3-a456-426614174099";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";
const CUENTA_ID = "123e4567-e89b-12d3-a456-426614174001";

const mockGetStoreId = jest.fn();
const mockAuth = jest.fn();
const mockGetAdminStatus = jest.fn();
const mockFrom = jest.fn();
const mockSingle = jest.fn();
const mockLogAudit = jest.fn();
const mockGetRequestMetadata = jest.fn(() => ({ ipAddress: "127.0.0.1", userAgent: "test-agent" }));
const mockSyncProductsToHub = jest.fn();
const mockCrearAsiento = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
jest.mock("@/lib/admin-check", () => ({ getAdminStatus: mockGetAdminStatus }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/audit", () => ({
  logAudit: mockLogAudit,
  getRequestMetadata: mockGetRequestMetadata,
}));
jest.mock("@/lib/hub-sync", () => ({ syncProductsToHub: mockSyncProductsToHub }));
jest.mock("@/lib/contabilidad/generador-asientos", () => ({
  crearAsiento: mockCrearAsiento.mockResolvedValue(undefined),
  lineasNotaCredito: jest.fn(() => []),
  lineasPagoProveedor: jest.fn(() => []),
}));

function req(url: string, method = "GET", body?: object) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

function patchParams(id: string) {
  return Promise.resolve({ id });
}

function ncChain(venta: any, ventaItem: any) {
  const queries = { ventas: 0, venta_items: 0, notas_credito: 0, nc_items: 0, productos: 0, saldos: 0, fidel: 0, stock_movements: 0 };

  return jest.fn((table: string) => {
    const chain: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
      upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      gt: jest.fn().mockReturnThis(),
    };

    if (table === "ventas") {
      queries.ventas++;
      chain.single.mockResolvedValue({ data: venta, error: venta ? null : new Error("Not found") });
      return chain;
    }
    if (table === "venta_items") {
      queries.venta_items++;
      chain.single.mockResolvedValue({ data: ventaItem, error: null });
      return chain;
    }
    if (table === "notas_credito") {
      queries.notas_credito++;
      chain.insert.mockReturnThis();
      chain.single.mockResolvedValue({
        data: { id: "nc1", numero_nc: "NC-20260508-TEST1234" },
        error: null,
      });
      return chain;
    }
    if (table === "nota_credito_items") {
      queries.nc_items++;
      chain.insert.mockResolvedValue({ error: null });
      return chain;
    }
    if (table === "productos") {
      queries.productos++;
      chain.single.mockResolvedValue({ data: { stock: 10 }, error: null });
      chain.eq.mockReturnThis();
      return chain;
    }
    if (table === "stock_movements") {
      queries.stock_movements++;
      chain.insert.mockResolvedValue({ error: null });
      return chain;
    }
    if (table === "saldos_a_favor") {
      queries.saldos++;
      chain.eq.mockReturnThis();
      chain.single.mockResolvedValue({ data: null, error: new Error("Not found") });
      chain.upsert.mockResolvedValue({ data: null, error: null });
      return chain;
    }
    if (table === "fidelizacion") {
      queries.fidel++;
      chain.eq.mockReturnThis();
      chain.single.mockResolvedValue({ data: null, error: new Error("Not found") });
      return chain;
    }
    return chain;
  });
}

function ncChainWithError(venta: any, ventaItem: any, ncInsertError: string) {
  return jest.fn((table: string) => {
    const chain: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
      upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      gt: jest.fn().mockReturnThis(),
    };

    if (table === "ventas") {
      chain.single.mockResolvedValue({ data: venta, error: venta ? null : new Error("Not found") });
      return chain;
    }
    if (table === "venta_items") {
      chain.single.mockResolvedValue({ data: ventaItem, error: null });
      return chain;
    }
    if (table === "notas_credito") {
      chain.insert.mockReturnThis();
      chain.single.mockResolvedValue({
        data: null,
        error: { message: ncInsertError, code: "23503" },
      });
      return chain;
    }
    if (table === "nota_credito_items") {
      chain.insert.mockResolvedValue({ error: null });
      return chain;
    }
    if (table === "productos") {
      chain.single.mockResolvedValue({ data: { stock: 10 }, error: null });
      chain.eq.mockReturnThis();
      return chain;
    }
    if (table === "stock_movements") {
      chain.insert.mockResolvedValue({ error: null });
      return chain;
    }
    if (table === "saldos_a_favor") {
      chain.eq.mockReturnThis();
      chain.single.mockResolvedValue({ data: null, error: new Error("Not found") });
      chain.upsert.mockResolvedValue({ data: null, error: null });
      return chain;
    }
    if (table === "fidelizacion") {
      chain.eq.mockReturnThis();
      chain.single.mockResolvedValue({ data: null, error: new Error("Not found") });
      return chain;
    }
    return chain;
  });
}

function catChain(catData: any) {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    eq: jest.fn(),
    order: jest.fn().mockResolvedValue({ data: [], error: null }),
    single: mockSingle,
  };
  ["select", "insert", "update", "eq", "order"].forEach(k => c[k].mockReturnValue(c));
  if (catData) {
    mockSingle.mockResolvedValue({ data: catData, error: null });
  }
  return c;
}

function productoChain(productoData: any, lotesCount = 0) {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    eq: jest.fn(),
    or: jest.fn(),
    gt: jest.fn(),
    limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    single: mockSingle,
  };
  ["select", "insert", "update", "eq", "or", "gt"].forEach(k => c[k].mockReturnValue(c));
  if (productoData) {
    mockSingle.mockResolvedValue({ data: productoData, error: null });
  }
  if (lotesCount > 0) {
    c.limit = jest.fn().mockResolvedValue({ data: [], count: lotesCount, error: null });
  }
  return c;
}

function cuentasPagarChain(cuentaData: any) {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    update: jest.fn(),
    eq: jest.fn(),
    neq: jest.fn(),
    order: jest.fn(),
    single: mockSingle,
  };
  ["select", "update", "eq", "neq", "order"].forEach(k => c[k].mockReturnValue(c));
  if (cuentaData) {
    mockSingle.mockResolvedValue({ data: cuentaData, error: null });
  }
  return c;
}

function ordenesCompraChain(ordenData: any) {
  const c: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn(function() { return this; }),
    single: mockSingle,
  };
  if (ordenData) {
    mockSingle.mockResolvedValue({ data: ordenData, error: null });
  }
  return c;
}

// ──────────────────────────────────────────────────────────────────────────────
// I-233: POST /api/notas-credito llama logAudit con action: CREATE, entityType: nota_credito
// ──────────────────────────────────────────────────────────────────────────────

describe("I-233: POST /api/notas-credito → logAudit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: USER_ID, storeId: STORE_ID, systemAdmin: false });
    mockLogAudit.mockResolvedValue(undefined);
  });

  it("I-233: POST exitoso llama logAudit con action: CREATE, entityType: nota_credito", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada", total: 5000 };
    const ventaItem = {
      id: "423e4567-e89b-12d3-a456-426614174003",
      producto_id: "523e4567-e89b-12d3-a456-426614174004",
      cantidad: 5,
      precio_unitario: 1000,
    };
    mockFrom.mockImplementation(ncChain(venta, [ventaItem]));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 2, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CREATE",
        entityType: "nota_credito",
        storeId: STORE_ID,
        userId: USER_ID,
      })
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// I-234: POST /api/categorias llama logAudit con action: CREATE, entityType: categoria
// ──────────────────────────────────────────────────────────────────────────────

describe("I-234: POST /api/categorias → logAudit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({ isSystemAdmin: false, isStoreAdmin: true, storeId: STORE_ID, userId: USER_ID });
    mockLogAudit.mockResolvedValue(undefined);
  });

  it("I-234: POST exitoso llama logAudit con action: CREATE, entityType: categoria", async () => {
    mockFrom.mockReturnValue(catChain({
      id: CAT_ID,
      store_id: STORE_ID,
      nombre: "Accesorios",
      descripcion: null,
      activo: true,
    }));

    const { POST } = await import("@/app/api/categorias/route");
    const res = await POST(req("/api/categorias", "POST", { nombre: "Accesorios" }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.nombre).toBe("Accesorios");

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CREATE",
        entityType: "categoria",
        storeId: STORE_ID,
        userId: USER_ID,
      })
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// I-235: PATCH /api/productos/[id] llama logAudit con action: UPDATE, entityType: producto
// ──────────────────────────────────────────────────────────────────────────────

describe("I-235: PATCH /api/productos/[id] → logAudit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: USER_ID, storeId: STORE_ID });
    mockLogAudit.mockResolvedValue(undefined);
  });

  it("I-235: PATCH exitoso llama logAudit con action: UPDATE, entityType: producto", async () => {
    const productoAnterior = {
      id: PRODUCTO_ID,
      nombre: "Test",
      sku: "SKU1",
      precio: 1000,
      stock: 5,
      activo: true,
      marca: null,
    };
    const productoActualizado = {
      id: PRODUCTO_ID,
      nombre: "Test",
      sku: "SKU1",
      precio: 9999,
      stock: 5,
      activo: true,
      marca: null,
    };

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      const c = productoChain(null, 0);
      if (callCount === 1) {
        mockSingle.mockResolvedValue({ data: productoAnterior, error: null });
      } else {
        mockSingle.mockResolvedValue({ data: productoActualizado, error: null });
      }
      return c;
    });

    const { PATCH } = await import("@/app/api/productos/[id]/route");
    const res = await PATCH(
      req(`/api/productos/${PRODUCTO_ID}`, "PATCH", { precio: 9999 }),
      { params: patchParams(PRODUCTO_ID) }
    );

    expect(res.status).toBe(200);

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "UPDATE",
        entityType: "producto",
        storeId: STORE_ID,
        userId: USER_ID,
        entityId: PRODUCTO_ID,
      })
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// I-236: PATCH /api/cuentas-pagar llama logAudit con action: UPDATE, entityType: cuenta_pagar
// ──────────────────────────────────────────────────────────────────────────────

describe("I-236: PATCH /api/cuentas-pagar → logAudit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: USER_ID, storeId: STORE_ID });
    mockLogAudit.mockResolvedValue(undefined);
  });

  it("I-236: PATCH exitoso llama logAudit con action: UPDATE, entityType: cuenta_pagar", async () => {
    const cuentaAnterior = { id: CUENTA_ID, estado: "pendiente", store_id: STORE_ID };
    const cuentaActualizada = {
      id: CUENTA_ID,
      estado: "pagada",
      store_id: STORE_ID,
      monto: 3800,
      updated_at: "2026-04-24T12:00:00Z",
    };

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      const c = cuentasPagarChain(null);
      if (callCount === 1) {
        mockSingle.mockResolvedValue({ data: cuentaAnterior, error: null });
      } else {
        mockSingle.mockResolvedValue({ data: cuentaActualizada, error: null });
      }
      return c;
    });

    const { PATCH } = await import("@/app/api/cuentas-pagar/route");
    const res = await PATCH(
      new NextRequest(`http://localhost/api/cuentas-pagar?id=${CUENTA_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "pagada" }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.estado).toBe("pagada");

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "UPDATE",
        entityType: "cuenta_pagar",
        storeId: STORE_ID,
        userId: USER_ID,
        entityId: CUENTA_ID,
      })
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// I-237: POST /api/ordenes-compra llama logAudit con action: CREATE, entityType: orden_compra
// ──────────────────────────────────────────────────────────────────────────────

describe("I-237: POST /api/ordenes-compra → logAudit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: USER_ID, storeId: STORE_ID });
    mockLogAudit.mockResolvedValue(undefined);
  });

  it("I-237: POST exitoso llama logAudit con action: CREATE, entityType: orden_compra", async () => {
    const ordenCreada = {
      id: "a57ace69-a5f4-4089-83e9-04d92c27dd43",
      numero: "OC-20260520-ABC123",
      estado: "pendiente",
      total: null,
      fecha_estimada: "2026-05-01",
      created_at: "2026-05-20T10:00:00Z",
      proveedor_id: "d93cfe99-3abf-4255-8f5f-be40d3d452a0",
    };

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      const c = ordenesCompraChain(null);
      if (callCount === 1) {
        mockSingle.mockResolvedValue({ data: ordenCreada, error: null });
      }
      return c;
    });

    const { POST } = await import("@/app/api/ordenes-compra/route");
    const res = await POST(
      new NextRequest("http://localhost/api/ordenes-compra", {
        method: "POST",
        body: JSON.stringify({
          proveedor_id: "d93cfe99-3abf-4255-8f5f-be40d3d452a0",
          items: [
            { producto_id: "24ab45db-484f-4e24-9c22-fe9c0894e2b5", cantidad_solicitada: 10 },
          ],
        }),
      })
    );

    expect(res.status).toBe(200);

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CREATE",
        entityType: "orden_compra",
        storeId: STORE_ID,
        userId: USER_ID,
      })
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// I-238: error en route → logAudit con result: failure
// ──────────────────────────────────────────────────────────────────────────────

describe("I-238: error en route → logAudit con result: failure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: USER_ID, storeId: STORE_ID, systemAdmin: false });
    mockLogAudit.mockResolvedValue(undefined);
  });

  it("I-238: error de BD en POST notas-credito → logAudit con result: failure y errorMessage", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada", total: 5000 };
    const ventaItem = {
      id: "423e4567-e89b-12d3-a456-426614174003",
      producto_id: "523e4567-e89b-12d3-a456-426614174004",
      cantidad: 5,
      precio_unitario: 1000,
    };
    mockFrom.mockImplementation(ncChainWithError(venta, ventaItem, "FK violation"));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 2, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CREATE",
        entityType: "nota_credito",
        storeId: STORE_ID,
        userId: USER_ID,
        result: "failure",
        errorMessage: "FK violation",
      })
    );
  });
});
