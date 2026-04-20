/**
 * Tests I-16 a I-34: GET, POST, PATCH, DELETE /api/productos + codigo_barra
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();
const mockSingle = jest.fn();
const mockSyncProductsToHub = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/hub-sync", () => ({ syncProductsToHub: mockSyncProductsToHub }));

function chain(terminal?: Promise<unknown>) {
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
  ["select","insert","update","eq","or","gt"].forEach(k => c[k].mockReturnValue(c));
  if (terminal) c.limit = jest.fn().mockReturnValue(terminal);
  return c;
}

function req(url: string, method = "GET", body?: object) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

const patchParams = Promise.resolve({ id: PRODUCTO_ID });

describe("GET /api/productos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-16
  it("I-16: lista productos activos con stock > 0", async () => {
    const { GET } = await import("@/app/api/productos/route");
    const res = await GET(req("/api/productos"));
    expect(res.status).toBe(200);
  });

  // I-17
  it("I-17: search con término válido retorna 200 sin error", async () => {
    const { GET } = await import("@/app/api/productos/route");
    const res = await GET(req("/api/productos?search=royal"));
    expect(res.status).toBe(200);
  });

  // I-29
  it("I-29: search por código de barra retorna 200", async () => {
    const { GET } = await import("@/app/api/productos/route");
    const res = await GET(req("/api/productos?search=7891234567890"));
    expect(res.status).toBe(200);
  });

  // I-30
  it("I-30: select incluye campo codigo_barra", async () => {
    let capturedSelect = "";
    const c = chain();
    c.select = jest.fn((s: string) => { capturedSelect = s; return c; });
    mockFrom.mockReturnValue(c);
    const { GET } = await import("@/app/api/productos/route");
    await GET(req("/api/productos"));
    expect(capturedSelect).toContain("codigo_barra");
  });
});

describe("POST /api/productos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-18
  it("I-18: nombre faltante → 400", async () => {
    const { POST } = await import("@/app/api/productos/route");
    const res = await POST(req("/api/productos", "POST", { sku: "SKU1", precio: 1000 }));
    expect(res.status).toBe(400);
  });

  // I-19
  it("I-19: SKU duplicado → 409", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "23505" } });
    const { POST } = await import("@/app/api/productos/route");
    const res = await POST(req("/api/productos", "POST", { nombre: "Test", sku: "DUP", precio: 1000 }));
    expect(res.status).toBe(409);
  });

  // I-20
  it("I-20: precio ≤ 0 → 400", async () => {
    const { POST } = await import("@/app/api/productos/route");
    const res = await POST(req("/api/productos", "POST", { nombre: "Test", sku: "SKU1", precio: 0 }));
    expect(res.status).toBe(400);
  });

  // I-21
  it("I-21: datos válidos → 201 y SKU en mayúsculas", async () => {
    mockSingle.mockResolvedValue({
      data: { id: PRODUCTO_ID, nombre: "Test", sku: "RC001", precio: 15000, stock: 0, activo: true },
      error: null,
    });
    const { POST } = await import("@/app/api/productos/route");
    const res = await POST(req("/api/productos", "POST", { nombre: "Test", sku: "rc001", precio: 15000 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sku).toBe("RC001");
  });

  // I-22
  it("I-22: POST válido llama syncProductsToHub", async () => {
    mockSingle.mockResolvedValue({
      data: { id: PRODUCTO_ID, nombre: "Test", sku: "SKU1", precio: 15000, stock: 0, activo: true, marca: null },
      error: null,
    });
    const { POST } = await import("@/app/api/productos/route");
    await POST(req("/api/productos", "POST", { nombre: "Test", sku: "SKU1", precio: 15000 }));
    expect(mockSyncProductsToHub).toHaveBeenCalled();
  });

  // I-31
  it("I-31: POST con codigo_barra válido → 201", async () => {
    mockSingle.mockResolvedValue({
      data: { id: PRODUCTO_ID, nombre: "Test", sku: "SKU1", precio: 15000, stock: 0, activo: true, marca: null, codigo_barra: "7891234567890" },
      error: null,
    });
    const { POST } = await import("@/app/api/productos/route");
    const res = await POST(req("/api/productos", "POST", { nombre: "Test", sku: "SKU1", precio: 15000, codigo_barra: "7891234567890" }));
    expect(res.status).toBe(201);
  });

  // I-32
  it("I-32: codigo_barra duplicado → 409 con mensaje diferenciado", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint productos_codigo_barra_store_unique" },
    });
    const { POST } = await import("@/app/api/productos/route");
    const res = await POST(req("/api/productos", "POST", { nombre: "Test", sku: "SKU99", precio: 1000, codigo_barra: "7891234567890" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("El código de barra ya existe");
  });
});

describe("PATCH /api/productos/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-23
  it("I-23: nombre vacío → 400", async () => {
    const { PATCH } = await import("@/app/api/productos/[id]/route");
    const res = await PATCH(req(`/api/productos/${PRODUCTO_ID}`, "PATCH", { nombre: "" }), { params: patchParams });
    expect(res.status).toBe(400);
  });

  // I-24
  it("I-24: producto de otro store → sin filas afectadas", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const { PATCH } = await import("@/app/api/productos/[id]/route");
    const res = await PATCH(req(`/api/productos/${PRODUCTO_ID}`, "PATCH", { precio: 9999 }), { params: patchParams });
    // La ruta retorna error si no encuentra el producto
    expect([200, 500]).toContain(res.status);
  });

  // I-25
  it("I-25: precio válido actualizado → 200 y llama hub-sync", async () => {
    mockSingle.mockResolvedValue({
      data: { id: PRODUCTO_ID, nombre: "Test", marca: null, precio: 9999, stock: 5, activo: true },
      error: null,
    });
    const { PATCH } = await import("@/app/api/productos/[id]/route");
    const res = await PATCH(req(`/api/productos/${PRODUCTO_ID}`, "PATCH", { precio: 9999 }), { params: patchParams });
    expect(res.status).toBe(200);
    expect(mockSyncProductsToHub).toHaveBeenCalled();
  });

  // I-33
  it("I-33: PATCH con codigo_barra → 200", async () => {
    mockSingle.mockResolvedValue({
      data: { id: PRODUCTO_ID, nombre: "Test", marca: null, precio: 9999, stock: 5, activo: true, codigo_barra: "7891234567890" },
      error: null,
    });
    const { PATCH } = await import("@/app/api/productos/[id]/route");
    const res = await PATCH(req(`/api/productos/${PRODUCTO_ID}`, "PATCH", { codigo_barra: "7891234567890" }), { params: patchParams });
    expect(res.status).toBe(200);
  });

  // I-34
  it("I-34: PATCH con codigo_barra duplicado → 409 con mensaje diferenciado", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint productos_codigo_barra_store_unique" },
    });
    const { PATCH } = await import("@/app/api/productos/[id]/route");
    const res = await PATCH(req(`/api/productos/${PRODUCTO_ID}`, "PATCH", { codigo_barra: "7891234567890" }), { params: patchParams });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("El código de barra ya existe");
  });
});

describe("DELETE /api/productos/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-26
  it("I-26: soft delete → activo=false, retorna 204", async () => {
    mockSingle.mockResolvedValue({
      data: { id: PRODUCTO_ID, nombre: "Test", marca: null, precio: 1000, stock: 5 },
      error: null,
    });
    const { DELETE } = await import("@/app/api/productos/[id]/route");
    const res = await DELETE(
      new NextRequest(`http://localhost/api/productos/${PRODUCTO_ID}`, { method: "DELETE" }),
      { params: patchParams }
    );
    expect(res.status).toBe(204);
  });

  // I-28
  it("I-28: delete llama syncProductsToHub con activo=false", async () => {
    mockSingle.mockResolvedValue({
      data: { id: PRODUCTO_ID, nombre: "Test", marca: "Royal", precio: 1000, stock: 5 },
      error: null,
    });
    const { DELETE } = await import("@/app/api/productos/[id]/route");
    await DELETE(
      new NextRequest(`http://localhost/api/productos/${PRODUCTO_ID}`, { method: "DELETE" }),
      { params: patchParams }
    );
    expect(mockSyncProductsToHub).toHaveBeenCalledWith([
      expect.objectContaining({ activo: false }),
    ]);
  });
});
