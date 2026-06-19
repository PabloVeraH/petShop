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

describe("POS Store — cálculo IVA (impuesto)", () => {
  beforeEach(resetStore);

  // S-20
  it("S-20: impuesto() es 19% del subtotal sin descuento", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, precio: 45928, subtotal: 45928 });
    // 45928 * 0.19 = 8726.32 → redondeado 8726
    expect(usePOSStore.getState().impuesto()).toBe(8726);
  });

  // S-21
  it("S-21: impuesto() aplica 19% sobre total con descuento", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, precio: 10000, subtotal: 10000 });
    usePOSStore.getState().setDescuento(10);
    // total = 10000 - 10% = 9000; IVA = 9000 * 0.19 = 1710
    expect(usePOSStore.getState().impuesto()).toBe(1710);
  });

  // S-22
  it("S-22: impuesto() es 0 cuando el carrito está vacío", () => {
    expect(usePOSStore.getState().impuesto()).toBe(0);
  });

  // S-23: consistencia con ModalPago (misma fórmula * 0.19)
  it("S-23: impuesto() coincide con la fórmula del ModalPago (sub - desc) * 0.19", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, precio: 30000, subtotal: 30000 });
    usePOSStore.getState().setDescuento(5);
    const store = usePOSStore.getState();
    const sub = store.subtotal();
    const desc = (sub * store.descuento) / 100;
    const expectedIva = Math.round((sub - desc) * 0.19);
    expect(store.impuesto()).toBe(expectedIva);
  });

  // S-24: redondeo a pesos enteros
  it("S-24: impuesto() siempre devuelve un entero (sin centavos)", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, precio: 1, subtotal: 1 });
    expect(Number.isInteger(usePOSStore.getState().impuesto())).toBe(true);
  });
});

describe("POS Store — guard precio null", () => {
  beforeEach(resetStore);

  // S-13
  it("S-13: addItem con precio 0 se agrega (precio 0 es válido)", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, precio: 0, subtotal: 0 });
    expect(usePOSStore.getState().items).toHaveLength(1);
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

describe("POS Store — email recibo toggle", () => {
  beforeEach(resetStore);

  // S-14
  it("S-14: enviarEmailRecibo inicia en false por defecto", () => {
    expect(usePOSStore.getState().enviarEmailRecibo).toBe(false);
  });

  // S-15
  it("S-15: setEnviarEmailRecibo(true) activa el flag", () => {
    usePOSStore.getState().setEnviarEmailRecibo(true);
    expect(usePOSStore.getState().enviarEmailRecibo).toBe(true);
  });

  // S-16
  it("S-16: clearCart resetea enviarEmailRecibo a false", () => {
    usePOSStore.getState().setEnviarEmailRecibo(true);
    usePOSStore.getState().clearCart();
    expect(usePOSStore.getState().enviarEmailRecibo).toBe(false);
  });

  // S-17
  it("S-17: setCliente persiste clienteEmail en el estado", () => {
    usePOSStore.getState().setCliente("cli-1", undefined, 0, "juan@test.com");
    expect(usePOSStore.getState().clienteEmail).toBe("juan@test.com");
  });

  // S-18
  it("S-18: clearCliente limpia clienteEmail", () => {
    usePOSStore.getState().setCliente("cli-1", undefined, 0, "juan@test.com");
    usePOSStore.getState().clearCliente();
    expect(usePOSStore.getState().clienteEmail).toBeUndefined();
  });

  // S-19
  it("S-19: clienteEmail se persiste en localStorage al agregar un item", () => {
    usePOSStore.getState().setCliente("cli-1", undefined, 0, "juan@test.com");
    usePOSStore.getState().addItem(ITEM_BASE);
    const calls = localStorageMock.setItem.mock.calls;
    const last = JSON.parse(calls[calls.length - 1][1]);
    expect(last.state.clienteEmail).toBe("juan@test.com");
  });

  // S-25: regresión — clearCart NO debe borrar el worker (mismo cajero, ventas consecutivas)
  it("S-25: clearCart preserva workerClerkId para ventas consecutivas", () => {
    usePOSStore.getState().setWorker("clerk_abc123");
    usePOSStore.getState().addItem(ITEM_BASE);
    usePOSStore.getState().clearCart();

    expect(usePOSStore.getState().workerClerkId).toBe("clerk_abc123");
  });

  // S-26: clearCart sí limpia el resto del estado
  it("S-26: clearCart limpia items, clienteId y metodoPago pero mantiene el worker", () => {
    usePOSStore.getState().setWorker("clerk_xyz");
    usePOSStore.getState().addItem(ITEM_BASE);
    usePOSStore.getState().setCliente("cli-99", undefined, 0, "a@b.com");
    usePOSStore.getState().setMetodoPago("efectivo");
    usePOSStore.getState().clearCart();

    const s = usePOSStore.getState();
    expect(s.items).toHaveLength(0);
    expect(s.clienteId).toBeUndefined();
    expect(s.metodoPago).toBeUndefined();
    expect(s.workerClerkId).toBe("clerk_xyz"); // worker se mantiene
  });
});
