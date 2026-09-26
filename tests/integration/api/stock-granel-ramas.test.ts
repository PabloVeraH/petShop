/**
 * Tests I-717 a I-721: ramas de las rutas de stock y granel (Fases 1/1b) sin
 * cobertura en la suite (auditoría de cobertura del 2026-09-26 sobre las
 * líneas cambiadas en feat/stockCanales):
 *   - GET /api/inventario y GET /api/productos cuando falla la lectura del
 *     saco abierto (G11 / G1) → 500, nunca datos sin los gramos;
 *   - PATCH /api/productos/[id] al activar vencimientos (D11): error de la
 *     conversión a LOTE-0 se audita como fallo sin romper el PATCH; no-op sin
 *     auditoría de lote;
 *   - merma de saco / conteo físico cuando el producto no se puede releer
 *     para el Hub → responde igual, sin sincronizar datos vacíos.
 *
 * Supabase se simula con tests/helpers/fake-supabase (una consulta por from()).
 */
import { NextRequest } from "next/server";
import { crearFakeSupabase, tiene } from "../../helpers/fake-supabase";

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return { ...actual, after: jest.fn((cb: () => unknown) => cb()) };
});
const mockLogAudit = jest.fn();
jest.mock("@/lib/audit", () => ({
  logAudit: (...a: unknown[]) => mockLogAudit(...a),
  getRequestMetadata: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
  withErrorLogging: (h: unknown) => h,
}));
const mockSync = jest.fn();
jest.mock("@/lib/hub-sync", () => ({ syncProductsToHub: (...a: unknown[]) => mockSync(...a) }));
jest.mock("@/lib/r2-storage", () => ({ eliminarImagenProducto: jest.fn().mockResolvedValue(undefined) }));
let fakeActual: ReturnType<typeof crearFakeSupabase>;
jest.mock("@/lib/supabase", () => ({ createServiceClient: () => fakeActual.client }));
const mockGetStoreId = jest.fn();
jest.mock("@/lib/auth", () => ({ getStoreId: () => mockGetStoreId() }));
const mockAuth = jest.fn();
jest.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

import { GET as INVENTARIO_GET } from "@/app/api/inventario/route";
import { GET as PRODUCTOS_GET } from "@/app/api/productos/route";
import { PATCH as PRODUCTO_PATCH } from "@/app/api/productos/[id]/route";
import { POST as SACO } from "@/app/api/productos/[id]/saco/route";
import { POST as CONTEO } from "@/app/api/inventario/[id]/conteo/route";

const STORE = "123e4567-e89b-12d3-a456-426614174000";
const PROD = "523e4567-e89b-12d3-a456-426614174001";
const GRANEL = { id: PROD, nombre: "Alimento 15 kg", precio_venta_kg: 4000, peso_gramos: 15000, stock: 3, stock_minimo: 1 };

