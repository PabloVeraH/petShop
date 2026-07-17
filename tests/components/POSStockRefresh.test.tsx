/**
 * Test PP-12: POSPage — la grilla de productos (SearchProductos, sin
 * mockear) refleja el stock nuevo inmediatamente después de una venta
 * exitosa, sin recargar la página.
 *
 * Reporte: "el stock mostrado en la grilla de productos del POS no se
 * actualiza automáticamente después de completar una venta; el número
 * permanece igual hasta recargar la página (F5)".
 *
 * Investigación: no se pudo reproducir contra el código actual.
 * `queryClient.invalidateQueries({ queryKey: ["productos"] })` en el
 * onSuccess de pos/page.tsx (ya existente, no es un fix nuevo) usa el
 * refetchType por defecto ("active" — confirmado leyendo
 * node_modules/@tanstack/query-core), que fuerza un refetch inmediato de
 * cualquier query activa cuyo queryKey empiece con ["productos", ...] —
 * exactamente el que usa SearchProductos.tsx. Sanity-check: este mismo test
 * FALLA si se remueve esa línea (confirmado manualmente, no incluido aquí),
 * por lo que si el mecanismo se rompe en el futuro este test lo detecta.
 * El backend (crear_venta_tx, migrations/044_venta_granel.sql) descuenta
 * stock de forma síncrona dentro de la misma transacción atómica que crea
 * la venta — el RPC se invoca con `await` en api/ventas/route.ts, así que
 * el commit ya ocurrió cuando el cliente recibe la respuesta 200.
 * Este test queda como regresión permanente para ese contrato.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockCreateVenta = jest.fn();
const mockClearCart = jest.fn();
const mockSetWorker = jest.fn();

function makeMockStore(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ id: "i1", producto_id: "prod-1", nombre: "Whiskas 1kg", precio: 15458, cantidad: 1, subtotal: 15458 }],
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
    addItem: jest.fn(),
    ...overrides,
  };
}

const mockUsePOSStore = jest.fn();

jest.mock("@/stores/pos", () => ({
  ...jest.requireActual("@/stores/pos"),
  usePOSStore: (...args: unknown[]) => mockUsePOSStore(...args),
}));

jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: "user-123", sessionClaims: { publicMetadata: { storeAdmin: true } } }),
}));

jest.mock("@/app/(app)/pos/api", () => ({
  createVenta: (...args: unknown[]) => mockCreateVenta(...args),
  getProductos: (search: string) =>
    fetch(`/api/productos?search=${encodeURIComponent(search)}`).then((r) => r.json()),
}));

// Carrito, ModalCliente y RecomendacionesIA no son relevantes para esta
// regresión — se mockean para aislar el flujo. SearchProductos y ModalPago
// se mantienen reales (ModalPago vía un stub mínimo que solo expone
// onConfirm, ya que el formulario de pago completo no es el foco aquí).
jest.mock("@/app/(app)/pos/components/Carrito", () => ({ __esModule: true, default: () => <div data-testid="carrito" /> }));
jest.mock("@/app/(app)/pos/components/ModalCliente", () => ({ __esModule: true, default: () => null }));
jest.mock("@/app/(app)/pos/components/RecomendacionesIA", () => ({ __esModule: true, default: () => null }));
jest.mock("@/app/(app)/pos/components/ModalPago", () => ({
  __esModule: true,
  default: ({ onConfirm }: { onConfirm: () => void }) => (
    <button onClick={onConfirm} data-testid="confirm-pago">Confirmar Pago</button>
  ),
}));

import POSPage from "@/app/(app)/pos/page";

const PRODUCTO_ANTES = { id: "prod-1", store_id: "s1", nombre: "Whiskas 1kg", sku: "W-1", precio: 15458, stock: 10, stock_minimo: 2 };
const PRODUCTO_DESPUES = { ...PRODUCTO_ANTES, stock: 9 };

describe("POSPage — grilla de productos tras venta (PP-12)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (window as unknown as { open: jest.Mock }).open = jest.fn().mockReturnValue({});
  });

  // PP-12: stock en la grilla se refresca solo tras una venta exitosa
  it("PP-12: el stock en la grilla se actualiza automáticamente tras una venta exitosa, sin recargar la página", async () => {
    mockUsePOSStore.mockReturnValue(makeMockStore());
    mockCreateVenta.mockResolvedValue({ id: "venta-1" });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });

    let ventaCompletada = false;
    global.fetch = jest.fn((url: string) => {
      if (url.startsWith("/api/productos")) {
        const data = ventaCompletada ? [PRODUCTO_DESPUES] : [PRODUCTO_ANTES];
        return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }) as unknown as typeof fetch;

    render(
      <QueryClientProvider client={qc}>
        <POSPage />
      </QueryClientProvider>
    );

    // Estado inicial: grilla muestra stock 10
    await waitFor(() => {
      expect(screen.getByText("Stock: 10")).toBeInTheDocument();
    });

    // Usuario buscó el producto antes de agregarlo — search NO está vacío
    // cuando se completa la venta (flujo real más común que dejar el campo
    // vacío), verificando que la invalidación no dependa de un queryKey
    // exacto ["productos", ""].
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/i), {
      target: { value: "whiskas" },
    });
    await waitFor(() => expect(screen.getByText("Stock: 10")).toBeInTheDocument());

    // Completar la venta
    ventaCompletada = true;
    fireEvent.click(screen.getByRole("button", { name: /Cobrar/i }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-pago"));
    });

    expect(mockCreateVenta).toHaveBeenCalledTimes(1);

    // La grilla debe reflejar el stock nuevo SIN recargar la página
    await waitFor(() => {
      expect(screen.getByText("Stock: 9")).toBeInTheDocument();
    });
  });
});
