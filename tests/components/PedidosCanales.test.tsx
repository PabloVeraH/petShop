/**
 * Tests PCN-01 a PCN-09 y PCA-01 a PCA-02: vista única de pedidos de canales
 * (/pos/pedidos) y aviso en el POS (Fase 3, paso 3.8 de
 * docs/canales-stock/stock_canales_externos.md).
 *
 * Reemplazan a RappiOrdenesPage / PedidosYaOrdenesPage / UberEatsOrdenesPage
 * (CO-01..CO-12: aceptar/rechazar manual, eliminado por D5). Su contrato de
 * "el error de la API se muestra al operador" sigue cubierto por PCN-05.
 * El botón "Reintentar" solo para admin es UX: el control real es el
 * servidor (I-652: storeWorker → 403).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockUseAuth = jest.fn();
jest.mock("@clerk/nextjs", () => ({ useAuth: () => mockUseAuth() }));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import PedidosCanales, { INTERVALO_MS } from "@/app/(app)/pos/components/PedidosCanales";
import PedidosCanalesAviso from "@/app/(app)/pos/components/PedidosCanalesAviso";

const orden = (id: string, estado: string, extra: Record<string, unknown> = {}) => ({
  id,
  canal_id: "rappi",
  external_order_id: `EXT-${id}`,
  estado,
  items: [{ sku: "SKU-A", nombre: "Alimento 15 kg", cantidad: 2, precio_unitario_bruto: 43990 }],
  total_externo: 87980,
  ultimo_error: null,
  created_at: new Date(Date.now() - 3 * 60_000).toISOString(),
  ready_at: null,
  ...extra,
});

const fetchMock = jest.fn();
global.fetch = fetchMock;

function respuestas(listas: unknown[][], accion: { ok: boolean; body?: unknown } = { ok: true, body: {} }) {
  let i = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return { ok: accion.ok, json: async () => accion.body ?? {} };
    const lista = listas[Math.min(i++, listas.length - 1)];
    return { ok: true, json: async () => lista };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({ sessionClaims: { publicMetadata: { storeWorker: true } } });
});

describe("PedidosCanales", () => {
  it("PCN-01: muestra canal, número, ítems, total y estado de cada pedido", async () => {
    respuestas([[orden("1", "accepted")]]);
    render(<PedidosCanales />);
    expect(await screen.findByText("#EXT-1")).toBeInTheDocument();
    expect(screen.getByText(/Rappi/)).toBeInTheDocument();
    expect(screen.getByText("2 × Alimento 15 kg")).toBeInTheDocument();
    expect(screen.getByText("$87.980")).toBeInTheDocument();
    expect(screen.getByText("Por preparar")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/canales/orders");
  });

  it("PCN-02: estados vacío y de carga", async () => {
    respuestas([[]]);
    render(<PedidosCanales />);
    expect(screen.getByText("Cargando pedidos...")).toBeInTheDocument();
    expect(await screen.findByText("No hay pedidos activos")).toBeInTheDocument();
  });

  it("PCN-03: el filtro de canal viaja a la API", async () => {
    respuestas([[]]);
    render(<PedidosCanales canal="pedidosya" />);
    await screen.findByText("No hay pedidos activos");
    expect(fetchMock).toHaveBeenCalledWith("/api/canales/orders?canal=pedidosya");
  });

  it("PCN-04: 'Marcar lista para retiro' (storeWorker, D8) llama POST /api/canales/orders/[id]/ready y recarga", async () => {
    respuestas([[orden("1", "accepted")], [orden("1", "ready")]]);
    render(<PedidosCanales />);
    fireEvent.click(await screen.findByText("Marcar lista para retiro"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/canales/orders/1/ready", { method: "POST" }));
    expect(await screen.findByText("Lista para retiro")).toBeInTheDocument();
  });

  it("PCN-05: el error de la API al marcar se muestra en pantalla (no queda en silencio)", async () => {
    respuestas([[orden("1", "accepted")]], { ok: false, body: { error: "Solo una orden aceptada puede marcarse como lista" } });
    render(<PedidosCanales />);
    fireEvent.click(await screen.findByText("Marcar lista para retiro"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Solo una orden aceptada");
  });

  it("PCN-06: orden fallida — admin ve 'Reintentar' y llama POST .../retry; worker ve el aviso sin botón (gate de UX)", async () => {
    respuestas([[orden("9", "failed", { ultimo_error: "Error creando la venta (40P01)" })]]);
    const { unmount } = render(<PedidosCanales />);
    expect(await screen.findByText("Error creando la venta (40P01)")).toBeInTheDocument();
    expect(screen.queryByText("Reintentar")).not.toBeInTheDocument();
    expect(screen.getByText(/Requiere que un administrador/)).toBeInTheDocument();
    unmount();

    mockUseAuth.mockReturnValue({ sessionClaims: { publicMetadata: { storeAdmin: true } } });
    respuestas([[orden("9", "failed")]]);
    render(<PedidosCanales />);
    fireEvent.click(await screen.findByText("Reintentar"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/canales/orders/9/retry", { method: "POST" }));
  });

  it("PCN-07: orden en 'processing' no ofrece acciones", async () => {
    respuestas([[orden("2", "processing")]]);
    render(<PedidosCanales />);
    expect(await screen.findByText("Procesando")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Marcar|Reintentar/ })).not.toBeInTheDocument();
  });

  it("PCN-08: aviso visual cuando llega un pedido nuevo por preparar entre refrescos", async () => {
    jest.useFakeTimers();
    try {
      respuestas([[orden("1", "accepted")], [orden("1", "accepted"), orden("2", "accepted")]]);
      render(<PedidosCanales />);
      await act(async () => { await Promise.resolve(); });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      await act(async () => { jest.advanceTimersByTime(INTERVALO_MS); await Promise.resolve(); await Promise.resolve(); });
      expect(await screen.findByRole("status")).toHaveTextContent("Llegó un pedido nuevo");
      fireEvent.click(screen.getByText("Entendido"));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("PCN-09: error al cargar la lista se muestra", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<PedidosCanales />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar los pedidos");
  });
});

describe("PedidosCanalesAviso (POS)", () => {
  it("PCA-01: enlaza a /pos/pedidos y muestra cuántos pedidos hay por preparar", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [orden("1", "accepted"), orden("2", "accepted")] });
    render(<PedidosCanalesAviso />);
    expect(await screen.findByText("Pedidos de canales (2)")).toHaveAttribute("href", "/pos/pedidos");
    expect(fetchMock).toHaveBeenCalledWith("/api/canales/orders?estado=accepted");
  });

  it("PCA-02: sin pedidos o con error de red, el enlace sigue disponible sin contador", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<PedidosCanalesAviso />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Pedidos de canales")).toHaveAttribute("href", "/pos/pedidos");
  });
});
