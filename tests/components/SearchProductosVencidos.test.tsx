/**
 * Tests VENC-C-01…07: SearchProductos — lotes vencidos ("Vender productos
 * vencidos", migración 095) y avisos de última unidad / stock bajo.
 *
 * Los avisos y el límite de cantidad del POS son conveniencia de UX: la regla
 * real la aplica crear_venta_tx en la BD (VENC-SQL-03…09), que vuelve a leer la
 * opción de la tienda al cobrar.
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Producto } from "@/types";

const mockAddItem = jest.fn();
jest.mock("@/stores/pos", () => ({
  usePOSStore: jest.fn(() => ({ addItem: mockAddItem, mascotaId: undefined, items: [] })),
}));

const mockGetProductos = jest.fn();
jest.mock("@/app/(app)/pos/api", () => ({
  getProductos: (...args: unknown[]) => mockGetProductos(...args),
}));

// Configuración de la tienda (GET /api/tienda/nombre).
const mockFetchJson = jest.fn();
jest.mock("@/lib/api-client", () => ({
  ...jest.requireActual("@/lib/api-client"),
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

jest.mock("@/app/(app)/pos/components/BarcodeScanner", () => ({ default: () => null }));
jest.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

import SearchProductos from "@/app/(app)/pos/components/SearchProductos";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const BOKATO: Producto = {
  id: "p-bokato", store_id: "store-1", nombre: "BOKATO GOLD 20KG", sku: "BOK20", precio: 45990,
  stock: 1, stock_minimo: 1, stock_vencido: 1, fecha_vencimiento: null,
  precio_oferta: null, en_oferta: false, codigo_barra: "7801234567890",
};

function setup(productos: Producto[], venderVencidos: boolean) {
  mockGetProductos.mockResolvedValue(productos);
  mockFetchJson.mockImplementation(async (url: string) => {
    if (url === "/api/tienda/nombre") return { name: "Tienda", vender_vencidos: venderVencidos };
    throw new Error(`URL inesperada ${url}`);
  });
  render(<SearchProductos />, { wrapper: makeWrapper() });
}

describe("SearchProductos — lotes vencidos y avisos de stock", () => {
  beforeEach(() => jest.clearAllMocks());

  it("VENC-C-01: opción desactivada → la tarjeta dice por qué no se vende y queda bloqueada", async () => {
    setup([BOKATO], false);
    expect(await screen.findByText("1 en lote vencido · no se puede vender")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /BOKATO GOLD 20KG/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("VENC-C-02: opción desactivada + pistola → mensaje claro en vez de 'Stock máximo alcanzado'", async () => {
    setup([BOKATO], false);
    await screen.findByText("BOKATO GOLD 20KG");
    const input = screen.getByPlaceholderText(/Buscar por nombre/);
    fireEvent.change(input, { target: { value: "7801234567890" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(
      "BOKATO GOLD 20KG: 1 en lote vencido. La tienda no permite vender productos vencidos"
    )).toBeInTheDocument();
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("VENC-C-03: opción activada → se agrega y avisa que sale de un lote vencido y que es la última unidad", async () => {
    setup([BOKATO], true);
    expect(await screen.findByText("1 en lote vencido · se vende con aviso")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /BOKATO GOLD 20KG/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /BOKATO GOLD 20KG/ }));
    expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({ producto_id: "p-bokato", cantidad: 1, stock: 1 }));
    expect(screen.getByText(
      "BOKATO GOLD 20KG: se venderá de un lote vencido · Última unidad disponible de BOKATO GOLD 20KG"
    )).toBeInTheDocument();
  });

  it("VENC-C-04: opción desactivada con 1 vigente + 1 vencido → se vende la vigente (límite 1) y avisa última unidad", async () => {
    setup([{ ...BOKATO, stock: 2, stock_vencido: 1 }], false);
    const btn = await screen.findByRole("button", { name: /BOKATO GOLD 20KG/ });
    await waitFor(() => expect(mockFetchJson).toHaveBeenCalledWith("/api/tienda/nombre"));
    fireEvent.click(btn);
    expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({ stock: 1 }));
    expect(screen.getByText("Última unidad disponible de BOKATO GOLD 20KG")).toBeInTheDocument();
  });

  // Caso que reportó el usuario: queda 1 y el mínimo es 1 → se vende igual, solo avisa.
  it("VENC-C-05: sin vencidos, stock 1 y mínimo 1 → se agrega (no bloquea) y avisa 'Última unidad'", async () => {
    setup([{ ...BOKATO, stock_vencido: 0 }], false);
    fireEvent.click(await screen.findByRole("button", { name: /BOKATO GOLD 20KG/ }));
    expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({ producto_id: "p-bokato", stock: 1 }));
    expect(screen.getByText("Última unidad disponible de BOKATO GOLD 20KG")).toBeInTheDocument();
    expect(screen.queryByText(/lote vencido/)).not.toBeInTheDocument();
  });

  it("VENC-C-06: queda en el mínimo o bajo él → aviso de stock bajo, sin bloquear", async () => {
    setup([{ ...BOKATO, stock: 5, stock_minimo: 4, stock_vencido: 0 }], false);
    fireEvent.click(await screen.findByRole("button", { name: /BOKATO GOLD 20KG/ }));
    expect(mockAddItem).toHaveBeenCalled();
    expect(screen.getByText("Stock bajo: quedarán 4 de BOKATO GOLD 20KG (mínimo 4)")).toBeInTheDocument();
  });

  it("VENC-C-07: stock holgado → sin avisos", async () => {
    setup([{ ...BOKATO, stock: 10, stock_minimo: 2, stock_vencido: 0 }], false);
    fireEvent.click(await screen.findByRole("button", { name: /BOKATO GOLD 20KG/ }));
    expect(mockAddItem).toHaveBeenCalled();
    expect(screen.queryByText(/Última unidad|Stock bajo|lote vencido/)).not.toBeInTheDocument();
  });
});
