/**
 * Tests I-661 a I-675: catálogo, precios y disponibilidad por canal (Fase 4
 * de docs/canales-stock/stock_canales_externos.md).
 *   - publicarDisponibilidad / publicarCatalogo vía el worker de la outbox
 *     (4.2, 4.5), con el adaptador real de Rappi y fetch simulado.
 *   - Criterio de salida de la fase: una venta que deja el producto en su
 *     mínimo → exactamente UNA llamada "apagar"; una recepción de OC → UNA
 *     llamada "encender".
 *   - Rutas: GET/PUT /api/canales/[canal]/productos, POST /api/canales/catalog,
 *     PATCH recargo_pct en /api/canales/config, cron canales-reconciliar.
 *
 * Supabase se simula (tests/helpers/fake-supabase). El trigger de
 * disponibilidad (encola al cruzar el mínimo en ambos sentidos, no encola si
 * no cambia, coalescencia) es SQL: se verifica contra la BD real con
 * docs/canales-stock/stock_canales_fase4_verificacion.sql (BEGIN … ROLLBACK).
 */
import { NextRequest } from "next/server";
import { crearFakeSupabase, tiene, argsDe, type Op } from "../../helpers/fake-supabase";

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
const mockLoadCtx = jest.fn();
jest.mock("@/lib/canales/infrastructure/context", () => {
  const actual = jest.requireActual("@/lib/canales/infrastructure/context");
  return { ...actual, loadChannelContext: (...a: unknown[]) => mockLoadCtx(...a) };
});
let fakeActual: ReturnType<typeof crearFakeSupabase>;
jest.mock("@/lib/supabase", () => ({ createServiceClient: () => fakeActual.client }));
const mockGetStoreId = jest.fn();
jest.mock("@/lib/auth", () => ({ getStoreId: () => mockGetStoreId() }));
const mockAuth = jest.fn();
jest.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

import { procesarOutbox } from "@/lib/canales/application/outbox";
import { publicarDisponibilidad } from "@/lib/canales/application/disponibilidad";
import { RappiAdapter } from "@/lib/canales/adapters/rappi/adapter";
import { limpiarCacheTokens } from "@/lib/canales/adapters/rappi/client";
import { GET as LISTAR, PUT as GUARDAR } from "@/app/api/canales/[canal]/productos/route";
import { POST as PUBLICAR } from "@/app/api/canales/catalog/route";
import { PATCH as CONFIG_PATCH } from "@/app/api/canales/config/route";
import { POST as RECONCILIAR } from "@/app/api/cron/canales-reconciliar/route";

const STORE = "123e4567-e89b-12d3-a456-426614174000";
const OTRA = "123e4567-e89b-12d3-a456-4266141740ff";
const P1 = "323e4567-e89b-12d3-a456-426614174001";
const P2 = "323e4567-e89b-12d3-a456-426614174002";
const CTX = {
  storeId: STORE,
  canalId: "rappi" as const,
  externalStoreId: "900",
  credentials: { client_id: "cid", client_secret: "csec" },
  recargoPct: 15,
  comisionPct: 0,
};

const fetchMock = jest.fn();
const envOriginal = { ENABLED_CHANNELS: process.env.ENABLED_CHANNELS, CRON_SECRET: process.env.CRON_SECRET };
const fetchOriginal = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  limpiarCacheTokens();
  process.env.ENABLED_CHANNELS = "rappi";
  process.env.CRON_SECRET = "secreto-cron";
  mockLogAudit.mockResolvedValue(undefined);
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE });
  mockAuth.mockResolvedValue({ sessionClaims: { sub: "u1", publicMetadata: { storeId: STORE, storeAdmin: true } } });
  mockLoadCtx.mockResolvedValue(CTX);
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/token/")) return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, status: 200, json: async () => ({}) };
  });
});
afterAll(() => {
  Object.assign(process.env, envOriginal);
  global.fetch = fetchOriginal;
});

const upd = (ops: Op[]) => argsDe(ops, "update")?.[0] as Record<string, unknown> | undefined;
const ins = (ops: Op[]) => argsDe(ops, "insert")?.[0] as Record<string, unknown> | undefined;
const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init as never);
const json = (body: unknown, method = "POST") => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const params = (canal: string) => ({ params: Promise.resolve({ canal }) });
const llamadasPlataforma = () => fetchMock.mock.calls.filter(([url]) => !String(url).includes("/token/"));
const cuerpo = (i: number) => JSON.parse(String(llamadasPlataforma()[i][1].body));
const soloWorker = () =>
  mockAuth.mockResolvedValue({ sessionClaims: { sub: "u2", publicMetadata: { storeId: STORE, storeWorker: true } } });

