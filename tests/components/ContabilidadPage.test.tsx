/**
 * Tests CP-01 a CP-15: ContabilidadPage — modal de confirmación y feedback de Cierre de Mes
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
 * CP-13  Período cerrado deshabilita botón y muestra badge ✓ Cerrado
 * CP-14  Botón Cierre de Mes deshabilitado impide abrir modal en período cerrado
 * CP-15  Error 409 concurrente refresca libro-diario y muestra "✓ Cerrado"
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

  // CP-13 — REGRESIÓN: si el período ya tiene CIERRE_MES, el botón se deshabilita y
  // muestra badge "✓ Cerrado" (prevención antes de abrir modal)
  it("CP-13: período cerrado deshabilita botón Cierre de Mes y muestra badge ✓ Cerrado", async () => {
    mockLibroDiarioResponse = {
      periodo: "junio 2026",
      desde: "2026-06-01",
      hasta: "2026-06-30",
      empresa: { nombre: "PetShop Test", rut: "76.000.000-0" },
      asientos: [
        {
          id: "cierre-1",
          numero_asiento: 99,
          fecha: "2026-06-30",
          tipo_movimiento: "CIERRE_MES",
          referencia_numero: "2026-06",
          descripcion: "Cierre 2026-06 - Costo de ventas",
          total_debito: 5000,
          total_credito: 5000,
          esta_balanceado: true,
        },
      ],
      resumen: { total_asientos: 6, total_debitos: 55000, total_creditos: 55000, balanceado: true },
    };

    setup();

    await waitFor(() => {
      expect(screen.getByText(/✓ Cerrado/i)).toBeInTheDocument();
    });

    const btn = screen.getByRole("button", { name: /Cierre de Mes/i });
    expect(btn).toBeDisabled();
  });

  // CP-14 — REGRESIÓN: cuando el período ya está cerrado, el botón Cierre de Mes está
  // deshabilitado y no se puede abrir el modal (prevención total antes de confirmar)
  it("CP-14: botón Cierre de Mes deshabilitado impide abrir modal en período cerrado", async () => {
    mockLibroDiarioResponse = {
      periodo: "junio 2026",
      desde: "2026-06-01",
      hasta: "2026-06-30",
      empresa: { nombre: "PetShop Test", rut: "76.000.000-0" },
      asientos: [
        {
          id: "cierre-1",
          numero_asiento: 99,
          fecha: "2026-06-30",
          tipo_movimiento: "CIERRE_MES",
          referencia_numero: "2026-06",
          descripcion: "Cierre 2026-06 - Costo de ventas",
          total_debito: 5000,
          total_credito: 5000,
          esta_balanceado: true,
        },
      ],
      resumen: { total_asientos: 6, total_debitos: 55000, total_creditos: 55000, balanceado: true },
    };

    setup();

    await waitFor(() => {
      expect(screen.getByText(/✓ Cerrado/i)).toBeInTheDocument();
    });

    // El botón está deshabilitado
    const btn = screen.getByRole("button", { name: /Cierre de Mes/i });
    expect(btn).toBeDisabled();

    // Click en botón deshabilitado no abre el modal
    fireEvent.click(btn);
    expect(screen.queryByText(/Confirmar Cierre de Mes/i)).not.toBeInTheDocument();
  });

  // CP-15 — la UI refresca el estado después de un 409 concurrente
  it("CP-15: error 409 concurrente refresca libro-diario y muestra ✓ Cerrado", async () => {
    let libroDiarioCallCount = 0;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (String(url).includes("cierre-mes")) {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({ error: "cerrado por otro" }),
        });
      }
      if (String(url).includes("libro-diario")) {
        libroDiarioCallCount++;
        // First fetch: no cierre entries
        if (libroDiarioCallCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              periodo: "junio 2026",
              desde: "2026-06-01",
              hasta: "2026-06-30",
              empresa: { nombre: "PetShop Test", rut: "76.000.000-0" },
              asientos: [],
              resumen: { total_asientos: 5, total_debitos: 50000, total_creditos: 50000, balanceado: true },
            }),
          });
        }
        // Second fetch (after invalidation): now with CIERRE_MES
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            periodo: "junio 2026",
            desde: "2026-06-01",
            hasta: "2026-06-30",
            empresa: { nombre: "PetShop Test", rut: "76.000.000-0" },
            asientos: [{
              id: "cierre-1",
              numero_asiento: 99,
              fecha: "2026-06-30",
              tipo_movimiento: "CIERRE_MES",
              referencia_numero: "2026-06",
              descripcion: "Cierre 2026-06",
              total_debito: 5000,
              total_credito: 5000,
              esta_balanceado: true,
            }],
            resumen: { total_asientos: 6, total_debitos: 55000, total_creditos: 55000, balanceado: true },
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    setup();

    // Verify initial state: button enabled, no badge
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Cierre de Mes/i })).not.toBeDisabled();
    });
    expect(screen.queryByText(/✓ Cerrado/i)).not.toBeInTheDocument();

    // Try to close
    fireEvent.click(screen.getByRole("button", { name: /Cierre de Mes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar cierre/i }));

    // Error appears
    await waitFor(() => {
      expect(screen.getByText(/✗ Error en el cierre/i)).toBeInTheDocument();
    });

    // After invalidation, libro-diario re-fetches and shows closed state
    await waitFor(() => {
      expect(screen.getByText(/✓ Cerrado/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Cierre de Mes/i })).toBeDisabled();
  });

  // CP-16 — REGRESIÓN: el botón PDF (y Excel) desaparecía al navegar a Balance de Comprobación
  it("CP-16: REGRESIÓN — botón PDF (y Excel) visible en tab Balance de Comprobación con href correcto", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Balance de Comprobación/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Balance de Comprobación" })).toBeInTheDocument();
    });
    const pdfLink = screen.getByRole("button", { name: "PDF" }).closest("a");
    expect(pdfLink).toHaveAttribute("href", expect.stringContaining("/api/contabilidad/balance-prueba/pdf"));
    const excelLink = screen.getByRole("button", { name: "Excel" }).closest("a");
    expect(excelLink).toHaveAttribute("href", expect.stringContaining("/api/contabilidad/balance-prueba/excel"));
  });

  // CP-17 — REGRESIÓN: el botón PDF (y Excel) desaparecía al navegar a Estado de Resultado
  it("CP-17: REGRESIÓN — botón PDF (y Excel) visible en tab Estado de Resultado con href correcto", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Estado de Resultado/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Estado de Resultado" })).toBeInTheDocument();
    });
    const pdfLink = screen.getByRole("button", { name: "PDF" }).closest("a");
    expect(pdfLink).toHaveAttribute("href", expect.stringContaining("/api/contabilidad/estado-resultado/pdf"));
    const excelLink = screen.getByRole("button", { name: "Excel" }).closest("a");
    expect(excelLink).toHaveAttribute("href", expect.stringContaining("/api/contabilidad/estado-resultado/excel"));
  });

  // CP-18 — al alternar entre tabs no deben quedar botones de exportación duplicados/obsoletos
  it("CP-18: al alternar entre tabs solo hay un botón PDF visible, con el href de la tab activa", async () => {
    setup();
    expect(screen.getAllByRole("button", { name: "PDF" })).toHaveLength(1); // Libro Diario (tab por defecto)
    expect(screen.getByRole("button", { name: "PDF" }).closest("a"))
      .toHaveAttribute("href", expect.stringContaining("/api/contabilidad/libro-diario/pdf"));

    fireEvent.click(screen.getByRole("button", { name: /Balance de Comprobación/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "PDF" })).toHaveLength(1);
    });
    expect(screen.getByRole("button", { name: "PDF" }).closest("a"))
      .toHaveAttribute("href", expect.stringContaining("/api/contabilidad/balance-prueba/pdf"));

    fireEvent.click(screen.getByRole("button", { name: /Estado de Resultado/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "PDF" })).toHaveLength(1);
    });
    expect(screen.getByRole("button", { name: "PDF" }).closest("a"))
      .toHaveAttribute("href", expect.stringContaining("/api/contabilidad/estado-resultado/pdf"));

    fireEvent.click(screen.getByRole("button", { name: /Libro Diario/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "PDF" })).toHaveLength(1);
    });
    expect(screen.getByRole("button", { name: "PDF" }).closest("a"))
      .toHaveAttribute("href", expect.stringContaining("/api/contabilidad/libro-diario/pdf"));
  });

  // CP-19 — el título de la página debe reflejar el tab activo
  it("CP-19: el título (h1) refleja el tab activo", async () => {
    setup();
    expect(screen.getByRole("heading", { name: "Libro Diario" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Balance de Comprobación/i }));
    expect(screen.getByRole("heading", { name: "Balance de Comprobación" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Estado de Resultado/i }));
    expect(screen.getByRole("heading", { name: "Estado de Resultado" })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ContabilidadPage — Eliminar asiento $0/$0", () => {
  const ASIENTO_ZERO = {
    id: "entry-uuid-zero-001",
    numero_asiento: 43,
    fecha: "2026-06-15",
    tipo_movimiento: "PAGO_PROVEEDOR",
    referencia_numero: null,
    descripcion: "Pago a Proveedor ABC — $0",
    total_debito: 0,
    total_credito: 0,
    esta_balanceado: true,
  };

  const LIBRO_CON_ZERO = {
    periodo: "junio 2026",
    desde: "2026-06-01",
    hasta: "2026-06-30",
    empresa: { nombre: "PetShop Test", rut: "76.000.000-0" },
    asientos: [ASIENTO_ZERO],
    resumen: { total_asientos: 1, total_debitos: 0, total_creditos: 0, balanceado: true },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockReset();
    (global.fetch as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (String(url).includes("cierre-mes")) {
        return Promise.resolve({ ok: true, status: 201, json: async () => ({}) });
      }
      if (options?.method === "DELETE") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => LIBRO_CON_ZERO });
    });
  });

  // CP-09 — REGRESIÓN: el ⚠️ debe mostrar botón "Eliminar" para entradas $0/$0
  it("CP-09: asiento $0/$0 muestra indicador ⚠ y botón 'Eliminar'", async () => {
    render(<ContabilidadPage />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("⚠")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Eliminar/i })).toBeInTheDocument();
  });

  // CP-10
  it("CP-10: click en 'Eliminar' abre modal de confirmación con el número de asiento", async () => {
    render(<ContabilidadPage />, { wrapper: makeWrapper() });

    await waitFor(() => screen.getByRole("button", { name: /Eliminar/i }));
    fireEvent.click(screen.getByRole("button", { name: /Eliminar/i }));

    expect(screen.getByText(/Eliminar asiento inválido/i)).toBeInTheDocument();
    expect(screen.getByText(/#43/)).toBeInTheDocument();
  });

  // CP-11
  it("CP-11: Cancelar cierra el modal sin llamar al DELETE", async () => {
    render(<ContabilidadPage />, { wrapper: makeWrapper() });

    await waitFor(() => screen.getByRole("button", { name: /Eliminar/i }));
    fireEvent.click(screen.getByRole("button", { name: /Eliminar/i }));

    expect(screen.getByText(/Eliminar asiento inválido/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Cancelar$/i }));

    expect(screen.queryByText(/Eliminar asiento inválido/i)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("asientos"),
      expect.objectContaining({ method: "DELETE" })
    );
  });

  // CP-12 — REGRESIÓN: confirmar debe llamar DELETE /api/contabilidad/asientos/[id]
  it(
    "CP-12: REGRESIÓN — confirmar eliminación llama a DELETE /api/contabilidad/asientos/[id] " +
      "y cierra el modal",
    async () => {
      render(<ContabilidadPage />, { wrapper: makeWrapper() });

      await waitFor(() => screen.getByRole("button", { name: /Eliminar/i }));
      fireEvent.click(screen.getByRole("button", { name: /Eliminar/i }));

      fireEvent.click(screen.getByRole("button", { name: /Sí, eliminar/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          `/api/contabilidad/asientos/${ASIENTO_ZERO.id}`,
          expect.objectContaining({ method: "DELETE" })
        );
      });

      await waitFor(() =>
        expect(screen.queryByText(/Eliminar asiento inválido/i)).not.toBeInTheDocument()
      );
    }
  );
});
