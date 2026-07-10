/**
 * Tests C-20 a C-25: ModalMascotaCreate — confirmación, refresco, porción diaria y advertencia de duplicado
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

  // C-23: REGRESIÓN — los campos de porción diaria deben estar presentes en el formulario
  // de CREACIÓN, no solo en el de edición. Bug original: el formulario solo pedía
  // Nombre, Tipo, Raza y Peso; los datos de consumo solo eran accesibles al editar.
  it("C-23: el formulario incluye campos 'Gramos/porción' y 'Veces/día'", () => {
    render(
      <ModalMascotaCreate clienteId="c1" onClose={jest.fn()} />,
      { wrapper: makeWrapper() }
    );

    // Verificar presencia por label text y por placeholder (accesibilidad + funcionalidad)
    expect(screen.getByText(/Gramos\/porción/i)).toBeInTheDocument();
    expect(screen.getByText(/Veces\/día/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ej: 150")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ej: 2")).toBeInTheDocument();
  });

  // C-24: los valores de gramos_porcion y veces_dia se envían en el POST al guardar
  it("C-24: al guardar, gramos_porcion y veces_dia se incluyen en el body del POST", async () => {
    mockFetchSuccess();
    render(
      <ModalMascotaCreate clienteId="c1" onClose={jest.fn()} />,
      { wrapper: makeWrapper() }
    );

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Firulais" } });
    fireEvent.change(screen.getByPlaceholderText("ej: 150"), { target: { value: "150" } });
    fireEvent.change(screen.getByPlaceholderText("ej: 2"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.gramos_porcion).toBe(150);
    expect(body.veces_dia).toBe(2);
  });

  // C-25: al escribir un nombre que ya existe, muestra advertencia y deshabilita Guardar
  it("C-25: muestra advertencia y deshabilita botón si el nombre ya existe (case-insensitive)", async () => {
    render(
      <ModalMascotaCreate
        clienteId="c1"
        existingNames={["Luna", "Firulais"]}
        onClose={jest.fn()}
      />,
      { wrapper: makeWrapper() }
    );

    const input = screen.getAllByRole("textbox")[0];
    const guardarBtn = screen.getByRole("button", { name: "Guardar" });

    // Sin advertencia al inicio
    expect(screen.queryByText("Ya existe una mascota con este nombre")).not.toBeInTheDocument();
    expect(guardarBtn).not.toBeDisabled();

    // Escribe nombre que coincide (case-insensitive: "luna" coincide con "Luna")
    fireEvent.change(input, { target: { value: "luna" } });

    await waitFor(() => {
      expect(screen.getByText("Ya existe una mascota con este nombre")).toBeInTheDocument();
      expect(guardarBtn).toBeDisabled();
    });

    // Cambia a nombre no existente → advertencia desaparece
    fireEvent.change(input, { target: { value: "Max" } });

    await waitFor(() => {
      expect(screen.queryByText("Ya existe una mascota con este nombre")).not.toBeInTheDocument();
      expect(guardarBtn).not.toBeDisabled();
    });
  });
});
