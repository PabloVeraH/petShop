/**
 * Tests LP-01 a LP-03: LotesPanel — regresión de robo de foco en Notas
 * @jest-environment jsdom
 *
 * Mismo bug de raíz que DV-15..17 (DevolucionModal) e IV-02/IV-03
 * (InventoryPage — ajuste de stock): ModalOverlay volvía a llamar
 * ref.current?.focus() en cada re-render porque su efecto de foco dependía
 * de [open, onClose], y el onClose que LotesPanel pasa
 * (`() => { setShowForm(false); setEditando(null); }`) es una función
 * inline, con referencia nueva en cada render. Corregido de forma
 * estructural en ModalOverlay (commit 1270b13) — el efecto ahora depende
 * solo de [open] — así que ningún consumidor necesita memoizar su onClose.
 * LotesPanel nunca tuvo test de componente propio; este archivo cierra ese
 * gap para el campo Notas del formulario de Agregar/Editar Lote.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children, onClick, disabled,
  }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

jest.mock("@/components/ui/input", () => ({
  Input: ({
    value, onChange, type, placeholder, min,
  }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      min={min}
    />
  ),
}));

global.fetch = jest.fn();

import { LotesPanel } from "@/app/(app)/inventory/components/LotesPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function setup(overrideProps: Partial<React.ComponentProps<typeof LotesPanel>> = {}) {
  const props = {
    productoId: "prod-1",
    storeId: "store-1",
    diasAlerta: 30,
    puedeAgregarLote: true,
    ...overrideProps,
  };
  render(<LotesPanel {...props} />, { wrapper: makeWrapper() });
  return props;
}

function abrirFormularioNuevoLote() {
  fireEvent.click(screen.getByRole("button", { name: /Agregar Lote/i }));
}

// La etiqueta "Notas" no está asociada por htmlFor/id — se identifica por
// posición: N° de Lote y Notas comparten placeholder "Opcional"; Notas es
// el segundo campo del formulario con ese placeholder (después de Fecha).
function getNotasInput() {
  const opcionales = screen.getAllByPlaceholderText("Opcional");
  return opcionales[opcionales.length - 1];
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("LotesPanel — formulario de Lote (Notas)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (!options?.method || options.method === "GET") {
        return Promise.resolve({ ok: true, json: async () => ({ lotes: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ id: "lote-nuevo-1" }) });
    });
  });

  // LP-01: REGRESIÓN — escribir en Notas no vuelve a robar el foco del
  // ModalOverlay real (no mockeado en este archivo) — mismo mecanismo que
  // DV-17 e IV-03.
  it("LP-01: REGRESIÓN — escribir en Notas no vuelve a robar el foco del ModalOverlay", async () => {
    const focusSpy = jest.spyOn(HTMLElement.prototype, "focus");
    setup();

    abrirFormularioNuevoLote();
    await waitFor(() => expect(screen.getByText("Agregar Lote")).toBeInTheDocument());
    const llamadasAlAbrir = focusSpy.mock.calls.length;
    expect(llamadasAlAbrir).toBeGreaterThan(0);

    fireEvent.change(getNotasInput(), { target: { value: "QA test - devolución Arena Arenero" } });

    expect(getNotasInput()).toHaveValue("QA test - devolución Arena Arenero");
    expect(focusSpy).toHaveBeenCalledTimes(llamadasAlAbrir);

    focusSpy.mockRestore();
  });

  // LP-02: REGRESIÓN — el texto completo de Notas se envía en el body del
  // POST, no truncado (el síntoma reportado: "QA test conteo fisico" → "Q").
  it("LP-02: REGRESIÓN — el texto completo de Notas se envía en el body del POST /api/lotes", async () => {
    setup();

    abrirFormularioNuevoLote();
    await waitFor(() => expect(screen.getByText("Agregar Lote")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("10"), { target: { value: "5" } });
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: "2026-12-31" } });
    fireEvent.change(getNotasInput(), { target: { value: "QA test conteo fisico" } });

    fireEvent.click(screen.getByRole("button", { name: /Crear Lote/i }));

    await waitFor(() => {
      const postCall = (global.fetch as jest.Mock).mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === "POST"
      );
      expect(postCall).toBeDefined();
    });

    const postCall = (global.fetch as jest.Mock).mock.calls.find(
      ([, opts]: [string, RequestInit]) => opts?.method === "POST"
    )!;
    const body = JSON.parse(postCall[1].body as string);
    expect(body.notas).toBe("QA test conteo fisico");
  });

  // LP-03: motivo vacío se envía como null, no como string vacío
  it("LP-03: Notas vacío se envía como null en el body del POST", async () => {
    setup();

    abrirFormularioNuevoLote();
    await waitFor(() => expect(screen.getByText("Agregar Lote")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("10"), { target: { value: "5" } });
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: "2026-12-31" } });

    fireEvent.click(screen.getByRole("button", { name: /Crear Lote/i }));

    await waitFor(() => {
      const postCall = (global.fetch as jest.Mock).mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === "POST"
      );
      expect(postCall).toBeDefined();
    });

    const postCall = (global.fetch as jest.Mock).mock.calls.find(
      ([, opts]: [string, RequestInit]) => opts?.method === "POST"
    )!;
    const body = JSON.parse(postCall[1].body as string);
    expect(body.notas).toBeNull();
  });
});
