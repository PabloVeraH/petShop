/**
 * Tests CTB-01 a CTB-04: CitasTab — columna/filtro de encargado y precarga
 * de la fecha del listado hacia el modal "Nueva cita" (Fase 3).
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockFetch = jest.fn();
global.fetch = mockFetch;

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

// NuevaCitaForm se mockea para aislar CitasTab: lo que nos interesa acá es
// SOLO qué prop `fechaInicial` recibe, no volver a probar su comportamiento
// interno (ya cubierto en NuevaCitaForm.test.tsx).
jest.mock("@/app/(app)/citas/components/NuevaCitaForm", () => ({
  NuevaCitaForm: function NuevaCitaForm({ fechaInicial }: { fechaInicial?: string }) {
    return <div data-testid="nueva-cita-form" data-fecha-inicial={fechaInicial ?? ""} />;
  },
}));

import { CitasTab } from "@/app/(app)/citas/components/CitasTab";

const HOY = "2026-08-15";
const ENCARGADO_ID = "enc-1";

const CITAS_MOCK = [
  {
    id: "cita-1",
    hora_inicio: "10:00:00",
    hora_fin: "10:30:00",
    duracion_minutos: 30,
    estado: "confirmada",
    cliente: { nombre: "Carlos Rojas", telefono: "912345678" },
    mascota: null,
    servicio: { nombre: "Peluquería" },
    encargado: { nombre: "Juan Pérez" },
    precio: 15000,
  },
  {
    id: "cita-2",
    hora_inicio: "11:00:00",
    hora_fin: "11:30:00",
    duracion_minutos: 30,
    estado: "confirmada",
    cliente: { nombre: "María López", telefono: null },
    mascota: null,
    servicio: { nombre: "Baño" },
    encargado: null,
    precio: null,
  },
];

const ENCARGADOS_MOCK = [{ id: ENCARGADO_ID, nombre: "Juan Pérez", activo: true }];

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function mockFetchDefaultImpl(url: string) {
  if (url === "/api/servicios") return Promise.resolve({ ok: true, json: async () => [] });
  if (url === "/api/encargados") return Promise.resolve({ ok: true, json: async () => ENCARGADOS_MOCK });
  if (url.startsWith("/api/citas")) return Promise.resolve({ ok: true, json: async () => CITAS_MOCK });
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

function campoTrasLabel(texto: string): HTMLElement {
  return screen.getByText(texto).nextElementSibling as HTMLElement;
}

describe("CitasTab (CTB-XX)", () => {
  beforeAll(() => {
    jest.useFakeTimers({
      doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "nextTick", "setImmediate", "clearImmediate"],
    }).setSystemTime(new Date(`${HOY}T12:00:00Z`));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockImplementation(mockFetchDefaultImpl);
  });

  // CTB-01
  it("CTB-01: fila con encargado asignado muestra su nombre", async () => {
    render(<CitasTab />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText("Carlos Rojas")).toBeInTheDocument());
    expect(screen.getByText((_, el) => el?.textContent === "Peluquería · 30 min · $15.000 · Juan Pérez · 912345678")).toBeInTheDocument();
  });

  // CTB-02 — REGRESIÓN: citas sin encargado (ej. históricas, encargado_id
  // NULL) no deben quedar en blanco, deben mostrar "Sin asignar".
  it("CTB-02: fila sin encargado (encargado_id NULL) muestra 'Sin asignar'", async () => {
    render(<CitasTab />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText("María López")).toBeInTheDocument());
    expect(screen.getByText((_, el) => el?.textContent === "Baño · 30 min · Sin asignar")).toBeInTheDocument();
  });

  // CTB-03
  it("CTB-03: cambiar el filtro Encargado agrega encargado_id a la URL de /api/citas", async () => {
    render(<CitasTab />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());

    const encargadoSelect = campoTrasLabel("Encargado") as HTMLSelectElement;
    fireEvent.change(encargadoSelect, { target: { value: ENCARGADO_ID } });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^/api/citas\\?.*encargado_id=${ENCARGADO_ID}`))
      );
    });
  });

  // CTB-04
  it("CTB-04: '+ Nueva cita' pasa la fecha del filtro del listado como fechaInicial al formulario", async () => {
    render(<CitasTab />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Carlos Rojas")).toBeInTheDocument());

    // Filtro de fecha del listado parte en "hoy" (mismo valor por defecto
    // que usa CitasTab) — se cambia a una fecha distinta para probar que el
    // valor efectivamente viaja, no que coincide por casualidad con "hoy".
    const fechaFiltro = campoTrasLabel("Fecha") as HTMLInputElement;
    fireEvent.change(fechaFiltro, { target: { value: "2026-08-20" } });

    fireEvent.click(screen.getByText("+ Nueva cita"));

    const form = screen.getByTestId("nueva-cita-form");
    expect(form.getAttribute("data-fecha-inicial")).toBe("2026-08-20");
  });

  // CTB-05 — Fase 4: una cita confirmada CON precio muestra el botón
  // "Completar y cobrar"; una cita legado SIN precio muestra "Completar".
  it("CTB-05: cita con precio muestra 'Completar y cobrar'; sin precio muestra 'Completar'", async () => {
    render(<CitasTab />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Carlos Rojas")).toBeInTheDocument());

    expect(screen.getByText("Completar y cobrar")).toBeInTheDocument();
    expect(screen.getByText("Completar")).toBeInTheDocument();

    // cita-1 (con precio) no ofrece completar simple; cita-2 (legado) sí.
    const botonCompletar = screen.getByText("Completar") as HTMLButtonElement;
    fireEvent.click(botonCompletar);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/citas/cita-2",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ accion: "completar" }),
        })
      );
    });
  });
});
