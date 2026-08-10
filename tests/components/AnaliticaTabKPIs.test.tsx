/**
 * Tests DA-07 a DA-09: AnaliticaTab — KPIs "Ventas hoy", "Transacciones" y
 * "Ticket promedio" reflejan las métricas consistentes del backend.
 *
 * Regresión (ticket Trello 6a77edec41f13cebd89d3d1e): el endpoint /api/dashboard
 * excluía las ventas 100% devueltas del monto de "Ventas hoy" pero las seguía
 * contando en "Transacciones", distorsionando "Ticket promedio". Este test
 * renderiza los KPICard REALES (no mockeados) con el payload corregido que
 * devuelve el endpoint para probar que la UI muestra el número neto de
 * transacciones y un ticket promedio consistente — no es una prueba de la
 * lógica de negocio (que vive en el servidor y la cubre I-510/I-511), sino del
 * contrato de presentación.
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import AnaliticaTab from "@/app/(app)/dashboard/components/AnaliticaTab";

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

// NOTA: KPICard NO se mockea — el objetivo es probar que los KPIs reales
// muestran los valores corregidos del endpoint.

// Escenario del ticket: 3 ventas (A $15.458 y C $12.990 devueltas al 100%,
// B $8.990 sin devolver) → el endpoint corrige a transacciones=1, promedio=$8.990.
const DASHBOARD_BODY = {
  ventasHoy: 8990,
  transacciones: 1,
  ticketPromedio: 8990,
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
  return function TestWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function setup() {
  render(<AnaliticaTab />, { wrapper: makeWrapper() });
}

describe("AnaliticaTab — KPIs consistentes (Transacciones netas / Ticket promedio)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockImplementation(mockFetch);
    endpoints = [
      { path: "/api/dashboard", ok: true, status: 200, body: DASHBOARD_BODY },
      { path: "/api/recompras", ok: true, status: 200, body: [] },
      { path: "/api/dashboard/stock-alertas", ok: true, status: 200, body: { total: 0, items: [] } },
      { path: "/api/dashboard/vencimientos", ok: true, status: 200, body: VENCIMIENTOS_BODY },
    ];
  });

  // DA-07: REGRESIÓN (ticket 6a77edec41f13cebd89d3d1e) — la UI muestra el
  // número NETO de transacciones y un Ticket promedio consistente con Ventas
  // hoy (ambas tarjetas en $8.990 en el escenario del ticket).
  it("DA-07: muestra Transacciones netas y Ticket promedio consistente con Ventas hoy", async () => {
    setup();

    expect(await screen.findByText("Ventas hoy")).toBeInTheDocument();
    expect(screen.getByText("Transacciones")).toBeInTheDocument();
    expect(screen.getByText("Ticket promedio")).toBeInTheDocument();

    // Ventas hoy y Ticket promedio convergen a $8.990 (antes del fix: promedio $2.997).
    expect(screen.getAllByText("$8.990")).toHaveLength(2);
    // Solo la venta no devuelta cuenta como transacción.
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("efectivo")).toBeInTheDocument();
  });

  // DA-08: con más de una transacción, la tarjeta muestra el conteo y el
  // promedio formateado según el payload del endpoint.
  it("DA-08: muestra N transacciones y el ticket promedio formateado", async () => {
    endpoints = endpoints.map((e) =>
      e.path === "/api/dashboard"
        ? { ...e, body: { ...DASHBOARD_BODY, ventasHoy: 45000, transacciones: 2, ticketPromedio: 22500 } }
        : e
    );
    setup();

    expect(await screen.findByText("Ventas hoy")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText("$45.000")).toHaveLength(1);
    expect(screen.getByText("$22.500")).toBeInTheDocument();
  });

  // DA-09: sin ventas, el endpoint responde 0 — la UI no muestra NaN.
  it("DA-09: sin ventas muestra $0 y 0 transacciones sin NaN", async () => {
    endpoints = endpoints.map((e) =>
      e.path === "/api/dashboard"
        ? { ...e, body: { ...DASHBOARD_BODY, ventasHoy: 0, transacciones: 0, ticketPromedio: 0 } }
        : e
    );
    setup();

    expect(await screen.findByText("Ventas hoy")).toBeInTheDocument();
    expect(screen.getAllByText("$0")).toHaveLength(2); // Ventas hoy y Ticket promedio
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("NaN")).not.toBeInTheDocument();
  });
});
