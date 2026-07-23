import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { extraerIva, netoDesdeBruto } from "@/lib/tax";

export interface CartItem {
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
  stock?: number;            // unidades disponibles en el momento de agregar (guard de sobrestock)
  // Campos granel:
  es_granel?: boolean;       // true si la venta es a granel
  gramos?: number;           // gramos indicados por el vendedor (solo display/recibo)
}

// ─────────────────────────────────────────────────────────────────────────
// Cálculos del carrito — funciones puras (items, descuento) => number.
//
// Invariante: cualquier UI que muestre un total derivado del carrito debe
// llamar a estas funciones con el MISMO `items`/`descuento` que ya usa para
// renderizar la lista de productos (el mismo destructure de usePOSStore()
// en el mismo render), en vez de invocar un getter del store que lee
// get() internamente. Esto garantiza que el total mostrado sea siempre
// consistente con los items realmente renderizados — incluyendo el primer
// render tras la rehidratación de Zustand persist desde localStorage,
// donde depender de un getter separado puede quedar desincronizado del
// array de items ya visible en pantalla.
// ─────────────────────────────────────────────────────────────────────────

export function calcularSubtotalCarrito(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.subtotal, 0);
}

export function calcularSubtotalNetoCarrito(items: CartItem[]): number {
  return netoDesdeBruto(calcularSubtotalCarrito(items));
}

export function calcularTotalCarrito(items: CartItem[], descuentoPct: number): number {
  const sub = calcularSubtotalCarrito(items);
  const desc = (sub * descuentoPct) / 100;
  return Math.round(sub - desc);
}

export function calcularImpuestoCarrito(items: CartItem[], descuentoPct: number): number {
  const sub = calcularSubtotalCarrito(items);
  const desc = (sub * descuentoPct) / 100;
  return extraerIva(sub - desc);
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
  notas: string;
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
  setNotas: (notas: string) => void;

  subtotal: () => number;
  subtotalNeto: () => number;
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
      notas: "",
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
          // Guard sobrestock: si el stock es conocido y ya se alcanzó, ignorar silenciosamente
          if (item.stock !== undefined && existing.cantidad >= item.stock) return;
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
          items: state.items.map((i) => {
            if (i.id !== id) return i;
            // Guard sobrestock: no superar el stock disponible
            const safeQty = i.stock !== undefined ? Math.min(quantity, i.stock) : quantity;
            return { ...i, cantidad: safeQty, subtotal: i.precio * safeQty };
          }),
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
          notas: "",
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
      setNotas: (notas) => set({ notas }),

      // precio ya incluye IVA
      subtotal: () => calcularSubtotalCarrito(get().items),

      // Subtotal neto (sin IVA) — extrae el IVA del subtotal bruto
      subtotalNeto: () => calcularSubtotalNetoCarrito(get().items),

      // IVA extraído del total con descuento — los precios ya incluyen IVA
      impuesto: () => calcularImpuestoCarrito(get().items, get().descuento),

      // Total = subtotal - descuento (IVA ya incluido en el precio) — pesos enteros
      total: () => calcularTotalCarrito(get().items, get().descuento),
    }),
    {
      name: "pos-cart",
      storage: createJSONStorage(() => localStorage),
      // metodoPago, numeroTransaccion y pagoNc quedan FUERA a propósito: son
      // estado transitorio del intento de cobro actual dentro de ModalPago, no
      // parte de "la venta que se está armando" (a diferencia de items/clienteId/
      // descuento, que sí deben sobrevivir un reload accidental). Persistirlos
      // hacía que un cobro con Nota de Crédito interrumpido a mitad de camino
      // (metodoPago="nota_credito" + pagoNc seteado, sin completar la venta)
      // sobreviviera al reload y la siguiente apertura del modal heredara ese NC
      // ajeno, bloqueando el cambio de método de pago (ticket Trello
      // 6a619fafd0aa9aa5ad06b1dd). Ver S-43/S-44 en tests/unit/lib/pos-store.test.ts.
      partialize: (state) => ({
        items: state.items,
        clienteId: state.clienteId,
        clienteEmail: state.clienteEmail,
        mascotaId: state.mascotaId,
        workerClerkId: state.workerClerkId,
        descuento: state.descuento,
        fidelizacionDescuento: state.fidelizacionDescuento,
        procedencia: state.procedencia,
        notas: state.notas,
      }),
    }
    ),
    { name: "pos-store" }
  )
);
