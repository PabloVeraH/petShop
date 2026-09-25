/**
 * Tests I-680 a I-690: seguridad, contabilidad y operación de canales (Fase 5
 * de docs/canales-stock/stock_canales_externos.md).
 *   - 5.1 matriz de autorización de TODO /api/canales/** (C15, §5.4):
 *     401 sin sesión, 403 usuario deshabilitado, 403 storeWorker en rutas de
 *     admin; el storeWorker solo lista pedidos y marca "lista" (D8).
 *   - 5.2 liquidaciones (D17/D24): asiento, tenant, validación, período
 *     cerrado, duplicado, compensación si el asiento falla (V25).
 *   - 5.3 alertas y reintento de llamadas 'dead'; estado del menú al publicar.
 *
 * Supabase simulado (tests/helpers/fake-supabase). Los CHECK/UNIQUE de la
 * migración 083 se verifican contra la BD real con
 * docs/canales-stock/stock_canales_fase5_verificacion.sql.
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
const mockDeshabilitado = jest.fn();
jest.mock("@/lib/usuario-habilitado", () => ({ usuarioDeshabilitado: (...a: unknown[]) => mockDeshabilitado(...a) }));
const mockCrearAsiento = jest.fn();
jest.mock("@/lib/contabilidad/generador-asientos", () => {
  const actual = jest.requireActual("@/lib/contabilidad/generador-asientos");
  return { ...actual, crearAsiento: (...a: unknown[]) => mockCrearAsiento(...a) };
});
const mockCierres = jest.fn();
jest.mock("@/lib/contabilidad/cierre-mes", () => ({ checkExistingCierre: (...a: unknown[]) => mockCierres(...a) }));
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

import * as config from "@/app/api/canales/config/route";
import * as productos from "@/app/api/canales/[canal]/productos/route";
import * as catalog from "@/app/api/canales/catalog/route";
import * as orders from "@/app/api/canales/orders/route";
import * as ready from "@/app/api/canales/orders/[id]/ready/route";
import * as retry from "@/app/api/canales/orders/[id]/retry/route";
import * as liquidacion from "@/app/api/canales/liquidacion/route";
import * as alertas from "@/app/api/canales/alertas/route";
import * as igPosts from "@/app/api/canales/instagram/posts/route";
import * as igPost from "@/app/api/canales/instagram/posts/[id]/route";
import * as igUpload from "@/app/api/canales/instagram/upload/route";
import { procesarOutbox } from "@/lib/canales/application/outbox";
import { RappiAdapter } from "@/lib/canales/adapters/rappi/adapter";
import { CUENTAS } from "@/lib/contabilidad/types";

const STORE = "123e4567-e89b-12d3-a456-426614174000";
const OTRA = "123e4567-e89b-12d3-a456-4266141740ff";
const ID = "323e4567-e89b-12d3-a456-426614174001";
const LIQ = "423e4567-e89b-12d3-a456-426614174001";
const ASIENTO = "523e4567-e89b-12d3-a456-426614174001";

const ADMIN = { sessionClaims: { sub: "u1", publicMetadata: { storeId: STORE, storeAdmin: true } } };
const WORKER = { sessionClaims: { sub: "u2", publicMetadata: { storeId: STORE, storeWorker: true } } };
const ADMIN_OTRA = { sessionClaims: { sub: "u3", publicMetadata: { storeId: OTRA, storeAdmin: true } } };

const envOriginal = process.env.ENABLED_CHANNELS;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.ENABLED_CHANNELS = "rappi";
  mockLogAudit.mockResolvedValue(undefined);
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE });
  mockAuth.mockResolvedValue(ADMIN);
  mockDeshabilitado.mockResolvedValue(false);
  mockCierres.mockResolvedValue(0);
  mockCrearAsiento.mockResolvedValue(ASIENTO);
  fakeActual = crearFakeSupabase(() => ({ data: null }));
  fakeActual.rpc.mockResolvedValue({ data: [], error: null });
});
afterAll(() => {
  process.env.ENABLED_CHANNELS = envOriginal;
});

const upd = (ops: Op[]) => argsDe(ops, "update")?.[0] as Record<string, unknown> | undefined;
const ins = (ops: Op[]) => argsDe(ops, "insert")?.[0] as Record<string, unknown> | undefined;
const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  } as never);
const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });

type Llamada = () => Promise<Response>;
const RUTAS_ADMIN: [string, Llamada][] = [
  ["GET config", () => config.GET(req("/api/canales/config"))],
  ["POST config", () => config.POST(req("/api/canales/config", "POST", { canal_id: "rappi", credenciales: {} }))],
  ["PATCH config", () => config.PATCH(req("/api/canales/config", "PATCH", { canal_id: "rappi", recargo_pct: 5 }))],
  ["GET productos", () => productos.GET(req("/x"), p({ canal: "rappi" }))],
  ["PUT productos", () => productos.PUT(req("/x", "PUT", { producto_id: ID, habilitado: true }), p({ canal: "rappi" }))],
  ["POST catalog", () => catalog.POST(req("/x", "POST", { canal_id: "rappi" }))],
  ["POST retry", () => retry.POST(req("/x", "POST"), p({ id: ID }))],
  ["GET liquidacion", () => liquidacion.GET(req("/api/canales/liquidacion"))],
  ["POST liquidacion", () => liquidacion.POST(req("/x", "POST", {}))],
  ["GET alertas", () => alertas.GET()],
  ["POST alertas", () => alertas.POST(req("/x", "POST", { id: ID }))],
  ["GET instagram posts", () => igPosts.GET(req("/api/canales/instagram/posts"))],
  ["POST instagram posts", () => igPosts.POST(req("/x", "POST", {}))],
  ["PATCH instagram post", () => igPost.PATCH(req("/x", "PATCH", {}), p({ id: ID }))],
  ["DELETE instagram post", () => igPost.DELETE(req("/x", "DELETE"), p({ id: ID }))],
  ["POST instagram upload", () => igUpload.POST(req("/x", "POST"))],
];
const RUTAS_TIENDA: [string, Llamada][] = [
  ["GET orders", () => orders.GET(req("/api/canales/orders"))],
  ["POST ready", () => ready.POST(req("/x", "POST"), p({ id: ID }))],
];

// ─── 5.1 Matriz de autorización ─────────────────────────────────────────────
describe("autorización de /api/canales/** (5.1)", () => {
  it.each([...RUTAS_ADMIN, ...RUTAS_TIENDA])("I-680: %s — sin sesión → 401 sin tocar la BD", async (_n, llamar) => {
    mockGetStoreId.mockResolvedValue(null);
    expect((await llamar()).status).toBe(401);
    expect(fakeActual.consultas).toHaveLength(0);
    expect(mockDeshabilitado).not.toHaveBeenCalled();
  });

  it.each([...RUTAS_ADMIN, ...RUTAS_TIENDA])("I-681: %s — usuario deshabilitado → 403 sin tocar la BD", async (_n, llamar) => {
    mockDeshabilitado.mockResolvedValue(true);
    expect((await llamar()).status).toBe(403);
    expect(mockDeshabilitado).toHaveBeenCalledWith("u1");
    expect(fakeActual.consultas).toHaveLength(0);
  });

  it.each(RUTAS_ADMIN)("I-682: %s — storeWorker o admin de OTRA tienda → 403 (D8)", async (_n, llamar) => {
    for (const sesion of [WORKER, ADMIN_OTRA]) {
      mockAuth.mockResolvedValue(sesion);
      expect((await llamar()).status).toBe(403);
    }
    expect(fakeActual.consultas).toHaveLength(0);
  });

  it.each(RUTAS_TIENDA)("I-683: %s — el storeWorker SÍ puede (lista pedidos / marca lista)", async (_n, llamar) => {
    mockAuth.mockResolvedValue(WORKER);
    expect([200, 404]).toContain((await llamar()).status);
    expect(fakeActual.consultas.length).toBeGreaterThan(0);
  });
});

// ─── 5.2 Liquidaciones ──────────────────────────────────────────────────────
describe("POST /api/canales/liquidacion (5.2, D24)", () => {
  const BODY = {
    canal_id: "rappi",
    periodo_desde: "2026-09-01",
    periodo_hasta: "2026-09-15",
    fecha_deposito: "2026-09-20",
    monto_bruto: 100000,
    comision: 23800,
    referencia: "LIQ-123",
  };
  function montar(opts: { insertError?: unknown } = {}) {
    fakeActual = crearFakeSupabase((tabla, ops) => {
      if (tabla === "canal_liquidaciones" && ins(ops)) return opts.insertError ? { error: opts.insertError } : { data: { id: LIQ } };
      return { data: null };
    });
    return fakeActual;
  }
  const post = (body: unknown) => liquidacion.POST(req("/api/canales/liquidacion", "POST", body));

  it("I-684: registra con store de la sesión y neto calculado, asiento D24 balanceado y vinculado, auditoría", async () => {
    const fake = montar();
    const res = await post(BODY);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: LIQ, journal_entry_id: ASIENTO, monto_neto: 76200 });

    const insert = fake.consultas.find((c) => ins(c.ops))!;
    expect(ins(insert.ops)).toEqual({
      store_id: STORE,
      canal_id: "rappi",
      periodo_desde: "2026-09-01",
      periodo_hasta: "2026-09-15",
      monto_bruto: 100000,
      comision: 23800,
      monto_neto: 76200,
      referencia: "LIQ-123",
    });
    const asiento = mockCrearAsiento.mock.calls[0][0];
    expect(asiento).toMatchObject({ storeId: STORE, fecha: "2026-09-20", tipoMovimiento: "LIQUIDACION_CANAL", referenciaId: LIQ });
    const porCuenta = Object.fromEntries(asiento.lineas.map((l: { cuentaCodigo: string; debito: number; credito: number }) => [l.cuentaCodigo, l.debito - l.credito]));
    expect(porCuenta).toEqual({
      [CUENTAS.BANCO.codigo]: 76200,
      [CUENTAS.COMISIONES_CANAL.codigo]: 20000,
      [CUENTAS.IVA_CREDITO_FISCAL.codigo]: 3800,
      [CUENTAS.CXC_RAPPI.codigo]: -100000,
    });
    const vinculo = fake.consultas.find((c) => upd(c.ops)?.journal_entry_id === ASIENTO)!;
    expect(tiene(vinculo.ops, "eq", "id", LIQ) && tiene(vinculo.ops, "eq", "store_id", STORE)).toBe(true);
    expect(mockCierres).toHaveBeenCalledWith(expect.anything(), STORE, "2026-09");
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "canal_liquidaciones", entityId: LIQ, storeId: STORE }));
  });

  it("I-685: validación — store_id/monto_neto del cliente, comisión > bruto, período invertido, decimales, fecha → 400 sin BD", async () => {
    const fake = montar();
    for (const cambio of [
      { store_id: OTRA },
      { monto_neto: 1 },
      { comision: 100001 },
      { periodo_desde: "2026-09-16" },
      { monto_bruto: 1000.5 },
      { comision: -1 },
      { fecha_deposito: "20-09-2026" },
      { canal_id: "pos" },
    ]) {
      expect((await post({ ...BODY, ...cambio })).status).toBe(400);
    }
    expect(fake.consultas).toHaveLength(0);
    expect(mockCrearAsiento).not.toHaveBeenCalled();
  });

  it("I-686: período contable cerrado → 409 sin insertar; liquidación duplicada (UNIQUE 083) → 409 sin asiento", async () => {
    mockCierres.mockResolvedValueOnce(1);
    let fake = montar();
    expect((await post(BODY)).status).toBe(409);
    expect(fake.consultas.some((c) => ins(c.ops))).toBe(false);

    fake = montar({ insertError: { code: "23505" } });
    const res = await post(BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/Ya existe/) });
    expect(mockCrearAsiento).not.toHaveBeenCalled();
  });

  it("I-687: el asiento falla (null o excepción) → se elimina la liquidación (compensación por tienda) y 500", async () => {
    for (const falla of [() => mockCrearAsiento.mockResolvedValueOnce(null), () => mockCrearAsiento.mockRejectedValueOnce(new Error("env"))]) {
      falla();
      const fake = montar();
      expect((await post(BODY)).status).toBe(500);
      const del = fake.consultas.find((c) => tiene(c.ops, "delete"))!;
      expect(del.tabla).toBe("canal_liquidaciones");
      expect(tiene(del.ops, "eq", "id", LIQ) && tiene(del.ops, "eq", "store_id", STORE)).toBe(true);
    }
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("I-688: GET lista solo la tienda de la sesión, filtra por canal validado", async () => {
    fakeActual = crearFakeSupabase(() => ({ data: [{ id: LIQ }] }));
    let res = await liquidacion.GET(req("/api/canales/liquidacion?canal=rappi"));
    expect(res.status).toBe(200);
    const q = fakeActual.consultas[0];
    expect(tiene(q.ops, "eq", "store_id", STORE) && tiene(q.ops, "eq", "canal_id", "rappi")).toBe(true);
    res = await liquidacion.GET(req("/api/canales/liquidacion?canal=otro"));
    expect(res.status).toBe(400);
  });
});

// ─── 5.3 Alertas y estado del menú ─────────────────────────────────────────
describe("alertas de canales (5.3)", () => {
  it("I-689: GET arma alertas desde outbox detenida/reintentando, pedidos fallidos y menú rechazado de ESTA tienda", async () => {
    fakeActual = crearFakeSupabase((tabla) => {
      if (tabla === "canal_outbox") {
        return {
          data: [
            { id: "j1", canal_id: "rappi", tipo: "confirm", estado: "dead", intentos: 8, last_error: "Rappi: PUT /orders respondió 503", updated_at: "t" },
            { id: "j2", canal_id: "rappi", tipo: "availability", estado: "pending", intentos: 3, last_error: "Rappi: autenticación rechazada (401)", updated_at: "t" },
          ],
        };
      }
      if (tabla === "canal_ordenes") return { data: [{ id: "o1", canal_id: "rappi", external_order_id: "EXT-9", ultimo_error: "x", updated_at: "t" }] };
      if (tabla === "canal_config") return { data: [{ canal_id: "rappi", menu_detalle: "Faltan imágenes", menu_estado_at: "t" }] };
      return { data: null };
    });
    const res = await alertas.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alertas.map((a: { tipo: string }) => a.tipo).sort()).toEqual(
      ["credenciales", "llamada_detenida", "llamada_reintentando", "menu_rechazado", "orden_fallida"].sort()
    );
    expect(body.alertas.find((a: { tipo: string }) => a.tipo === "llamada_detenida").outbox_id).toBe("j1");
    for (const c of fakeActual.consultas) expect(tiene(c.ops, "eq", "store_id", STORE)).toBe(true);
    const outbox = fakeActual.consultas.find((c) => c.tabla === "canal_outbox")!;
    expect(tiene(outbox.ops, "or", "estado.eq.dead,and(estado.eq.pending,intentos.gte.2)")).toBe(true);
  });

  it("I-690: POST reintenta UNA llamada dead de la tienda (dead → pending, intentos 0); ajena/no dead → 404; duplicada → 409; id inválido → 400", async () => {
    fakeActual = crearFakeSupabase((tabla, ops) =>
      tabla === "canal_outbox" && upd(ops) ? { data: [{ id: ID, canal_id: "rappi", tipo: "confirm" }] } : { data: null }
    );
    const res = await alertas.POST(req("/x", "POST", { id: ID }));
    expect(res.status).toBe(200);
    const u = fakeActual.consultas.find((c) => upd(c.ops))!;
    expect(upd(u.ops)).toMatchObject({ estado: "pending", intentos: 0, last_error: null });
    expect(tiene(u.ops, "eq", "id", ID) && tiene(u.ops, "eq", "store_id", STORE) && tiene(u.ops, "eq", "estado", "dead")).toBe(true);
    expect(fakeActual.rpc).toHaveBeenCalledWith("claim_canal_outbox", { p_limit: 5 });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "canal_outbox", entityId: ID }));

    fakeActual = crearFakeSupabase(() => ({ data: [] }));
    expect((await alertas.POST(req("/x", "POST", { id: ID }))).status).toBe(404);
    fakeActual = crearFakeSupabase(() => ({ error: { code: "23505" } }));
    expect((await alertas.POST(req("/x", "POST", { id: ID }))).status).toBe(409);
    expect((await alertas.POST(req("/x", "POST", { id: "no-uuid" }))).status).toBe(400);
    expect((await alertas.POST(req("/x", "POST", { id: ID, store_id: OTRA }))).status).toBe(400);
  });

  it("I-691: publicar el catálogo con éxito deja menu_estado = 'enviado' para la tienda/canal", async () => {
    const pushCatalog = jest.spyOn(RappiAdapter.prototype, "pushCatalog").mockResolvedValue();
    mockLoadCtx.mockResolvedValue({ storeId: STORE, canalId: "rappi", externalStoreId: "9", credentials: {}, recargoPct: 0, comisionPct: 0 });
    fakeActual = crearFakeSupabase((tabla, ops) => {
      if (tabla === "canal_producto_config" && tiene(ops, "select")) {
        return {
          data: [{
            producto_id: ID, precio_override: null, categoria_canal: null, descripcion_canal: null,
            productos: { id: ID, store_id: STORE, sku: "S", nombre: "N", precio: 1000, precio_oferta: null, en_oferta: false, activo: true, imagen_url: null, categorias: null },
          }],
        };
      }
      if (tabla === "canal_config" && upd(ops)) return { data: [{ id: "cfg-1" }] };
      return { data: null };
    });
    fakeActual.rpc.mockResolvedValue({ data: [{ id: "job", store_id: STORE, canal_id: "rappi", tipo: "catalog", canal_orden_id: null, payload: {}, intentos: 1 }], error: null });
    expect(await procesarOutbox(fakeActual.client, 5)).toMatchObject({ hechos: 1 });
    const menu = fakeActual.consultas.find((c) => c.tabla === "canal_config" && upd(c.ops))!;
    expect(upd(menu.ops)).toMatchObject({ menu_estado: "enviado", menu_detalle: null });
    expect(tiene(menu.ops, "eq", "store_id", STORE) && tiene(menu.ops, "eq", "canal_id", "rappi")).toBe(true);
    pushCatalog.mockRestore();
  });
});
