const mockFetch = jest.fn();
global.fetch = mockFetch;

const PRODUCT = {
  producto_id: "123e4567-e89b-12d3-a456-426614174000",
  nombre_producto: "Royal Canin Adult",
  precio: 15000,
  stock: 10,
};

describe("lib/hub-sync (sin HUB_URL)", () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.HUB_URL;
    delete process.env.HUB_SYNC_SECRET;
    mockFetch.mockClear();
  });

  // U-15
  it("U-15: sin HUB_URL configurado no hace fetch", () => {
    const { syncProductsToHub } = require("@/lib/hub-sync");
    syncProductsToHub([PRODUCT]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("lib/hub-sync (con HUB_URL)", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.HUB_URL = "http://localhost:3001";
    process.env.HUB_SYNC_SECRET = "test-secret";
    mockFetch.mockResolvedValue({ ok: true });
    mockFetch.mockClear();
  });

  // U-16
  it("U-16: con HUB_URL hace POST a /api/sync/catalog", () => {
    const { syncProductsToHub } = require("@/lib/hub-sync");
    syncProductsToHub([PRODUCT]);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/sync/catalog",
      expect.objectContaining({ method: "POST" })
    );
  });

  // U-17
  it("U-17: error de red no lanza excepción (fire-and-forget)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { syncProductsToHub } = require("@/lib/hub-sync");
    expect(() => syncProductsToHub([PRODUCT])).not.toThrow();
    await Promise.resolve();
  });

  // U-18
  it("U-18: syncPurchaseToHub envía RUT y monto correctos en body", () => {
    const { syncPurchaseToHub } = require("@/lib/hub-sync");
    syncPurchaseToHub("11.111.111-1", 25000);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/sync/purchase",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ rut: "11.111.111-1", monto: 25000 }),
      })
    );
  });
});
