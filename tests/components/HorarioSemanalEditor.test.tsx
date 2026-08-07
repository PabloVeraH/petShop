/**
 * Tests HSR-01 a HSR-04: HorarioSemanalEditor — horario semanal de un servicio
 * (ticket 6a715eb4198366506a54cb9f).
 *
 * Regresión: cuando el backend rechaza PUT /api/servicios/[id]/horarios con
 * 400 (hora_inicio >= hora_fin, mensaje 'La hora de inicio debe ser anterior a
 * la hora de fin'), el error debe mostrarse EN EL MODAL (feedback visible) y el
 * modal permanece abierto para corregir los valores. El backend devuelve el
 * mensaje exacto (I-SRV-24); este test verifica que la UI lo despliega.
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

jest.mock("@/app/(app)/servicios/components/ExcepcionesEditor", () => ({
  ExcepcionesEditor: () => <div data-testid="excepciones-editor" />,
}));

import { HorarioSemanalEditor } from "@/app/(app)/servicios/components/HorarioSemanalEditor";

const SERVICIO = {
  id: "srv-1",
  store_id: "st-1",
  nombre: "Peluqueria Canina",
  descripcion: null,
  duracion_minutos: 60,
  precio: 15000,
  activo: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const LUNES_10_18 = {
  id: "h1",
  store_id: "st-1",
  servicio_id: "srv-1",
  dia_semana: 1,
  hora_inicio: "10:00:00",
  hora_fin: "18:00:00",
  created_at: "",
  updated_at: "",
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("HorarioSemanalEditor (HSR-XX)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/servicios/srv-1" && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...SERVICIO, servicio_horarios: [LUNES_10_18] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  // HSR-01
  it("HSR-01: carga los horarios existentes del servicio (Lunes 10:00 a 18:00)", async () => {
    render(<HorarioSemanalEditor servicio={SERVICIO} onClose={() => {}} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Lunes")).toBeInTheDocument());
    expect(screen.getByDisplayValue("10:00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("18:00")).toBeInTheDocument();
    // El día Lunes queda habilitado (checkbox marcado).
    expect(screen.getByLabelText("Lunes")).toBeChecked();
  });

  // HSR-02 — repro del ticket: hora_fin ANTES de hora_inicio → el backend
  // responde 400 y el mensaje debe verse en el modal.
  it("HSR-02: hora_fin antes de hora_inicio → PUT 400 y el error del backend se muestra en el modal", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/servicios/srv-1" && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...SERVICIO, servicio_horarios: [LUNES_10_18] }),
        });
      }
      if (url === "/api/servicios/srv-1/horarios" && init?.method === "PUT") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ error: "La hora de inicio debe ser anterior a la hora de fin" }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const onClose = jest.fn();
    render(<HorarioSemanalEditor servicio={SERVICIO} onClose={onClose} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByDisplayValue("18:00")).toBeInTheDocument());

    // Cambiar la hora de fin del Lunes a 09:00 (antes del inicio 10:00).
    fireEvent.change(screen.getByDisplayValue("18:00"), { target: { value: "09:00" } });

    fireEvent.click(screen.getByText("Guardar horario"));

    // El mensaje del backend aparece en el modal (no un alert nativo).
    await waitFor(() =>
      expect(screen.getByText("La hora de inicio debe ser anterior a la hora de fin")).toBeInTheDocument()
    );
    // El modal permanece abierto: el botón de guardar sigue presente y onClose NO se llamó.
    expect(screen.getByText("Guardar horario")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  // HSR-03
  it("HSR-03: guardado exitoso → PUT 200 con la grilla y se cierra el modal", async () => {
    const putBodies: Array<{ horarios: unknown[] }> = [];
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/servicios/srv-1" && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...SERVICIO, servicio_horarios: [LUNES_10_18] }),
        });
      }
      if (url === "/api/servicios/srv-1/horarios" && init?.method === "PUT") {
        putBodies.push(JSON.parse(String(init.body)));
        return Promise.resolve({ ok: true, json: async () => [LUNES_10_18] });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const onClose = jest.fn();
    render(<HorarioSemanalEditor servicio={SERVICIO} onClose={onClose} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Lunes")).toBeInTheDocument());

    // Marcar Martes (default 09:00 a 18:00) además del Lunes.
    fireEvent.click(screen.getByLabelText("Martes"));

    fireEvent.click(screen.getByText("Guardar horario"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    // La grilla enviada incluye Lunes (10:00-18:00) y Martes (09:00-18:00).
    const envio = putBodies[0].horarios as Array<{ dia_semana: number; hora_inicio: string; hora_fin: string }>;
    expect(envio).toHaveLength(2);
    expect(envio).toContainEqual({ dia_semana: 1, hora_inicio: "10:00", hora_fin: "18:00" });
    expect(envio).toContainEqual({ dia_semana: 2, hora_inicio: "09:00", hora_fin: "18:00" });
  });

  // HSR-04
  it("HSR-04: servicio sin horarios configurados → todos los días desmarcados", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/servicios/srv-1" && !init?.method) {
        return Promise.resolve({ ok: true, json: async () => ({ ...SERVICIO, servicio_horarios: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<HorarioSemanalEditor servicio={SERVICIO} onClose={() => {}} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Lunes")).toBeInTheDocument());
    for (const dia of ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]) {
      expect(screen.getByLabelText(dia)).not.toBeChecked();
    }
  });
});
