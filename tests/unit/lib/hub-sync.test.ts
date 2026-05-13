const mockFetch = jest.fn();
global.fetch = mockFetch;

const BASE_PRODUCT = {
  producto_id: "123e4567-e89b-12d3-a456-426614174000",
  nombre_producto: "Royal Canin Adult",
  precio: 15000,
  stock: 10,
};

describe("lib/hub-sync (sin HUB_URL ni HUB_SYNC_SECRET)", () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.HUB_URL;
    delete process.env.HUB_SYNC_SECRET;
    delete process.env.STORE_ID;
    mockFetch.mockClear();
  });

  it("U-15: sin HUB_URL configurado no hace fetch", () => {
    const { syncProductsToHub } = require("@/lib/hub-sync");
    syncProductsToHub([BASE_PRODUCT]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("U-19: syncPurchaseToHub sin HUB_URL no hace fetch", () => {
    const { syncPurchaseToHub } = require("@/lib/hub-sync");
    syncPurchaseToHub("11.111.111-1", 25000);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("lib/hub-sync (con HUB_URL y HUB_SYNC_SECRET, sin STORE_ID)", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.HUB_URL = "http://localhost:3001";
    process.env.HUB_SYNC_SECRET = "test-secret";
    delete process.env.STORE_ID;
    mockFetch.mockResolvedValue({ ok: true });
    mockFetch.mockClear();
  });

  it("U-20: sin STORE_ID envía payload sin store_id (fallback)", () => {
    const { syncProductsToHub } = require("@/lib/hub-sync");
    syncProductsToHub([BASE_PRODUCT]);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/sync/catalog",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ store_id: undefined, productos: [BASE_PRODUCT] }),
      })
    );
  });
});

describe("lib/hub-sync (con HUB_URL, HUB_SYNC_SECRET y STORE_ID)", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.HUB_URL = "http://localhost:3001";
    process.env.HUB_SYNC_SECRET = "test-secret";
    process.env.STORE_ID = "123e4567-e89b-12d3-a456-426614174001";
    mockFetch.mockResolvedValue({ ok: true });
    mockFetch.mockClear();
  });

  it("U-16: con HUB_URL hace POST a /api/sync/catalog", () => {
    const { syncProductsToHub } = require("@/lib/hub-sync");
    syncProductsToHub([BASE_PRODUCT]);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/sync/catalog",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("U-21: payload incluye store_id del env", () => {
    const { syncProductsToHub } = require("@/lib/hub-sync");
    syncProductsToHub([BASE_PRODUCT]);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.store_id).toBe("123e4567-e89b-12d3-a456-426614174001");
  });

  it("U-22: payload incluye todos los campos del producto", () => {
    const { syncProductsToHub } = require("@/lib/hub-sync");
    const productWithAllFields = {
      ...BASE_PRODUCT,
      marca: "Royal Canin",
      categoria: "Alimento",
      codigo_barra: "123456789",
      tipo_animal: "perro",
      peso_gramos: 3000,
      precio_oferta: 12000,
      en_oferta: true,
      imagen_url: "https://example.com/image.jpg",
      activo: true,
    };
    syncProductsToHub([productWithAllFields]);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.productos[0]).toMatchObject({
      producto_id: "123e4567-e89b-12d3-a456-426614174000",
      nombre_producto: "Royal Canin Adult",
      marca: "Royal Canin",
      categoria: "Alimento",
      codigo_barra: "123456789",
      precio: 15000,
      stock: 10,
      tipo_animal: "perro",
      peso_gramos: 3000,
      precio_oferta: 12000,
      en_oferta: true,
      imagen_url: "https://example.com/image.jpg",
      activo: true,
    });
  });

  it("U-23: productos con precio < 1000 no se sincronizan (activos)", () => {
    const { syncProductsToHub } = require("@/lib/hub-sync");
    const cheapProduct = { ...BASE_PRODUCT, precio: 500, activo: true };
    syncProductsToHub([cheapProduct]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("U-24: productos con precio < 1000 pero activo=false SÍ se sincronizan", () => {
    const { syncProductsToHub } = require("@/lib/hub-sync");
    const cheapProduct = { ...BASE_PRODUCT, precio: 500, activo: false };
    syncProductsToHub([cheapProduct]);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.productos).toHaveLength(1);
    expect(body.productos[0].activo).toBe(false);
  });

  it("U-25: activo=false siempre se sincroniza aunque precio < 1000", () => {
    const { syncProductsToHub } = require("@/lib/hub-sync");
    const products = [
      { ...BASE_PRODUCT, precio: 500, activo: false },
      { ...BASE_PRODUCT, precio: 15000, activo: true },
    ];
    syncProductsToHub(products);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.productos).toHaveLength(2);
    expect(body.productos[0].activo).toBe(false);
    expect(body.productos[1].precio).toBe(15000);
  });

  it("U-17: error de red no lanza excepción (fire-and-forget)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { syncProductsToHub } = require("@/lib/hub-sync");
    expect(() => syncProductsToHub([BASE_PRODUCT])).not.toThrow();
    await Promise.resolve();
  });

  it("U-26: syncPurchaseToHub incluye store_id y fecha en payload", () => {
    const { syncPurchaseToHub } = require("@/lib/hub-sync");
    const today = new Date().toISOString().split("T")[0];
    syncPurchaseToHub("11.111.111-1", 25000);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/sync/purchase",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          store_id: "123e4567-e89b-12d3-a456-426614174001",
          rut: "11.111.111-1",
          monto: 25000,
          fecha: today,
        }),
      })
    );
  });

  it("U-18: syncPurchaseToHub envía RUT, monto, store_id y fecha en body", () => {
    const { syncPurchaseToHub } = require("@/lib/hub-sync");
    const today = new Date().toISOString().split("T")[0];
    syncPurchaseToHub("11.111.111-1", 25000);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/sync/purchase",
      expect.objectContaining({
        method: "POST",
      })
    );
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.rut).toBe("11.111.111-1");
    expect(callBody.monto).toBe(25000);
    expect(callBody.store_id).toBe("123e4567-e89b-12d3-a456-426614174001");
    expect(callBody.fecha).toBe(today);
  });

  it("U-27: sin productos elegibles no hace fetch", () => {
    const { syncProductsToHub } = require("@/lib/hub-sync");
    const cheapProducts = [
      { ...BASE_PRODUCT, precio: 500, activo: true },
      { ...BASE_PRODUCT, precio: 800, activo: true },
    ];
    syncProductsToHub(cheapProducts);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("U-28: empty array no hace fetch", () => {
    const { syncProductsToHub } = require("@/lib/hub-sync");
    syncProductsToHub([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});