import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface CartItem {
  id: string;
  producto_id: string;
  nombre: string;
  precio: number;
  cantidad: number;
  mascota_id?: string;
  subtotal: number;
}

interface POSStore {
  items: CartItem[];
  clienteId?: string;
  mascotaId?: string;
  vendedorId?: string;
  metodoPago?: string;
  descuento: number;
  fidelizacionDescuento: number;

  addItem: (item: Omit<CartItem, "id">) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  setCliente: (clienteId: string, mascotaId?: string, fidelizacionDescuento?: number) => void;
  clearCliente: () => void;
  setVendedor: (vendedorId: string | undefined) => void;
  setMetodoPago: (metodo: string) => void;
  setDescuento: (descuento: number) => void;

  subtotal: () => number;
  impuesto: () => number;
  total: () => number;
}

export const usePOSStore = create<POSStore>()(
  devtools(
    (set, get) => ({
      items: [],
      descuento: 0,
      fidelizacionDescuento: 0,

      addItem: (item) => {
        const existing = get().items.find(
          (i) => i.producto_id === item.producto_id && i.mascota_id === item.mascota_id
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

      removeItem: (id) =>
        set((state) => ({
          items: state.items.filter((i) => i.id !== id),
        })),

      updateQuantity: (id, quantity) => {
        if (quantity <= 0) {
          get().removeItem(id);
          return;
        }
        set((state) => ({
          items: state.items.map((i) =>
            i.id === id ? { ...i, cantidad: quantity, subtotal: i.precio * quantity } : i
          ),
        }));
      },

      clearCart: () =>
        set({
          items: [],
          clienteId: undefined,
          mascotaId: undefined,
          vendedorId: undefined,
          metodoPago: undefined,
          descuento: 0,
          fidelizacionDescuento: 0,
        }),

      setCliente: (clienteId, mascotaId, fidelizacionDescuento = 0) => {
        const currentClienteId = get().clienteId;
        if (currentClienteId && currentClienteId !== clienteId) {
          // Cliente changed — clear stale mascota_id from all cart items
          set((state) => ({
            items: state.items.map((i) => ({ ...i, mascota_id: undefined })),
            clienteId,
            mascotaId,
            fidelizacionDescuento,
          }));
        } else {
          set({ clienteId, mascotaId, fidelizacionDescuento });
        }
      },

      clearCliente: () => set({ clienteId: undefined, mascotaId: undefined, fidelizacionDescuento: 0 }),

      setVendedor: (vendedorId) => set({ vendedorId }),

      setMetodoPago: (metodoPago) => set({ metodoPago }),

      setDescuento: (descuento) => set({ descuento }),

      subtotal: () => get().items.reduce((sum, i) => sum + i.subtotal, 0),

      impuesto: () => get().subtotal() * 0.19,

      total: () => {
        const sub = get().subtotal();
        const desc = (sub * get().descuento) / 100;
        return (sub - desc) * 1.19;
      },
    }),
    { name: "pos-store" }
  )
);
