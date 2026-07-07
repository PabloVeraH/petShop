/**
 * Tests SP-01 a SP-04: Pago modal en SupplierHubPage
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockMutate = jest.fn();
let mutationCallbacks: Array<{ onSuccess?: Function; onError?: Function }> = [];
const mockUseMutation = jest.fn((opts?: any) => {
  mutationCallbacks.push({ onSuccess: opts?.onSuccess, onError: opts?.onError });
  return { mutate: mockMutate, isPending: false };
});

jest.mock("@tanstack/react-query", () => {
  const actual = jest.requireActual("@tanstack/react-query");
  return {
    ...actual,
    useQuery: jest.fn(),
    useMutation: (...args: any[]) => mockUseMutation(...args),
    useQueryClient: jest.fn(() => ({ invalidateQueries: jest.fn() })),
  };
});

const { useQuery } = jest.requireMock("@tanstack/react-query");

const MOCK_PROVEEDOR = { id: "prov-1", nombre: "Test Proveedor", rut: null, contacto: null, telefono: null, email: null };
const MOCK_CUENTA = { id: "cp-1", monto: 50000, fecha_vencimiento: "2026-07-01", estado: "pendiente" };

function setupMocks() {
  useQuery.mockImplementation(({ queryKey }: any) => {
    if (queryKey[0] === "proveedores") return { data: [MOCK_PROVEEDOR], isLoading: false };
    if (queryKey[0] === "proveedor") return { data: { ...MOCK_PROVEEDOR, productos: [] } };
    if (queryKey[0] === "ordenes-proveedor") return { data: [] };
    if (queryKey[0] === "cuentas-proveedor") return { data: [MOCK_CUENTA] };
    if (queryKey[0] === "productos-activos") return { data: [] };
    return { data: [], isLoading: false };
  });
}

async function renderPage() {
  const SupplierHubPage = (await import("@/app/(app)/suppliers/page")).default;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SupplierHubPage />
    </QueryClientProvider>
  );
}

async function selectProveedor() {
  fireEvent.click(screen.getAllByText("Test Proveedor")[0]);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Pagar" })).toBeInTheDocument();
  });
}

describe("SuppliersPage - Payment Modal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mutationCallbacks = [];
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
    mockMutate.mockClear();
    setupMocks();
  });

  // SP-01
  it("SP-01: Click Pagar abre modal con selector de método de pago", async () => {
    await renderPage();
    await selectProveedor();

    fireEvent.click(screen.getByRole("button", { name: "Pagar" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Confirmar pago" })).toBeInTheDocument();
      expect(screen.getByText("Método de pago")).toBeInTheDocument();
    });

    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("efectivo");
  });

  // SP-02
  it("SP-02: Cambiar método de pago en el selector", async () => {
    await renderPage();
    await selectProveedor();

    fireEvent.click(screen.getByRole("button", { name: "Pagar" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Confirmar pago" })).toBeInTheDocument();
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "transferencia" } });
    expect(select.value).toBe("transferencia");
  });

  // SP-03
  it("SP-03: Confirmar pago envía metodo_pago en PATCH", async () => {
    await renderPage();
    await selectProveedor();

    fireEvent.click(screen.getByRole("button", { name: "Pagar" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));

    expect(mockMutate).toHaveBeenCalledWith({
      id: MOCK_CUENTA.id,
      metodo_pago: "efectivo",
    });
  });

  // SP-04
  it("SP-04: Cancelar cierra modal sin pagar", async () => {
    await renderPage();
    await selectProveedor();

    fireEvent.click(screen.getByRole("button", { name: "Pagar" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Confirmar pago" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Confirmar pago" })).not.toBeInTheDocument();
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  // SP-05
  it("SP-05: Payment falla → muestra mensaje de error en el modal", async () => {
    await renderPage();
    await selectProveedor();

    fireEvent.click(screen.getByRole("button", { name: "Pagar" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Confirmar pago" })).toBeInTheDocument();
    });

    const payMutation = mutationCallbacks.filter((cb) => cb.onError).pop();
    expect(payMutation).toBeDefined();
    await act(async () => {
      payMutation!.onError!(new Error("Error interno del servidor"));
    });

    await waitFor(() => {
      expect(screen.getByText("Error interno del servidor")).toBeInTheDocument();
    });
  });
});
