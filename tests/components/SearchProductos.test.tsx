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

  // C-65: producto con imagen_url muestra la miniatura en el card del buscador
  it("C-65: producto con imagen_url renderiza la miniatura con src y alt correctos", async () => {
    mockGetProductos.mockResolvedValue([
      prod({
        id: "p8",
        nombre: "Alimento Gato Whiskas 1kg",
        precio: 15458,
        imagen_url: "https://demo.ammapet.cl/productos/store-1/p8/foto.webp",
      }),
    ]);
    render(<SearchProductos />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Alimento Gato Whiskas 1kg")).toBeInTheDocument()
    );

    const img = screen.getByRole("img", { name: "Alimento Gato Whiskas 1kg" });
    expect(img).toHaveAttribute(
      "src",
      "https://demo.ammapet.cl/productos/store-1/p8/foto.webp"
    );
  });

  // C-66: producto sin imagen_url muestra el placeholder, no un <img> roto
  it("C-66: producto sin imagen_url NO renderiza <img> — muestra el placeholder", async () => {
    mockGetProductos.mockResolvedValue([
      prod({ id: "p9", nombre: "Producto Sin Foto", precio: 4000, imagen_url: null }),
    ]);
    render(<SearchProductos />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Producto Sin Foto")).toBeInTheDocument()
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  // C-67: si la miniatura falla al cargar (URL rota en R2), cae al placeholder
  // en vez de dejar el ícono de imagen quebrada del navegador
  it("C-67: error al cargar la miniatura reemplaza el <img> por el placeholder", async () => {
    mockGetProductos.mockResolvedValue([
      prod({
        id: "p10",
        nombre: "Foto Rota",
        precio: 4000,
        imagen_url: "https://demo.ammapet.cl/productos/store-1/p10/foto.webp",
      }),
    ]);
    render(<SearchProductos />, { wrapper: makeWrapper() });

    const img = await screen.findByRole("img", { name: "Foto Rota" });
    fireEvent.error(img);

    await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
  });

  // C-118 — REGRESIÓN (mascotaspetshop, 2026-11-25): cada carácter era una
  // request a /api/productos (~80 % del tráfico del POS) y la caja recibía 429.
  describe("búsqueda con espera (C-118)", () => {
    const INPUT = "Buscar por nombre, SKU o código de barra...";

    it("C-118: escribir varias letras seguidas busca una sola vez, con el texto final", async () => {
      render(<SearchProductos />, { wrapper: makeWrapper() });
      await waitFor(() => expect(mockGetProductos).toHaveBeenCalledWith(""));
      mockGetProductos.mockClear();

      const input = screen.getByPlaceholderText(INPUT);
      for (const v of ["a", "al", "ali", "alim"]) fireEvent.change(input, { target: { value: v } });
      expect(mockGetProductos).not.toHaveBeenCalled();

      await waitFor(() => expect(mockGetProductos).toHaveBeenCalledWith("alim"));
      expect(mockGetProductos).toHaveBeenCalledTimes(1);
    });

    it("C-118: el escaneo (código + Enter) busca el código de inmediato y una sola vez", async () => {
      const codigo = "7801234567890";
      mockGetProductos.mockImplementation((s: string) =>
        Promise.resolve(s === codigo ? [prod({ id: "p11", nombre: "Escaneado", precio: 1000, codigo_barra: codigo })] : [])
      );
      render(<SearchProductos />, { wrapper: makeWrapper() });
      await waitFor(() => expect(mockGetProductos).toHaveBeenCalledWith(""));
      mockGetProductos.mockClear();

      const input = screen.getByPlaceholderText(INPUT);
      for (let i = 1; i <= codigo.length; i++) fireEvent.change(input, { target: { value: codigo.slice(0, i) } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({ producto_id: "p11" })));
      expect(mockGetProductos).toHaveBeenCalledTimes(1);
      expect(mockGetProductos).toHaveBeenCalledWith(codigo);
      // Pasada la espera, el campo vacío reusa la lista ya cargada: sin requests nuevas.
      await new Promise((r) => setTimeout(r, 400));
      expect(mockGetProductos).toHaveBeenCalledTimes(1);
    });
  });

  // C-119 — REGRESIÓN (mascotaspetshop, 2026-11-25): tras una venta o un cambio
  // de inventario, invalidateQueries(["productos"]) con refetchType "all" volvía
  // a pedir TODAS las búsquedas guardadas (~100 requests en un segundo). Ahora
  // solo la que está en pantalla; las demás se piden al volver a mostrarse, con
  // el stock nuevo. Se invalida igual que pos/page.tsx tras una venta.
  it("C-119: invalidar productos solo vuelve a pedir la búsqueda en pantalla; una anterior se refresca al volver a ella", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let stock = 10;
    mockGetProductos.mockImplementation((s: string) =>
      Promise.resolve(s ? [prod({ id: `p-${s}`, nombre: `Prod ${s}`, precio: 1000, stock })] : [])
    );
    render(<QueryClientProvider client={qc}><SearchProductos /></QueryClientProvider>);
    const input = screen.getByPlaceholderText("Buscar por nombre, SKU o código de barra...");

    fireEvent.change(input, { target: { value: "lata" } });
    expect(await screen.findByText("Prod lata")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "perro" } });
    expect(await screen.findByText("Prod perro")).toBeInTheDocument();
    mockGetProductos.mockClear();

    stock = 3;
    await qc.invalidateQueries({ queryKey: ["productos"] });

    expect(mockGetProductos).toHaveBeenCalledTimes(1);
    expect(mockGetProductos).toHaveBeenCalledWith("perro");

    fireEvent.change(input, { target: { value: "lata" } });
    await waitFor(() => expect(mockGetProductos).toHaveBeenCalledWith("lata"));
    expect(await screen.findByText("Stock: 3")).toBeInTheDocument();
  });
});