const estado = (sku: string, disponible: boolean, publicado: boolean | null, cupo = 3) => ({
  producto_id: `p-${sku}`,
  sku,
  disponible,
  cupo,
  ultimo_disponible_publicado: publicado,
  ultima_cantidad_publicada: null,
});

// ─── publicarDisponibilidad (4.2) ───────────────────────────────────────────
describe("publicarDisponibilidad", () => {
  function montar(filas: unknown[]) {
    const fake = crearFakeSupabase(() => ({ data: null }));
    fake.rpc.mockResolvedValue({ data: filas, error: null });
    return fake;
  }

  it("I-661: lee el estado ACTUAL (RPC por tienda/canal), envía solo los cambios y registra lo publicado", async () => {
    const fake = montar([estado("A", true, true), estado("B", false, true, 0), estado("C", true, false)]);
    const n = await publicarDisponibilidad(fake.client, new RappiAdapter(), CTX, false);
    expect(n).toBe(2);
    expect(fake.rpc).toHaveBeenCalledWith("estado_disponibilidad_canal", { p_store_id: STORE, p_canal_id: "rappi" });
    expect(llamadasPlataforma()).toHaveLength(1);
    expect(cuerpo(0)).toEqual([{ store_integration_id: "900", items: { turn_on: ["C"], turn_off: ["B"] } }]);

    const updates = fake.consultas.filter((c) => c.tabla === "canal_producto_config" && upd(c.ops));
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      expect(tiene(u.ops, "eq", "store_id", STORE) && tiene(u.ops, "eq", "canal_id", "rappi")).toBe(true);
      expect(upd(u.ops)).toHaveProperty("ultima_cantidad_publicada", null);
    }
    const apagado = updates.find((u) => upd(u.ops)?.ultimo_disponible_publicado === false)!;
    expect(tiene(apagado.ops, "in", "producto_id", ["p-B"])).toBe(true);
  });

  it("I-662: sin cambios respecto de lo publicado → ninguna llamada ni escritura; completo → republica todo", async () => {
    const filas = [estado("A", true, true), estado("B", false, false, 0)];
    let fake = montar(filas);
    expect(await publicarDisponibilidad(fake.client, new RappiAdapter(), CTX, false)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.consultas).toHaveLength(0);

    fake = montar(filas);
    expect(await publicarDisponibilidad(fake.client, new RappiAdapter(), CTX, true)).toBe(2);
    expect(cuerpo(0)[0].items).toEqual({ turn_on: ["A"], turn_off: ["B"] });
  });

  it("I-663: criterio de salida — venta que deja el producto en su mínimo → UNA llamada 'apagar'; recepción de OC → UNA 'encender'", async () => {
    // Tras la venta POS: cupo 0 (stock = mínimo); lo publicado era "disponible".
    await publicarDisponibilidad(montar([estado("SKU-A", false, true, 0)]).client, new RappiAdapter(), CTX, false);
    // Reintento del mismo trabajo ya registrado: nada que enviar.
    await publicarDisponibilidad(montar([estado("SKU-A", false, false, 0)]).client, new RappiAdapter(), CTX, false);
    // Tras recibir la OC: cupo > 0; lo publicado era "apagado".
    await publicarDisponibilidad(montar([estado("SKU-A", true, false, 12)]).client, new RappiAdapter(), CTX, false);

    expect(llamadasPlataforma()).toHaveLength(2);
    expect(cuerpo(0)[0].items).toEqual({ turn_on: [], turn_off: ["SKU-A"] });
    expect(cuerpo(1)[0].items).toEqual({ turn_on: ["SKU-A"], turn_off: [] });
  });
});

