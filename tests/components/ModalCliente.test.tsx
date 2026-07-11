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

// ── Suite 5: prompt de consumo (migración 032) ────────────────────────────────
// necesitaPrompt se basa en mascotas sin gramos_porcion, no por producto

describe("ModalCliente — prompt de porción diaria", () => {
  const CLIENTE = { id: "cli-1", nombre: "Juan Pérez", rut: "15.855.267-1", email: null, telefono: null };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClienteByRUT.mockResolvedValue(CLIENTE);
  });

  it("MC-23: NO muestra prompt si la mascota ya tiene gramos_porcion configurado", async () => {
    mockGetMascotasByCliente.mockResolvedValue([
      { id: "m-1", nombre: "Grizzly", tipo: "perro", gramos_porcion: 25, veces_dia: 3 },
    ]);
    // Simula alimento en carrito
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("alimento-check")) {
        return Promise.resolve({ ok: true, json: async () => [{ id: "p-1", nombre: "Pro Plan", peso_gramos: 3000 }] });
      }
      return Promise.resolve({ ok: false, json: async () => null });
    });

    const { usePOSStore } = require("@/stores/pos");
    (usePOSStore as jest.Mock).mockReturnValue({
      setCliente: mockSetCliente,
      clearCliente: mockClearCliente,
      items: [{ producto_id: "p-1", cantidad: 1 }],
    });

    const { input } = setup();
    changeRUT(input, "158552671");

    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());
    expect(screen.queryByText(/Porción diaria de alimento/i)).not.toBeInTheDocument();
  });

  it("MC-24: muestra prompt de porción para mascota SIN gramos_porcion cuando hay alimento en carrito", async () => {
    mockGetMascotasByCliente.mockResolvedValue([
      { id: "m-1", nombre: "Grizzly", tipo: "perro", gramos_porcion: null, veces_dia: null },
    ]);
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("alimento-check")) {
        return Promise.resolve({ ok: true, json: async () => [{ id: "p-1", nombre: "Pro Plan", peso_gramos: 3000 }] });
      }
      return Promise.resolve({ ok: false, json: async () => null });
    });

    const { usePOSStore } = require("@/stores/pos");
    (usePOSStore as jest.Mock).mockReturnValue({
      setCliente: mockSetCliente,
      clearCliente: mockClearCliente,
      items: [{ producto_id: "p-1", cantidad: 1 }],
    });

    const { input } = setup();
    changeRUT(input, "158552671");

    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByText(/Porción diaria de alimento/i)).toBeInTheDocument()
    );
    // Aparece en el selector de mascotas Y en el prompt → getAllByText
    expect(screen.getAllByText("Grizzly (perro)").length).toBeGreaterThanOrEqual(1);
  });
});

// ── Suite 6: deduplicación de mascotas (REGRESIÓN) ───────────────────────────

describe("ModalCliente — deduplicación de mascotas en dropdown (MC-25/MC-26)", () => {
  const CLIENTE = { id: "cli-1", nombre: "María González", rut: "15.855.267-1", email: null, telefono: null };

  beforeEach(() => {
    jest.clearAllMocks();
    // Restaurar fetch tras clearAllMocks (borra la implementación del mock global)
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => null });
    mockGetClienteByRUT.mockResolvedValue(CLIENTE);
  });

  // MC-25: REGRESIÓN — el dropdown no debe mostrar "Luna (gato)" dos veces
  it("MC-25: no muestra mascota duplicada cuando API devuelve dos registros con mismo nombre y tipo", async () => {
    mockGetMascotasByCliente.mockResolvedValue([
      { id: "m-dup-1", nombre: "Luna", tipo: "gato", gramos_porcion: null, veces_dia: null },
      { id: "m-dup-2", nombre: "Luna", tipo: "gato", gramos_porcion: null, veces_dia: null },
    ]);

    const { input } = setup();
    changeRUT(input, "158552671");

    await waitFor(() => expect(screen.getByText("María González")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText("Luna (gato)").length).toBeGreaterThan(0));

    // Debe aparecer solo UNA vez en el selector
    expect(screen.getAllByText("Luna (gato)")).toHaveLength(1);
  });

  // MC-26: mascotas con mismo nombre pero distinto tipo sí se muestran ambas
  it("MC-26: muestra ambas mascotas cuando tienen mismo nombre pero distinto tipo", async () => {
    mockGetMascotasByCliente.mockResolvedValue([
      { id: "m-1", nombre: "Luna", tipo: "gato",  gramos_porcion: null, veces_dia: null },
      { id: "m-2", nombre: "Luna", tipo: "perro", gramos_porcion: null, veces_dia: null },
    ]);

    const { input } = setup();
    changeRUT(input, "158552671");

    await waitFor(() => expect(screen.getByText("María González")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Luna (gato)")).toBeInTheDocument());

    expect(screen.getByText("Luna (gato)")).toBeInTheDocument();
    expect(screen.getByText("Luna (perro)")).toBeInTheDocument();
  });
});

