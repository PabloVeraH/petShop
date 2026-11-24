/**
 * Tests C-105 a C-110: total "a boletear" (pago mixto F10) en el componente
 * MontoBoleta y en Reportes (el Dashboard ya no lo muestra, C-110).
 * El cálculo vive en el servidor (I-817); aquí se prueba la presentación.
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import MontoBoleta from "@/app/(app)/dashboard/components/MontoBoleta";

jest.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: { publicMetadata: { storeAdmin: true } } }) }));

import ReportesTab from "@/app/(app)/dashboard/components/ReportesTab";
import AnaliticaTab from "@/app/(app)/dashboard/components/AnaliticaTab";

const ETIQUETA = "A boletear (no cubierto por voucher)";

describe("MontoBoleta", () => {
  it("C-105: muestra el total y el desglose por método con etiquetas legibles", () => {
    render(<MontoBoleta monto={13500} porMetodo={{ efectivo: 8000, nota_credito: 5500 }} />);
    expect(screen.getByText(ETIQUETA)).toBeInTheDocument();
    expect(screen.getByText("$13.500")).toBeInTheDocument();
    expect(screen.getByText("Efectivo: $8.000")).toBeInTheDocument();
    expect(screen.getByText("Nota de crédito: $5.500")).toBeInTheDocument();
  });

  it("C-106: estado vacío (solo tarjeta o sin ventas) → $0 y 'Sin montos a boletear'", () => {
    render(<MontoBoleta monto={0} porMetodo={{}} />);
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByText("Sin montos a boletear")).toBeInTheDocument();
  });

  it("C-107: sin el campo en la respuesta no se renderiza (no inventa un $0)", () => {
    const { container } = render(<MontoBoleta />);
    expect(container).toBeEmptyDOMElement();
  });
});

const REPORTS = {
  periodo: 30, totalPeriodo: 37000, totalTransacciones: 4, ticketPromedio: 9250,
  ventasPorDia: [], topProductos: [], topClientes: [],
  metodos: { efectivo: 8000, debito: 12000 }, canales: {}, procedencias: {},
  prediccion7dias: null, promedioDiario: 1233,
  montoBoleta: 8000, boletaPorMetodo: { efectivo: 8000 },
};

describe("ReportesTab — a boletear", () => {
  it("C-108: muestra el total a boletear que devuelve /api/reports", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => REPORTS });
    render(<ReportesTab />);
    expect(await screen.findByText(ETIQUETA)).toBeInTheDocument();
    expect(screen.getByText("Efectivo: $8.000")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/reports?periodo=30");
  });

  it("C-109: período sin montos a boletear → estado vacío", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...REPORTS, montoBoleta: 0, boletaPorMetodo: {} }) });
    render(<ReportesTab />);
    expect(await screen.findByText("Sin montos a boletear")).toBeInTheDocument();
  });
});

describe("AnaliticaTab — a boletear", () => {
  // Pedido de la tienda (2026-11-24): en el Dashboard solo va "Métodos de pago hoy".
  it("C-110: el Dashboard no muestra el total a boletear, aunque la respuesta lo trajera", async () => {
    const dashboard = {
      ventasHoy: 17000, transacciones: 1, ticketPromedio: 17000, topMetodo: "debito",
      topProductos: [], ultimasVentas: [], alertas: [], ventasPorCanal: [], ventasPorProcedencia: [],
      montoBoleta: 5000, boletaPorMetodo: { efectivo: 5000 },
    };
    global.fetch = jest.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/dashboard" ? dashboard
            : url === "/api/recompras" ? []
            : url.includes("stock-alertas") ? { total: 0, items: [] }
            : { vencidos: [], proximos: [], lotes: { vencidos: [], proximos: [] } },
      })
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    render(<AnaliticaTab />, { wrapper });
    expect(await screen.findByText("Ventas hoy")).toBeInTheDocument();
    expect(screen.queryByText(ETIQUETA)).not.toBeInTheDocument();
  });
});
