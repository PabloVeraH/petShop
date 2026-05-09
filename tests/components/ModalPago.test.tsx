/**
 * Tests MP-01 a MP-05: ModalPago — toggle "Enviar boleta por mail al cliente"
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSetEnviarEmailRecibo = jest.fn();
const mockSetMetodoPago        = jest.fn();
const mockSetDescuento         = jest.fn();
const mockSetProcedencia       = jest.fn();
const mockSetNumeroTransaccion = jest.fn();
const mockSetWorker            = jest.fn();
const mockSetPayNc             = jest.fn();
const mockClearPayNc           = jest.fn();

// Variables mutables — se leen en la factory cada vez que el componente llama usePOSStore()
let mockClienteEmail: string | undefined    = undefined;
let mockEnviarEmailRecibo                   = false;

jest.mock("@/stores/pos", () => ({
  usePOSStore: jest.fn(() => ({
    subtotal:              () => 10000,
    descuento:             0,
    total:                 () => 10000,
    metodoPago:            "efectivo",
    setMetodoPago:         mockSetMetodoPago,
    numeroTransaccion:     undefined,
    setNumeroTransaccion:  mockSetNumeroTransaccion,
    setDescuento:          mockSetDescuento,
    fidelizacionDescuento: 0,
    workerClerkId:         undefined,
    setWorker:             mockSetWorker,
    procedencia:           "presencial",
    setProcedencia:        mockSetProcedencia,
    pagoNc:                undefined,
    setPayNc:              mockSetPayNc,
    clearPayNc:            mockClearPayNc,
    clienteEmail:          mockClienteEmail,
    enviarEmailRecibo:     mockEnviarEmailRecibo,
    setEnviarEmailRecibo:  mockSetEnviarEmailRecibo,
  })),
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog:        ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children, onClick, disabled,
  }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

// Workers endpoint → lista vacía
global.fetch = jest.fn().mockResolvedValue({
  ok:   true,
  json: async () => [],
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function setup() {
  const onConfirm = jest.fn();
  const onCancel  = jest.fn();
  render(
    <ModalPago onConfirm={onConfirm} onCancel={onCancel} isLoading={false} />,
    { wrapper: makeWrapper() },
  );
  return { onConfirm, onCancel };
}

// ── Import después de mocks ───────────────────────────────────────────────────

import ModalPago from "@/app/(app)/pos/components/ModalPago";

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("ModalPago — toggle email al cliente", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClienteEmail      = undefined;
    mockEnviarEmailRecibo = false;
  });

  // MP-01
  it("MP-01: toggle NO se muestra cuando el cliente no tiene email", () => {
    // mockClienteEmail = undefined (default)
    setup();
    expect(screen.queryByText(/Enviar boleta por mail/)).not.toBeInTheDocument();
  });

  // MP-02
  it("MP-02: toggle SE muestra cuando el cliente tiene email", () => {
    mockClienteEmail = "juan@test.com";
    setup();
    expect(screen.getByText(/Enviar boleta por mail/)).toBeInTheDocument();
  });

  // MP-03
  it("MP-03: toggle aparece desactivado por defecto (muestra '○')", () => {
    mockClienteEmail      = "juan@test.com";
    mockEnviarEmailRecibo = false;
    setup();
    const btn = screen.getByText(/Enviar boleta por mail/).closest("button");
    expect(btn).toHaveTextContent("○");
  });

  // MP-04
  it("MP-04: al hacer click llama setEnviarEmailRecibo(true) cuando está desactivado", () => {
    mockClienteEmail      = "juan@test.com";
    mockEnviarEmailRecibo = false;
    setup();
    fireEvent.click(screen.getByText(/Enviar boleta por mail/).closest("button")!);
    expect(mockSetEnviarEmailRecibo).toHaveBeenCalledWith(true);
  });

  // MP-05
  it("MP-05: cuando enviarEmailRecibo=true muestra '✓' y llama setEnviarEmailRecibo(false) al hacer click", () => {
    mockClienteEmail      = "juan@test.com";
    mockEnviarEmailRecibo = true;
    setup();
    const btn = screen.getByText(/Enviar boleta por mail/).closest("button")!;
    expect(btn).toHaveTextContent("✓");
    fireEvent.click(btn);
    expect(mockSetEnviarEmailRecibo).toHaveBeenCalledWith(false);
  });
});