// ── Suite 7: fidelización descuento automático (REGRESIÓN) ──────────────────

describe("ModalCliente — fidelización descuento automático (MC-27/28/29)", () => {
  const CLIENTE = { id: "cli-1", nombre: "María González", rut: "15.855.267-1", email: "maria@test.com", telefono: null };

  beforeEach(() => {
    jest.clearAllMocks();
    // Restaurar fetch mock por defecto
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      return Promise.resolve({ ok: false, json: async () => null });
    });
    mockGetClienteByRUT.mockResolvedValue(CLIENTE);
    mockGetMascotasByCliente.mockResolvedValue([]);
  });

  // MC-27: REGRESIÓN — al confirmar cliente con fidelización 10%,
  // setCliente recibe 10 como fidelizacionDescuento (auto-apply).
  // El bug: handleConfirm leía fidelizacion?.descuento_actual de una query
  // asíncrona que podía no haber completado, pasando 0 en vez del valor real.
  it("MC-27: confirmar cliente con descuento_actual=10 aplica 10 como fidelizacionDescuento", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("/api/fidelizacion")) {
        return Promise.resolve({
          ok:   true,
          json: async () => ({
            total_historico:    150_000,
            frecuencia_compras: 5,
            descuento_actual:   10,
            niveles:            [{ monto: 50000, descuento: 5 }, { monto: 150000, descuento: 10 }],
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => null });
    });

    const { input } = setup();
    changeRUT(input, "158552671");

    // Esperar a que aparezca el cliente y la fidelización
    await waitFor(() => expect(screen.getByText("María González")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Fidelización: 10%/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    // setCliente debe recibir el descuento real (10), no 0
    await waitFor(() => {
      expect(mockSetCliente).toHaveBeenCalledWith(
        "cli-1",
        undefined,     // selectedMascotaId (none selected)
        10,            // fidelizacionDescuento
        "maria@test.com",
      );
    });
  });

  // MC-28: REGRESIÓN — cliente sin fidelización: setCliente recibe 0
  it("MC-28: confirmar cliente sin fidelización pasa descuento 0", async () => {
    // mock por defecto: fetch devuelve ok=false → getFidelizacion retorna null
    const { input } = setup();
    changeRUT(input, "158552671");

    await waitFor(() => expect(screen.getByText("María González")).toBeInTheDocument());
    // No debe mostrar fidelización (fetch returns ok=false → null)
    expect(screen.queryByText(/Fidelización/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => {
      expect(mockSetCliente).toHaveBeenCalledWith(
        "cli-1",
        undefined,
        0,             // sin fidelización → descuento 0
        "maria@test.com",
      );
    });
  });

  // MC-29: REGRESIÓN — fidelización falla (API retorna null), descuento es 0
  it("MC-29: confirmar cuando fidelización retorna null aplica descuento 0", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("/api/fidelizacion")) {
        return Promise.resolve({
          ok:   true,
          json: async () => null,   // API retorna null (cliente sin fidelización)
        });
      }
      return Promise.resolve({ ok: false, json: async () => null });
    });

    const { input } = setup();
    changeRUT(input, "158552671");

    await waitFor(() => expect(screen.getByText("María González")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => {
      expect(mockSetCliente).toHaveBeenCalledWith(
        "cli-1",
        undefined,
        0,             // null → descuento 0
        "maria@test.com",
      );
    });
  });

  // MC-30: REGRESIÓN — confirmar cliente con mascota seleccionada
  // y fidelización activa, setCliente recibe ambos
  it("MC-30: confirmar con mascota seleccionada y descuento 10%", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("/api/fidelizacion")) {
        return Promise.resolve({
          ok:   true,
          json: async () => ({
            total_historico:    150_000,
            frecuencia_compras: 5,
            descuento_actual:   10,
            niveles:            [{ monto: 50000, descuento: 5 }, { monto: 150000, descuento: 10 }],
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => null });
    });

    mockGetMascotasByCliente.mockResolvedValue([
      { id: "m-1", nombre: "Luna", tipo: "gato", gramos_porcion: 60, veces_dia: 1 },
    ]);

    const { input } = setup();
    changeRUT(input, "158552671");

    await waitFor(() => expect(screen.getByText("María González")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Fidelización: 10%/)).toBeInTheDocument());

    // Seleccionar mascota
    fireEvent.click(screen.getByText("Luna (gato)"));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => {
      expect(mockSetCliente).toHaveBeenCalledWith(
        "cli-1",
        "m-1",   // mascota seleccionada
        10,      // descuento fidelización
        "maria@test.com",
      );
    });
  });
});
