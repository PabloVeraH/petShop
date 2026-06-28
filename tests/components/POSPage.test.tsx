/**
 * Tests PP-01 a PP-04: POSPage — botón "Cobrar" reactivo al total del carrito
 * Regresión: el botón mostraba "Cobrar $0" al cargar la página con items persistidos
 * en localStorage, porque usePOSStore() sin selector no garantizaba re-render tras
 * la rehidratación de Zustand persist. Fix: cartTotal = usePOSStore(state => state.total())
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockClearCart = jest.fn();
const mockSetWorker = jest.fn();

// Simula un carrito con un producto cargado (estado post-rehidratación de persist)
function makeMockStore(overrides: { items?: unknown[]; cartTotal?: number } = {}) {
  const items = overrides.items ?? [
    { id: "item-1", producto_id: "prod-1", nombre: "Whiskas 1kg", precio: 15458, cantidad: 1, subtotal: 15458 },
  ];
  const total = overrides.cartTotal ?? 15458;

  return {
    items,
    clienteId: undefined,
    mascotaId: undefined,
    workerClerkId: undefined,
    metodoPago: "efectivo",
    numeroTransaccion: undefined,
    descuento: 0,
    procedencia: "presencial",
    pagoNc: undefined,
    enviarEmailRecibo: false,
    clearCart: mockClearCart,
    setWorker: mockSetWorker,
    total: () => total,
    subtotal: () => total,
    impuesto: () => Math.round(total * 0.19 / 1.19),
  };
}

// usePOSStore se llama dos veces en POSPage:
// 1. usePOSStore()  → destructure general (items, clearCart, etc.)
// 2. usePOSStore(selector) → selector para cartTotal = state.total()
const mockUsePOSStore = jest.fn();

jest.mock("@/stores/pos", () => ({
  usePOSStore: (...args: unknown[]) => mockUsePOSStore(...args),
}));

jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    userId: "user-123",
    sessionClaims: { publicMetadata: { storeAdmin: true } },
  }),
}));

jest.mock("@tanstack/react-query", () => {
  const actual = jest.requireActual("@tanstack/react-query");
  return {
    ...actual,
    useMutation: () => ({ mutate: jest.fn(), isPending: false }),
  };
});

jest.mock("@/app/(app)/pos/components/SearchProductos",   () => ({ __esModule: true, default: () => <div /> }));
jest.mock("@/app/(app)/pos/components/Carrito",           () => ({ __esModule: true, default: () => <div data-testid="carrito" /> }));
jest.mock("@/app/(app)/pos/components/ModalCliente",      () => ({ __esModule: true, default: () => null }));
jest.mock("@/app/(app)/pos/components/ModalPago",         () => ({ __esModule: true, default: () => null }));
jest.mock("@/app/(app)/pos/components/RecomendacionesIA", () => ({ __esModule: true, default: () => null }));
jest.mock("@/app/(app)/pos/api",                          () => ({ createVenta: jest.fn() }));

import POSPage from "@/app/(app)/pos/page";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POSPage — botón Cobrar reactivo (PP-01/PP-02/PP-03)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // PP-01: REGRESIÓN — el botón muestra el total real, no $0, cuando hay items en el carrito
  it("PP-01: con carrito persistido ($15.458) el botón muestra 'Cobrar $15.458'", () => {
    const store = makeMockStore();
    // Primera llamada: sin selector → devuelve el store completo
    // Segunda llamada: con selector (state => state.total()) → devuelve el total
    mockUsePOSStore.mockImplementation((selector?: (s: typeof store) => unknown) => {
      if (typeof selector === "function") return selector(store);
      return store;
    });

    render(<POSPage />, { wrapper: makeWrapper() });

    const button = screen.getByRole("button", { name: /Cobrar/i });
    expect(button).toHaveTextContent("Cobrar $15.458");
    expect(button).not.toBeDisabled();
  });

  // PP-02: REGRESIÓN — el botón NO dice "Cobrar $0" cuando el carrito tiene items
  it("PP-02: el botón nunca muestra $0 cuando items.length > 0", () => {
    const store = makeMockStore();
    mockUsePOSStore.mockImplementation((selector?: (s: typeof store) => unknown) => {
      if (typeof selector === "function") return selector(store);
      return store;
    });

    render(<POSPage />, { wrapper: makeWrapper() });

    const button = screen.getByRole("button", { name: /Cobrar/i });
    expect(button).not.toHaveTextContent("$0");
  });

  // PP-03: carrito vacío → botón dice 'Carrito vacío' y está deshabilitado
  it("PP-03: con carrito vacío el botón dice 'Carrito vacío' y está deshabilitado", () => {
    const store = makeMockStore({ items: [], cartTotal: 0 });
    mockUsePOSStore.mockImplementation((selector?: (s: typeof store) => unknown) => {
      if (typeof selector === "function") return selector(store);
      return store;
    });

    render(<POSPage />, { wrapper: makeWrapper() });

    const button = screen.getByRole("button", { name: /Carrito vacío/i });
    expect(button).toHaveTextContent("Carrito vacío");
    expect(button).toBeDisabled();
  });

  // PP-04: REGRESIÓN — el vendedor activo siempre se asigna al montar, incluso si
  // workerClerkId tiene un valor persistido de una sesión anterior (ej: admin previo).
  // Bug: la condición `!workerClerkId` impedía sobreescribir el admin guardado en
  // localStorage cuando un vendedor diferente iniciaba sesión en el mismo equipo.
  it("PP-04: setWorker se llama con userId al montar aunque workerClerkId ya tenga valor previo", () => {
    // Store con workerClerkId del admin de la sesión anterior
    const store = makeMockStore();
    const storeConWorkerPrevio = { ...store, workerClerkId: "admin-clerk-id-previo" };
    mockUsePOSStore.mockImplementation((selector?: (s: typeof store) => unknown) => {
      if (typeof selector === "function") return selector(storeConWorkerPrevio);
      return storeConWorkerPrevio;
    });

    render(<POSPage />, { wrapper: makeWrapper() });

    // El userId del mock de Clerk es "user-123" (el vendedor actual)
    // setWorker debe haberse llamado con el userId actual, no dejar el admin previo
    expect(mockSetWorker).toHaveBeenCalledWith("user-123");
  });
});
