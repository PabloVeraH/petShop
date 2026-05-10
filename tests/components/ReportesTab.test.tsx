/**
 * Tests RC-01 a RC-13: ReportesTab — renderizado, PieChart y tooltip
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_DATA = {
  periodo: 30,
  totalPeriodo: 875136,
  totalTransacciones: 11,
  ticketPromedio: 79558,
  ventasPorDia: [["2026-04-10", 100000]] as [string, number][],
  topProductos: [{ nombre: "Alimento Premium", cantidad: 5, revenue: 50000 }],
  topClientes: [{ nombre: "Juan Pérez", total: 50000, compras: 2 }],
  metodos: { efectivo: 500000 },
  // pos 80%, rappi 20%
  canales: {
    pos:   { total: 700000, transacciones: 8 },
    rappi: { total: 175136, transacciones: 3 },
  },
  // presencial 65%, instagram 32%, whatsapp 3%
  procedencias: {
    presencial: { total: 568211, transacciones: 8 },
    instagram:  { total: 280150, transacciones: 3 },
    whatsapp:   { total: 26775,  transacciones: 1 },
  },
  prediccion7dias: 200000,
  promedioDiario: 28571,
};

// ── Fetch mock ────────────────────────────────────────────────────────────────

global.fetch = jest.fn();

function mockFetch(data: object = MOCK_DATA) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => data });
}

// ── Import after mocks ────────────────────────────────────────────────────────

import ReportesTab from "@/app/(app)/dashboard/components/ReportesTab";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup(data: object = MOCK_DATA) {
  mockFetch(data);
  render(<ReportesTab />);
}

async function waitForData() {
  await waitFor(() =>
    expect(screen.getByText("Total Ventas período")).toBeInTheDocument(),
  );
}

// ── Suite: renderizado básico ─────────────────────────────────────────────────

describe("ReportesTab — renderizado básico", () => {
  // RC-01
  it("RC-01: muestra 'Cargando...' mientras la petición está en vuelo", () => {
    (global.fetch as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
    render(<ReportesTab />);
    expect(screen.getByText("Cargando...")).toBeInTheDocument();
  });

  // RC-02
  it("RC-02: renderiza KPIs con los valores formateados tras cargar datos", async () => {
    setup();
    await waitForData();
    // totalPeriodo: fmt(875136) = "$875.136" en es-CL
    expect(screen.getByText("$875.136")).toBeInTheDocument();
    // totalTransacciones
    expect(screen.getByText("11")).toBeInTheDocument();
  });

  // RC-03
  it("RC-03: renderiza el encabezado 'Ventas por canal' cuando hay datos", async () => {
    setup();
    await waitForData();
    expect(screen.getByText("Ventas por canal")).toBeInTheDocument();
  });

  // RC-04
  it("RC-04: oculta la sección 'Ventas por canal' cuando canales está vacío", async () => {
    setup({ ...MOCK_DATA, canales: {} });
    await waitForData();
    expect(screen.queryByText("Ventas por canal")).not.toBeInTheDocument();
  });

  // RC-05
  it("RC-05: renderiza el encabezado 'Procedencia de ventas' cuando hay datos", async () => {
    setup();
    await waitForData();
    expect(screen.getByText("Procedencia de ventas")).toBeInTheDocument();
  });

  // RC-06
  it("RC-06: oculta la sección 'Procedencia de ventas' cuando procedencias está vacío", async () => {
    setup({ ...MOCK_DATA, procedencias: {} });
    await waitForData();
    expect(screen.queryByText("Procedencia de ventas")).not.toBeInTheDocument();
  });
});

// ── Suite: PieChart — etiquetas de porcentaje ─────────────────────────────────

describe("ReportesTab — PieChart etiquetas de porcentaje", () => {
  // RC-07
  it("RC-07: muestra etiquetas de % en tramos ≥ 5% (canales: POS 80%, Rappi 20%)", async () => {
    setup();
    await waitForData();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
  });

  // RC-08
  it("RC-08: omite etiqueta de % en tramos < 5% (whatsapp ≈ 3%)", async () => {
    setup();
    await waitForData();
    expect(screen.queryByText("3%")).not.toBeInTheDocument();
  });

  // RC-09
  it("RC-09: renderiza la leyenda con el nombre de cada procedencia", async () => {
    setup();
    await waitForData();
    expect(screen.getByText("Presencial")).toBeInTheDocument();
    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
  });

  // RC-10
  it("RC-10: muestra 'Sin datos' cuando todos los totales del gráfico son 0", async () => {
    setup({
      ...MOCK_DATA,
      canales:     { pos: { total: 0, transacciones: 0 } },
      procedencias: { presencial: { total: 0, transacciones: 0 } },
    });
    await waitForData();
    const sinDatos = screen.getAllByText("Sin datos");
    // Un "Sin datos" por cada PieChart (canales y procedencias)
    expect(sinDatos.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Suite: PieChart — tooltip ─────────────────────────────────────────────────

describe("ReportesTab — PieChart tooltip", () => {
  // RC-11
  it("RC-11: muestra tooltip con nombre, monto y cantidad de ventas al entrar en un tramo de canal", async () => {
    setup();
    await waitForData();

    // Los paths de canales están en el primer SVG del DOM.
    // El primer path corresponde al canal con mayor total: pos (700 000 → 80%)
    const firstCanalPath = document.querySelectorAll("svg")[0].querySelector("path")!;
    fireEvent.mouseEnter(firstCanalPath, { clientX: 100, clientY: 100 });

    await waitFor(() => expect(screen.getByText("$700.000")).toBeInTheDocument());
    expect(screen.getByText("8 ventas")).toBeInTheDocument();
  });

  // RC-12
  it("RC-12: oculta el tooltip al salir del tramo", async () => {
    setup();
    await waitForData();

    const firstCanalPath = document.querySelectorAll("svg")[0].querySelector("path")!;
    fireEvent.mouseEnter(firstCanalPath, { clientX: 100, clientY: 100 });
    await waitFor(() => expect(screen.getByText("$700.000")).toBeInTheDocument());

    fireEvent.mouseLeave(firstCanalPath);
    await waitFor(() => expect(screen.queryByText("$700.000")).not.toBeInTheDocument());
  });
});

// ── Suite: selector de período ────────────────────────────────────────────────

describe("ReportesTab — selector de período", () => {
  // RC-13
  it("RC-13: al hacer click en '7 días' re-fetch con periodo=7", async () => {
    setup();
    await waitForData();

    mockFetch();
    fireEvent.click(screen.getByText("7 días"));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("periodo=7")),
    );
  });
});
