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
    expect(state.metodoPago).toBe("efectivo");
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

describe("POS Store — subtotalNeto (sin IVA)", () => {
  beforeEach(resetStore);

  // S-36
  it("S-36: subtotalNeto extrae IVA del subtotal bruto", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, precio: 119000, subtotal: 119000 });
    // 119000 / 1.19 = 100000
    expect(usePOSStore.getState().subtotalNeto()).toBe(100000);
  });

  // S-37
  it("S-37: subtotalNeto con múltiples items suma y extrae IVA", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, producto_id: "p1", precio: 11900, subtotal: 11900 });
    usePOSStore.getState().addItem({ ...ITEM_BASE, producto_id: "p2", precio: 23800, subtotal: 23800 });
    // bruto = 35700 → neto = 35700 / 1.19 = 30000
    expect(usePOSStore.getState().subtotalNeto()).toBe(30000);
  });

  // S-38
  it("S-38: subtotalNeto es 0 cuando el carrito está vacío", () => {
    expect(usePOSStore.getState().subtotalNeto()).toBe(0);
  });

  // S-39
  it("S-39: subtotalNeto es entero (redondeado)", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, precio: 15458, subtotal: 15458 });
    // 15458 / 1.19 = 12989.916 → 12990
    expect(Number.isInteger(usePOSStore.getState().subtotalNeto())).toBe(true);
    expect(usePOSStore.getState().subtotalNeto()).toBe(12990);
  });
});

describe("POS Store — cálculo IVA (impuesto)", () => {
  beforeEach(resetStore);

  // S-20
  it("S-20: impuesto() extrae IVA del subtotal (precio ya incluye IVA)", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, precio: 45928, subtotal: 45928 });
    // 45928 × (0.19/1.19) = 7333.47 → redondeado 7333
    expect(usePOSStore.getState().impuesto()).toBe(7333);
  });

  // S-21
  it("S-21: impuesto() extrae IVA del total con descuento", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, precio: 10000, subtotal: 10000 });
    usePOSStore.getState().setDescuento(10);
    // total = 10000 - 10% = 9000; IVA = 9000 × (0.19/1.19) = 1436.97 → 1437
    expect(usePOSStore.getState().impuesto()).toBe(1437);
  });

  // S-22
  it("S-22: impuesto() es 0 cuando el carrito está vacío", () => {
    expect(usePOSStore.getState().impuesto()).toBe(0);
  });

  // S-23: consistencia con ModalPago — misma fórmula de extracción (sub - desc) × (0.19/1.19)
  it("S-23: impuesto() coincide con la fórmula del ModalPago (sub - desc) × (0.19/1.19)", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, precio: 30000, subtotal: 30000 });
    usePOSStore.getState().setDescuento(5);
    const store = usePOSStore.getState();
    const sub = store.subtotal();
    const desc = (sub * store.descuento) / 100;
    const expectedIva = Math.round((sub - desc) * 0.19 / 1.19);
    expect(store.impuesto()).toBe(expectedIva);
  });

  // S-27: REGRESIÓN — Whiskas 1kg $15.458 → IVA = $2.468, no $2.937
  // Bug: se usaba total × 0.19 (aditiva) en vez de total × (0.19/1.19) (extracción)
  it("S-27: Whiskas 1kg $15.458 con IVA incluido → IVA extraído = $2.468", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, precio: 15458, subtotal: 15458 });
    // extracción: 15458 × (0.19/1.19) = 2467.79 → 2468
    // erróneo:    15458 × 0.19        = 2937.02 → 2937
    expect(usePOSStore.getState().impuesto()).toBe(2468);
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

