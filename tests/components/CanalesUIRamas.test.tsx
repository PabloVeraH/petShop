/**
 * Tests CTC-10..11, LQC-06, PRC-06, PCA-03, CNP-01..03 y PPD-01..02: UI de
 * canales sin cobertura en la suite de las Fases 3–6 (auditoría de cobertura
 * del 2026-09-26 sobre las líneas cambiadas en feat/stockCanales):
 *   - errores de la API y de red en mutaciones y cargas → visibles, nunca
 *     silenciados (AGENTS.md §19.1);
 *   - página /canales (estaba en 0 %): estado por canal y navegación;
 *   - /pos/pedidos y las redirecciones de las antiguas páginas de órdenes
 *     por canal (estaban en 0 %).
 *
 * Mostrar/ocultar según rol es UX: el control real es el servidor
 * (I-668, I-672, I-674, I-675, I-680..I-682).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

const mockPush = jest.fn();
const mockRedirect = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  redirect: (...a: unknown[]) => mockRedirect(...a),
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
// /pos/pedidos: se verifica qué canal le pasa la página al componente.
const mockPedidosCanales = jest.fn();
jest.mock("@/app/(app)/pos/components/PedidosCanales", () => ({
  __esModule: true,
  default: (props: { canal?: string }) => {
    mockPedidosCanales(props);
    return <div data-testid="pedidos-canales">{props.canal ?? "todos"}</div>;
  },
}));

import CatalogoCanal from "@/app/(app)/canales/components/CatalogoCanal";
import LiquidacionesCanal from "@/app/(app)/canales/components/LiquidacionesCanal";
import PreparacionCanal from "@/app/(app)/canales/components/PreparacionCanal";
import PedidosCanalesAviso, { INTERVALO_AVISO_MS } from "@/app/(app)/pos/components/PedidosCanalesAviso";
import CanalesPage from "@/app/(app)/canales/page";
import PosPedidosPage from "@/app/(app)/pos/pedidos/page";
import RappiOrdenesPage from "@/app/(app)/canales/rappi/ordenes/page";
import PedidosYaOrdenesPage from "@/app/(app)/canales/pedidosya/ordenes/page";
import UberEatsOrdenesPage from "@/app/(app)/canales/ubereats/ordenes/page";

const fetchMock = jest.fn();
global.fetch = fetchMock;

type Resp = { ok: boolean; status?: number; body?: unknown } | Error;
// Responde por URL; una Error simula falla de red (fetch rechazado).
function responder(rutas: Record<string, Resp | ((init?: RequestInit) => Resp)>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const clave = Object.keys(rutas).find((k) => url.startsWith(k));
    let r = clave ? rutas[clave] : { ok: true, body: {} };
    if (typeof r === "function") r = r(init);
    if (r instanceof Error) throw r;
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body ?? {} };
  });
}
const mutaciones = () => fetchMock.mock.calls.filter(([, init]) => init?.method);

let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

// ─── CatalogoCanal: errores de mutación ─────────────────────────────────────
describe("CatalogoCanal — errores al guardar", () => {
  const CANAL = { id: "rappi" as const, nombre: "Rappi", icono: "🛵", color: "bg-red-500" };
  const LISTADO = {
    ok: true,
    body: {
      canal: "rappi", activo: true, recargo_pct: 15,
      productos: [{
        producto_id: "1", nombre: "Producto 1", sku: "SKU-1", precio_base: 10000, precio_override: null, precio_canal: 11500,
        habilitado: false, publicado_at: null, disponible_publicado: null, stock: 12, stock_minimo: 2, cupo: 10,
      }],
    },
  };

  it("CTC-10: guardar producto — error de la API muestra su mensaje (sin recargar); falla de red → mensaje de red", async () => {
    responder({
      "/api/canales/rappi/productos": (init) =>
        init?.method === "PUT" ? { ok: false, status: 409, body: { error: "El producto se modificó al mismo tiempo; reintenta" } } : LISTADO,
    });
    render(<CatalogoCanal canal={CANAL} />);
    fireEvent.click(await screen.findByLabelText("Vender Producto 1 en Rappi"));
    expect(await screen.findByText("El producto se modificó al mismo tiempo; reintenta")).toBeInTheDocument();
    const [url, init] = mutaciones()[0];
    expect(url).toBe("/api/canales/rappi/productos");
    expect(JSON.parse(init.body)).toEqual({ producto_id: "1", habilitado: true });
    // Tras el error no se volvió a cargar el listado (1 GET inicial).
    expect(fetchMock.mock.calls.filter(([, i]) => !i?.method)).toHaveLength(1);

    responder({ "/api/canales/rappi/productos": (init) => (init?.method === "PUT" ? new Error("offline") : LISTADO) });
    fireEvent.click(screen.getByLabelText("Vender Producto 1 en Rappi"));
    expect(await screen.findByText("Error de red guardando el producto")).toBeInTheDocument();
  });

  it("CTC-11: guardar recargo — error de la API (sin mensaje) usa el genérico; falla de red → mensaje de red; nunca muestra 'guardado'", async () => {
    responder({
      "/api/canales/rappi/productos": LISTADO,
      "/api/canales/config": { ok: false, status: 500, body: {} },
    });
    render(<CatalogoCanal canal={CANAL} />);
    const input = await screen.findByLabelText(/Recargo/i);
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar recargo" }));
    expect(await screen.findByText("Error guardando el recargo")).toBeInTheDocument();
    expect(JSON.parse(mutaciones()[0][1].body)).toEqual({ canal_id: "rappi", recargo_pct: 20 });

    responder({ "/api/canales/rappi/productos": LISTADO, "/api/canales/config": new Error("offline") });
    fireEvent.click(screen.getByRole("button", { name: "Guardar recargo" }));
    expect(await screen.findByText("Error de red guardando el recargo")).toBeInTheDocument();
    expect(screen.queryByText(/Recargo guardado/)).not.toBeInTheDocument();
  });
});

// ─── Liquidaciones / Preparación / Aviso del POS: errores de carga ──────────
describe("errores de carga visibles", () => {
  it("LQC-06: la carga de liquidaciones falla (HTTP o red) → mensaje visible, sin tabla vacía engañosa", async () => {
    responder({ "/api/canales/liquidacion": { ok: false, status: 500 } });
    const { unmount } = render(<LiquidacionesCanal canalId="rappi" nombre="Rappi" />);
    expect(await screen.findByText("No se pudieron cargar las liquidaciones")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/canales/liquidacion?canal=rappi");
    unmount();

    responder({ "/api/canales/liquidacion": new Error("offline") });
    render(<LiquidacionesCanal canalId="rappi" nombre="Rappi" />);
    expect(await screen.findByText("No se pudieron cargar las liquidaciones")).toBeInTheDocument();
  });

  it("PRC-06: falla de red al cargar la preparación → mensaje visible (no queda la página en blanco)", async () => {
    responder({ "/api/canales/rappi/preparacion": new Error("offline") });
    render(<PreparacionCanal canalId="rappi" nombre="Rappi" />);
    expect(await screen.findByText("No se pudo cargar la preparación del canal")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/canales/rappi/preparacion");
  });

  it("PCA-03: el aviso del POS ignora respuestas no-OK (sin contador) y se actualiza en cada intervalo hasta desmontarse", async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
      const { unmount } = render(<PedidosCanalesAviso />);
      await act(async () => {});
      expect(screen.getByText("Pedidos de canales")).toHaveAttribute("href", "/pos/pedidos");

      fetchMock.mockResolvedValue({ ok: true, json: async () => [{ id: "1" }, { id: "2" }, { id: "3" }] });
      await act(async () => { jest.advanceTimersByTime(INTERVALO_AVISO_MS); });
      expect(screen.getByText("Pedidos de canales (3)")).toBeInTheDocument();

      const llamadas = fetchMock.mock.calls.length;
      unmount();
      await act(async () => { jest.advanceTimersByTime(INTERVALO_AVISO_MS * 3); });
      expect(fetchMock.mock.calls.length).toBe(llamadas);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─── Página /canales ────────────────────────────────────────────────────────
describe("CanalesPage (/canales)", () => {
  const CONFIGS = [
    { id: "c1", canal_id: "rappi", activo: true },
    { id: "c2", canal_id: "pedidosya", activo: false },
    { id: "c3", canal_id: "instagram", activo: true },
  ];
  const tarjeta = (nombre: string) => screen.getByRole("heading", { name: nombre }).closest("div.bg-white") as HTMLElement;

  it("CNP-01: 'Cargando...' y luego estado por canal: POS siempre activo, configurados según la API, alertas incluidas", async () => {
    responder({ "/api/canales/config": { ok: true, body: CONFIGS }, "/api/canales/alertas": { ok: true, body: { alertas: [], total: 0 } } });
    render(<CanalesPage />);
    expect(screen.getByText("Cargando...")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Canales de Venta" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/canales/config");
    expect(fetchMock).toHaveBeenCalledWith("/api/canales/alertas");

    expect(tarjeta("Punto de Venta")).toHaveTextContent("Activo");
    expect(tarjeta("Rappi")).toHaveTextContent("Activo");
    expect(tarjeta("PedidosYa")).toHaveTextContent("Inactivo");
    expect(tarjeta("Uber Eats")).toHaveTextContent("Inactivo");
    // Configurado → "Ver configuración"; no configurado → "Configurar →"; POS sin botones.
    expect(tarjeta("Rappi")).toHaveTextContent("Ver configuración");
    expect(tarjeta("Uber Eats")).toHaveTextContent("Configurar →");
    expect(tarjeta("Punto de Venta").querySelector("button")).toBeNull();
  });

  it("CNP-02: los botones navegan a la configuración del canal; Instagram activo ofrece 'Gestionar publicaciones'", async () => {
    responder({ "/api/canales/config": { ok: true, body: CONFIGS }, "/api/canales/alertas": { ok: true, body: { alertas: [], total: 0 } } });
    render(<CanalesPage />);
    await screen.findByRole("heading", { name: "Canales de Venta" });
    fireEvent.click(within(tarjeta("Rappi")).getByRole("button", { name: "Ver configuración" }));
    expect(mockPush).toHaveBeenLastCalledWith("/canales/rappi");
    fireEvent.click(within(tarjeta("Uber Eats")).getByRole("button", { name: "Configurar →" }));
    expect(mockPush).toHaveBeenLastCalledWith("/canales/ubereats");
    fireEvent.click(screen.getByRole("button", { name: "Gestionar publicaciones" }));
    expect(mockPush).toHaveBeenLastCalledWith("/canales/instagram/posts");
    // PedidosYa configurado pero inactivo: sin "Gestionar publicaciones" propio.
    expect(within(tarjeta("PedidosYa")).queryByRole("button", { name: "Gestionar publicaciones" })).toBeNull();
  });

  it("CNP-03: respuesta de config que no es lista (ej. 403 {error}) o falla de red → todos sin configurar, sin romper la página", async () => {
    for (const cfg of [{ ok: false, status: 403, body: { error: "Forbidden" } }, new Error("offline")] as Resp[]) {
      responder({ "/api/canales/config": cfg, "/api/canales/alertas": { ok: true, body: { alertas: [], total: 0 } } });
      const { unmount } = render(<CanalesPage />);
      await screen.findByRole("heading", { name: "Canales de Venta" });
      for (const nombre of ["Rappi", "PedidosYa", "Uber Eats", "Instagram"]) {
        expect(tarjeta(nombre)).toHaveTextContent("Inactivo");
        expect(tarjeta(nombre)).toHaveTextContent("Configurar →");
      }
      unmount();
    }
  });
});

// ─── /pos/pedidos y redirecciones ───────────────────────────────────────────
describe("/pos/pedidos y rutas antiguas de órdenes", () => {
  it("PPD-01: /pos/pedidos pasa el canal de la URL a PedidosCanales (solo si es un string) y enlaza de vuelta al POS", async () => {
    render(await PosPedidosPage({ searchParams: Promise.resolve({ canal: "rappi" }) }));
    expect(mockPedidosCanales).toHaveBeenLastCalledWith({ canal: "rappi" });
    expect(screen.getByRole("heading", { name: "Pedidos de canales" })).toBeInTheDocument();
    expect(screen.getByText("← Volver al POS")).toHaveAttribute("href", "/pos");

    render(await PosPedidosPage({ searchParams: Promise.resolve({ canal: ["rappi", "ubereats"] }) }));
    expect(mockPedidosCanales).toHaveBeenLastCalledWith({ canal: undefined });
    render(await PosPedidosPage({ searchParams: Promise.resolve({}) }));
    expect(mockPedidosCanales).toHaveBeenLastCalledWith({ canal: undefined });
  });

  it("PPD-02: /canales/{rappi,pedidosya,ubereats}/ordenes redirigen a /pos/pedidos con su canal (enlaces guardados siguen funcionando)", () => {
    RappiOrdenesPage();
    PedidosYaOrdenesPage();
    UberEatsOrdenesPage();
    expect(mockRedirect.mock.calls).toEqual([
      ["/pos/pedidos?canal=rappi"],
      ["/pos/pedidos?canal=pedidosya"],
      ["/pos/pedidos?canal=ubereats"],
    ]);
  });
});

// CNP-04 — REGRESIÓN (QA 2026-09-27, BUG 3): un canal con integración
// pendiente se muestra Inactivo aunque la config llegue con activo=true.
describe("CanalesPage — integración pendiente (CNP-04)", () => {
  it("CNP-04: PedidosYa y Uber Eats con activo=true se muestran Inactivo; Rappi sigue Activo", async () => {
    responder({
      "/api/canales/config": { ok: true, body: [
        { id: "c1", canal_id: "rappi", activo: true },
        { id: "c2", canal_id: "pedidosya", activo: true },
        { id: "c3", canal_id: "ubereats", activo: true },
      ] },
      "/api/canales/alertas": { ok: true, body: { alertas: [], total: 0 } },
    });
    render(<CanalesPage />);
    await screen.findByRole("heading", { name: "Canales de Venta" });
    const tarjeta = (nombre: string) => screen.getByRole("heading", { name: nombre }).closest("div.bg-white") as HTMLElement;
    expect(tarjeta("Rappi")).toHaveTextContent("Activo");
    expect(tarjeta("PedidosYa")).toHaveTextContent("Inactivo");
    expect(tarjeta("Uber Eats")).toHaveTextContent("Inactivo");
  });
});
