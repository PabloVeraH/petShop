/**
 * Tests RC-01 a RC-16 y RHV-C-01 a RHV-C-11: ReportesTab — renderizado, PieChart, tooltip y export CSV
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_DATA = {
  periodo: 30,
  totalPeriodo: 875136,
  totalTransacciones: 11,
  ticketPromedio: 79558,
  ventasPorDia: [["2026-04-10", { total: 100000, transacciones: 3 }]] as [string, { total: number; transacciones: number }][],
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

// Por defecto (lista de vendedores, GET /api/workers): vacía. Cada test
// antepone con mockFetch() la respuesta de /api/reports.
global.fetch = jest.fn();
beforeEach(() => {
  (global.fetch as jest.Mock).mockReset().mockResolvedValue({ ok: true, json: async () => [] });
});

// Sesión de Clerk en el cliente: admin por defecto (botones de export visibles).
let mockUserMeta: Record<string, unknown> = { storeAdmin: true };
jest.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: { publicMetadata: mockUserMeta } }) }));

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
    // svg[0] = DayChart, svg[1] = PieChart canales
    const firstCanalPath = document.querySelectorAll("svg")[1].querySelector("path")!;
    fireEvent.mouseEnter(firstCanalPath, { clientX: 100, clientY: 100 });

    await waitFor(() => expect(screen.getByText("$700.000")).toBeInTheDocument());
    expect(screen.getByText("8 ventas")).toBeInTheDocument();
  });

  // RC-12
  it("RC-12: oculta el tooltip al salir del tramo", async () => {
    setup();
    await waitForData();

    // svg[0] = DayChart, svg[1] = PieChart canales
    const firstCanalPath = document.querySelectorAll("svg")[1].querySelector("path")!;
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

// ── Suite: export CSV (solo admins) ──────────────────────────────────────────
// El gate de la UI es conveniencia: el control real es GET /api/reports/export
// → 403 para quien no sea storeAdmin de la tienda ni systemAdmin (I-746).

describe("ReportesTab — export CSV", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserMeta = { storeAdmin: true };
  });

  it("RC-14: el storeWorker no ve los botones de export; storeAdmin y systemAdmin sí", async () => {
    mockUserMeta = {};
    mockFetch();
    const { unmount } = render(<ReportesTab />);
    expect(screen.queryByText("↓ Ventas CSV")).not.toBeInTheDocument();
    expect(screen.queryByText("↓ Inventario CSV")).not.toBeInTheDocument();
    unmount();

    for (const meta of [{ storeAdmin: true }, { systemAdmin: true }]) {
      mockUserMeta = meta;
      mockFetch();
      const r = render(<ReportesTab />);
      expect(screen.getByText("↓ Ventas CSV")).toBeInTheDocument();
      expect(screen.getByText("↓ Inventario CSV")).toBeInTheDocument();
      r.unmount();
    }
  });

  it("RC-15: 'Ventas CSV' pide /api/reports/export con el período en pantalla y descarga el archivo", async () => {
    setup();
    await waitForData();
    const click = jest.fn();
    const origCreate = document.createElement.bind(document);
    const spy = jest.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "a" ? ({ click, href: "", download: "" } as unknown as HTMLAnchorElement) : origCreate(tag));
    (URL as unknown as Record<string, unknown>).createObjectURL = jest.fn(() => "blob:x");
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(["a,b"]) });

    fireEvent.click(screen.getByText("↓ Ventas CSV"));

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenLastCalledWith("/api/reports/export?tipo=ventas&periodo=30");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it("RC-16: si la API rechaza (403) muestra el error y no descarga nada", async () => {
    setup();
    await waitForData();
    const click = jest.fn();
    const origCreate = document.createElement.bind(document);
    const spy = jest.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "a" ? ({ click, href: "", download: "" } as unknown as HTMLAnchorElement) : origCreate(tag));
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });

    fireEvent.click(screen.getByText("↓ Ventas CSV"));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo exportar: No tienes permiso para exportar.");
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByText("↓ Ventas CSV")).not.toBeDisabled();
    spy.mockRestore();
  });
});

// ── Suite: "Hoy" y filtro por vendedor (pedido de la tienda 2026-11-24) ──────

describe("ReportesTab — Hoy y vendedor", () => {
  const VENDEDORES = [
    { clerk_id: "user_ana", nombre: "Ana Peña", email: "ana@x.cl" },
    { clerk_id: "user_sin", nombre: null, email: "sin@x.cl" },
  ];
  const llamadas = () => (global.fetch as jest.Mock).mock.calls.map(([u]) => String(u));
  const reportes = () => llamadas().filter((u) => u.startsWith("/api/reports?"));

  // Responde según la URL; `reporte` permite variar /api/reports por prueba.
  function rutas(reporte: (u: string) => unknown = () => ({ ok: true, json: async () => MOCK_DATA })) {
    (global.fetch as jest.Mock).mockReset().mockImplementation((url: string) => {
      if (url === "/api/workers") return Promise.resolve({ ok: true, json: async () => VENDEDORES });
      if (url.startsWith("/api/reports/export")) return Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(["a"]) });
      return Promise.resolve(reporte(url));
    });
  }

  function capturarDescarga() {
    const enlace = { click: jest.fn(), href: "", download: "" };
    const orig = document.createElement.bind(document);
    const spy = jest.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "a" ? (enlace as unknown as HTMLAnchorElement) : orig(tag));
    (URL as unknown as Record<string, unknown>).createObjectURL = jest.fn(() => "blob:x");
    return { enlace, spy };
  }

  beforeEach(() => { mockUserMeta = { storeAdmin: true }; rutas(); });

  it("RHV-C-01: 'Hoy' va antes de '7 días' y pide periodo=hoy", async () => {
    render(<ReportesTab />);
    await waitForData();
    const botones = screen.getAllByRole("button").map((b) => b.textContent);
    expect(botones.slice(0, 4)).toEqual(["Hoy", "7 días", "30 días", "90 días"]);
    fireEvent.click(screen.getByText("Hoy"));
    await waitFor(() => expect(reportes().at(-1)).toBe("/api/reports?periodo=hoy"));
  });

  it("RHV-C-02: con Hoy la predicción dice 'No aplica' (no 'Mínimo 10 ventas')", async () => {
    rutas(() => ({ ok: true, json: async () => ({ ...MOCK_DATA, periodo: "hoy", prediccion7dias: null }) }));
    render(<ReportesTab />);
    await waitForData();
    expect(screen.getByText("No aplica")).toBeInTheDocument();
    expect(screen.getByText("Elige 7 días o más")).toBeInTheDocument();
    expect(screen.queryByText("Mínimo 10 ventas requeridas")).not.toBeInTheDocument();
  });

  it("RHV-C-03: el selector lista a los vendedores (sin nombre, el correo) y filtra junto con los demás", async () => {
    render(<ReportesTab />);
    await screen.findByRole("option", { name: "Ana Peña" });
    const opciones = [...screen.getByLabelText<HTMLSelectElement>("Vendedor").options].map((o) => o.text);
    expect(opciones).toEqual(["Todos los vendedores", "Ana Peña", "sin@x.cl"]);

    fireEvent.change(screen.getByLabelText("Canal"), { target: { value: "pos" } });
    fireEvent.change(screen.getByLabelText("Vendedor"), { target: { value: "user_ana" } });
    await waitFor(() => expect(reportes().at(-1)).toBe("/api/reports?periodo=30&canal=pos&vendedor=user_ana"));
    await waitForData();
    fireEvent.change(screen.getByLabelText("Vendedor"), { target: { value: "" } });
    await waitFor(() => expect(reportes().at(-1)).toBe("/api/reports?periodo=30&canal=pos"));
  });

  it("RHV-C-04: el CSV de ventas lleva período, canal y vendedor, y el nombre del archivo los indica", async () => {
    render(<ReportesTab />);
    await screen.findByRole("option", { name: "Ana Peña" });
    fireEvent.click(screen.getByText("Hoy"));
    fireEvent.change(screen.getByLabelText("Canal"), { target: { value: "pos" } });
    fireEvent.change(screen.getByLabelText("Vendedor"), { target: { value: "user_ana" } });
    await waitForData();
    const { enlace, spy } = capturarDescarga();
    fireEvent.click(screen.getByText("↓ Ventas CSV"));
    await waitFor(() => expect(enlace.click).toHaveBeenCalled());
    expect(llamadas().at(-1)).toBe("/api/reports/export?tipo=ventas&periodo=hoy&canal=pos&vendedor=user_ana");
    expect(enlace.download).toMatch(/^ventas-hoy-pos-ana-pena-\d{4}-\d{2}-\d{2}\.csv$/);
    spy.mockRestore();
  });

  it("RHV-C-05: el CSV de inventario no lleva filtros de ventas", async () => {
    render(<ReportesTab />);
    await screen.findByRole("option", { name: "Ana Peña" });
    fireEvent.change(screen.getByLabelText("Vendedor"), { target: { value: "user_ana" } });
    await waitForData();
    const { enlace, spy } = capturarDescarga();
    fireEvent.click(screen.getByText("↓ Inventario CSV"));
    await waitFor(() => expect(enlace.click).toHaveBeenCalled());
    expect(llamadas().at(-1)).toBe("/api/reports/export?tipo=inventario");
    expect(enlace.download).toMatch(/^inventario-\d{4}/);
    spy.mockRestore();
  });

  // Conveniencia de UX: el control real es el servidor (RHV-I-06).
  it("RHV-C-06: el storeWorker no ve el selector ni pide la lista de vendedores", async () => {
    mockUserMeta = { storeWorker: true };
    render(<ReportesTab />);
    await waitForData();
    expect(screen.queryByLabelText("Vendedor")).not.toBeInTheDocument();
    expect(llamadas()).not.toContain("/api/workers");
    expect(screen.getByText("Hoy")).toBeInTheDocument();
  });

  it("RHV-C-07: si la lista de vendedores falla, el reporte funciona con 'Todos los vendedores'", async () => {
    (global.fetch as jest.Mock).mockReset().mockImplementation((url: string) =>
      url === "/api/workers" ? Promise.reject(new Error("red")) : Promise.resolve({ ok: true, json: async () => MOCK_DATA }));
    render(<ReportesTab />);
    await waitForData();
    expect(screen.getByLabelText<HTMLSelectElement>("Vendedor").options).toHaveLength(1);
  });

  it.each([
    ["la API responde error", () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "Error interno" }) })],
    ["no hay red", () => Promise.reject(new Error("red"))],
  ])("RHV-C-08: si %s al filtrar, muestra el error y no deja a la vista los datos del filtro anterior", async (_n, falla) => {
    rutas((u) => (u.includes("vendedor=") ? falla() : { ok: true, json: async () => MOCK_DATA }));
    render(<ReportesTab />);
    await screen.findByRole("option", { name: "Ana Peña" });
    await waitForData();
    fireEvent.change(screen.getByLabelText("Vendedor"), { target: { value: "user_ana" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar los reportes");
    expect(screen.queryByText("$875.136")).not.toBeInTheDocument();
    // Se recupera al volver a "Todos".
    fireEvent.change(screen.getByLabelText("Vendedor"), { target: { value: "" } });
    await waitForData();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("RHV-C-09 (REGRESIÓN): una respuesta atrasada del filtro anterior no pisa la del actual", async () => {
    let soltar30: (v: unknown) => void = () => {};
    rutas((u) => u.includes("periodo=30")
      ? new Promise((r) => { soltar30 = r; })
      : { ok: true, json: async () => ({ ...MOCK_DATA, totalPeriodo: 111 }) });
    render(<ReportesTab />);
    fireEvent.click(screen.getByText("Hoy"));
    expect(await screen.findByText("$111")).toBeInTheDocument();
    await act(async () => { soltar30({ ok: true, json: async () => ({ ...MOCK_DATA, totalPeriodo: 999 }) }); });
    expect(screen.getByText("$111")).toBeInTheDocument();
    expect(screen.queryByText("$999")).not.toBeInTheDocument();
  });
});

// ── Suite: indicador de carga al cambiar de filtro ───────────────────────────

describe("ReportesTab — indicador de carga", () => {
  let soltar: (v: unknown) => void;

  // La primera carga responde al tiro; las siguientes quedan en vuelo.
  async function cargadoYEnVuelo() {
    let n = 0;
    (global.fetch as jest.Mock).mockReset().mockImplementation((url: string) => {
      if (url === "/api/workers") return Promise.resolve({ ok: true, json: async () => [{ clerk_id: "user_ana", nombre: "Ana", email: "a@x.cl" }] });
      if (n++ === 0) return Promise.resolve({ ok: true, json: async () => MOCK_DATA });
      return new Promise((r) => { soltar = r; });
    });
    mockUserMeta = { storeAdmin: true };
    render(<ReportesTab />);
    await waitForData();
    await screen.findByRole("option", { name: "Ana" });
  }
  const contenido = () => screen.getByText("Total Ventas período").closest(".space-y-6")!;

  it.each([
    ["días", () => fireEvent.click(screen.getByText("Hoy"))],
    ["canal", () => fireEvent.change(screen.getByLabelText("Canal"), { target: { value: "pos" } })],
    ["vendedor", () => fireEvent.change(screen.getByLabelText("Vendedor"), { target: { value: "user_ana" } })],
  ])("RHV-C-10: al cambiar %s aparece el ícono girando sobre los datos atenuados y desaparece al llegar los nuevos", async (_f, cambiar) => {
    await cargadoYEnVuelo();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(contenido()).not.toHaveClass("opacity-40");

    cambiar();
    const aviso = screen.getByRole("status");
    expect(aviso).toHaveTextContent("Cargando...");
    expect(aviso.querySelector("svg.animate-spin")).toBeInTheDocument();
    expect(contenido()).toHaveClass("opacity-40");

    await act(async () => { soltar({ ok: true, json: async () => ({ ...MOCK_DATA, totalPeriodo: 111 }) }); });
    expect(screen.getByText("$111")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(contenido()).not.toHaveClass("opacity-40");
  });

  it("RHV-C-11: también desaparece si la carga falla, y no aparece al elegir el mismo período", async () => {
    await cargadoYEnVuelo();
    fireEvent.click(screen.getByText("30 días"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Hoy"));
    expect(screen.getByRole("status")).toBeInTheDocument();
    await act(async () => { soltar({ ok: false, json: async () => ({ error: "Error interno" }) }); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los reportes");
  });
});
