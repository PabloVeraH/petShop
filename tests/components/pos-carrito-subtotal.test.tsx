/** @jest-environment jsdom */
/**
 * Tests PC-05 a PC-07: POS Carrito — subtotal muestra neto (sin IVA)
 * Verifica que el subtotal en el carrito sea el neto, no el bruto.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { usePOSStore } from "@/stores/pos";

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
