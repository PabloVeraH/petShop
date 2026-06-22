import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { IVA_RATE } from "@/lib/tax";

interface CartItem {
  id: string;
  producto_id: string;
  nombre: string;
  precio: number;
  cantidad: number;          // para granel = kg vendidos (ej: 0.5)
  mascota_id?: string;
  subtotal: number;
  fecha_vencimiento?: string | null;
  precio_oferta?: number | null;
  en_oferta?: boolean;
  // Campos granel:
  es_granel?: boolean;       // true si la venta es a granel
  gramos?: number;           // gramos indicados por el vendedor (solo display/recibo)
}

interface PagoNc {
  nota_credito_id: string;
  numero_nc: string;
  monto: number;
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
  pagoNc?: PagoNc;
  enviarEmailRecibo: boolean;

  addItem: (item: Omit<CartItem, "id">) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  setCliente: (clienteId: string, mascotaId?: string, fidelizacionDescuento?: number, clienteEmail?: string) => void;
  clearCliente: () => void;
  setEnviarEmailRecibo: (v: boolean) => void;
  setWorker: (clerkId: string | undefined) => void;
  setMetodoPago: (metodo: string) => void;
  setNumeroTransaccion: (numero: string | undefined) => void;
  setDescuento: (descuento: number) => void;
  setProcedencia: (procedencia: string) => void;
  setPayNc: (nc: PagoNc) => void;
  clearPayNc: () => void;

  subtotal: () => number;
  impuesto: () => number;
  total: () => number;
}

export const usePOSStore = create<POSStore>()(
  devtools(
    persist(
    (set, get) => ({
      items: [],
      descuento: 0,
      fidelizacionDescuento: 0,
      metodoPago: "efectivo",
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
          clienteEmail: undefined,
          mascotaId: undefined,
          // workerClerkId se mantiene — el mismo cajero atiende ventas consecutivas
          metodoPago: "efectivo",
          numeroTransaccion: undefined,
          descuento: 0,
          fidelizacionDescuento: 0,
          procedencia: "presencial",
          pagoNc: undefined,
          enviarEmailRecibo: false,
        }),

      setCliente: (clienteId, mascotaId, fidelizacionDescuento = 0, clienteEmail) => {
        const currentClienteId = get().clienteId;
        if (currentClienteId && currentClienteId !== clienteId) {
          // Cliente changed — clear stale mascota_id from all cart items
          set((state) => ({
            items: state.items.map((i) => ({ ...i, mascota_id: undefined })),
            clienteId,
            clienteEmail,
            mascotaId,
            fidelizacionDescuento,
            descuento: fidelizacionDescuento, // auto-apply loyalty discount
          }));
        } else {
          set({ clienteId, clienteEmail, mascotaId, fidelizacionDescuento, descuento: fidelizacionDescuento });
        }
      },

      clearCliente: () => set({ clienteId: undefined, clienteEmail: undefined, mascotaId: undefined, fidelizacionDescuento: 0, descuento: 0 }),

      setEnviarEmailRecibo: (enviarEmailRecibo) => set({ enviarEmailRecibo }),

      setWorker: (workerClerkId) => set({ workerClerkId }),

      setMetodoPago: (metodoPago) => set({ metodoPago }),

      setNumeroTransaccion: (numeroTransaccion) => set({ numeroTransaccion }),

      setDescuento: (descuento) => set({ descuento }),

      setProcedencia: (procedencia) => set({ procedencia }),

      setPayNc: (nc) => set({ pagoNc: nc }),

      clearPayNc: () => set({ pagoNc: undefined }),

      // precio ya incluye IVA
      subtotal: () => get().items.reduce((sum, i) => sum + i.subtotal, 0),

      // IVA extraído del total con descuento — los precios ya incluyen IVA
      impuesto: () => {
        const sub = get().subtotal();
        const desc = (sub * get().descuento) / 100;
        const t = sub - desc;
        return Math.round(t * IVA_RATE / (1 + IVA_RATE));
      },

      // Total = subtotal - descuento (IVA ya incluido en el precio) — pesos enteros
      total: () => {
        const sub = get().subtotal();
        const desc = (sub * get().descuento) / 100;
        return Math.round(sub - desc);
      },
    }),
    {
      name: "pos-cart",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
        clienteId: state.clienteId,
        clienteEmail: state.clienteEmail,
        mascotaId: state.mascotaId,
        workerClerkId: state.workerClerkId,
        metodoPago: state.metodoPago,
        numeroTransaccion: state.numeroTransaccion,
        descuento: state.descuento,
        fidelizacionDescuento: state.fidelizacionDescuento,
        procedencia: state.procedencia,
        pagoNc: state.pagoNc,
      }),
    }
    ),
    { name: "pos-store" }
  )
);
