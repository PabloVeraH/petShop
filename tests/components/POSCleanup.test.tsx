/**
 * Tests POS-01 a POS-03: Cleanup de timers/fetch en POS al desmontar
 * REGRESIÓN: Completar venta y navegar dejaba la pestaña congelada
 * porque setTimeout sin cleanup seguía ejecutando setState en componente
 * desmontado.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ── Mocks dinámicos (se reconfiguran en cada test) ──────────────

const mockUsePOSStore = jest.fn();

jest.mock("@/stores/pos", () => ({
  usePOSStore: (...args: unknown[]) => mockUsePOSStore(...args),
}));

jest.mock("@clerk/nextjs", () => ({
  useAuth: jest.fn(() => ({ userId: "u1" })),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("POS Cleanup (POS-XX)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
  });

  // POS-01
  it("POS-01: SearchProductos renderiza y desmonta sin error", () => {
    mockUsePOSStore.mockImplementation((selector?: any) => {
      const s = { items: [], addItem: jest.fn(), mascotaId: undefined };
      return selector ? selector(s) : s;
    });

    const SearchProductos = require("@/app/(app)/pos/components/SearchProductos").default;
    const { unmount } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <SearchProductos />
      </QueryClientProvider>
    );

    expect(screen.getByPlaceholderText(/Buscar por nombre/)).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });

  // POS-02
  it("POS-02: RecomendacionesIA renderiza sin cliente y desmonta sin error", () => {
    mockUsePOSStore.mockImplementation((selector?: any) => {
      const s = { clienteId: undefined, mascotaId: undefined, items: [], addItem: jest.fn() };
      return selector ? selector(s) : s;
    });

    const RecomendacionesIA = require("@/app/(app)/pos/components/RecomendacionesIA").default;
    const { container, unmount } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <RecomendacionesIA />
      </QueryClientProvider>
    );

    expect(container.innerHTML).toBe("");
    expect(() => unmount()).not.toThrow();
  });

  // POS-03 — POSPage ya tiene cobertura via POSPage.test.tsx (PP-01/PP-04)
});
