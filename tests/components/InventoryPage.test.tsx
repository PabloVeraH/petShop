/**
 * Tests C-07 a C-13: InventoryPage — tabs, renderizado y controles de admin
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@clerk/nextjs", () => ({ useUser: jest.fn() }));

jest.mock("@/app/(app)/inventory/components/LotesPanel", () => ({
  LotesPanel: () => <div data-testid="lotes-panel" />,
}));

jest.mock("@/app/(app)/inventory/components/CategoriasTab", () => ({
  CategoriasTab: () => <div data-testid="categorias-tab" />,
}));

jest.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children, className }: { children: ReactNode; className?: string }) => (
    <tr className={className}>{children}</tr>
  ),
  TableHead: ({ children }: { children: ReactNode }) => <th>{children}</th>,
  TableCell: ({ children }: { children: ReactNode }) => <td>{children}</td>,
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant }: { children: ReactNode; variant?: string }) => (
    <span data-variant={variant}>{children}</span>
  ),
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children, onClick, disabled, variant, size,
  }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: string; size?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));

// fetch no existe en jsdom — definir antes de cualquier test
global.fetch = jest.fn();

// ── Imports after mocks ───────────────────────────────────────────────────────

import { useUser } from "@clerk/nextjs";
import InventoryPage from "@/app/(app)/inventory/page";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function mockAsAdmin(systemAdmin = false) {
  (useUser as jest.Mock).mockReturnValue({
    user: { publicMetadata: systemAdmin ? { systemAdmin: true } : { storeAdmin: true } },
  });
}

function mockAsWorker() {
  (useUser as jest.Mock).mockReturnValue({ user: { publicMetadata: {} } });
}

const PRODUCTO = {
  id: "p1",
  nombre: "Alimento Premium",
  sku: "SKU-001",
  precio: 10000,
  costo: null,
  stock: 15,
  stock_minimo: 5,
  marca: null,
  peso_gramos: null,
  fecha_vencimiento: null,
  dias_alerta_expira: 30,
  precio_oferta: null,
  en_oferta: false,
  categoria_id: null,
  codigo_barra: null,
};

const PRODUCTO_BAJO_STOCK = { ...PRODUCTO, id: "p2", nombre: "Snack Perro", stock: 3, stock_minimo: 5 };

function setupFetch(productos = [PRODUCTO]) {
  (global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
    const u = url.toString();
    if (u.includes("/api/inventario")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(productos) } as Response);
    }
    if (u.includes("/api/categorias")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InventoryPage — tabs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetch();
  });

  // C-07
  it("C-07: admin ve tab bar con Productos y Categorías", () => {
    mockAsAdmin();
    render(<InventoryPage />, { wrapper: makeWrapper() });

    expect(screen.getByRole("button", { name: "Productos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Categorías" })).toBeInTheDocument();
  });

  // C-08
  it("C-08: worker NO ve tab bar", () => {
    mockAsWorker();
    render(<InventoryPage />, { wrapper: makeWrapper() });

    expect(screen.queryByRole("button", { name: "Productos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Categorías" })).not.toBeInTheDocument();
  });

  // C-09
  it("C-09: click en tab Categorías muestra CategoriasTab", () => {
    mockAsAdmin();
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: "Categorías" }));

    expect(screen.getByTestId("categorias-tab")).toBeInTheDocument();
  });

  // C-10
  it("C-10: click en tab Categorías oculta la tabla de productos", () => {
    mockAsAdmin();
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: "Categorías" }));

    // la barra de búsqueda de productos desaparece
    expect(screen.queryByPlaceholderText("Buscar por nombre o SKU...")).not.toBeInTheDocument();
  });
});

describe("InventoryPage — lista de productos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsAdmin();
  });

  // C-11
  it("C-11: muestra nombre y precio de productos al cargar", async () => {
    setupFetch([PRODUCTO]);
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Alimento Premium")).toBeInTheDocument()
    );
    expect(screen.getByText("$10.000")).toBeInTheDocument();
  });

  // C-12
  it("C-12: producto con stock <= stock_minimo muestra badge 'Bajo stock'", async () => {
    setupFetch([PRODUCTO_BAJO_STOCK]);
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Snack Perro")).toBeInTheDocument()
    );

    expect(screen.getByText("Bajo stock")).toBeInTheDocument();
  });

  // C-13
  it("C-13: producto con stock > stock_minimo muestra badge 'OK'", async () => {
    setupFetch([PRODUCTO]);
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Alimento Premium")).toBeInTheDocument()
    );

    expect(screen.getByText("OK")).toBeInTheDocument();
  });
});

describe("InventoryPage — formulario de producto", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsAdmin();
    setupFetch();
  });

  // C-14
  it("C-14: '+ Nuevo producto' abre el modal de creación", () => {
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo producto/i }));

    expect(screen.getByText("Nuevo producto")).toBeInTheDocument();
  });

  // C-15
  it("C-15: Cancelar en el modal de creación cierra el formulario", () => {
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo producto/i }));
    expect(screen.getByText("Nuevo producto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText("Nuevo producto")).not.toBeInTheDocument();
  });
});
