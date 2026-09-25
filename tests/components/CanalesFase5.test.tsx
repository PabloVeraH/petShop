/**
 * Tests ALC-01 a ALC-05 y LQC-01 a LQC-05: UI de la Fase 5 de
 * docs/canales-stock/stock_canales_externos.md — alertas de canales (5.3) y
 * liquidaciones (5.2). Ocultar las alertas ante 403 es UX: el control real
 * está en el servidor (I-680..I-682).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import AlertasCanales from "@/app/(app)/canales/components/AlertasCanales";
import LiquidacionesCanal from "@/app/(app)/canales/components/LiquidacionesCanal";

const fetchMock = jest.fn();
global.fetch = fetchMock;

type Resp = { ok: boolean; status?: number; body?: unknown };
function responder(lectura: Resp, mutacion: Resp = { ok: true, body: {} }) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    const r = init?.method ? mutacion : lectura;
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body ?? {} };
  });
}
const mutaciones = () => fetchMock.mock.calls.filter(([, init]) => init?.method);

beforeEach(() => jest.clearAllMocks());

const ALERTAS = [
  { tipo: "llamada_detenida", severidad: "alta", canal_id: "rappi", mensaje: "No se pudo confirmar un pedido tras 8 intentos", detalle: "503", fecha: null, outbox_id: "job-1" },
  { tipo: "credenciales", severidad: "alta", canal_id: "rappi", mensaje: "La plataforma rechaza las credenciales", detalle: null, fecha: null },
  { tipo: "menu_rechazado", severidad: "alta", canal_id: "rappi", mensaje: "La plataforma rechazó el catálogo publicado", detalle: "Faltan imágenes", fecha: null },
  { tipo: "orden_fallida", severidad: "alta", canal_id: "rappi", mensaje: "El pedido EXT-9 no se pudo procesar", detalle: null, fecha: null },
];

describe("AlertasCanales", () => {
  it("ALC-01: muestra las alertas con su detalle y enlaces a la acción correspondiente", async () => {
    responder({ ok: true, body: { alertas: ALERTAS, total: 4 } });
    render(<AlertasCanales />);
    expect(await screen.findByText("4 alertas de canales externos")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/canales/alertas");
    expect(screen.getByText("Faltan imágenes")).toBeInTheDocument();
    expect(screen.getByText("Revisar configuración")).toHaveAttribute("href", "/canales/rappi");
    expect(screen.getByText("Revisar catálogo")).toHaveAttribute("href", "/canales/rappi/catalogo");
    expect(screen.getByText("Ver pedidos")).toHaveAttribute("href", "/pos/pedidos?canal=rappi");
    expect(screen.getAllByRole("button", { name: "Reintentar" })).toHaveLength(1);
  });

  it("ALC-02: sin alertas o con 403 (no admin — UX; el servidor es el control) no muestra nada", async () => {
    responder({ ok: true, body: { alertas: [], total: 0 } });
    const { container, unmount } = render(<AlertasCanales />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();
    responder({ ok: false, status: 403 });
    const r2 = render(<AlertasCanales />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(r2.container).toBeEmptyDOMElement();
  });

  it("ALC-03: 'Reintentar' llama POST /api/canales/alertas con el id del trabajo y recarga", async () => {
    responder({ ok: true, body: { alertas: ALERTAS, total: 4 } });
    render(<AlertasCanales />);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Reintento en curso");
    const [url, init] = mutaciones()[0];
    expect(url).toBe("/api/canales/alertas");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ id: "job-1" });
    expect(fetchMock.mock.calls.filter(([, i]) => !i?.method)).toHaveLength(2);
  });

  it("ALC-04: error del reintento visible", async () => {
    responder({ ok: true, body: { alertas: ALERTAS, total: 4 } }, { ok: false, status: 409, body: { error: "Ya hay un trabajo equivalente en curso" } });
    render(<AlertasCanales />);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya hay un trabajo equivalente en curso");
  });

  it("ALC-05: error de carga visible", async () => {
    responder({ ok: false, status: 500 });
    render(<AlertasCanales />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar las alertas");
  });
});

describe("LiquidacionesCanal", () => {
  const LISTA = [
    { id: "l1", periodo_desde: "2026-09-01", periodo_hasta: "2026-09-15", monto_bruto: 100000, comision: 23800, monto_neto: 76200, referencia: "R-1", journal_entry_id: "a1" },
  ];
  function llenar(v: Record<string, string>) {
    const labels: Record<string, string> = {
      periodo_desde: "Período desde",
      periodo_hasta: "Período hasta",
      fecha_deposito: "Fecha de depósito",
      monto_bruto: "Ventas del período (con IVA)",
      comision: "Comisión (con IVA)",
      referencia: "Referencia (opcional)",
    };
    for (const [k, val] of Object.entries(v)) fireEvent.change(screen.getByLabelText(labels[k]), { target: { value: val } });
  }
  const COMPLETO = {
    periodo_desde: "2026-09-01",
    periodo_hasta: "2026-09-15",
    fecha_deposito: "2026-09-20",
    monto_bruto: "100000",
    comision: "23800",
  };

  it("LQC-01: lista las liquidaciones del canal (GET filtrado por canal)", async () => {
    responder({ ok: true, body: LISTA });
    render(<LiquidacionesCanal canalId="rappi" nombre="Rappi" />);
    expect(await screen.findByText("2026-09-01 al 2026-09-15")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/canales/liquidacion?canal=rappi");
    expect(screen.getByText("$76.200")).toBeInTheDocument();
  });

  it("LQC-02: vacío muestra 'Sin liquidaciones registradas'", async () => {
    responder({ ok: true, body: [] });
    render(<LiquidacionesCanal canalId="rappi" nombre="Rappi" />);
    expect(await screen.findByText("Sin liquidaciones registradas")).toBeInTheDocument();
  });

  it("LQC-03: registrar → POST con montos enteros (sin neto: lo calcula el servidor), previsualiza el depositado y recarga", async () => {
    responder({ ok: true, body: [] }, { ok: true, status: 201, body: { id: "l2" } });
    render(<LiquidacionesCanal canalId="rappi" nombre="Rappi" />);
    await screen.findByText("Sin liquidaciones registradas");
    llenar({ ...COMPLETO, referencia: " R-2 " });
    expect(screen.getByText("$76.200")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Registrar liquidación" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Liquidación registrada");
    const [url, init] = mutaciones()[0];
    expect(url).toBe("/api/canales/liquidacion");
    expect(JSON.parse(init.body)).toEqual({
      canal_id: "rappi",
      periodo_desde: "2026-09-01",
      periodo_hasta: "2026-09-15",
      fecha_deposito: "2026-09-20",
      monto_bruto: 100000,
      comision: 23800,
      referencia: "R-2",
    });
  });

  it("LQC-04: datos incompletos o comisión mayor que el bruto → error sin request", async () => {
    responder({ ok: true, body: [] });
    render(<LiquidacionesCanal canalId="rappi" nombre="Rappi" />);
    await screen.findByText("Sin liquidaciones registradas");
    fireEvent.click(screen.getByRole("button", { name: "Registrar liquidación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Completa el período/);
    llenar({ ...COMPLETO, comision: "200000" });
    fireEvent.click(screen.getByRole("button", { name: "Registrar liquidación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Montos inválidos/);
    expect(mutaciones()).toHaveLength(0);
  });

  it("LQC-05: error de la API (ej. período cerrado) visible", async () => {
    responder({ ok: true, body: [] }, { ok: false, status: 409, body: { error: "El período 2026-09 ya está cerrado." } });
    render(<LiquidacionesCanal canalId="rappi" nombre="Rappi" />);
    await screen.findByText("Sin liquidaciones registradas");
    llenar(COMPLETO);
    fireEvent.click(screen.getByRole("button", { name: "Registrar liquidación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El período 2026-09 ya está cerrado.");
  });
});