// ─── Worker de la outbox: availability / catalog (4.2, 4.5) ─────────────────
describe("procesarOutbox — trabajos de tienda", () => {
  const trabajo = (tipo: string, payload: Record<string, unknown> = {}, intentos = 1) => ({
    id: "job-1",
    store_id: STORE,
    canal_id: "rappi",
    tipo,
    canal_orden_id: null,
    payload,
    intentos,
  });

  it("I-664: availability → publica y, al terminar, re-verifica cambios ocurridos durante el proceso (encolar_disponibilidad_canal)", async () => {
    const fake = crearFakeSupabase(() => ({ data: null }));
    fake.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === "claim_canal_outbox") return { data: [trabajo("availability")], error: null };
      if (nombre === "estado_disponibilidad_canal") return { data: [estado("A", false, true, 0)], error: null };
      return { data: 0, error: null };
    });
    const r = await procesarOutbox(fake.client, 5);
    expect(r).toMatchObject({ reclamados: 1, hechos: 1 });
    expect(llamadasPlataforma()).toHaveLength(1);
    const done = fake.consultas.find((c) => c.tabla === "canal_outbox" && upd(c.ops)?.estado === "done");
    expect(done).toBeDefined();
    expect(fake.rpc).toHaveBeenLastCalledWith("encolar_disponibilidad_canal", { p_store_id: STORE, p_canal_id: "rappi" });
  });

  it("I-665: catalog → solo habilitados con precio del canal; marca publicado, retira el resto y encola disponibilidad completa", async () => {
    const pushCatalog = jest.spyOn(RappiAdapter.prototype, "pushCatalog");
    const fake = crearFakeSupabase((tabla, ops) => {
      if (tabla === "canal_producto_config" && tiene(ops, "select")) {
        return {
          data: [
            {
              producto_id: P1,
              precio_override: null,
              categoria_canal: null,
              descripcion_canal: null,
              productos: { id: P1, store_id: STORE, sku: "SKU-1", nombre: "Alimento", precio: 10000, precio_oferta: null, en_oferta: false, activo: true, imagen_url: null, categorias: { nombre: "Alimentos" } },
            },
            {
              producto_id: P2,
              precio_override: 4990,
              categoria_canal: null,
              descripcion_canal: null,
              productos: { id: P2, store_id: STORE, sku: "SKU-2", nombre: "Snack", precio: 3000, precio_oferta: null, en_oferta: false, activo: true, imagen_url: null, categorias: null },
            },
          ],
        };
      }
      return { data: null };
    });
    fake.rpc.mockResolvedValue({ data: [trabajo("catalog")], error: null });

    expect(await procesarOutbox(fake.client, 5)).toMatchObject({ hechos: 1 });

    const lectura = fake.consultas.find((c) => c.tabla === "canal_producto_config" && tiene(c.ops, "select"))!;
    expect(tiene(lectura.ops, "eq", "store_id", STORE) && tiene(lectura.ops, "eq", "canal_id", "rappi") && tiene(lectura.ops, "eq", "activo", true)).toBe(true);
    const items = pushCatalog.mock.calls[0][1];
    expect(items.map((i) => [i.sku, i.precioBruto])).toEqual([["SKU-1", 11500], ["SKU-2", 4990]]);
    expect(cuerpo(0).items[0]).toMatchObject({ sku: "SKU-1", price: 11500 });

    const marcado = fake.consultas.find((c) => upd(c.ops)?.publicado_at && tiene(c.ops, "in", "producto_id", [P1, P2]));
    expect(marcado && tiene(marcado.ops, "eq", "store_id", STORE)).toBe(true);
    const retiro = fake.consultas.find((c) => upd(c.ops)?.publicado_at === null)!;
    expect(tiene(retiro.ops, "not", "producto_id", "in", `(${P1},${P2})`) && tiene(retiro.ops, "eq", "store_id", STORE)).toBe(true);
    const encolado = fake.consultas.find((c) => c.tabla === "canal_outbox" && ins(c.ops))!;
    expect(ins(encolado.ops)).toMatchObject({
      store_id: STORE,
      canal_id: "rappi",
      tipo: "availability",
      payload: { completo: true },
      dedupe_key: `avail-full:${STORE}:rappi`,
    });
    pushCatalog.mockRestore();
  });

  it("I-666: catálogo vacío → NO llama a la plataforma (borraría el menú) y el trabajo muere sin reintentos", async () => {
    const fake = crearFakeSupabase(() => ({ data: [] }));
    fake.rpc.mockResolvedValue({ data: [trabajo("catalog")], error: null });
    const r = await procesarOutbox(fake.client, 5);
    expect(r).toMatchObject({ muertos: 1, reintentos: 0 });
    expect(llamadasPlataforma()).toHaveLength(0);
    const muerto = fake.consultas.find((c) => upd(c.ops)?.estado === "dead")!;
    expect(upd(muerto.ops)?.last_error).toMatch(/No hay productos habilitados/);
  });
});

