/**
 * Tests EXC-01 a EXC-04: ExcepcionesEditor (feriados y cierres de un servicio).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ExcepcionesEditor } from "@/app/(app)/servicios/components/ExcepcionesEditor";

const SERVICIO = { id: "srv-1", nombre: "Peluquería" } as never;
const EXCEPCIONES = [
  { id: "ex-1", fecha: "2026-12-25", cerrado: true, hora_inicio: null, hora_fin: null },
  { id: "ex-2", fecha: "2026-12-31", cerrado: false, hora_inicio: "10:00:00", hora_fin: "14:00:00" },
];
let lista: unknown[] = EXCEPCIONES;
let fallos: Record<string, unknown> = {};
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  lista = EXCEPCIONES;
  fallos = {};
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const clave = `${init?.method ?? "GET"} ${url}`;
    if (clave in fallos) return { ok: false, json: async () => fallos[clave] };
    if (!init?.method) return { ok: true, json: async () => lista };
    return { ok: true, json: async () => ({}) };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

function renderEditor(onClose = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  render(<ExcepcionesEditor servicio={SERVICIO} onClose={onClose} />, { wrapper: Wrapper });
  return onClose;
}
const fechaInput = () => document.querySelector('input[type="date"]') as HTMLInputElement;
const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === "POST");

describe("ExcepcionesEditor", () => {
  it("EXC-01: lista cierres y horarios especiales; sin excepciones muestra el vacío; Cerrar llama onClose", async () => {
    const onClose = renderEditor();
    expect(await screen.findByText("2026-12-25")).toBeInTheDocument();
    expect(screen.getByText("Cerrado")).toBeInTheDocument();
    expect(screen.getByText("Horario especial: 10:00–14:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("EXC-02: agregar día cerrado hace POST solo con fecha y cerrado; sin fecha el botón está deshabilitado", async () => {
    lista = [];
    renderEditor();
    expect(await screen.findByText("Sin excepciones configuradas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar excepción" })).toBeDisabled();

    fireEvent.change(fechaInput(), { target: { value: "2026-09-18" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar excepción" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe("/api/servicios/srv-1/excepciones");
    expect(JSON.parse(posts()[0][1].body)).toEqual({ fecha: "2026-09-18", cerrado: true });
    await waitFor(() => expect(fechaInput()).toHaveValue(""));
  });

  it("EXC-03: horario especial manda horas; inicio ≥ fin deshabilita; error de la API se muestra", async () => {
    renderEditor();
    await screen.findByText("2026-12-25");
    fireEvent.change(fechaInput(), { target: { value: "2026-09-19" } });
    fireEvent.click(screen.getByRole("checkbox"));
    const [inicio, fin] = Array.from(document.querySelectorAll('input[type="time"]'));
    fireEvent.change(inicio, { target: { value: "15:00" } });
    fireEvent.change(fin, { target: { value: "12:00" } });
    expect(screen.getByRole("button", { name: "Agregar excepción" })).toBeDisabled();
    fireEvent.change(fin, { target: { value: "17:30" } });

    fallos["POST /api/servicios/srv-1/excepciones"] = { error: "Ya existe una excepción ese día" };
    fireEvent.click(screen.getByRole("button", { name: "Agregar excepción" }));
    expect(await screen.findByText("Ya existe una excepción ese día")).toBeInTheDocument();
    expect(JSON.parse(posts()[0][1].body)).toEqual({ fecha: "2026-09-19", cerrado: false, hora_inicio: "15:00", hora_fin: "17:30" });

    fallos["POST /api/servicios/srv-1/excepciones"] = {};
    fireEvent.click(screen.getByRole("button", { name: "Agregar excepción" }));
    expect(await screen.findByText("Error al agregar")).toBeInTheDocument();
  });

  it("EXC-04: Eliminar hace DELETE de la excepción; error (con o sin cuerpo) se muestra", async () => {
    renderEditor();
    await screen.findByText("2026-12-25");
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[0]);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/servicios/srv-1/excepciones/ex-1", { method: "DELETE" })
    );

    fallos["DELETE /api/servicios/srv-1/excepciones/ex-2"] = { error: "Tiene citas agendadas" };
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[1]);
    expect(await screen.findByText("Tiene citas agendadas")).toBeInTheDocument();

    fetchMock.mockImplementationOnce(async () => ({ ok: false, json: async () => { throw new Error("sin json"); } }));
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[1]);
    expect(await screen.findByText("Error al eliminar")).toBeInTheDocument();
  });
});
