/**
 * Tests DAB-01 a DAB-03: DeshacerAperturaButton — "Deshacer apertura" de un
 * saco granel (G2, Fase 1b de docs/canales-stock/stock_canales_externos.md).
 * @jest-environment jsdom
 *
 * Solo se muestra a admin (gate de UX en InventoryPage, IV-19); el control
 * real es el servidor (I-575: storeWorker → 403; I-583: saco con ventas → 409).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

global.fetch = jest.fn();

import { DeshacerAperturaButton } from "@/app/(app)/inventory/components/DeshacerAperturaButton";

function renderBtn() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = jest.spyOn(qc, "invalidateQueries");
  render(<QueryClientProvider client={qc}><DeshacerAperturaButton productoId="prod-g" /></QueryClientProvider>);
  return { spy };
}

beforeEach(() => jest.clearAllMocks());

describe("DeshacerAperturaButton", () => {
  it("DAB-01: el clic envía POST /api/productos/[id]/saco con accion 'deshacer'", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: () => Promise.resolve({ saco: {}, stock: 10 }) });
    renderBtn();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer apertura" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/productos/prod-g/saco", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ accion: "deshacer" }),
    })));
  });

  it("DAB-02: éxito invalida inventario, productos y lotes", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: () => Promise.resolve({ saco: {}, stock: 10 }) });
    const { spy } = renderBtn();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer apertura" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["inventario"], refetchType: "all" }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["productos"], refetchType: "all" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["lotes"], refetchType: "all" });
  });

  it("DAB-03: error del servidor (409 / 403) se muestra en pantalla", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "El saco no se puede deshacer: tiene ventas asociadas" }),
    });
    const { spy } = renderBtn();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer apertura" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("tiene ventas asociadas");
    expect(spy).not.toHaveBeenCalled();
  });
});
