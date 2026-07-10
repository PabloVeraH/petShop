/**
 * Tests DA-01 a DA-06: AnaliticaTab — widget "Stock bajo mínimo"
 * DA-01: Sin alertas → muestra "Todo el stock sobre mínimo"
 * DA-02: Con alertas → lista productos y contador
 * DA-03: stock === stock_minimo → considerado alerta (regresión operador < vs <=)
 * DA-04: stock=0, mínimo=0 → considerado alerta
 * DA-05: fetch de stock-alertas falla → widget vacío sin error
 * DA-06: contador muestra el total real, no el largo de la lista recortada a 10
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

jest.mock("@/app/(app)/dashboard/components/KPICard", () => ({
  __esModule: true,
  default: () => <div data-testid="kpi-card" />,
}));

jest.mock("@/app/(app)/dashboard/components/TopProductos", () => ({
  __esModule: true,
  default: () => <div data-testid="top-productos" />,
}));

jest.mock("@/app/(app)/dashboard/components/UltimasVentas", () => ({
  __esModule: true,
  default: () => <div data-testid="ultimas-ventas" />,
}));

jest.mock("@/app/(app)/dashboard/components/AlertasConsumo", () => ({
  __esModule: true,
  default: () => <div data-testid="alertas-consumo" />,
}));

jest.mock("@/app/(app)/dashboard/components/SugerenciasRecompra", () => ({
  __esModule: true,
  default: () => <div data-testid="sugerencias-recompra" />,
}));

jest.mock("@/app/(app)/dashboard/components/VentasPorCanal", () => ({
  __esModule: true,
  default: () => <div data-testid="ventas-canal" />,
}));

jest.mock("@/app/(app)/dashboard/components/VentasPorProcedencia", () => ({
  __esModule: true,
  default: () => <div data-testid="ventas-procedencia" />,
}));

const DASHBOARD_BODY = {
  ventasHoy: 150000,
  transacciones: 12,
  ticketPromedio: 12500,
  topMetodo: "efectivo",
  topProductos: [],
  ultimasVentas: [],
  alertas: [],
  ventasPorCanal: [],
  ventasPorProcedencia: [],
};

const VENCIMIENTOS_BODY = {
  vencidos: [],
  proximos: [],
  lotes: { vencidos: [], proximos: [] },
  totalUnidadesVencidas: 0,
};

type Endpoint = {
  path: string;
  ok: boolean;
  status: number;
  body: unknown;
};

let endpoints: Endpoint[] = [];

function mockFetch(url: string | Request): Promise<Response> {
  const urlStr = typeof url === "string" ? url : url.url;
  const sorted = [...endpoints].sort((a, b) => b.path.length - a.path.length);
  const match = sorted.find((e) => urlStr.includes(e.path));
  if (match) {
    return Promise.resolve({
      ok: match.ok,
      status: match.status,
      json: async () => match.body,
    } as Response);
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function setup() {
  const { default: AnaliticaTab } = require("@/app/(app)/dashboard/components/AnaliticaTab");
  render(<AnaliticaTab />, { wrapper: makeWrapper() });
}

describe("AnaliticaTab — widget Stock bajo mínimo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockImplementation(mockFetch);
    endpoints = [
      { path: "/api/dashboard", ok: true, status: 200, body: DASHBOARD_BODY },
      { path: "/api/dashboard/vencimientos", ok: true, status: 200, body: VENCIMIENTOS_BODY },
    ];
  });

  // DA-01
  it("DA-01: sin alertas muestra 'Todo el stock sobre mínimo'", async () => {
    endpoints.push({ path: "/api/dashboard/stock-alertas", ok: true, status: 200, body: { total: 0, items: [] } });
    setup();

    await waitFor(() => {
      expect(screen.getByText("Todo el stock sobre mínimo")).toBeInTheDocument();
    });
  });

  // DA-02
  it("DA-02: con alertas lista productos y muestra contador", async () => {
    const items = [
      { id: "p1", nombre: "Alimento X", sku: "ALI-X", stock: 2, stock_minimo: 10 },
      { id: "p2", nombre: "Collar Y", sku: "COL-Y", stock: 1, stock_minimo: 5 },
    ];
    endpoints.push({
      path: "/api/dashboard/stock-alertas",
      ok: true,
      status: 200,
      body: { total: items.length, items },
    });
    setup();

    await waitFor(() => {
      expect(screen.getByText("Alimento X")).toBeInTheDocument();
      expect(screen.getByText("Collar Y")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument(); // badge de contador
    });
  });

  // DA-03 — regresión: operador < vs <=
  it("DA-03: stock igual al mínimo se considera alerta (regresión)", async () => {
    endpoints.push({
      path: "/api/dashboard/stock-alertas",
      ok: true,
      status: 200,
      body: {
        total: 1,
        items: [{ id: "p-coll", nombre: "Collar Ajustable M", sku: "COLLAR-M", stock: 5, stock_minimo: 5 }],
      },
    });
    setup();

    await waitFor(() => {
      expect(screen.getByText("Collar Ajustable M")).toBeInTheDocument();
      expect(screen.getByText("5 / 5")).toBeInTheDocument();
    });

    expect(screen.queryByText("Todo el stock sobre mínimo")).not.toBeInTheDocument();
  });

  // DA-04
  it("DA-04: stock=0, mínimo=0 se considera alerta", async () => {
    endpoints.push({
      path: "/api/dashboard/stock-alertas",
      ok: true,
      status: 200,
      body: {
        total: 1,
        items: [{ id: "p-zero", nombre: "Producto Cero", sku: "ZERO", stock: 0, stock_minimo: 0 }],
      },
    });
    setup();

    await waitFor(() => {
      expect(screen.getByText("Producto Cero")).toBeInTheDocument();
    });
  });

  // DA-05
  it("DA-05: fetch de stock-alertas falla → widget muestra vacío sin error", async () => {
    endpoints.push({
      path: "/api/dashboard/stock-alertas",
      ok: false,
      status: 500,
      body: { error: "Error" },
    });
    setup();

    await waitFor(() => {
      expect(screen.getByText("Todo el stock sobre mínimo")).toBeInTheDocument();
    });
  });

  // DA-06 — REGRESIÓN: el widget debe mostrar el TOTAL real de productos bajo
  // mínimo en el contador, no la cantidad de items de la lista recortada
  // (el endpoint limita a 10). Antes de este fix, el contador usaba
  // items.length y mostraba "10" en vez de "13", discrepando con Inventario
  // igual que el bug original reportado.
  it("DA-06: con más de 10 alertas, el contador muestra el total real (no el largo de la lista recortada)", async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `p-${i}`,
      nombre: `Producto ${i}`,
      sku: `SKU-${i}`,
      stock: i,
      stock_minimo: 10,
    }));
    endpoints.push({
      path: "/api/dashboard/stock-alertas",
      ok: true,
      status: 200,
      body: { total: 13, items },
    });
    setup();

    await waitFor(() => {
      expect(screen.getByText("Producto 0")).toBeInTheDocument();
    });

    expect(screen.getByText("13")).toBeInTheDocument();
    expect(screen.queryByText("10")).not.toBeInTheDocument();
  });
});
