/**
 * DPM-C-01…06: "Métodos de pago hoy" en el Dashboard. El cálculo vive en el
 * servidor (DPM-I-01…05); aquí se prueba la presentación.
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import PagosPorMetodo from "@/app/(app)/dashboard/components/PagosPorMetodo";
import AnaliticaTab from "@/app/(app)/dashboard/components/AnaliticaTab";

const DATA = [
  { metodo: "debito", total: 24000, transacciones: 2 },
  { metodo: "efectivo", total: 10000, transacciones: 3 },
  { metodo: "saldo_a_favor", total: 1500, transacciones: 1 },
];
const region = () => screen.findByRole("region", { name: "Métodos de pago hoy" });

describe("PagosPorMetodo", () => {
  it("DPM-C-01: un renglón por medio con etiqueta legible, ventas y monto, en el orden recibido, y el total", () => {
    render(<PagosPorMetodo data={DATA} />);
    const filas = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(filas).toEqual(["Débito (2)$24.000", "Efectivo (3)$10.000", "Saldo a favor (1)$1.500"]);
    expect(screen.getByText("Total cobrado").nextSibling).toHaveTextContent("$35.500");
    expect(screen.getByText(/sin descontar devoluciones/)).toBeInTheDocument();
  });

  it("DPM-C-02: sin ventas → estado vacío, sin total", () => {
    render(<PagosPorMetodo data={[]} />);
    expect(screen.getByText("Sin ventas hoy")).toBeInTheDocument();
    expect(screen.queryByText("Total cobrado")).not.toBeInTheDocument();
  });

  it("DPM-C-03: sin el campo en la respuesta no se renderiza (no inventa un $0)", () => {
    const { container } = render(<PagosPorMetodo />);
    expect(container).toBeEmptyDOMElement();
  });

  it("DPM-C-04: total $0 (ventas con 100 % de descuento) no produce NaN", () => {
    const { container } = render(<PagosPorMetodo data={[{ metodo: "efectivo", total: 0, transacciones: 1 }]} />);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(screen.getByText("Efectivo")).toBeInTheDocument();
  });
});

describe("AnaliticaTab — métodos de pago hoy", () => {
  function setup(dashOk: boolean) {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: url === "/api/dashboard" ? dashOk : true,
        json: async () =>
          url === "/api/dashboard"
            ? {
                ventasHoy: 35500, transacciones: 5, ticketPromedio: 7100, topMetodo: "efectivo", pagosPorMetodo: DATA,
                topProductos: [], ultimasVentas: [], alertas: [], ventasPorCanal: [], ventasPorProcedencia: [],
              }
            : url === "/api/recompras" ? []
            : url.includes("stock-alertas") ? { total: 0, items: [] }
            : { vencidos: [], proximos: [], lotes: { vencidos: [], proximos: [] } },
      })
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    render(<AnaliticaTab />, { wrapper });
  }

  it("DPM-C-05: muestra los medios que devuelve GET /api/dashboard", async () => {
    setup(true);
    expect(within(await region()).getByText("$24.000")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/dashboard");
  });

  it("DPM-C-06: si GET /api/dashboard falla, se muestra el error y ningún monto", async () => {
    setup(false);
    expect(await screen.findByText("Error al cargar el dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Métodos de pago hoy")).not.toBeInTheDocument();
  });
});
