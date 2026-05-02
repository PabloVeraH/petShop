/**
 * Tests S-01 a S-10: POS Store — estado, acciones y persistencia
 */

// Mock localStorage antes de importar el store (node env no lo provee)
const storage: Record<string, string> = {};
const localStorageMock = {
  getItem: jest.fn((k: string) => storage[k] ?? null),
  setItem: jest.fn((k: string, v: string) => { storage[k] = v; }),
  removeItem: jest.fn((k: string) => { delete storage[k]; }),
  clear: jest.fn(() => { Object.keys(storage).forEach((k) => delete storage[k]); }),
  length: 0,
  key: jest.fn(() => null),
};
Object.defineProperty(global, "localStorage", { value: localStorageMock, writable: true });

import { usePOSStore } from "@/stores/pos";

const ITEM_BASE = {
  producto_id: "prod-001",
  nombre: "Alimento Premium",
  precio: 10000,
  cantidad: 1,
  subtotal: 10000,
};

function resetStore() {
  usePOSStore.getState().clearCart();
  Object.keys(storage).forEach((k) => delete storage[k]);
  jest.clearAllMocks();
}

describe("POS Store — estado y acciones", () => {
  beforeEach(resetStore);

  // S-01
  it("S-01: estado inicial tiene carrito vacío y defaults correctos", () => {
    const { items, descuento, procedencia } = usePOSStore.getState();
    expect(items).toHaveLength(0);
    expect(descuento).toBe(0);
    expect(procedencia).toBe("presencial");
  });

  // S-02
  it("S-02: addItem agrega un producto al carrito", () => {
    usePOSStore.getState().addItem(ITEM_BASE);
    expect(usePOSStore.getState().items).toHaveLength(1);
    expect(usePOSStore.getState().items[0].producto_id).toBe("prod-001");
  });

  // S-03
  it("S-03: addItem mismo producto_id acumula cantidad en lugar de duplicar", () => {
    usePOSStore.getState().addItem(ITEM_BASE);
    usePOSStore.getState().addItem(ITEM_BASE);
    const items = usePOSStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].cantidad).toBe(2);
    expect(items[0].subtotal).toBe(20000);
  });

  // S-04
  it("S-04: removeItem elimina el producto del carrito", () => {
    usePOSStore.getState().addItem(ITEM_BASE);
    const id = usePOSStore.getState().items[0].id;
    usePOSStore.getState().removeItem(id);
    expect(usePOSStore.getState().items).toHaveLength(0);
  });

  // S-05
  it("S-05: updateQuantity actualiza cantidad y subtotal", () => {
    usePOSStore.getState().addItem(ITEM_BASE);
    const id = usePOSStore.getState().items[0].id;
    usePOSStore.getState().updateQuantity(id, 3);
    const item = usePOSStore.getState().items[0];
    expect(item.cantidad).toBe(3);
    expect(item.subtotal).toBe(30000);
  });

  // S-06
  it("S-06: updateQuantity con cantidad 0 elimina el item", () => {
    usePOSStore.getState().addItem(ITEM_BASE);
    const id = usePOSStore.getState().items[0].id;
    usePOSStore.getState().updateQuantity(id, 0);
    expect(usePOSStore.getState().items).toHaveLength(0);
  });

  // S-07
  it("S-07: clearCart vacía el carrito y resetea todos los defaults", () => {
    usePOSStore.getState().addItem(ITEM_BASE);
    usePOSStore.getState().setDescuento(15);
    usePOSStore.getState().setProcedencia("instagram");
    usePOSStore.getState().setMetodoPago("debito");

    usePOSStore.getState().clearCart();

    const state = usePOSStore.getState();
    expect(state.items).toHaveLength(0);
    expect(state.descuento).toBe(0);
    expect(state.procedencia).toBe("presencial");
    expect(state.metodoPago).toBeUndefined();
    expect(state.clienteId).toBeUndefined();
  });
});

describe("POS Store — cálculos derivados", () => {
  beforeEach(resetStore);

  // S-08
  it("S-08: subtotal suma los subtotales de todos los items", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, subtotal: 10000 });
    usePOSStore.getState().addItem({ ...ITEM_BASE, producto_id: "prod-002", subtotal: 5000 });
    expect(usePOSStore.getState().subtotal()).toBe(15000);
  });

  // S-09
  it("S-09: total aplica el descuento sobre el subtotal", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, cantidad: 2, subtotal: 20000 });
    usePOSStore.getState().setDescuento(10);
    // 20000 - 10% = 18000
    expect(usePOSStore.getState().total()).toBe(18000);
  });
});

describe("POS Store — persistencia en localStorage", () => {
  beforeEach(resetStore);

  // S-10
  it("S-10: al agregar un item se escribe en localStorage", () => {
    usePOSStore.getState().addItem(ITEM_BASE);
    expect(localStorageMock.setItem).toHaveBeenCalled();
    const [[, rawValue]] = localStorageMock.setItem.mock.calls;
    const saved = JSON.parse(rawValue);
    expect(saved.state.items).toHaveLength(1);
    expect(saved.state.items[0].producto_id).toBe("prod-001");
  });

  // S-11
  it("S-11: el estado persistido NO incluye funciones (partialize correcto)", () => {
    usePOSStore.getState().addItem(ITEM_BASE);
    const [[, rawValue]] = localStorageMock.setItem.mock.calls;
    const saved = JSON.parse(rawValue);
    expect(saved.state.addItem).toBeUndefined();
    expect(saved.state.clearCart).toBeUndefined();
    expect(saved.state.subtotal).toBeUndefined();
    expect(saved.state.total).toBeUndefined();
  });

  // S-12
  it("S-12: el estado persistido incluye procedencia y descuento", () => {
    usePOSStore.getState().setDescuento(20);
    usePOSStore.getState().setProcedencia("whatsapp");
    usePOSStore.getState().addItem(ITEM_BASE);
    const calls = localStorageMock.setItem.mock.calls;
    const last = JSON.parse(calls[calls.length - 1][1]);
    expect(last.state.descuento).toBe(20);
    expect(last.state.procedencia).toBe("whatsapp");
  });
});
