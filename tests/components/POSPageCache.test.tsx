/**
 * Tests PP-05: POSPage — invalidación de caché tras venta exitosa
 * PP-05: REGRESIÓN — completar venta invalida ["ventas"] con refetchType "all"
 *         (no solo activos). Sin refetchType: "all", al navegar a Ventas la lista
 *         muestra datos stale hasta recargar la página.
 *
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockCreateVenta = jest.fn();
const mockClearCart = jest.fn();
const mockSetWorker = jest.fn();

function makeMockStore(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ id: "i1", producto_id: "p1", nombre: "Test", precio: 1000, cantidad: 1, subtotal: 1000 }],
    clienteId: undefined,
    mascotaId: undefined,
    workerClerkId: undefined,
    metodoPago: "efectivo",
    numeroTransaccion: undefined,
    descuento: 0,
    procedencia: "presencial",
    pagoNc: undefined,
    enviarEmailRecibo: false,
    notas: "",
    clearCart: mockClearCart,
    setWorker: mockSetWorker,
    total: () => 1000,
    subtotal: () => 1000,
    impuesto: () => 160,
    ...overrides,
  };
}

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

jest.mock("@/app/(app)/pos/api", () => ({ createVenta: mockCreateVenta }));

jest.mock("@/app/(app)/pos/components/SearchProductos", () => ({
  __esModule: true,
  default: () => <div />,
}));

jest.mock("@/app/(app)/pos/components/Carrito", () => ({
  __esModule: true,
  default: () => <div data-testid="carrito" />,
}));

jest.mock("@/app/(app)/pos/components/ModalCliente", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/app/(app)/pos/components/ModalPago", () => ({
  __esModule: true,
  default: ({ onConfirm }: { onConfirm: () => void }) => (
    <button onClick={onConfirm} data-testid="confirm-pago">Confirmar Pago</button>
  ),
}));

jest.mock("@/app/(app)/pos/components/RecomendacionesIA", () => ({
  __esModule: true,
  default: () => null,
}));

import POSPage from "@/app/(app)/pos/page";

describe("POSPage — invalidación de caché post-venta", () => {
  let qc: QueryClient;
  let spy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateVenta.mockReset();
    mockClearCart.mockClear();
    mockSetWorker.mockClear();

    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    spy = jest.spyOn(qc, "invalidateQueries");

    const store = makeMockStore();
    mockUsePOSStore.mockImplementation((selector?: (s: typeof store) => unknown) => {
      if (typeof selector === "function") return selector(store);
      return store;
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  // PP-05 — REGRESIÓN: completar venta debe invalidar ["ventas"] con refetchType "all"
  it("PP-05: REGRESIÓN — completar venta invalida ['ventas'] con refetchType 'all'", async () => {
    mockCreateVenta.mockResolvedValue({ id: "new-venta-123" });

    render(<POSPage />, { wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )});

    // Click "Cobrar" → ModalPago se abre con su onConfirm
    fireEvent.click(screen.getByRole("button", { name: /Cobrar/i }));

    // Click confirmar en ModalPago → procesarVenta() se ejecuta
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-pago"));
    });

    // Verificar que createVenta fue llamada
    expect(mockCreateVenta).toHaveBeenCalledTimes(1);
    expect(mockCreateVenta).toHaveBeenCalledWith(
      expect.objectContaining({ metodoPago: "efectivo" })
    );

    // Verificar que se invalidaron las queries correctas
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: ["productos"] });
    });

    // DEBE llamar con refetchType: "all" — fuerza refetch aunque no haya observer activo
    expect(spy).toHaveBeenCalledWith({ queryKey: ["ventas"], refetchType: "all" });

    // NO debe llamar sin refetchType (esa es la versión bugueada)
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["ventas"] });

    // clearCart debe haberse llamado
    expect(mockClearCart).toHaveBeenCalledTimes(1);
  });
});
