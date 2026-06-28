/**
 * Tests VS-01 a VS-05: SalesPage — tabla de historial de ventas
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const MOCK_VENTAS = {
  data: [
    {
      id: "v1",
      total: 50000,
      metodo_pago: "efectivo",
      estado: "completada",
      created_at: "2026-06-01T10:00:00.000Z",
      numero_comprobante: "001",
      clientes: { nombre: "Juan Pérez" },
    },
    {
      id: "v2",
      total: 25000,
      metodo_pago: "debito",
      estado: "anulada",
      created_at: "2026-05-28T14:30:00.000Z",
      numero_comprobante: "002",
      clientes: null,
    },
  ],
  count: 2,
};

let fetchMock: jest.Mock;
let currentFetchUrl = "";

beforeEach(() => {
  fetchMock = jest.fn().mockImplementation((url: string) => {
    currentFetchUrl = url;
    if (url.includes("/api/ventas")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_VENTAS) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock as any;
});

afterEach(() => {
  jest.restoreAllMocks();
});

jest.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: jest.fn() }),
  usePathname: () => "/sales",
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("SalesPage — historial de ventas", () => {
  it("VS-01: renderiza loading state y luego la tabla con datos", async () => {
    render(await import("@/app/(app)/sales/page").then((m) => <m.default />), {
      wrapper: makeWrapper(),
    });

    expect(screen.getByText("Cargando...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("001")).toBeInTheDocument();
    });

    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    expect(screen.getByText("Anulada")).toBeInTheDocument();
  });

  it("VS-02: aplica filtro desde por defecto (90 días atrás)", async () => {
    render(await import("@/app/(app)/sales/page").then((m) => <m.default />), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const ventasCalls = fetchMock.mock.calls.filter(
      ([url]: string[]) => typeof url === "string" && url.includes("/api/ventas"),
    );

    expect(ventasCalls.length).toBeGreaterThanOrEqual(1);
    const firstCall = ventasCalls[0][0] as string;
    expect(firstCall).toContain("desde=");
  });

  it("VS-03: muestra enlace 'Ver ticket' para cada venta", async () => {
    render(await import("@/app/(app)/sales/page").then((m) => <m.default />), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(screen.getAllByText("Ver ticket")).toHaveLength(2);
    });

    const links = screen.getAllByText("Ver ticket");
    expect(links[0]).toHaveAttribute("href", "/sales/v1");
    expect(links[1]).toHaveAttribute("href", "/sales/v2");
  });

  it("VS-04: paginación oculta cuando total <= 50", async () => {
    render(await import("@/app/(app)/sales/page").then((m) => <m.default />), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText("001")).toBeInTheDocument();
    });

    expect(screen.queryByText("Ant.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sig.")).not.toBeInTheDocument();
  });

  it("VS-05: search input se renderiza con placeholder", async () => {
    render(await import("@/app/(app)/sales/page").then((m) => <m.default />), {
      wrapper: makeWrapper(),
    });

    expect(
      screen.getByPlaceholderText("Buscar por cliente o nº de venta..."),
    ).toBeInTheDocument();
  });
});