// ─── GET /api/canales/[canal]/productos (4.3) ───────────────────────────────
describe("GET /api/canales/[canal]/productos", () => {
  function montar() {
    const fake = crearFakeSupabase((tabla) => {
      if (tabla === "canal_config") return { data: { activo: true, recargo_pct: 10 } };
      if (tabla === "productos") {
        return {
          data: [
            { id: P1, nombre: "Alimento", sku: "SKU-1", precio: 10000, precio_oferta: null, en_oferta: false, stock: 12, stock_minimo: 2, activo: true },
            { id: P2, nombre: "Inactivo", sku: "SKU-2", precio: 5000, precio_oferta: null, en_oferta: false, stock: 3, stock_minimo: 0, activo: false },
          ],
        };
      }
      if (tabla === "canal_producto_config") {
        return { data: [{ producto_id: P1, activo: true, precio_override: null, publicado_at: "2026-09-25T10:00:00Z", ultimo_disponible_publicado: true, disponibilidad_publicada_at: null }] };
      }
      return { data: null };
    });
    fake.rpc.mockResolvedValue({ data: [{ producto_id: P1, unidades_vendibles: 12, cupo: 10 }], error: null });
    fakeActual = fake;
    return fake;
  }

  it("I-667: devuelve productos activos de la tienda con precio del canal, cupo y estado publicado; todo filtrado por tienda", async () => {
    const fake = montar();
    const res = await LISTAR(req("/api/canales/rappi/productos"), params("rappi"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ canal: "rappi", activo: true, recargo_pct: 10 });
    expect(body.productos).toEqual([
      expect.objectContaining({ producto_id: P1, precio_base: 10000, precio_canal: 11000, habilitado: true, cupo: 10, disponible_publicado: true }),
    ]);
    for (const c of fake.consultas) expect(tiene(c.ops, "eq", "store_id", STORE)).toBe(true);
    expect(fake.rpc).toHaveBeenCalledWith("cupos_canal_tienda", { p_store_id: STORE });
  });

  it("I-668: 401 sin sesión, 403 storeWorker (D8), 404 canal desconocido y canal sin configurar", async () => {
    montar();
    mockGetStoreId.mockResolvedValueOnce(null);
    expect((await LISTAR(req("/x"), params("rappi"))).status).toBe(401);
    soloWorker();
    expect((await LISTAR(req("/x"), params("rappi"))).status).toBe(403);
    mockAuth.mockResolvedValue({ sessionClaims: { sub: "u1", publicMetadata: { storeId: STORE, storeAdmin: true } } });
    expect((await LISTAR(req("/x"), params("instagram"))).status).toBe(404);
    fakeActual = crearFakeSupabase(() => ({ data: null }));
    expect((await LISTAR(req("/x"), params("rappi"))).status).toBe(404);
  });
});

