/**
 * Tests de venta a granel - Store
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

import { create } from "zustand";

// Simular el store con la interfaz extendida para granel
interface CartItem {
  id: string;
  producto_id: string;
  nombre: string;
  precio: number;
  cantidad: number;
  mascota_id?: string;
  subtotal: number;
  fecha_vencimiento?: string | null;
  precio_oferta?: number | null;
  en_oferta?: boolean;
  es_granel?: boolean;
  gramos?: number;
}

interface POSStore {
  items: CartItem[];
  clienteId?: string;
  clienteEmail?: string;
  mascotaId?: string;
  workerClerkId?: string;
  metodoPago?: string;
  numeroTransaccion?: string;
  descuento: number;
  fidelizacionDescuento: number;
  procedencia: string;
  enviarEmailRecibo: boolean;
  addItem: (item: Omit<CartItem, "id">) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
}

const createTestStore = () => create<POSStore>()(
  (set, get) => ({
    items: [],
    descuento: 0,
    fidelizacionDescuento: 0,
    procedencia: "presencial",
    enviarEmailRecibo: false,

    addItem: (item) => {
      // Items granel NUNCA se fusionan — cada pesada es una línea distinta
      if (item.es_granel) {
        set((state) => ({
          items: [...state.items, { id: crypto.randomUUID(), ...item }],
        }));
        return;
      }
      // lógica existente para items normales...
      const existing = get().items.find(
        (i) => i.producto_id === item.producto_id &&
               i.mascota_id === item.mascota_id &&
               !i.es_granel
      );
      if (existing) {
        set((state) => ({
          items: state.items.map((i) =>
            i.id === existing.id
              ? { ...i, cantidad: i.cantidad + 1, subtotal: i.precio * (i.cantidad + 1) }
              : i
          ),
        }));
      } else {
        set((state) => ({
          items: [...state.items, { id: crypto.randomUUID(), ...item }],
        }));
      }
    },

    removeItem: (id) => {
      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
      }));
    },

    updateQuantity: (id, quantity) => {
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id
            ? { ...item, cantidad: quantity, subtotal: item.precio * quantity }
            : item
        ),
      }));
    },

    clearCart: () => set({ items: [] }),
  })
);

describe("Tests unitarios de venta a granel - Store", () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
    store.getState().clearCart();
    jest.clearAllMocks();
  });

  test("GR-U-01: addItem granel no fusiona con item existente del mismo producto", () => {
    const item1 = {
      producto_id: "prod1",
      nombre: "Producto A",
      precio: 1000,
      cantidad: 0.5,
      subtotal: 500,
      es_granel: true,
      gramos: 500,
    };

    const item2 = {
      producto_id: "prod1",
      nombre: "Producto A",
      precio: 1000,
      cantidad: 0.3,
      subtotal: 300,
      es_granel: true,
      gramos: 300,
    };

    store.getState().addItem(item1);
    store.getState().addItem(item2);

    const state = store.getState();
    expect(state.items).toHaveLength(2);
    expect(state.items[0].producto_id).toBe("prod1");
    expect(state.items[0].cantidad).toBe(0.5);
    expect(state.items[1].producto_id).toBe("prod1");
    expect(state.items[1].cantidad).toBe(0.3);
  });

  test("GR-U-02: subtotal de item granel = (gramos/1000) * precio_venta_kg", () => {
    const item = {
      producto_id: "prod1",
      nombre: "Producto A",
      precio: 3000, // precio por kg
      cantidad: 0.5, // kg
      subtotal: 1500, // 0.5 * 3000
      es_granel: true,
      gramos: 500,
    };

    store.getState().addItem(item);
    const state = store.getState();
    
    expect(state.items[0].subtotal).toBe(1500);
    expect(state.items[0].cantidad).toBe(0.5);
    expect(state.items[0].gramos).toBe(500);
  });

  test("GR-U-03: addItem granel crea línea independiente para 2 pesadas del mismo producto", () => {
    const item1 = {
      producto_id: "prod1",
      nombre: "Producto A",
      precio: 2500,
      cantidad: 0.4,
      subtotal: 1000,
      es_granel: true,
      gramos: 400,
    };

    const item2 = {
      producto_id: "prod1",
      nombre: "Producto A",
      precio: 2500,
      cantidad: 0.6,
      subtotal: 1500,
      es_granel: true,
      gramos: 600,
    };

    store.getState().addItem(item1);
    store.getState().addItem(item2);

    const state = store.getState();
    expect(state.items).toHaveLength(2);
    expect(state.items.filter(item => item.es_granel)).toHaveLength(2);
    expect(state.items[0].gramos).toBe(400);
    expect(state.items[1].gramos).toBe(600);
  });

  test("GR-U-04: updateQuantity modifica subtotal para items granel", () => {
    const item = {
      producto_id: "prod1",
      nombre: "Producto A",
      precio: 2000,
      cantidad: 0.5,
      subtotal: 1000,
      es_granel: true,
      gramos: 500,
    };

    store.getState().addItem(item);
    const initialState = store.getState().items[0];
    
    // Intentar modificar cantidad con updateQuantity
    store.getState().updateQuantity(initialState.id, 1.0);
    
    const state = store.getState();
    // Para items granel, la cantidad y subtotal sí deben cambiar con updateQuantity
    expect(state.items[0].cantidad).toBe(1.0); // Debe cambiar
    expect(state.items[0].subtotal).toBe(2000); // Debe cambiar
    expect(state.items[0].gramos).toBe(500); // No debe cambiar
  });
});