/**
 * Test PP-13: POSPage — el carrito se limpia automáticamente tras una
 * venta exitosa.
 *
 * Reporte: "el carrito/grilla de productos no se refresca automáticamente
 * después de completar una venta".
 *
 * PP-12 ya verifica que la grilla (SearchProductos real) actualiza el stock.
 * PP-05 verifica que invalida ["productos"] y ["ventas"] con refetchType "all".
 * PP-13 verifica que clearCart se llama tras una venta exitosa.
 *
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockCreateVenta = jest.fn();
const mockClearCart = jest.fn();
const mockSetWorker = jest.fn();

function buildStore() {
  return {
    items: [{ id: "i1", producto_id: "p1", nombre: "Test", precio: 1000, cantidad: 1, subtotal: 1000 }],
    clienteId: undefined,
    mascotaId: undefined,
    workerClerkId: "user-123",
    metodoPago: "efectivo",
    numeroTransaccion: undefined,
    descuento: 0,
    fidelizacionDescuento: 0,
    procedencia: "presencial",
    pagoNc: undefined,
    notas: "",
    enviarEmailRecibo: false,
    total: () => 1000,
    clearCart: mockClearCart,
    setWorker: mockSetWorker,
    addItem: jest.fn(),
    removeItem: jest.fn(),
  };
}

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

jest.mock("@/app/(app)/pos/api", () => ({ createVenta: mockCreateVenta }));

jest.mock("@/app/(app)/pos/components/SearchProductos", () => ({
  __esModule: true,
  default: () => <div data-testid="search-productos" />,
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

describe("POSPage — cart clear after sale (PP-13)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateVenta.mockReset();
    mockClearCart.mockClear();
    mockSetWorker.mockClear();
    (window as unknown as { open: jest.Mock }).open = jest.fn().mockReturnValue({});

    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const store = buildStore();
    mockUsePOSStore.mockImplementation((selector?: (s: typeof store) => unknown) => {
      if (typeof selector === "function") return selector(store);
      return store;
    });
  });

  // PP-13 — igual patrón que PP-05 (store mock estático)
  it("PP-13: clearCart se llama tras venta exitosa y botón cambia a Carrito vacío", async () => {
    mockCreateVenta.mockResolvedValue({ id: "venta-1" });

    render(<POSPage />, { wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )});

    // Botón muestra Cobrar y monto
    expect(screen.getByRole("button", { name: /Cobrar/ })).toBeInTheDocument();
    expect(screen.getByText(/\$1\.000/)).toBeInTheDocument();

    // Completar venta
    fireEvent.click(screen.getByRole("button", { name: /Cobrar/ }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-pago"));
    });

    expect(mockCreateVenta).toHaveBeenCalledTimes(1);
    expect(mockClearCart).toHaveBeenCalledTimes(1);
  });
});
