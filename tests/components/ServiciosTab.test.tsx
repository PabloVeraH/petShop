/**
 * Tests SRVC-01 a SRVC-04: ServiciosTab — campo de precio (Fase 4):
 * badge de precio en la lista, precio obligatorio al crear, y edición de
 * servicios legado sin precio.
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

jest.mock("@/app/(app)/servicios/components/HorarioSemanalEditor", () => ({
  HorarioSemanalEditor: () => <div data-testid="horario-editor" />,
}));

jest.mock("@/app/(app)/servicios/components/ExcepcionesEditor", () => ({
  ExcepcionesEditor: () => <div data-testid="excepciones-editor" />,
}));

import { useUser } from "@clerk/nextjs";
import { ServiciosTab } from "@/app/(app)/servicios/components/ServiciosTab";

const SERVICIOS_MOCK = [
  { id: "srv-1", nombre: "Corte básico", descripcion: null, duracion_minutos: 30, activo: true, precio: 15000 },
  { id: "srv-2", nombre: "Baño", descripcion: null, duracion_minutos: 60, activo: true, precio: null },
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

describe("ServiciosTab (SRV-XX)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setAdmin(true);
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/servicios" && !init?.method) {
        return Promise.resolve({ ok: true, json: async () => SERVICIOS_MOCK });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  // SRVC-01
  it("SRVC-01: servicio con precio muestra badge con el monto; sin precio muestra 'Sin precio'", async () => {
    render(<ServiciosTab />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Corte básico")).toBeInTheDocument());

    expect(screen.getByText("$15.000")).toBeInTheDocument();
    expect(screen.getByText("Sin precio")).toBeInTheDocument();
  });

  // SRVC-02
  it("SRVC-02: crear servicio sin precio → botón deshabilitado (precio obligatorio)", async () => {
    render(<ServiciosTab />, { wrapper: makeWrapper() });

    const nombre = screen.getByPlaceholderText(/Nombre \*/) as HTMLInputElement;
    fireEvent.change(nombre, { target: { value: "Corte premium" } });

    const boton = screen.getByText("Crear servicio") as HTMLButtonElement;
    expect(boton).toBeDisabled();

    const precio = screen.getByPlaceholderText(/Precio \*/) as HTMLInputElement;
    fireEvent.change(precio, { target: { value: "25000" } });
    expect(boton).toBeEnabled();
  });

  // SRVC-03
  it("SRVC-03: crear servicio con precio → POST /api/servicios incluye precio bruto", async () => {
    render(<ServiciosTab />, { wrapper: makeWrapper() });

    const nombre = screen.getByPlaceholderText(/Nombre \*/) as HTMLInputElement;
    fireEvent.change(nombre, { target: { value: "Corte premium" } });
    const precio = screen.getByPlaceholderText(/Precio \*/) as HTMLInputElement;
    fireEvent.change(precio, { target: { value: "25000" } });

    fireEvent.click(screen.getByText("Crear servicio"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/servicios",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nombre: "Corte premium", descripcion: undefined, duracion_minutos: 30, precio: 25000 }),
        })
      );
    });
  });

  // SRVC-04
  it("SRVC-04: editar servicio legado sin precio permite guardar sin precio, y enviar precio lo completa", async () => {
    render(<ServiciosTab />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText("Baño")).toBeInTheDocument());

    fireEvent.click(screen.getAllByText("Editar")[1]); // srv-2 (legado, sin precio)

    // Sin tocar el precio, "Guardar cambios" está habilitado (legado).
    const guardar = screen.getByText("Guardar cambios") as HTMLButtonElement;
    expect(guardar).toBeEnabled();

    // Con precio ingresado, el PATCH lo incluye (completa el precio).
    const precio = screen.getByPlaceholderText(/Precio \*/) as HTMLInputElement;
    fireEvent.change(precio, { target: { value: "18000" } });
    fireEvent.click(guardar);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/servicios/srv-2",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ nombre: "Baño", descripcion: undefined, duracion_minutos: 60, precio: 18000 }),
        })
      );
    });
  });
});