// ─── PUT /api/canales/[canal]/productos (4.3) ───────────────────────────────
describe("PUT /api/canales/[canal]/productos", () => {
  function montar(opts: { producto?: boolean; existente?: boolean } = {}) {
    const { producto = true, existente = false } = opts;
    fakeActual = crearFakeSupabase((tabla, ops) => {
      if (tabla === "productos") return { data: producto ? { id: P1, nombre: "Alimento" } : null };
      if (tabla === "canal_producto_config" && tiene(ops, "maybeSingle")) {
        return { data: existente ? { id: "cpc-1", activo: false, precio_override: null } : null };
      }
      if (tabla === "canal_producto_config" && (ins(ops) || upd(ops))) {
        const v = (ins(ops) ?? upd(ops))!;
        return { data: { id: "cpc-1", activo: v.activo, precio_override: v.precio_override ?? null } };
      }
      return { data: null };
    });
    return fakeActual;
  }
  const put = (body: unknown, canal = "rappi") => GUARDAR(req(`/api/canales/${canal}/productos`, json(body, "PUT")), params(canal));

  it("I-669: habilitar un producto nuevo → INSERT con store_id de la sesión + auditoría", async () => {
    const fake = montar();
    const res = await put({ producto_id: P1, habilitado: true, precio_override: 12990 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ producto_id: P1, habilitado: true, precio_override: 12990 });
    const insert = fake.consultas.find((c) => ins(c.ops))!;
    expect(ins(insert.ops)).toMatchObject({ store_id: STORE, canal_id: "rappi", producto_id: P1, activo: true, precio_override: 12990 });
    const prod = fake.consultas.find((c) => c.tabla === "productos")!;
    expect(tiene(prod.ops, "eq", "id", P1) && tiene(prod.ops, "eq", "store_id", STORE)).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "canal_producto_config", storeId: STORE, action: "CREATE" }));
  });

  it("I-670: existente → UPDATE filtrado por tienda; precio_override ausente no se toca, null lo quita", async () => {
    let fake = montar({ existente: true });
    await put({ producto_id: P1, habilitado: false });
    let u = fake.consultas.find((c) => upd(c.ops))!;
    expect(upd(u.ops)).not.toHaveProperty("precio_override");
    expect(upd(u.ops)).toMatchObject({ activo: false });
    expect(tiene(u.ops, "eq", "store_id", STORE)).toBe(true);

    fake = montar({ existente: true });
    await put({ producto_id: P1, habilitado: true, precio_override: null });
    u = fake.consultas.find((c) => upd(c.ops))!;
    expect(upd(u.ops)).toMatchObject({ precio_override: null });
  });

  it("I-671: producto de OTRA tienda (IDOR) → 404 sin escribir nada", async () => {
    const fake = montar({ producto: false });
    const res = await put({ producto_id: P1, habilitado: true });
    expect(res.status).toBe(404);
    expect(fake.consultas.some((c) => ins(c.ops) || upd(c.ops))).toBe(false);
  });

  it("I-672: validación — store_id en el body, precio 0/negativo/decimal/texto, id inválido → 400; 401 y 403", async () => {
    const fake = montar();
    for (const body of [
      { producto_id: P1, habilitado: true, store_id: OTRA },
      { producto_id: P1, habilitado: true, precio_override: 0 },
      { producto_id: P1, habilitado: true, precio_override: -10 },
      { producto_id: P1, habilitado: true, precio_override: 99.5 },
      { producto_id: P1, habilitado: true, precio_override: "1000" },
      { producto_id: "no-uuid", habilitado: true },
      { producto_id: P1 },
    ]) {
      expect((await put(body)).status).toBe(400);
    }
    expect(fake.consultas).toHaveLength(0);
    mockGetStoreId.mockResolvedValueOnce(null);
    expect((await put({ producto_id: P1, habilitado: true })).status).toBe(401);
    soloWorker();
    expect((await put({ producto_id: P1, habilitado: true })).status).toBe(403);
  });
});

// ─── POST /api/canales/catalog (4.5) ────────────────────────────────────────
describe("POST /api/canales/catalog", () => {
  function montar(opts: { config?: { id: string; activo: boolean } | null; habilitados?: number; outboxError?: unknown } = {}) {
    const { config = { id: "cfg-1", activo: true }, habilitados = 2, outboxError = null } = opts;
    fakeActual = crearFakeSupabase((tabla, ops) => {
      if (tabla === "canal_config") return { data: config };
      if (tabla === "canal_producto_config") return { data: null, count: habilitados };
      if (tabla === "canal_outbox" && ins(ops)) return { error: outboxError };
      return { data: null };
    });
    fakeActual.rpc.mockResolvedValue({ data: [], error: null });
    return fakeActual;
  }
  const publicar = (body: unknown) => PUBLICAR(req("/api/canales/catalog", json(body)));

  it("I-673: encola 'catalog' (dedupe por tienda/canal) → 202; si ya hay uno vivo → 202 ya_en_curso", async () => {
    let fake = montar();
    let res = await publicar({ canal_id: "rappi" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "encolado", habilitados: 2 });
    const encolado = fake.consultas.find((c) => c.tabla === "canal_outbox")!;
    expect(ins(encolado.ops)).toMatchObject({ store_id: STORE, canal_id: "rappi", tipo: "catalog", dedupe_key: `catalog:${STORE}:rappi` });
    for (const c of fake.consultas.filter((c) => c.tabla !== "canal_outbox")) expect(tiene(c.ops, "eq", "store_id", STORE)).toBe(true);
    expect(fake.rpc).toHaveBeenCalledWith("claim_canal_outbox", { p_limit: 5 });

    fake = montar({ outboxError: { code: "23505" } });
    res = await publicar({ canal_id: "rappi" });
    expect(await res.json()).toMatchObject({ status: "ya_en_curso" });
  });

  it("I-674: 401, 403 worker, 400 canal inválido, 409 canal no desplegado o inactivo, 404 sin config, 422 sin habilitados", async () => {
    montar();
    mockGetStoreId.mockResolvedValueOnce(null);
    expect((await publicar({ canal_id: "rappi" })).status).toBe(401);
    soloWorker();
    expect((await publicar({ canal_id: "rappi" })).status).toBe(403);
    mockAuth.mockResolvedValue({ sessionClaims: { sub: "u1", publicMetadata: { storeId: STORE, storeAdmin: true } } });
    expect((await publicar({ canal_id: "instagram" })).status).toBe(400);
    expect((await publicar({ canal_id: "pedidosya" })).status).toBe(409);
    montar({ config: null });
    expect((await publicar({ canal_id: "rappi" })).status).toBe(404);
    montar({ config: { id: "cfg-1", activo: false } });
    expect((await publicar({ canal_id: "rappi" })).status).toBe(409);
    const fake = montar({ habilitados: 0 });
    expect((await publicar({ canal_id: "rappi" })).status).toBe(422);
    expect(fake.consultas.some((c) => c.tabla === "canal_outbox")).toBe(false);
  });
});

