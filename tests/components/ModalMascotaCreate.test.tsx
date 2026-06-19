/**
 * Tests C-20 a C-22: ModalMascotaCreate — confirmación y refresco sin duplicados
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

global.fetch = jest.fn();

// ── Imports ───────────────────────────────────────────────────────────────────

import ModalMascotaCreate from "@/app/(app)/customers/components/ModalMascotaCreate";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const MASCOTA_RESP = { id: "m1", nombre: "Firulais", tipo: "perro", raza: null, peso_kg: null };

function mockFetchSuccess() {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(MASCOTA_RESP),
  } as Response);
}

function mockFetchError(msg: string) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    json: () => Promise.resolve({ error: msg }),
  } as Response);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ModalMascotaCreate", () => {
  beforeEach(() => jest.clearAllMocks());

  // C-20: éxito muestra banner de confirmación (no cierra silenciosamente)
  it("C-20: tras guardar exitosamente muestra banner '¡Mascota registrada!' antes de cerrar", async () => {
    mockFetchSuccess();
    const onClose = jest.fn();
    const onCreated = jest.fn();

    render(
      <ModalMascotaCreate clienteId="c1" onClose={onClose} onCreated={onCreated} />,
      { wrapper: makeWrapper() }
    );

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Firulais" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(screen.getByText("¡Mascota registrada!")).toBeInTheDocument()
    );

    // El modal NO se cierra aún — sigue abierto con confirmación
    expect(onClose).not.toHaveBeenCalled();

    // El formulario desaparece — no hay botón "Guardar" en pantalla
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
  });

  // C-21: onCreated se llama con los datos de la mascota antes del cierre
  it("C-21: onCreated recibe los datos de la mascota nueva al guardar", async () => {
    mockFetchSuccess();
    const onClose = jest.fn();
    const onCreated = jest.fn();

    render(
      <ModalMascotaCreate clienteId="c1" onClose={onClose} onCreated={onCreated} />,
      { wrapper: makeWrapper() }
    );

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Firulais" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(MASCOTA_RESP));
  });

  // C-22: error de API muestra mensaje, no cierra el modal, no llama onCreated
  it("C-22: error de API muestra mensaje y no cierra ni llama onCreated", async () => {
    mockFetchError("Mascota ya registrada");
    const onClose = jest.fn();
    const onCreated = jest.fn();

    render(
      <ModalMascotaCreate clienteId="c1" onClose={onClose} onCreated={onCreated} />,
      { wrapper: makeWrapper() }
    );

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Firulais" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(screen.getByText("Mascota ya registrada")).toBeInTheDocument()
    );

    expect(onClose).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    // El formulario sigue visible para que el usuario corrija
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
  });
});
