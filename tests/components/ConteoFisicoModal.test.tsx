/**
 * Tests CF-01 a CF-07: ConteoFisicoModal — ajuste por conteo físico (D22,
 * Fase 1 de docs/canales-stock/stock_canales_externos.md).
 * @jest-environment jsdom
 *
 * El modal solo se muestra a admin (gate de UX en InventoryPage, ver IV-15);
 * el control de seguridad real es el servidor (I-555: storeWorker → 403).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

global.fetch = jest.fn();

import { ConteoFisicoModal } from "@/app/(app)/inventory/components/ConteoFisicoModal";

const PRODUCTO = { id: "prod-1", nombre: "Alimento Premium", stock: 9.5 };

const LOTE = {
  id: "lote-1", store_id: "s", producto_id: "prod-1", numero_lote: "LOTE-A",
  cantidad_inicial: 20, cantidad_actual: 12, fecha_vencimiento: "2027-01-01",
  fecha_ingreso: "2026-09-01", activo: true, created_at: "", updated_at: "",
};

function renderModal(onClose = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}><ConteoFisicoModal producto={PRODUCTO} onClose={onClose} /></QueryClientProvider>
  );
  return { onClose, qc };
}

function mockFetch(lotes: object[], conteoResponse: { ok: boolean; body: object } = { ok: true, body: {} }) {
  (global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
    if (url.startsWith("/api/lotes")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ lotes }) } as Response);
    }
    if (url.includes("/conteo") && opts?.method === "POST") {
      return Promise.resolve({ ok: conteoResponse.ok, json: () => Promise.resolve(conteoResponse.body) } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
  });
}

function postConteo() {
  return (global.fetch as jest.Mock).mock.calls.find(
    ([url, opts]: [string, RequestInit]) => url.includes("/conteo") && opts?.method === "POST"
  );
}

beforeEach(() => jest.clearAllMocks());

describe("ConteoFisicoModal", () => {
  it("CF-01: producto sin lotes — registra el conteo con POST a /api/inventario/[id]/conteo y el body correcto", async () => {
    mockFetch([]);
    const { onClose } = renderModal();
    await waitFor(() => expect(screen.getByLabelText(/Cantidad contada/)).toBeInTheDocument());

    expect(screen.getByText("Cantidad registrada: 9.5")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Lote contado/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Cantidad contada/), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "  Conteo de fin de mes " } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar conteo" }));

    await waitFor(() => expect(postConteo()).toBeDefined());
    const [url, opts] = postConteo()!;
    expect(url).toBe("/api/inventario/prod-1/conteo");
    expect(JSON.parse(opts.body as string)).toEqual({ stock_contado: 9, motivo: "Conteo de fin de mes" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("CF-02: producto con lotes — exige elegir el lote y envía lote_id", async () => {
    mockFetch([LOTE]);
    renderModal();
    await waitFor(() => expect(screen.getByLabelText(/Lote contado/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Cantidad contada/), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "Conteo lote marzo" } });
    // Sin lote elegido el botón sigue bloqueado
    expect(screen.getByRole("button", { name: "Registrar conteo" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Lote contado/), { target: { value: "lote-1" } });
    expect(screen.getByText("Cantidad registrada: 12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Registrar conteo" }));

    await waitFor(() => expect(postConteo()).toBeDefined());
    expect(JSON.parse(postConteo()![1].body as string)).toEqual({ stock_contado: 10, motivo: "Conteo lote marzo", lote_id: "lote-1" });
  });

  it("CF-03: motivo con menos de 5 caracteres muestra error y bloquea el envío", async () => {
    mockFetch([]);
    renderModal();
    await waitFor(() => expect(screen.getByLabelText(/Cantidad contada/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Cantidad contada/), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "abc" } });

    expect(screen.getByText(/al menos 5 caracteres/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar conteo" })).toBeDisabled();
  });

  it("CF-04: cantidad vacía o negativa bloquea el envío", async () => {
    mockFetch([]);
    renderModal();
    await waitFor(() => expect(screen.getByLabelText(/Cantidad contada/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "Conteo mensual" } });
    expect(screen.getByRole("button", { name: "Registrar conteo" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Cantidad contada/), { target: { value: "-2" } });
    expect(screen.getByRole("button", { name: "Registrar conteo" })).toBeDisabled();
  });

  it("CF-05: error de la API (ej. 403) se muestra en pantalla y el modal no se cierra", async () => {
    mockFetch([], { ok: false, body: { error: "Forbidden" } });
    const { onClose } = renderModal();
    await waitFor(() => expect(screen.getByLabelText(/Cantidad contada/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Cantidad contada/), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "Conteo mensual" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar conteo" }));

    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("CF-06: estado de carga y error al cargar lotes", async () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)
    );
    renderModal();
    expect(screen.getByText("Cargando lotes...")).toBeInTheDocument();
    expect(await screen.findByText("Error al cargar lotes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar conteo" })).toBeDisabled();
  });

  it("CF-07: éxito invalida inventario, productos y lotes del producto", async () => {
    mockFetch([]);
    const { qc } = renderModal();
    const spy = jest.spyOn(qc, "invalidateQueries");
    await waitFor(() => expect(screen.getByLabelText(/Cantidad contada/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Cantidad contada/), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "Conteo mensual" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar conteo" }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["inventario"], refetchType: "all" }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["productos"], refetchType: "all" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["lotes", "prod-1"] });
  });
});

// ── Fase 1b — conteo de granel (migración 077) ─────────────────────────────
describe("ConteoFisicoModal — granel", () => {
  const GRANEL = {
    id: "prod-g", nombre: "Alimento granel", stock: 9.967,
    precio_venta_kg: 5000, peso_gramos: 15000, saco_abierto_gramos: 14500,
  };

  function renderGranel(producto: object = GRANEL) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ConteoFisicoModal producto={producto as typeof GRANEL} onClose={jest.fn()} />
      </QueryClientProvider>
    );
  }

  it("CF-08: granel muestra 'N sacos + X kg' y pide sacos cerrados + gramos del saco abierto", async () => {
    mockFetch([]);
    renderGranel();
    expect(screen.getByText(/9 sacos \+ 14,5 kg/)).toBeInTheDocument();
    expect(await screen.findByLabelText(/Sacos cerrados contados/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Gramos en el saco abierto/)).toBeInTheDocument();
    expect(screen.getByText("Cantidad registrada: 9")).toBeInTheDocument();
  });

  it("CF-09: envía gramos_saco_abierto solo si se contaron (vacío = sin cambio)", async () => {
    mockFetch([], { ok: true, body: {} });
    renderGranel();
    fireEvent.change(await screen.findByLabelText(/Sacos cerrados contados/), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "Conteo mensual" } });
    fireEvent.change(screen.getByLabelText(/Gramos en el saco abierto/), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar conteo" }));

    await waitFor(() => expect(postConteo()).toBeDefined());
    expect(JSON.parse(postConteo()![1].body)).toEqual({
      stock_contado: 9, motivo: "Conteo mensual", gramos_saco_abierto: 12000,
    });
  });

  it("CF-10: gramos con decimales bloquean el envío; producto no granel no muestra el campo", async () => {
    mockFetch([]);
    renderGranel();
    fireEvent.change(await screen.findByLabelText(/Sacos cerrados contados/), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "Conteo mensual" } });
    fireEvent.change(screen.getByLabelText(/Gramos en el saco abierto/), { target: { value: "10.5" } });
    expect(screen.getByText(/Los gramos deben ser un entero/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar conteo" })).toBeDisabled();
  });

  it("CF-10b: producto sin granel no muestra el campo de gramos ni los envía", async () => {
    mockFetch([]);
    renderGranel({ id: "prod-u", nombre: "Cama", stock: 3, precio_venta_kg: null, peso_gramos: null });
    expect(await screen.findByLabelText(/Cantidad contada/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Gramos en el saco abierto/)).not.toBeInTheDocument();
  });
});
