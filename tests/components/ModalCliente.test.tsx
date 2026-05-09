/**
 * Tests MC-01 a MC-19: ModalCliente — auto-formato de RUT y comportamiento
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSetCliente  = jest.fn();
const mockClearCliente = jest.fn();

jest.mock("@/stores/pos", () => ({
  usePOSStore: jest.fn(() => ({
    setCliente:   mockSetCliente,
    clearCliente: mockClearCliente,
    items:        [],
  })),
}));

const mockGetClienteByRUT     = jest.fn();
const mockGetMascotasByCliente = jest.fn();

jest.mock("@/app/(app)/pos/api", () => ({
  getClienteByRUT:      (...args: unknown[]) => mockGetClienteByRUT(...args),
  getMascotasByCliente: (...args: unknown[]) => mockGetMascotasByCliente(...args),
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog:        ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children, onClick, disabled, variant,
  }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant}>
      {children}
    </button>
  ),
}));

// Fetch secundario (fidelización, consumo-configs, alimento-check)
global.fetch = jest.fn().mockResolvedValue({
  ok:   false,
  json: async () => null,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function setup() {
  const onClose = jest.fn();
  render(<ModalCliente onClose={onClose} />, { wrapper: makeWrapper() });
  const input = screen.getByPlaceholderText("12.345.678-9");
  return { onClose, input };
}

function changeRUT(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

// ── Import después de mocks ───────────────────────────────────────────────────

import ModalCliente from "@/app/(app)/pos/components/ModalCliente";

// ── Suite 1: auto-formato del input ──────────────────────────────────────────

describe("ModalCliente — auto-formato de RUT", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClienteByRUT.mockResolvedValue(null);
    mockGetMascotasByCliente.mockResolvedValue([]);
  });

  it("MC-01: 1 a 3 dígitos no aplica formato", () => {
    const { input } = setup();

    changeRUT(input, "1");
    expect(input).toHaveValue("1");

    changeRUT(input, "15");
    expect(input).toHaveValue("15");

    changeRUT(input, "158");
    expect(input).toHaveValue("158");
  });

  it("MC-02: 4° dígito produce formato XXX-X", () => {
    const { input } = setup();
    changeRUT(input, "1234");
    expect(input).toHaveValue("123-4");
  });

  it("MC-03: 5 dígitos produce X.XXX-X", () => {
    const { input } = setup();
    changeRUT(input, "12345");
    expect(input).toHaveValue("1.234-5");
  });

  it("MC-04: 6 dígitos produce XX.XXX-X", () => {
    const { input } = setup();
    changeRUT(input, "123456");
    expect(input).toHaveValue("12.345-6");
  });

  it("MC-05: 7 dígitos produce XXX.XXX-X", () => {
    const { input } = setup();
    changeRUT(input, "1234567");
    expect(input).toHaveValue("123.456-7");
  });

  it("MC-06: 8 dígitos produce X.XXX.XXX-X", () => {
    const { input } = setup();
    changeRUT(input, "12345678");
    expect(input).toHaveValue("1.234.567-8");
  });

  it("MC-07: 9 dígitos produce XX.XXX.XXX-X", () => {
    const { input } = setup();
    changeRUT(input, "123456789");
    expect(input).toHaveValue("12.345.678-9");
  });

  it("MC-08: acepta K como DV y lo normaliza a mayúscula", () => {
    const { input } = setup();
    // 9 chars: body=12345678 (8 dígitos), DV=K
    changeRUT(input, "12345678k");
    expect(input).toHaveValue("12.345.678-K");
  });

  it("MC-09: ignora caracteres no válidos (letras, símbolos)", () => {
    const { input } = setup();
    changeRUT(input, "abc123!@#456");
    expect(input).toHaveValue("12.345-6");
  });

  it("MC-10: limita a 9 caracteres raw (8 cuerpo + 1 DV)", () => {
    const { input } = setup();
    changeRUT(input, "1234567890"); // 10 dígitos
    expect(input).toHaveValue("12.345.678-9"); // descarta el 10°
  });

  it("MC-11: re-formatea correctamente si el valor ya tiene puntos y guion", () => {
    const { input } = setup();
    // Simula que el valor ya estaba formateado (e.g. tras pegar)
    changeRUT(input, "1.234-5");
    expect(input).toHaveValue("1.234-5");
  });
});

// ── Suite 2: validación progresiva del DV ─────────────────────────────────────

describe("ModalCliente — validación progresiva de DV", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClienteByRUT.mockResolvedValue(null);
    mockGetMascotasByCliente.mockResolvedValue([]);
  });

  it("MC-12: sin guion (1-3 dígitos) no muestra mensaje de validación", () => {
    const { input } = setup();
    changeRUT(input, "158");
    expect(screen.queryByText("RUT inválido")).not.toBeInTheDocument();
  });

  it("MC-13: desde el 4° dígito muestra 'RUT inválido' si el DV es incorrecto", () => {
    const { input } = setup();
    // 1234 → 123-4; el cuerpo es demasiado corto para ser un RUT real → inválido
    changeRUT(input, "1234");
    expect(screen.getByText("RUT inválido")).toBeInTheDocument();
  });

  it("MC-14: no muestra 'RUT inválido' cuando el DV es correcto (15.855.267-1)", () => {
    const { input } = setup();
    // 158552671 → 15.855.267-1, dígito verificador correcto
    changeRUT(input, "158552671");
    expect(screen.queryByText("RUT inválido")).not.toBeInTheDocument();
  });

  it("MC-15: cambia de válido a inválido al editar el DV", () => {
    const { input } = setup();

    changeRUT(input, "158552671"); // válido
    expect(screen.queryByText("RUT inválido")).not.toBeInTheDocument();

    changeRUT(input, "158552679"); // DV incorrecto (debería ser 1)
    expect(screen.getByText("RUT inválido")).toBeInTheDocument();
  });
});

// ── Suite 3: activación del query de búsqueda ─────────────────────────────────

describe("ModalCliente — query de búsqueda", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMascotasByCliente.mockResolvedValue([]);
  });

  it("MC-16: no consulta getClienteByRUT mientras el RUT es inválido", () => {
    mockGetClienteByRUT.mockResolvedValue(null);
    const { input } = setup();
    changeRUT(input, "1234"); // inválido
    expect(mockGetClienteByRUT).not.toHaveBeenCalled();
  });

  it("MC-17: consulta getClienteByRUT al completar un RUT válido", async () => {
    mockGetClienteByRUT.mockResolvedValue(null);
    const { input } = setup();
    changeRUT(input, "158552671"); // 15.855.267-1 válido
    await waitFor(() => expect(mockGetClienteByRUT).toHaveBeenCalled());
  });

  it("MC-18: muestra 'Cliente no encontrado' para RUT válido sin resultado", async () => {
    mockGetClienteByRUT.mockResolvedValue(null);
    const { input } = setup();
    changeRUT(input, "158552671");
    await waitFor(() =>
      expect(screen.getByText("Cliente no encontrado.")).toBeInTheDocument()
    );
  });

  it("MC-19: muestra el nombre del cliente cuando es encontrado", async () => {
    mockGetClienteByRUT.mockResolvedValue({
      id:       "cli-1",
      nombre:   "María García",
      rut:      "15.855.267-1",
      email:    null,
      telefono: null,
    });
    const { input } = setup();
    changeRUT(input, "158552671");
    await waitFor(() =>
      expect(screen.getByText("María García")).toBeInTheDocument()
    );
  });
});

// ── Suite 4: botones ──────────────────────────────────────────────────────────

describe("ModalCliente — botones", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClienteByRUT.mockResolvedValue(null);
    mockGetMascotasByCliente.mockResolvedValue([]);
  });

  it("MC-20: 'Sin cliente' llama clearCliente y onClose", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByText("Sin cliente"));
    expect(mockClearCliente).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("MC-21: 'Confirmar' está deshabilitado cuando hay RUT válido pero sin cliente", async () => {
    const { input } = setup();
    changeRUT(input, "158552671");
    await waitFor(() =>
      expect(screen.getByText("Cliente no encontrado.")).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
  });

  it("MC-22: 'Confirmar' está habilitado cuando el cliente es encontrado", async () => {
    mockGetClienteByRUT.mockResolvedValue({
      id:       "cli-1",
      nombre:   "Juan Pérez",
      rut:      "15.855.267-1",
      email:    null,
      telefono: null,
    });
    const { input } = setup();
    changeRUT(input, "158552671");
    await waitFor(() =>
      expect(screen.getByText("Juan Pérez")).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Confirmar" })).not.toBeDisabled();
  });
});
