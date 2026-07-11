/** @jest-environment jsdom */
/**
 * Tests PC-05 a PC-12: POS Carrito — subtotal muestra neto (sin IVA)
 * PC-05 a PC-07: el subtotal en el carrito es el neto, no el bruto.
 * PC-08 a PC-12: el footer (Subtotal/IVA/Total) es correcto y consistente con
 * los items realmente renderizados en escenarios adyacentes al bug reportado
 * ("Cobrar $0" con un carrito rehidratado desde localStorage): estado ya
 * rehidratado sin interacción, crear (addItem), editar (updateQuantity),
 * mutaciones concurrentes y re-hidratación repetida sin cambios.
 *
 * NOTA HONESTA: se verificó empíricamente (revirtiendo Carrito.tsx a la
 * versión que llamaba a los getters subtotal()/impuesto()/total() del store)
 * que estos tests, al simular la rehidratación con setState() ANTES del
 * render, PASAN en ambas versiones — no reproducen el bug original. jsdom/Jest
 * ejecutan todo sincrónicamente y de un solo hilo, sin el scheduling
 * concurrente/interrumpible de React en un navegador real, así que no alcanzan
 * a exponer esa ventana de carrera. Ver también PC-13 en
 * pos-carrito-real-rehydration.test.tsx (rehidratación asíncrona REAL de
 * Zustand persist), que tampoco la reproduce. La verificación en navegador
 * real queda pendiente — ver informe de cierre del bug.
 *
 * Estos tests SÍ tienen valor real: son guardas de regresión para la fórmula
 * de cálculo y su cableado a items/descuento (evitan que un refactor futuro
 * reintroduzca selectores separados o cálculos divergentes entre componentes).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { usePOSStore, calcularSubtotalNetoCarrito, calcularTotalCarrito } from "@/stores/pos";

const storage: Record<string, string> = {};
Object.defineProperty(global, "localStorage", {
  value: {
    getItem: jest.fn((k: string) => storage[k] ?? null),
    setItem: jest.fn((k: string, v: string) => { storage[k] = v; }),
    removeItem: jest.fn((k: string) => { delete storage[k]; }),
    clear: jest.fn(() => { Object.keys(storage).forEach((k) => delete storage[k]); }),
    length: 0,
    key: jest.fn(() => null),
  },
  writable: true,
});

let Carrito: React.ComponentType;

beforeAll(async () => {
  Carrito = (await import("@/app/(app)/pos/components/Carrito")).default;
});

beforeEach(() => {
  Object.keys(storage).forEach((k) => delete storage[k]);
  usePOSStore.getState().clearCart();
  jest.clearAllMocks();
});

describe("POS Carrito — subtotal display", () => {
  // PC-05
  it("PC-05: muestra subtotal neto (sin IVA) cuando hay items en el carrito", () => {
    act(() => {
      usePOSStore.getState().addItem({
        producto_id: "p1",
        nombre: "Producto Test",
        precio: 119000,
        cantidad: 1,
        subtotal: 119000,
      });
    });

    render(React.createElement(Carrito));

    // Subtotal neto = 119000 / 1.19 = 100000 → "$100.000"
    expect(screen.getByText("$100.000")).toBeInTheDocument();
    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    // Total = 119000 (sin descuento)
    expect(screen.getByText("$119.000")).toBeInTheDocument();
  });

  // PC-06
  it("PC-06: subtotal neto se actualiza al agregar múltiples items", () => {
    act(() => {
      usePOSStore.getState().addItem({
        producto_id: "p1",
        nombre: "Producto 1",
        precio: 11900,
        cantidad: 1,
        subtotal: 11900,
      });
      usePOSStore.getState().addItem({
        producto_id: "p2",
        nombre: "Producto 2",
        precio: 23800,
        cantidad: 1,
        subtotal: 23800,
      });
    });

    render(React.createElement(Carrito));

    // bruto = 35700 → neto = 30000 → "$30.000"
    expect(screen.getByText("$30.000")).toBeInTheDocument();
  });

  // PC-07
  it("PC-07: subtotal neto con descuento muestra neto correcto", () => {
    act(() => {
      usePOSStore.getState().addItem({
        producto_id: "p1",
        nombre: "Producto Test",
        precio: 119000,
        cantidad: 1,
        subtotal: 119000,
      });
      usePOSStore.getState().setDescuento(10);
    });

    render(React.createElement(Carrito));

    // Subtotal neto = 119000 / 1.19 = 100000 (neto, descuento no afecta el subtotal)
    expect(screen.getByText("$100.000")).toBeInTheDocument();
    // Descuento 10% sobre bruto
    expect(screen.getByText(/10%/)).toBeInTheDocument();
  });
});

// ── Rehidratación de persist — regresión "Cobrar $0" ──────────────────────────
//
// Simula el merge real que hace Zustand persist al rehidratar desde localStorage:
// merge: (persistedState, currentState) => ({ ...currentState, ...persistedState })
// seguido de set(merged, true). persistedState solo trae datos (items, descuento),
// nunca funciones — currentState aporta todas las funciones (addItem, total, etc.).
// Confirmado leyendo node_modules/zustand/esm/middleware.mjs (persistImpl.hydrate).
function simularRehidratacion(persistedState: { items: unknown[]; descuento?: number }) {
  const currentState = usePOSStore.getState();
  act(() => {
    usePOSStore.setState({ ...currentState, ...persistedState } as typeof currentState, true);
  });
}

describe("POS Carrito — regresión: rehidratación de persist sin interacción del usuario", () => {
  // PC-08: footer correcto en el PRIMER render con el carrito ya rehidratado,
  // sin llamar addItem/removeItem (mismo escenario que el reporte de bug).
  it("PC-08: tras simular rehidratación con 1 item, el footer muestra el total real (no $0)", () => {
    simularRehidratacion({
      items: [{ id: "a", producto_id: "p1", nombre: "Whiskas 1kg", precio: 15458, cantidad: 1, subtotal: 15458 }],
      descuento: 0,
    });

    render(React.createElement(Carrito));

    expect(screen.getByText("$12.990")).toBeInTheDocument(); // subtotal neto
    expect(screen.getByText("$15.458")).toBeInTheDocument(); // total
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });

  // PC-09: escenario adyacente "crear" — tras rehidratar, agregar un item NUEVO
  // sigue recalculando el total correctamente (no se queda pegado en el valor rehidratado).
  it("PC-09: tras rehidratar, addItem (crear) recalcula el total con el item nuevo incluido", () => {
    simularRehidratacion({
      items: [{ id: "a", producto_id: "p1", nombre: "Whiskas 1kg", precio: 15458, cantidad: 1, subtotal: 15458 }],
      descuento: 0,
    });
    render(React.createElement(Carrito));

    act(() => {
      usePOSStore.getState().addItem({
        producto_id: "p2", nombre: "Producto 2", precio: 5000, cantidad: 1, subtotal: 5000,
      });
    });

    const totalEsperado = calcularTotalCarrito(usePOSStore.getState().items, 0);
    expect(totalEsperado).toBe(20458);
    expect(screen.getByText(`$${totalEsperado.toLocaleString("es-CL")}`)).toBeInTheDocument();
  });

  // PC-10: escenario adyacente "editar" — tras rehidratar, cambiar la cantidad de
  // un item YA EXISTENTE (persistido) recalcula el total correctamente.
  it("PC-10: tras rehidratar, updateQuantity (editar) recalcula el total del item persistido", () => {
    simularRehidratacion({
      items: [{ id: "a", producto_id: "p1", nombre: "Whiskas 1kg", precio: 15458, cantidad: 1, subtotal: 15458 }],
      descuento: 0,
    });
    render(React.createElement(Carrito));

    act(() => {
      usePOSStore.getState().updateQuantity("a", 2);
    });

    // precio 15458 x 2 = 30916
    expect(screen.getByText("$30.916")).toBeInTheDocument();
  });

  // PC-11: escenario adyacente "requests concurrentes" — múltiples addItem en la
  // misma tanda síncrona (ej: pistola de código de barras escaneando rápido)
  // producen un total final consistente, sin perder ninguna mutación.
  it("PC-11: múltiples addItem síncronos tras rehidratar no pierden ninguna mutación", () => {
    simularRehidratacion({
      items: [{ id: "a", producto_id: "p1", nombre: "Whiskas 1kg", precio: 15458, cantidad: 1, subtotal: 15458 }],
      descuento: 0,
    });
    render(React.createElement(Carrito));

    act(() => {
      usePOSStore.getState().addItem({ producto_id: "p2", nombre: "P2", precio: 1000, cantidad: 1, subtotal: 1000 });
      usePOSStore.getState().addItem({ producto_id: "p3", nombre: "P3", precio: 2000, cantidad: 1, subtotal: 2000 });
      usePOSStore.getState().addItem({ producto_id: "p4", nombre: "P4", precio: 3000, cantidad: 1, subtotal: 3000 });
    });

    // 15458 + 1000 + 2000 + 3000 = 21458
    expect(screen.getByText("$21.458")).toBeInTheDocument();
  });

  // PC-12: escenario adyacente "re-guardado sin cambios" — Zustand persist puede
  // re-emitir el mismo estado (ej. otra pestaña, un segundo ciclo de hidratación)
  // con una nueva referencia de objeto pero el MISMO contenido. El total no debe
  // duplicarse ni desincronizarse.
  it("PC-12: re-aplicar la misma rehidratación (nueva referencia, mismos datos) mantiene el total correcto", () => {
    const items = [{ id: "a", producto_id: "p1", nombre: "Whiskas 1kg", precio: 15458, cantidad: 1, subtotal: 15458 }];
    simularRehidratacion({ items: [...items], descuento: 0 });
    render(React.createElement(Carrito));
    expect(screen.getByText("$15.458")).toBeInTheDocument();

    // Segundo ciclo de "hidratación" con el mismo contenido pero nuevo array/objetos
    simularRehidratacion({ items: [{ ...items[0] }], descuento: 0 });
    expect(screen.getByText("$15.458")).toBeInTheDocument();
    expect(screen.getByText(`$${calcularSubtotalNetoCarrito(usePOSStore.getState().items).toLocaleString("es-CL")}`)).toBeInTheDocument();
  });
});
