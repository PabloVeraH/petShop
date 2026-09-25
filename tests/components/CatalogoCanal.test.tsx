/**
 * Tests CTC-01 a CTC-09: pantalla de catálogo por canal (Fase 4, paso 4.4 de
 * docs/canales-stock/stock_canales_externos.md). Reemplaza a las páginas
 * RappiCatalogoPage / PedidosYaCatalogoPage / UberEatsCatalogoPage, que no
 * tenían tests.
 *
 * El mensaje ante 403 es UX: el control real es el servidor (I-668, I-672,
 * I-674, I-675: storeWorker → 403 en todas las rutas del catálogo).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import CatalogoCanal from "@/app/(app)/canales/components/CatalogoCanal";

const CANAL = { id: "rappi" as const, nombre: "Rappi", icono: "🛵", color: "bg-red-500" };

const producto = (id: string, extra: Record<string, unknown> = {}) => ({
  producto_id: id,
  nombre: `Producto ${id}`,
  sku: `SKU-${id}`,
  precio_base: 10000,
  precio_override: null,
  precio_canal: 11500,
  habilitado: false,
  publicado_at: null,
  disponible_publicado: null,
  stock: 12,
  stock_minimo: 2,
  cupo: 10,
  ...extra,
});

const fetchMock = jest.fn();
global.fetch = fetchMock;

type Resp = { ok: boolean; status?: number; body?: unknown };
function responder(lista: Resp, mutacion: Resp = { ok: true, body: {} }) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    const r = init?.method ? mutacion : lista;
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body ?? {} };
  });
}
const listado = (productos: unknown[], extra: Record<string, unknown> = {}) => ({
  ok: true,
  body: { canal: "rappi", activo: true, recargo_pct: 15, productos, ...extra },
});
const mutaciones = () => fetchMock.mock.calls.filter(([, init]) => init?.method);

beforeEach(() => jest.clearAllMocks());

describe("CatalogoCanal", () => {
  it("CTC-01: carga desde la API del canal y muestra stock, mínimo, cupo, precios y estado publicado", async () => {
    responder(
      listado([
        producto("1", { habilitado: true, publicado_at: "2026-09-25", disponible_publicado: true }),
        producto("2", { cupo: 0, habilitado: true, publicado_at: "2026-09-25", disponible_publicado: false }),
        producto("3"),
      ])
    );
    render(<CatalogoCanal canal={CANAL} />);
    expect(screen.getByText("Cargando...")).toBeInTheDocument();
    expect(await screen.findByText("Producto 1")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/canales/rappi/productos");
    expect(screen.getByText("Catálogo Rappi")).toBeInTheDocument();
    expect(screen.getByText(/2 productos habilitados/)).toBeInTheDocument();
    expect(screen.getByText("Disponible")).toBeInTheDocument();
    expect(screen.getByText("Apagado")).toBeInTheDocument();
    expect(screen.getByText("No publicado")).toBeInTheDocument();
    expect(screen.getAllByText("$11.500")).toHaveLength(3);
    expect(screen.getByDisplayValue("15")).toBeInTheDocument();
  });

  it("CTC-02: sin productos → 'Sin productos' y 'Publicar catálogo' deshabilitado", async () => {
    responder(listado([]));
    render(<CatalogoCanal canal={CANAL} />);
    expect(await screen.findByText("Sin productos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publicar catálogo" })).toBeDisabled();
  });

  it("CTC-03: el toggle 'Vender' llama PUT con habilitado invertido (sin tocar el precio) y recarga", async () => {
    responder(listado([producto("1")]));
    render(<CatalogoCanal canal={CANAL} />);
    fireEvent.click(await screen.findByLabelText("Vender Producto 1 en Rappi"));
    await waitFor(() => expect(mutaciones()).toHaveLength(1));
    const [url, init] = mutaciones()[0];
    expect(url).toBe("/api/canales/rappi/productos");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ producto_id: "1", habilitado: true });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, i]) => !i?.method)).toHaveLength(2));
  });

  it("CTC-04: precio fijo → PUT con precio_override entero; vacío → null; inválido → error sin request", async () => {
    responder(listado([producto("1", { habilitado: true })]));
    render(<CatalogoCanal canal={CANAL} />);
    const input = await screen.findByLabelText("Precio fijo de Producto 1");

    fireEvent.change(input, { target: { value: "12990" } });
    fireEvent.click(screen.getByLabelText("Guardar precio de Producto 1"));
    await waitFor(() => expect(mutaciones()).toHaveLength(1));
    expect(JSON.parse(mutaciones()[0][1].body)).toEqual({ producto_id: "1", habilitado: true, precio_override: 12990 });

    fireEvent.change(await screen.findByLabelText("Precio fijo de Producto 1"), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText("Guardar precio de Producto 1"));
    await waitFor(() => expect(mutaciones()).toHaveLength(2));
    expect(JSON.parse(mutaciones()[1][1].body)).toMatchObject({ precio_override: null });

    fireEvent.change(await screen.findByLabelText("Precio fijo de Producto 1"), { target: { value: "99.5" } });
    fireEvent.click(screen.getByLabelText("Guardar precio de Producto 1"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Precio inválido/);
    expect(mutaciones()).toHaveLength(2);
  });

  it("CTC-05: 'Publicar catálogo' llama POST /api/canales/catalog con el canal y muestra el aviso", async () => {
    responder(listado([producto("1", { habilitado: true })]), { ok: true, status: 202, body: { status: "encolado" } });
    render(<CatalogoCanal canal={CANAL} />);
    fireEvent.click(await screen.findByRole("button", { name: "Publicar catálogo" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Publicación en curso/);
    const [url, init] = mutaciones()[0];
    expect(url).toBe("/api/canales/catalog");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ canal_id: "rappi" });
  });

  it("CTC-06: 'Guardar recargo' llama PATCH /api/canales/config; fuera de 0–100 → error sin request", async () => {
    responder(listado([producto("1")]));
    render(<CatalogoCanal canal={CANAL} />);
    const input = await screen.findByDisplayValue("15");
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar recargo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/entre 0 y 100/);
    expect(mutaciones()).toHaveLength(0);

    fireEvent.change(input, { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar recargo" }));
    await waitFor(() => expect(mutaciones()).toHaveLength(1));
    const [url, init] = mutaciones()[0];
    expect(url).toBe("/api/canales/config");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ canal_id: "rappi", recargo_pct: 12.5 });
  });

  it("CTC-07: 403 al cargar (storeWorker) → mensaje de solo administradores, sin tabla", async () => {
    responder({ ok: false, status: 403, body: { error: "Forbidden" } });
    render(<CatalogoCanal canal={CANAL} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Solo un administrador de la tienda puede gestionar el catálogo");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("CTC-08: error de la API en una mutación se muestra (no se silencia)", async () => {
    responder(listado([producto("1", { habilitado: true })]), { ok: false, status: 422, body: { error: "No hay productos habilitados para este canal" } });
    render(<CatalogoCanal canal={CANAL} />);
    fireEvent.click(await screen.findByRole("button", { name: "Publicar catálogo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No hay productos habilitados para este canal");
  });
});

describe("páginas de catálogo por canal", () => {
  it.each([
    ["rappi", "Rappi"],
    ["pedidosya", "PedidosYa"],
    ["ubereats", "Uber Eats"],
  ])("CTC-09: /canales/%s/catalogo usa el componente común con su canal", async (id, nombre) => {
    responder(listado([]));
    const Pagina = (await import(`@/app/(app)/canales/${id}/catalogo/page`)).default;
    render(<Pagina />);
    expect(await screen.findByText(`Catálogo ${nombre}`)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/canales/${id}/productos`);
  });
});