let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockLogAudit.mockResolvedValue(undefined);
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE });
  mockAuth.mockResolvedValue({ sessionClaims: { sub: "u1", publicMetadata: { storeId: STORE, storeAdmin: true } } });
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init as never);
const json = (url: string, method: string, body: unknown) =>
  req(url, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("lecturas con saco abierto de granel", () => {
  it("I-717: GET /api/inventario — error leyendo sacos_abiertos → 500 (no se muestra stock de granel sin sus gramos)", async () => {
    fakeActual = crearFakeSupabase((tabla) => (tabla === "sacos_abiertos" ? { error: { code: "57014" } } : { data: [GRANEL] }));
    const res = await INVENTARIO_GET(req("/api/inventario"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error interno del servidor" });
    const sacos = fakeActual.consultas.find((c) => c.tabla === "sacos_abiertos")!.ops;
    expect(tiene(sacos, "eq", "store_id", STORE) && tiene(sacos, "is", "cerrado_at", null)).toBe(true);
  });

  it("I-718: GET /api/productos (POS) — error leyendo sacos_abiertos → 500 (el POS no decide aperturas sin los gramos, G1)", async () => {
    fakeActual = crearFakeSupabase((tabla) => (tabla === "sacos_abiertos" ? { error: { code: "57014" } } : { data: [GRANEL] }));
    const res = await PRODUCTOS_GET(req("/api/productos?search=alim"));
    expect(res.status).toBe(500);
    // Sin productos de granel no se consulta sacos_abiertos.
    fakeActual = crearFakeSupabase(() => ({ data: [{ ...GRANEL, precio_venta_kg: null }] }));
    expect((await PRODUCTOS_GET(req("/api/productos"))).status).toBe(200);
    expect(fakeActual.consultas.some((c) => c.tabla === "sacos_abiertos")).toBe(false);
  });
});

describe("PATCH /api/productos/[id] — activar vencimientos (D11)", () => {
  function montar() {
    fakeActual = crearFakeSupabase((tabla, ops) => {
      if (tabla === "productos" && tiene(ops, "update")) {
        return { data: { id: PROD, nombre: "Arena", stock: 5, fecha_vencimiento: "2026-12-31", precio: 5990, activo: true } };
      }
      if (tabla === "productos") return { data: { id: PROD, stock: 5, imagen_url: null, imagen_url_2: null } };
      return { data: null };
    });
  }
  const patch = () => PRODUCTO_PATCH(json(`/api/productos/${PROD}`, "PATCH", { fecha_vencimiento: "2026-12-31" }), params(PROD));
  const auditoriasDeLote = () => mockLogAudit.mock.calls.map((c) => c[0]).filter((a) => a.entityType === "lote_producto");

  it("I-719: la conversión a LOTE-0 falla → el PATCH responde 200 y queda auditado como fallo (result failure)", async () => {
    montar();
    fakeActual.rpc.mockResolvedValue({ data: null, error: { message: "Producto con lotes" } });
    const res = await patch();
    expect(res.status).toBe(200);
    expect(fakeActual.rpc).toHaveBeenCalledWith("convertir_stock_suelto_a_lote", {
      p_store_id: STORE, p_producto_id: PROD, p_fecha_vencimiento: "2026-12-31",
    });
    expect(auditoriasDeLote()).toEqual([
      expect.objectContaining({ result: "failure", errorMessage: "Producto con lotes", storeId: STORE }),
    ]);
  });

  it("I-720: la RPC es no-op (ya tenía lotes → null) → sin auditoría de lote; con lote creado → auditoría con su id", async () => {
    montar();
    fakeActual.rpc.mockResolvedValue({ data: null, error: null });
    expect((await patch()).status).toBe(200);
    expect(auditoriasDeLote()).toEqual([]);

    mockLogAudit.mockClear();
    montar();
    fakeActual.rpc.mockResolvedValue({ data: { id: "lote-0" }, error: null });
    await patch();
    expect(auditoriasDeLote()).toEqual([expect.objectContaining({ entityId: "lote-0", action: "CREATE" })]);
  });
});

describe("Hub tras merma de saco / conteo físico", () => {
  it("I-721: si el producto no se puede releer, la merma y el conteo responden igual pero NO sincronizan al Hub", async () => {
    fakeActual = crearFakeSupabase(() => ({ data: null }));
    fakeActual.rpc.mockResolvedValue({
      data: { saco: { id: "saco-1", gramos_iniciales: 15000, gramos_restantes: 0 }, gramos_merma: 300, stock: 2 },
      error: null,
    });
    const merma = await SACO(json(`/api/productos/${PROD}/saco`, "POST", { accion: "merma", motivo: "Resto húmedo" }), params(PROD));
    expect(merma.status).toBe(200);
    // Se intentó releer el producto por tienda.
    const lectura = fakeActual.consultas.find((c) => c.tabla === "productos")!.ops;
    expect(tiene(lectura, "eq", "store_id", STORE)).toBe(true);

    fakeActual = crearFakeSupabase(() => ({ data: null }));
    fakeActual.rpc.mockResolvedValue({
      data: { stock_anterior: 3, stock_nuevo: 2, cantidad_anterior: 3, cantidad_contada: 2, delta: -1, lote_id: null },
      error: null,
    });
    const conteo = await CONTEO(json(`/api/inventario/${PROD}/conteo`, "POST", { stock_contado: 2, motivo: "Conteo mensual" }), params(PROD));
    expect(conteo.status).toBe(200);
    expect(mockSync).not.toHaveBeenCalled();
  });
});
