/**
 * Tests NCF-01 a NCF-07: NuevaCitaForm — precarga de fecha desde el listado,
 * bloqueo de fechas pasadas, y obligatoriedad del encargado (Fase 3).
 *
 * Reloj fijo (jest.useFakeTimers) para que "hoy" sea determinístico —
 * hoyLocal() (src/app/(app)/citas/components/date-utils.ts) usa new Date(),
 * así que sin fijar el reloj estos tests dependerían de la fecha real de
 * ejecución.
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

import { NuevaCitaForm } from "@/app/(app)/citas/components/NuevaCitaForm";

const HOY = "2026-08-15";
const CLIENTE_ID = "cli-1";
const SERVICIO_ID = "srv-1";
const ENCARGADO_ID = "enc-1";

const CLIENTES_MOCK = { data: [{ id: CLIENTE_ID, nombre: "Carlos Rojas", rut: "11.111.111-1" }], count: 1 };
const SERVICIOS_MOCK = [{ id: SERVICIO_ID, nombre: "Peluquería", duracion_minutos: 60 }];
const ENCARGADOS_MOCK = [{ id: ENCARGADO_ID, nombre: "Peluquero 1", activo: true }];
const SLOTS_MOCK = [{ hora_inicio: "10:00", hora_fin: "11:00" }];

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function mockFetchDefaultImpl(url: string) {
  if (url.startsWith("/api/clientes")) {
    return Promise.resolve({ ok: true, json: async () => CLIENTES_MOCK });
  }
  if (url.startsWith("/api/mascotas")) {
    return Promise.resolve({ ok: true, json: async () => [] });
  }
  if (url.includes("/disponibilidad")) {
    return Promise.resolve({ ok: true, json: async () => SLOTS_MOCK });
  }
  if (url === "/api/servicios") {
    return Promise.resolve({ ok: true, json: async () => SERVICIOS_MOCK });
  }
  if (url === "/api/encargados") {
    return Promise.resolve({ ok: true, json: async () => ENCARGADOS_MOCK });
  }
  if (url === "/api/citas") {
    return Promise.resolve({ ok: true, json: async () => ({ id: "cita-nueva" }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

// Ubica el <input>/<select> renderizado justo después de su <label> visual
// (no hay htmlFor/id — no son asociables por accesibilidad, así que
// getByLabelText no sirve aquí; esto refleja el markup real, no lo tapa).
function campoTrasLabel(texto: string): HTMLElement {
  return screen.getByText(texto).nextElementSibling as HTMLElement;
}

// Espera a que la opción exista en el DOM (los <select> se pueblan de forma
// asíncrona vía useQuery) ANTES de disparar el change — si se dispara antes,
// jsdom no encuentra ninguna <option> con ese value, el <select> queda en ""
// y el fireEvent.change queda como no-op silencioso (causa raíz depurada:
// ver commit — sin esta espera, todos los tests de selección fallaban).
async function seleccionarServicio(id: string, textoOpcion: string) {
  await waitFor(() => expect(screen.getByText(textoOpcion)).toBeInTheDocument());
  fireEvent.change(campoTrasLabel("Servicio *") as HTMLSelectElement, { target: { value: id } });
}

async function seleccionarEncargado(id: string, textoOpcion: string) {
  await waitFor(() => expect(screen.getByText(textoOpcion)).toBeInTheDocument());
  fireEvent.change(campoTrasLabel("Encargado *") as HTMLSelectElement, { target: { value: id } });
}

describe("NuevaCitaForm (NCF-XX)", () => {
  beforeAll(() => {
    // doNotFake deja setTimeout/microtasks reales — solo se congela Date().
    // Con fake timers "completos", waitFor()/React Query dejan de avanzar
    // porque nada llama jest.advanceTimersByTime(); esto evita ese problema
    // sin perder el control determinístico sobre "hoy".
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

  // NCF-01
  it("NCF-01: sin fechaInicial, el campo Fecha se precarga con hoy", () => {
    render(<NuevaCitaForm onClose={jest.fn()} />, { wrapper: makeWrapper() });
    const fechaInput = campoTrasLabel("Fecha *") as HTMLInputElement;
    expect(fechaInput.value).toBe(HOY);
  });

  // NCF-02
  it("NCF-02: con fechaInicial futura, el campo Fecha se precarga con ese valor", () => {
    render(<NuevaCitaForm onClose={jest.fn()} fechaInicial="2026-08-20" />, { wrapper: makeWrapper() });
    const fechaInput = campoTrasLabel("Fecha *") as HTMLInputElement;
    expect(fechaInput.value).toBe("2026-08-20");
  });

  // NCF-03 — REGRESIÓN: si el filtro del listado quedó en una fecha pasada,
  // el modal no debe prellenar un valor que igual sería rechazado al agendar.
  it("NCF-03: con fechaInicial pasada, el campo Fecha se precarga con hoy (clamp), no con la fecha pasada", () => {
    render(<NuevaCitaForm onClose={jest.fn()} fechaInicial="2026-08-01" />, { wrapper: makeWrapper() });
    const fechaInput = campoTrasLabel("Fecha *") as HTMLInputElement;
    expect(fechaInput.value).toBe(HOY);
    expect(fechaInput.value).not.toBe("2026-08-01");
  });

  // NCF-04
  it("NCF-04: el input de fecha tiene min=hoy (bloquea fechas pasadas en el date picker)", () => {
    render(<NuevaCitaForm onClose={jest.fn()} />, { wrapper: makeWrapper() });
    const fechaInput = campoTrasLabel("Fecha *") as HTMLInputElement;
    expect(fechaInput.min).toBe(HOY);
  });

  // NCF-05
  it("NCF-05: no consulta disponibilidad hasta tener servicio + encargado + fecha (no solo servicio+fecha)", async () => {
    render(<NuevaCitaForm onClose={jest.fn()} />, { wrapper: makeWrapper() });

    await seleccionarServicio(SERVICIO_ID, "Peluquería (60 min)");

    // Fecha ya está precargada (hoy) y el servicio ya se eligió, pero SIN
    // encargado — la query de disponibilidad no debe dispararse todavía.
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining("/disponibilidad"));

    await seleccionarEncargado(ENCARGADO_ID, "Peluquero 1");

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/servicios/${SERVICIO_ID}/disponibilidad?fecha=${HOY}&encargado_id=${ENCARGADO_ID}`
      );
    });
  });

  // NCF-06
  it("NCF-06: 'Agendar cita' permanece deshabilitado sin encargado, aunque haya cliente/servicio/fecha", async () => {
    render(<NuevaCitaForm onClose={jest.fn()} />, { wrapper: makeWrapper() });

    // Selecciona cliente
    await waitFor(() => expect(screen.getByText("Carlos Rojas")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Carlos Rojas"));

    // Selecciona servicio (sin encargado)
    await seleccionarServicio(SERVICIO_ID, "Peluquería (60 min)");

    const botonAgendar = screen.getByText("Agendar cita") as HTMLButtonElement;
    expect(botonAgendar.disabled).toBe(true);

    // La sección de horarios ni siquiera se renderiza sin encargado
    expect(screen.queryByText("Horario disponible *")).not.toBeInTheDocument();
  });

  // NCF-07
  it("NCF-07: al agendar, el body de POST /api/citas incluye encargado_id", async () => {
    render(<NuevaCitaForm onClose={jest.fn()} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Carlos Rojas")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Carlos Rojas"));

    await seleccionarServicio(SERVICIO_ID, "Peluquería (60 min)");
    await seleccionarEncargado(ENCARGADO_ID, "Peluquero 1");

    await waitFor(() => expect(screen.getByText("10:00")).toBeInTheDocument());
    fireEvent.click(screen.getByText("10:00"));

    const botonAgendar = screen.getByText("Agendar cita") as HTMLButtonElement;
    expect(botonAgendar.disabled).toBe(false);
    fireEvent.click(botonAgendar);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/citas",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(`"encargado_id":"${ENCARGADO_ID}"`),
        })
      );
    });
  });
});