describe("POS Store — guard sobrestock", () => {
  beforeEach(resetStore);

  // S-32: REGRESIÓN — addItem no puede superar el stock disponible
  // Bug: se podían agregar 7 unidades de un producto con stock 6 sin advertencia.
  it("S-32: addItem no incrementa cuando ya se alcanzó el stock máximo", () => {
    // Agregar hasta el stock máximo (stock: 2)
    usePOSStore.getState().addItem({ ...ITEM_BASE, stock: 2 });
    usePOSStore.getState().addItem({ ...ITEM_BASE, stock: 2 }); // llega a 2 (límite)
    expect(usePOSStore.getState().items[0].cantidad).toBe(2);

    // Intento adicional debe ser ignorado
    usePOSStore.getState().addItem({ ...ITEM_BASE, stock: 2 });
    expect(usePOSStore.getState().items[0].cantidad).toBe(2); // no cambió
  });

  // S-33: updateQuantity tampoco puede superar el stock
  it("S-33: updateQuantity caps la cantidad al stock disponible", () => {
    usePOSStore.getState().addItem({ ...ITEM_BASE, stock: 3 });
    const id = usePOSStore.getState().items[0].id;

    usePOSStore.getState().updateQuantity(id, 10); // pide 10, stock = 3
    const item = usePOSStore.getState().items[0];
    expect(item.cantidad).toBe(3);
    expect(item.subtotal).toBe(3 * ITEM_BASE.precio);
  });

  // S-34: sin stock definido, no hay límite (comportamiento previo preservado)
  it("S-34: sin campo stock, updateQuantity no tiene límite", () => {
    usePOSStore.getState().addItem(ITEM_BASE); // sin stock
    const id = usePOSStore.getState().items[0].id;
    usePOSStore.getState().updateQuantity(id, 99);
    expect(usePOSStore.getState().items[0].cantidad).toBe(99);
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
  it("S-26: clearCart limpia items y clienteId, resetea metodoPago a efectivo, mantiene el worker", () => {
    usePOSStore.getState().setWorker("clerk_xyz");
    usePOSStore.getState().addItem(ITEM_BASE);
    usePOSStore.getState().setCliente("cli-99", undefined, 0, "a@b.com");
    usePOSStore.getState().setMetodoPago("credito");
    usePOSStore.getState().clearCart();

    const s = usePOSStore.getState();
    expect(s.items).toHaveLength(0);
    expect(s.clienteId).toBeUndefined();
    expect(s.metodoPago).toBe("efectivo");
    expect(s.workerClerkId).toBe("clerk_xyz"); // worker se mantiene
  });

  // S-28: REGRESIÓN — setCliente con fidelizacionDescuento aplica descuento automáticamente
  // Bug: el 10% de fidelización quedaba disponible en modal pero requería clic manual.
  it("S-28: setCliente con fidelizacion 10% aplica descuento automáticamente", () => {
    usePOSStore.getState().setCliente("cli-1", undefined, 10, "maria@test.com");
    const s = usePOSStore.getState();
    expect(s.fidelizacionDescuento).toBe(10);
    expect(s.descuento).toBe(10); // ← auto-aplicado, no requiere clic
  });

  // S-29: setCliente con 0% de fidelización no altera el descuento (lo deja en 0)
  it("S-29: setCliente sin fidelización resetea descuento a 0", () => {
    usePOSStore.getState().setDescuento(15); // descuento manual previo
    usePOSStore.getState().setCliente("cli-2", undefined, 0, "otro@test.com");
    const s = usePOSStore.getState();
    expect(s.fidelizacionDescuento).toBe(0);
    expect(s.descuento).toBe(0); // el descuento manual previo se sobreescribe
  });

  // S-30: clearCliente resetea descuento junto con fidelizacionDescuento
  it("S-30: clearCliente elimina el descuento de fidelización aplicado", () => {
    usePOSStore.getState().setCliente("cli-1", undefined, 10, "maria@test.com");
    expect(usePOSStore.getState().descuento).toBe(10);

    usePOSStore.getState().clearCliente();
    const s = usePOSStore.getState();
    expect(s.clienteId).toBeUndefined();
    expect(s.fidelizacionDescuento).toBe(0);
    expect(s.descuento).toBe(0); // el descuento se elimina al quitar el cliente
  });

  // S-31: cambiar de cliente aplica el descuento del nuevo cliente
  it("S-31: cambiar cliente sobrescribe descuento con el del nuevo cliente", () => {
    usePOSStore.getState().addItem(ITEM_BASE); // necesario para activar rama de cambio de cliente
    usePOSStore.getState().setCliente("cli-1", undefined, 10, "a@test.com");
    expect(usePOSStore.getState().descuento).toBe(10);

    usePOSStore.getState().setCliente("cli-2", undefined, 5, "b@test.com");
    const s = usePOSStore.getState();
    expect(s.fidelizacionDescuento).toBe(5);
    expect(s.descuento).toBe(5); // nuevo cliente, nuevo descuento
  });

  // S-35: setWorker permite cambiar de vendedor (simula el uso manual en el dropdown)
  it("S-35: setWorker asigna correctamente el vendedor y se puede reasignar", () => {
    usePOSStore.getState().setWorker("user-session-1");
    expect(usePOSStore.getState().workerClerkId).toBe("user-session-1");

    // Cambio manual a otro vendedor (vender en nombre de otro)
    usePOSStore.getState().setWorker("user-other-2");
    expect(usePOSStore.getState().workerClerkId).toBe("user-other-2");

    // Se puede desasignar (Sin asignar)
    usePOSStore.getState().setWorker(undefined);
    expect(usePOSStore.getState().workerClerkId).toBeUndefined();
  });
});
