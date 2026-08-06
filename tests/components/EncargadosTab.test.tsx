/**
 * Tests ENC-01 a ENC-06: EncargadosTab — gate de admin, estadísticas de
 * citas, y CRUD (crear/editar/desactivar) (Fase 3).
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@clerk/nextjs", () => ({ useUser: jest.fn() }));

jest.mock("@/components/ui/button", () => ({
  Button: function Button({ children, onClick, disabled, variant }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: string;
  }) {
    return <button onClick={onClick} disabled={disabled} data-variant={variant}>{children}</button>;
  },
}));

jest.mock("@/components/ui/input", () => ({
  Input: function Input(props: React.ComponentProps<"input">) {
    return <input {...props} />;
  },
}));

import { useUser } from "@clerk/nextjs";
import { EncargadosTab } from "@/app/(app)/encargados/components/EncargadosTab";

const ENCARGADOS_MOCK = [
  { id: "enc-1", nombre: "Juan Pérez", activo: true, citas_totales: 12, citas_completadas: 8 },
  { id: "enc-2", nombre: "María López", activo: true, citas_totales: 0, citas_completadas: 0 },
];

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function setAdmin(isAdmin: boolean) {
  (useUser as jest.Mock).mockReturnValue({
    user: { publicMetadata: isAdmin ? { storeAdmin: true } : {} },
  });
}

describe("EncargadosTab (ENC-XX)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ENCARGADOS_MOCK });
  });

  // ENC-01 — gate de UI: un storeWorker (no admin) no debe ver el
  // formulario ni los botones de gestión, aunque el enforcement real vive
  // en el servidor (requireStoreAdmin en las rutas) — esto es defensa en
  // profundidad del lado del cliente, no el control de seguridad real.
  it("ENC-01: usuario sin rol admin no ve el formulario CRUD, solo el mensaje", async () => {
    setAdmin(false);
    render(<EncargadosTab />, { wrapper: makeWrapper() });

    expect(screen.getByText("Solo administradores pueden gestionar encargados.")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Nombre * (ej: Juan Pérez)")).not.toBeInTheDocument();
    expect(screen.queryByText("Crear encargado")).not.toBeInTheDocument();
    // Nota: el useQuery de la lista se declara ANTES del `if (!isAdmin)`
    // (reglas de hooks — no puede ser condicional), así que SÍ dispara el
    // fetch aunque no se muestre nada; no es una fuga porque
    // GET /api/encargados ya es de lectura abierta a cualquier staff
    // autenticado en el servidor (no solo admin) — verificado en la ruta.
  });

  // ENC-02
  it("ENC-02: usuario admin ve la lista con citas_totales/citas_completadas", async () => {
    setAdmin(true);
    render(<EncargadosTab />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());
    expect(screen.getByText("12 citas tomadas · 8 finalizadas")).toBeInTheDocument();
    expect(screen.getByText("0 citas tomadas · 0 finalizadas")).toBeInTheDocument();
  });

  // ENC-03
  it("ENC-03: crear encargado llama a POST /api/encargados con el nombre ingresado", async () => {
    setAdmin(true);
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "/api/encargados" && opts?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ id: "enc-3", nombre: "Pedro Soto", activo: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => ENCARGADOS_MOCK });
    });

    render(<EncargadosTab />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Nombre * (ej: Juan Pérez)"), { target: { value: "Pedro Soto" } });
    fireEvent.click(screen.getByText("Crear encargado"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/encargados",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ nombre: "Pedro Soto" }) })
      );
    });
  });

  // ENC-04
  it("ENC-04: 'Editar' precarga el formulario y 'Guardar cambios' llama a PATCH /api/encargados/[id]", async () => {
    setAdmin(true);
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "/api/encargados/enc-1" && opts?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: async () => ({ id: "enc-1", nombre: "Juan Pérez Editado", activo: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => ENCARGADOS_MOCK });
    });

    render(<EncargadosTab />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());

    fireEvent.click(screen.getAllByText("Editar")[0]);

    expect(screen.getByDisplayValue("Juan Pérez")).toBeInTheDocument();
    expect(screen.getByText("Editar: Juan Pérez")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Juan Pérez"), { target: { value: "Juan Pérez Editado" } });
    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/encargados/enc-1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ nombre: "Juan Pérez Editado" }) })
      );
    });
  });

  // ENC-05
  it("ENC-05: 'Desactivar' pide confirmación y al confirmar llama a DELETE /api/encargados/[id]", async () => {
    setAdmin(true);
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "/api/encargados/enc-1" && opts?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ENCARGADOS_MOCK });
    });

    render(<EncargadosTab />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());

    fireEvent.click(screen.getAllByText("Desactivar")[0]);
    expect(screen.getByText("¿Desactivar encargado?")).toBeInTheDocument();

    const modal = screen.getByText("¿Desactivar encargado?").closest("[class*='fixed']")!;
    fireEvent.click(within(modal).getByText("Desactivar"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/encargados/enc-1", expect.objectContaining({ method: "DELETE" }));
    });
  });

  // ENC-06
  it("ENC-06: 'Cancelar' en el modal de confirmación NO llama a DELETE", async () => {
    setAdmin(true);
    render(<EncargadosTab />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());

    fireEvent.click(screen.getAllByText("Desactivar")[0]);
    expect(screen.getByText("¿Desactivar encargado?")).toBeInTheDocument();

    const modal = screen.getByText("¿Desactivar encargado?").closest("[class*='fixed']")!;
    fireEvent.click(within(modal).getByText("Cancelar"));

    expect(screen.queryByText("¿Desactivar encargado?")).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalledWith("/api/encargados/enc-1", expect.objectContaining({ method: "DELETE" }));
  });
});