// ─── PATCH recargo_pct (4.3) y cron de reconciliación (4.6) ────────────────
describe("PATCH /api/canales/config — recargo_pct", () => {
  function montar() {
    fakeActual = crearFakeSupabase((tabla, ops) => {
      if (tabla === "canal_config" && upd(ops)) return { data: { id: "cfg-1", canal_id: "rappi", activo: true, recargo_pct: upd(ops)!.recargo_pct } };
      return { data: null };
    });
    return fakeActual;
  }
  const patch = (body: unknown) => CONFIG_PATCH(req("/api/canales/config", json(body, "PATCH")));

  it("I-675: guarda el recargo filtrando por tienda; rechaza negativo, > 100 y más de 2 decimales; 403 worker", async () => {
    const fake = montar();
    const res = await patch({ canal_id: "rappi", recargo_pct: 12.5 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recargo_pct: 12.5 });
    const u = fake.consultas.find((c) => upd(c.ops))!;
    expect(upd(u.ops)).toMatchObject({ recargo_pct: 12.5 });
    expect(upd(u.ops)).not.toHaveProperty("activo");
    expect(tiene(u.ops, "eq", "store_id", STORE)).toBe(true);

    for (const recargo_pct of [-1, 100.01, 1.001]) {
      expect((await patch({ canal_id: "rappi", recargo_pct })).status).toBe(400);
    }
    soloWorker();
    expect((await patch({ canal_id: "rappi", recargo_pct: 5 })).status).toBe(403);
  });
});

describe("POST /api/cron/canales-reconciliar", () => {
  const cron = (auth?: string) =>
    RECONCILIAR(req("/api/cron/canales-reconciliar", { method: "POST", headers: auth ? { authorization: auth } : {} }));

  it("I-676: sin Bearer CRON_SECRET → 401 sin tocar la BD", async () => {
    fakeActual = crearFakeSupabase(() => ({ data: null }));
    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer otro")).status).toBe(401);
    expect(fakeActual.consultas).toHaveLength(0);
  });

  it("I-677: encola una disponibilidad COMPLETA por tienda/canal con catálogo publicado, canal activo y adaptador desplegado", async () => {
    const fake = crearFakeSupabase((tabla) => {
      if (tabla === "canal_producto_config") {
        return {
          data: [
            { store_id: STORE, canal_id: "rappi" },
            { store_id: STORE, canal_id: "rappi" },
            { store_id: OTRA, canal_id: "rappi" },       // canal inactivo en esa tienda
            { store_id: STORE, canal_id: "pedidosya" },  // sin adaptador desplegado
          ],
        };
      }
      if (tabla === "canal_config") return { data: [{ store_id: STORE, canal_id: "rappi" }, { store_id: STORE, canal_id: "pedidosya" }] };
      return { data: null };
    });
    fakeActual = fake;
    const res = await cron("Bearer secreto-cron");
    expect(await res.json()).toEqual({ ok: true, encolados: 1, omitidos: 2 });
    const lectura = fake.consultas.find((c) => c.tabla === "canal_producto_config")!;
    expect(tiene(lectura.ops, "not", "publicado_at", "is", null)).toBe(true);
    const inserts = fake.consultas.filter((c) => c.tabla === "canal_outbox" && ins(c.ops));
    expect(inserts).toHaveLength(1);
    expect(ins(inserts[0].ops)).toMatchObject({
      store_id: STORE,
      canal_id: "rappi",
      tipo: "availability",
      payload: { completo: true },
      dedupe_key: `avail-full:${STORE}:rappi`,
    });
  });
});
