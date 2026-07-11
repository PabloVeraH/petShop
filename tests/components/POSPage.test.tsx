/**
 * Tests PP-01 a PP-04, PP-06: POSPage — botón "Cobrar" reactivo al total del carrito
 *
 * PP-01  REGRESIÓN — botón muestra total real ($15.458), no $0, con items en carrito
 * PP-02  REGRESIÓN — botón nunca dice $0 cuando items.length > 0
 * PP-03  Carrito vacío → botón dice "Carrito vacío" y está deshabilitado
 * PP-04  REGRESIÓN — setWorker se llama con userId al montar
 * PP-06  Total se computa de items+descuento localmente (no vía selector separado)
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockClearCart = jest.fn();
const mockSetWorker = jest.fn();

// Simula un carrito con un producto cargado (estado post-rehidratación de persist)
function makeMockStore(overrides: { items?: unknown[]; descuento?: number } = {}) {
  return {
    items: overrides.items ?? [
      { id: "item-1", producto_id: "prod-1", nombre: "Whiskas 1kg", precio: 15458, cantidad: 1, subtotal: 15458 },
    ],
    clienteId: undefined,
    mascotaId: undefined,
    workerClerkId: undefined,
    metodoPago: "efectivo",
    numeroTransaccion: undefined,
    descuento: overrides.descuento ?? 0,
    procedencia: "presencial",
    pagoNc: undefined,
    enviarEmailRecibo: false,
    clearCart: mockClearCart,
    setWorker: mockSetWorker,
  };
}

// POSPage ahora solo llama usePOSStore() sin selector — el total se computa
// con calcularTotalCarrito(items, descuento) (función pura real, no mockeada)
// localmente desde items + descuento en el mismo render.
const mockUsePOSStore = jest.fn();

jest.mock("@/stores/pos", () => ({
  ...jest.requireActual("@/stores/pos"),
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
    mockUsePOSStore.mockReturnValue(store);

    render(<POSPage />, { wrapper: makeWrapper() });

    const button = screen.getByRole("button", { name: /Cobrar/i });
    expect(button).toHaveTextContent("Cobrar $15.458");
    expect(button).not.toBeDisabled();
  });

  // PP-02: REGRESIÓN — el botón NO dice "Cobrar $0" cuando el carrito tiene items
  it("PP-02: el botón nunca muestra $0 cuando items.length > 0", () => {
    const store = makeMockStore();
    mockUsePOSStore.mockReturnValue(store);

    render(<POSPage />, { wrapper: makeWrapper() });

    const button = screen.getByRole("button", { name: /Cobrar/i });
    expect(button).not.toHaveTextContent("$0");
  });

  // PP-03: carrito vacío → botón dice 'Carrito vacío' y está deshabilitado
  it("PP-03: con carrito vacío el botón dice 'Carrito vacío' y está deshabilitado", () => {
    const store = makeMockStore({ items: [] });
    mockUsePOSStore.mockReturnValue(store);

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
    const store = { ...makeMockStore(), workerClerkId: "admin-clerk-id-previo" };
    mockUsePOSStore.mockReturnValue(store);

    render(<POSPage />, { wrapper: makeWrapper() });

    // El userId del mock de Clerk es "user-123" (el vendedor actual)
    // setWorker debe haberse llamado con el userId actual, no dejar el admin previo
    expect(mockSetWorker).toHaveBeenCalledWith("user-123");
  });

  // PP-06: REGRESIÓN — el total se computa con calcularTotalCarrito(items, descuento)
  // sobre los mismos items/descuento ya destructurados en este render, no vía un
  // getter del store (state.total()) que lee get() en el momento de la invocación.
  it("PP-06: total local coincide con la suma de subtotales menos descuento", () => {
    const store = makeMockStore({
      items: [
        { id: "a", subtotal: 10000 },
        { id: "b", subtotal: 5000 },
      ],
      descuento: 10,
    });
    mockUsePOSStore.mockReturnValue(store);

    render(<POSPage />, { wrapper: makeWrapper() });

    // subtotal = 10000 + 5000 = 15000
    // descuento 10% = 1500
    // total = 15000 - 1500 = 13500
    const button = screen.getByRole("button", { name: /Cobrar/i });
    expect(button).toHaveTextContent("Cobrar $13.500");
  });
});
