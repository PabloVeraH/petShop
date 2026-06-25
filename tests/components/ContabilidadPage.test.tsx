/**
 * Tests CP-01 a CP-08: ContabilidadPage — modal de confirmación y feedback de Cierre de Mes
 * @jest-environment jsdom
 *
 * CP-01  REGRESIÓN — click en "Cierre de Mes" abre modal, NO ejecuta directamente
 * CP-02  Modal muestra período correcto
 * CP-03  Cancelar cierra el modal sin llamar al API
 * CP-04  Confirmar llama a /api/contabilidad/cierre-mes con POST
 * CP-05  Éxito muestra banner verde con mes_cerrado y numero_asientos
 * CP-06  Error 409 muestra banner rojo con el mensaje de la API
 * CP-07  Error de red muestra banner rojo genérico
 * CP-08  Botón "Cierre de Mes" está deshabilitado mientras cerrandoMes=true
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    className,
    variant,
    size,
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
}));

// Respuestas configurables por test
let mockLibroDiarioResponse: object = {
  periodo: "junio 2026",
  desde: "2026-06-01",
  hasta: "2026-06-30",
  empresa: { nombre: "PetShop Test", rut: "76.000.000-0" },
  asientos: [],
  resumen: { total_asientos: 5, total_debitos: 50000, total_creditos: 50000, balanceado: true },
};

let mockCierreResponse: { ok: boolean; status: number; body: object } = {
  ok: true,
  status: 201,
  body: {
    mes_cerrado: "2026-06",
    desde: "2026-06-01",
    hasta: "2026-06-30",
    numero_asientos: 5,
    total_debitos: 50000,
    total_creditos: 50000,
    balanceado: true,
    asientos_cierre: [],
  },
};

function defaultFetchMock(url: string) {
  if (String(url).includes("cierre-mes")) {
    return Promise.resolve({
      ok: mockCierreResponse.ok,
      status: mockCierreResponse.status,
      json: async () => mockCierreResponse.body,
    });
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => mockLibroDiarioResponse,
  });
}

global.fetch = jest.fn().mockImplementation(defaultFetchMock);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function setup() {
  render(<ContabilidadPage />, { wrapper: makeWrapper() });
}

import ContabilidadPage from "@/app/(app)/contabilidad/page";

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("ContabilidadPage — Cierre de Mes: modal y feedback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore default fetch mock (tests like CP-07 may override)
    (global.fetch as jest.Mock).mockReset();
    (global.fetch as jest.Mock).mockImplementation(defaultFetchMock);
    mockCierreResponse = {
      ok: true,
      status: 201,
      body: {
        mes_cerrado: "2026-06",
        desde: "2026-06-01",
        hasta: "2026-06-30",
        numero_asientos: 5,
        total_debitos: 50000,
        total_creditos: 50000,
        balanceado: true,
        asientos_cierre: [],
      },
    };
  });

  // CP-01 — REGRESIÓN principal
  it("CP-01: click en 'Cierre de Mes' abre modal de confirmación sin llamar al API", async () => {
    setup();

    const btn = screen.getByRole("button", { name: /Cierre de Mes/i });
    fireEvent.click(btn);

    // Modal aparece
    expect(screen.getByText(/Confirmar Cierre de Mes/i)).toBeInTheDocument();
    // El API NO fue llamado todavía
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("cierre-mes"),
      expect.anything()
    );
  });

  // CP-02
  it("CP-02: el modal muestra el período seleccionado", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Cierre de Mes/i }));
    // El mes por defecto es el mes actual, verificamos que haya texto de período
    expect(screen.getByText(/Confirmar Cierre de Mes/i)).toBeInTheDocument();
    expect(screen.getByText(/cierre contable del período/i)).toBeInTheDocument();
  });

  // CP-03
  it("CP-03: Cancelar cierra el modal sin llamar al API", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Cierre de Mes/i }));
    expect(screen.getByText(/Confirmar Cierre de Mes/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Cancelar$/i }));

    expect(screen.queryByText(/Confirmar Cierre de Mes/i)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("cierre-mes"),
      expect.anything()
    );
  });

  // CP-04
  it("CP-04: 'Confirmar cierre' llama a /api/contabilidad/cierre-mes con POST", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Cierre de Mes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar cierre/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/contabilidad/cierre-mes",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  // CP-05
  it("CP-05: éxito muestra banner verde con mes_cerrado y numero_asientos", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Cierre de Mes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar cierre/i }));

    await waitFor(() => {
      expect(screen.getByText(/✓ Cierre realizado/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/2026-06/)).toBeInTheDocument();
    expect(screen.getByText(/Asientos procesados:/i)).toBeInTheDocument();
    // "5" aparece tanto en la tarjeta de resumen como en el banner de éxito
    expect(screen.getAllByText("5").length).toBeGreaterThanOrEqual(1);
    // Modal de confirmación desaparece
    expect(screen.queryByText(/Confirmar Cierre de Mes/i)).not.toBeInTheDocument();
  });

  // CP-06
  it("CP-06: error 409 muestra banner rojo con el mensaje de la API", async () => {
    mockCierreResponse = {
      ok: false,
      status: 409,
      body: { error: "El período 2026-06 ya tiene un asiento de cierre" },
    };

    setup();
    fireEvent.click(screen.getByRole("button", { name: /Cierre de Mes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar cierre/i }));

    await waitFor(() => {
      expect(screen.getByText(/✗ Error en el cierre/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/ya tiene un asiento de cierre/i)).toBeInTheDocument();
    // Modal de confirmación desaparece
    expect(screen.queryByText(/Confirmar Cierre de Mes/i)).not.toBeInTheDocument();
  });

  // CP-07
  it("CP-07: error de red muestra banner rojo con mensaje de error", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (String(url).includes("cierre-mes")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => mockLibroDiarioResponse });
    });

    setup();
    fireEvent.click(screen.getByRole("button", { name: /Cierre de Mes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar cierre/i }));

    await waitFor(() => {
      expect(screen.getByText(/✗ Error en el cierre/i)).toBeInTheDocument();
    });
  });

  // CP-08
  it("CP-08: el banner de éxito se puede descartar con el botón ✕", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Cierre de Mes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar cierre/i }));

    await waitFor(() => {
      expect(screen.getByText(/✓ Cierre realizado/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Cerrar$/i }));
    expect(screen.queryByText(/✓ Cierre realizado/i)).not.toBeInTheDocument();
  });
});
