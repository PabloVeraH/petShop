/**
 * Tests IAC-01 a IAC-04: IAConfigSection (Admin > IA, solo systemAdmin).
 * El permiso real lo valida PATCH /api/admin/ai-config en el servidor; aquí
 * se prueba que la UI envía lo correcto y muestra los errores.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { IAConfigSection } from "@/components/admin/IAConfigSection";

const STORES = [
  { id: "store-aaaaaaaa-1", name: "Tienda Uno", openrouter_model: "openai/gpt-4o" },
  { id: "store-bbbbbbbb-2", name: "", openrouter_model: null },
];
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("IAConfigSection", () => {
  it("IAC-01: muestra el modelo de cada tienda (openrouter/free si no tiene) y el nombre o un id corto", () => {
    render(<IAConfigSection stores={STORES} />);
    expect(screen.getByText("Tienda Uno")).toBeInTheDocument();
    expect(screen.getByText("Tienda store-bb...")).toBeInTheDocument();
    expect(screen.getByDisplayValue("openai/gpt-4o")).toBeInTheDocument();
    expect(screen.getByDisplayValue("openrouter/free")).toBeInTheDocument();
  });

  it("IAC-02: modelo vacío → error sin llamar a la API", () => {
    render(<IAConfigSection stores={STORES} />);
    fireEvent.change(screen.getByDisplayValue("openai/gpt-4o"), { target: { value: "   " } });
    fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[0]);
    expect(screen.getByText("El modelo no puede estar vacío")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("IAC-03: guardar hace PATCH /api/admin/ai-config con store_id y el modelo recortado; el ✓ se limpia a los 2 s", async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<IAConfigSection stores={STORES} />);
    fireEvent.change(screen.getByDisplayValue("openai/gpt-4o"), { target: { value: " anthropic/claude-haiku-4.5 " } });
    fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[0]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/ai-config", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ store_id: "store-aaaaaaaa-1", openrouter_model: "anthropic/claude-haiku-4.5" }),
    })));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Guardar" })).toHaveLength(1));
    act(() => { jest.advanceTimersByTime(2000); });
    expect(screen.getAllByRole("button", { name: "Guardar" })).toHaveLength(2);
    jest.useRealTimers();
  });

  it("IAC-04: error de la API (con y sin mensaje) se muestra bajo la tienda", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Modelo no permitido" }) });
    render(<IAConfigSection stores={STORES} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[1]);
    expect(await screen.findByText("Modelo no permitido")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[1]);
    expect(await screen.findByText("Error al guardar")).toBeInTheDocument();

    fetchMock.mockRejectedValueOnce("caída");
    fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[1]);
    expect(await screen.findByText("Error desconocido")).toBeInTheDocument();
  });
});
