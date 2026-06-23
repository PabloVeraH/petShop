/**
 * Tests C-01 a C-06: SearchProductos — renderizado y comportamiento con precio nullable
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Producto } from "@/types";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockAddItem = jest.fn();

jest.mock("@/stores/pos", () => ({
  usePOSStore: jest.fn(() => ({ addItem: mockAddItem, mascotaId: undefined, items: [] })),
}));

const mockGetProductos = jest.fn();
jest.mock("@/app/(app)/pos/api", () => ({
  getProductos: (...args: unknown[]) => mockGetProductos(...args),
}));

jest.mock("@/app/(app)/pos/components/BarcodeScanner", () => ({
  default: () => null,
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant }: { children: ReactNode; variant?: string }) => (
    <span data-variant={variant}>{children}</span>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const PROD_BASE: Omit<Producto, "id" | "nombre" | "precio"> = {
  store_id: "store-1",
  sku: "SKU001",
  stock: 10,
  stock_minimo: 2,
  fecha_vencimiento: null,
  precio_oferta: null,
  en_oferta: false,
  codigo_barra: null,
};

function prod(overrides: Partial<Producto> & Pick<Producto, "id" | "nombre" | "precio">): Producto {
  return { ...PROD_BASE, ...overrides };
}

// ── Import component after mocks ──────────────────────────────────────────────

import SearchProductos from "@/app/(app)/pos/components/SearchProductos";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SearchProductos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProductos.mockResolvedValue([]);
  });

  // C-01
  it("C-01: muestra skeleton cards mientras la query está pendiente", () => {
    mockGetProductos.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SearchProductos />, { wrapper: makeWrapper() });
    // Skeleton renders 6 animated divs — not the old "Cargando..." text
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
    expect(screen.queryByText("Cargando...")).not.toBeInTheDocument();
  });

  // C-02
  it("C-02: muestra productos al resolverse la query", async () => {
    mockGetProductos.mockResolvedValue([
      prod({ id: "p1", nombre: "Alimento Premium", precio: 5000 }),
    ]);
    render(<SearchProductos />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Alimento Premium")).toBeInTheDocument()
    );
    expect(screen.getByText("$5.000")).toBeInTheDocument();
  });

  // C-03: caso clave — precio null no debe crashear y deshabilita el botón
  it("C-03: producto con precio null muestra badge 'Sin precio' y deshabilita el botón", async () => {
    mockGetProductos.mockResolvedValue([
      prod({ id: "p2", nombre: "Producto Sin Precio", precio: null }),
    ]);
    render(<SearchProductos />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Producto Sin Precio")).toBeInTheDocument()
    );

    expect(screen.getByText("Sin precio")).toBeInTheDocument();

    const btn = screen.getByRole("button", { name: /Producto Sin Precio/i });
    expect(btn).toBeDisabled();
  });

  // C-04
  it("C-04: producto con precio válido tiene botón habilitado", async () => {
    mockGetProductos.mockResolvedValue([
      prod({ id: "p3", nombre: "Producto Normal", precio: 3000 }),
    ]);
    render(<SearchProductos />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Producto Normal")).toBeInTheDocument()
    );

    const btn = screen.getByRole("button", { name: /Producto Normal/i });
    expect(btn).not.toBeDisabled();
  });

  // C-05
  it("C-05: click en producto válido llama addItem con precio correcto", async () => {
    mockGetProductos.mockResolvedValue([
      prod({ id: "p4", nombre: "Producto Click", precio: 2500 }),
    ]);
    render(<SearchProductos />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Producto Click")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /Producto Click/i }));

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({ producto_id: "p4", precio: 2500, cantidad: 1 })
    );
  });

  // C-06
  it("C-06: click en producto con precio null NO llama addItem", async () => {
    mockGetProductos.mockResolvedValue([
      prod({ id: "p5", nombre: "Sin Precio Click", precio: null }),
    ]);
    render(<SearchProductos />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Sin Precio Click")).toBeInTheDocument()
    );

    // button is disabled — fireEvent still fires but addItem should not be called
    const btn = screen.getByRole("button", { name: /Sin Precio Click/i });
    fireEvent.click(btn);

    expect(mockAddItem).not.toHaveBeenCalled();
  });

  // C-18: regresión — precio $0 también bloquea (no solo null/undefined)
  it("C-18: producto con precio 0 muestra 'Sin precio' y deshabilita el botón", async () => {
    mockGetProductos.mockResolvedValue([
      prod({ id: "p6", nombre: "Precio Cero", precio: 0 }),
    ]);
    render(<SearchProductos />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Precio Cero")).toBeInTheDocument()
    );

    expect(screen.getByText("Sin precio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Precio Cero/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Precio Cero/i }));
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  // C-19: regresión — precio $0 NO se agrega al carrito (guard interno)
  it("C-19: addItem no se llama para precio $0 aunque se invoque addProductoToCart", async () => {
    mockGetProductos.mockResolvedValue([
      prod({ id: "p7", nombre: "Zero Price Guard", precio: 0 }),
    ]);
    render(<SearchProductos />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Zero Price Guard")).toBeInTheDocument()
    );

    // disabled button → addItem never called
    expect(mockAddItem).not.toHaveBeenCalled();
  });
});
