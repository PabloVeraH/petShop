/**
 * Tests I-697 a I-715: ramas de canales externos sin cobertura en la suite de
 * las Fases 3–6 (auditoría de cobertura del 2026-09-26 sobre las líneas
 * cambiadas en feat/stockCanales): errores de BD que deben responder 500 sin
 * efectos a medias, caminos alternativos de procesarOrden / cancelación /
 * webhook, y filtros de las rutas.
 *
 * Supabase se simula con tests/helpers/fake-supabase (una consulta por from()).
 */
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { crearFakeSupabase, tiene, argsDe, type Op } from "../../helpers/fake-supabase";

const mockDeshabilitado = jest.fn().mockResolvedValue(false);
jest.mock("@/lib/usuario-habilitado", () => ({ usuarioDeshabilitado: (...a: unknown[]) => mockDeshabilitado(...a) }));
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
const mockCrearAsiento = jest.fn();
jest.mock("@/lib/contabilidad/generador-asientos", () => {
  const actual = jest.requireActual("@/lib/contabilidad/generador-asientos");
  return { ...actual, crearAsiento: (...a: unknown[]) => mockCrearAsiento(...a) };
});
const mockCierres = jest.fn();
jest.mock("@/lib/contabilidad/cierre-mes", () => ({ checkExistingCierre: (...a: unknown[]) => mockCierres(...a) }));
const mockSync = jest.fn();
jest.mock("@/lib/hub-sync", () => ({ syncProductsToHub: (...a: unknown[]) => mockSync(...a) }));
const mockAnular = jest.fn();
jest.mock("@/lib/ventas/anular-venta", () => ({ anularVenta: (...a: unknown[]) => mockAnular(...a) }));
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

import { procesarOrden, ORDEN_MAX_INTENTOS } from "@/lib/canales/application/procesar-orden";
import { cancelarOrdenCanal } from "@/lib/canales/application/cancelar-orden";
import { recibirEventoWebhook } from "@/lib/canales/application/recibir-evento";
import { RappiAdapter } from "@/lib/canales/adapters/rappi/adapter";
import { GET as PRODUCTOS_GET, PUT as PRODUCTOS_PUT } from "@/app/api/canales/[canal]/productos/route";
import { GET as ALERTAS_GET, POST as ALERTAS_POST } from "@/app/api/canales/alertas/route";
import { GET as LIQ_GET, POST as LIQ_POST } from "@/app/api/canales/liquidacion/route";
import { GET as ORDENES_GET } from "@/app/api/canales/orders/route";
import { POST as READY } from "@/app/api/canales/orders/[id]/ready/route";
import { POST as RETRY } from "@/app/api/canales/orders/[id]/retry/route";
import { POST as RECONCILIAR } from "@/app/api/cron/canales-reconciliar/route";
import { GET as PREPARACION } from "@/app/api/canales/[canal]/preparacion/route";

const STORE = "123e4567-e89b-12d3-a456-426614174000";
const ORDEN = "223e4567-e89b-12d3-a456-426614174001";
const P1 = "323e4567-e89b-12d3-a456-426614174001";
const JOB = "423e4567-e89b-12d3-a456-426614174001";
const CTX = { storeId: STORE, canalId: "rappi" as const, externalStoreId: "900105814", credentials: {}, recargoPct: 0, comisionPct: 0 };
const ADMIN = { sessionClaims: { sub: "u1", publicMetadata: { storeId: STORE, storeAdmin: true } } };

const envOriginal = { ENABLED_CHANNELS: process.env.ENABLED_CHANNELS, CRON_SECRET: process.env.CRON_SECRET };
let errSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.ENABLED_CHANNELS = "rappi";
  process.env.CRON_SECRET = "secreto-cron";
  mockLogAudit.mockResolvedValue(undefined);
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE });
  mockAuth.mockResolvedValue(ADMIN);
  mockDeshabilitado.mockResolvedValue(false);
  mockLoadCtx.mockResolvedValue(CTX);
  mockCrearAsiento.mockResolvedValue("asiento-1");
  mockCierres.mockResolvedValue(0);
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  warnSpy.mockRestore();
});
afterAll(() => Object.assign(process.env, envOriginal));

const upd = (ops: Op[]) => argsDe(ops, "update")?.[0] as Record<string, unknown> | undefined;
const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init as never);
const json = (url: string, method: string, body: unknown) =>
  req(url, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

// ─── procesarOrden: caminos alternativos ────────────────────────────────────
describe("procesarOrden — ramas", () => {
  const ITEMS = [{ sku: "SKU-A", nombre: "Alimento", cantidad: 1, precio_unitario_bruto: 11900 }];
  function montar(o: { canal?: string; intentos?: number; prodError?: unknown; productos?: unknown[]; actualizados?: unknown[] } = {}) {
    const { canal = "rappi", intentos = 0, prodError = null, productos = [{ id: "p-a", sku: "SKU-A", costo: 0, activo: true }], actualizados = [] } = o;
    let lecturasProductos = 0;
    const fake = crearFakeSupabase((tabla, ops) => {
      if (tabla === "canal_ordenes") {
        if (tiene(ops, "maybeSingle")) return { data: { intentos } };
        if (upd(ops)?.estado === "processing") {
          return { data: [{ id: ORDEN, canal_id: canal, external_order_id: "EXT-1", items: ITEMS, intentos: intentos + 1 }] };
        }
        return { data: null };
      }
      if (tabla === "productos") {
        lecturasProductos++;
        // 1ª lectura: SKU → producto. 2ª: productos actualizados para el Hub.
        return lecturasProductos === 1 ? { data: productos, error: prodError } : { data: actualizados };
      }
      return {};
    });
    fake.rpc.mockResolvedValue({
      data: { venta: { id: "venta-1", total: 11900, numero_comprobante: "N-1", created_at: "2026-09-26T12:00:00Z" }, created: true },
      error: null,
    });
    return fake;
  }
  const estadoFinal = (fake: ReturnType<typeof montar>) =>
    upd(fake.consultas.filter((c) => c.tabla === "canal_ordenes" && upd(c.ops)).pop()!.ops);

  it("I-697: canal desconocido en la orden → reintento (luego fallida), nunca venta ni rechazo a la plataforma", async () => {
    const fake = montar({ canal: "shopify" });
    expect(await procesarOrden(fake.client, STORE, ORDEN)).toEqual({ resultado: "reintentar", error: "Canal desconocido" });
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.consultas.some((c) => c.tabla === "canal_outbox")).toBe(false);
    expect(estadoFinal(fake)).toMatchObject({ estado: "pending", ultimo_error: "Canal desconocido" });

    const agotada = montar({ canal: "shopify", intentos: ORDEN_MAX_INTENTOS - 1 });
    expect((await procesarOrden(agotada.client, STORE, ORDEN)).resultado).toBe("fallida");
    expect(estadoFinal(agotada)).toMatchObject({ estado: "failed" });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ result: "failure", entityId: ORDEN }));
  });

  it("I-698: error leyendo productos → reintento sin venta (no se rechaza una orden por una falla transitoria)", async () => {
    const fake = montar({ prodError: { code: "57014" } });
    const r = await procesarOrden(fake.client, STORE, ORDEN);
    expect(r).toEqual({ resultado: "reintentar", error: "Error leyendo productos" });
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.consultas.some((c) => c.tabla === "canal_outbox")).toBe(false);
    const prod = fake.consultas.find((c) => c.tabla === "productos")!.ops;
    expect(tiene(prod, "eq", "store_id", STORE)).toBe(true);
  });

  it("I-699: crear_venta_tx rechaza la procedencia (CHECK 23514) → reintento + error de configuración logueado; otro error → reintento sin ese log", async () => {
    const fake = montar();
    fake.rpc.mockResolvedValue({ data: null, error: { code: "23514", message: 'new row violates check constraint "ventas_procedencia_check"' } });
    const r = await procesarOrden(fake.client, STORE, ORDEN);
    expect(r).toEqual({ resultado: "reintentar", error: "Error creando la venta (23514)" });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("no es una procedencia válida"));

    errSpy.mockClear();
    const otro = montar();
    otro.rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "violates check constraint total_positivo" } });
    expect((await procesarOrden(otro.client, STORE, ORDEN)).resultado).toBe("reintentar");
    expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining("procedencia"));
  });

  it("I-700: costo 0 → solo asiento de ingreso (sin COGS); asiento no creado se loguea pero la orden queda aceptada; sin productos que sincronizar no llama al Hub", async () => {
    mockCrearAsiento.mockResolvedValue(null);
    const fake = montar({ actualizados: [] });
    const r = await procesarOrden(fake.client, STORE, ORDEN);
    expect(r).toEqual({ resultado: "aceptada", ventaId: "venta-1", creada: true });
    expect(mockCrearAsiento).toHaveBeenCalledTimes(1);
    expect(mockCrearAsiento.mock.calls[0][0].descripcion).toMatch(/^Venta RAPPI/);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Asiento de ingreso NO CREADO para venta venta-1"));
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("I-701: con costo > 0 y COGS no creado → se loguea el COGS faltante; con productos actualizados → Hub sincronizado", async () => {
    mockCrearAsiento.mockResolvedValueOnce("asiento-1").mockResolvedValueOnce(null);
    const fake = montar({
      productos: [{ id: "p-a", sku: "SKU-A", costo: 5000, activo: true }],
      actualizados: [{ id: "p-a", nombre: "Alimento", precio: 11900, stock: 4, activo: true, en_oferta: null, categorias: { nombre: "Perro" } }],
    });
    expect((await procesarOrden(fake.client, STORE, ORDEN)).resultado).toBe("aceptada");
    expect(mockCrearAsiento).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Asiento COGS NO CREADO para venta venta-1"));
    expect(mockSync).toHaveBeenCalledWith([
      expect.objectContaining({ producto_id: "p-a", stock: 4, en_oferta: false, categoria: "Perro", activo: true }),
    ]);
  });
});

// ─── Cancelación: orden aceptada sin venta ──────────────────────────────────
describe("cancelarOrdenCanal — orden aceptada sin venta_id", () => {
  it("I-702: accepted/ready sin venta → no anula nada, pero cancela, descarta la outbox y audita", async () => {
    const fake = crearFakeSupabase((tabla, ops) => {
      if (tabla === "canal_ordenes" && tiene(ops, "maybeSingle")) return { data: { id: ORDEN, estado: "ready", venta_id: null } };
      return { data: null };
    });
    expect(await cancelarOrdenCanal(fake.client, STORE, "rappi", "EXT-1")).toEqual({ resultado: "anulada" });
    expect(mockAnular).not.toHaveBeenCalled();
    const cancel = fake.consultas.find((c) => upd(c.ops)?.estado === "cancelled")!;
    expect(upd(cancel.ops)).toMatchObject({ ultimo_error: null });
    expect(tiene(cancel.ops, "eq", "store_id", STORE)).toBe(true);
    expect(fake.consultas.some((c) => c.tabla === "canal_outbox" && upd(c.ops)?.estado === "done")).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ changeDescription: expect.stringContaining("venta — anulada") }));
  });
});

// ─── Webhook: errores inesperados y registro del último evento ──────────────
describe("recibirEventoWebhook — ramas", () => {
  const PING = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/canales/rappi/PING.json"), "utf8");
  const entrada = (fake: ReturnType<typeof crearFakeSupabase>, evento = "PING", rawBody = PING) => ({
    supabase: fake.client, canal: "rappi", storeId: STORE, evento, headers: new Headers(), rawBody,
  });

  it("I-703: un error inesperado al cargar el contexto o al parsear NO se convierte en 4xx: se propaga (500 del handler)", async () => {
    const fake = crearFakeSupabase(() => ({}));
    mockLoadCtx.mockRejectedValueOnce(new TypeError("fallo de red"));
    await expect(recibirEventoWebhook(entrada(fake))).rejects.toThrow("fallo de red");

    const verify = jest.spyOn(RappiAdapter.prototype, "verifyWebhook").mockReturnValue(true);
    const parse = jest.spyOn(RappiAdapter.prototype, "parseEvent").mockImplementation(() => { throw new RangeError("bug"); });
    try {
      await expect(recibirEventoWebhook(entrada(fake))).rejects.toThrow("bug");
    } finally {
      verify.mockRestore();
      parse.mockRestore();
    }
  });

  it("I-704: si registrar el último evento falla, el evento autenticado igual se procesa (no bloquea)", async () => {
    const verify = jest.spyOn(RappiAdapter.prototype, "verifyWebhook").mockReturnValue(true);
    const fake = crearFakeSupabase((tabla) => (tabla === "canal_config" ? { error: { code: "40001" } } : {}));
    try {
      const r = await recibirEventoWebhook(entrada(fake));
      expect(r.status).toBe(200);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("no se pudo registrar el último evento (40001)"));
      const cfg = fake.consultas.find((c) => c.tabla === "canal_config")!.ops;
      expect(tiene(cfg, "eq", "store_id", STORE) && tiene(cfg, "eq", "canal_id", "rappi")).toBe(true);
    } finally {
      verify.mockRestore();
    }
  });
});

// ─── Rutas: errores de BD y ramas alternativas ──────────────────────────────
describe("GET/PUT /api/canales/[canal]/productos — ramas", () => {
  it("I-705: GET — error de BD → 500; producto sin precio base ni override → precio_canal null (no se publica gratis)", async () => {
    fakeActual = crearFakeSupabase((tabla) => {
      if (tabla === "canal_config") return { data: { activo: true, recargo_pct: 10 } };
      if (tabla === "productos") return { error: { code: "57014" } };
      return { data: [] };
    });
    fakeActual.rpc.mockResolvedValue({ data: [], error: null });
    expect((await PRODUCTOS_GET(req("/x"), params({ canal: "rappi" }))).status).toBe(500);

    fakeActual = crearFakeSupabase((tabla) => {
      if (tabla === "canal_config") return { data: { activo: true, recargo_pct: 10 } };
      if (tabla === "productos") return { data: [{ id: P1, nombre: "Sin precio", sku: "S", precio: null, precio_oferta: null, en_oferta: false, stock: 3, stock_minimo: 1, activo: true }] };
      return { data: [] };
    });
    fakeActual.rpc.mockResolvedValue({ data: [], error: null });
    const res = await PRODUCTOS_GET(req("/x"), params({ canal: "rappi" }));
    expect(res.status).toBe(200);
    expect((await res.json()).productos[0]).toMatchObject({ producto_id: P1, precio_base: null, precio_canal: null, cupo: 0 });
  });

  it("I-706: PUT — update falla → 500; insert concurrente (23505) → 409; otro error de insert → 500; nunca audita un fallo", async () => {
    const put = () => PRODUCTOS_PUT(json("/x", "PUT", { producto_id: P1, habilitado: true }), params({ canal: "rappi" }));
    const montar = (existente: boolean, error: unknown) => {
      fakeActual = crearFakeSupabase((tabla, ops) => {
        if (tabla === "productos") return { data: { id: P1, nombre: "Alimento" } };
        if (tabla === "canal_producto_config" && tiene(ops, "maybeSingle")) return { data: existente ? { id: "cpc1", activo: false, precio_override: null } : null };
        return { error };
      });
    };
    montar(true, { code: "40001" });
    expect((await put()).status).toBe(500);
    montar(false, { code: "23505" });
    const conflicto = await put();
    expect(conflicto.status).toBe(409);
    expect((await conflicto.json()).error).toMatch(/reintenta/);
    montar(false, { code: "42501" });
    expect((await put()).status).toBe(500);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});

describe("/api/canales/alertas — ramas", () => {
  it("I-707: GET con error de BD → 500; POST con error distinto de 23505 → 500 sin reprocesar ni auditar", async () => {
    fakeActual = crearFakeSupabase((tabla) => (tabla === "canal_ordenes" ? { error: { code: "57014" } } : { data: [] }));
    expect((await ALERTAS_GET(req("/api/canales/alertas"))).status).toBe(500);

    fakeActual = crearFakeSupabase(() => ({ error: { code: "40001" } }));
    const res = await ALERTAS_POST(json("/api/canales/alertas", "POST", { id: JOB }));
    expect(res.status).toBe(500);
    expect(fakeActual.rpc).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});

describe("/api/canales/liquidacion — ramas", () => {
  it("I-708: GET filtra por canal cuando viene y por tienda siempre; error de BD → 500", async () => {
    fakeActual = crearFakeSupabase(() => ({ data: [] }));
    expect((await LIQ_GET(req("/api/canales/liquidacion?canal=rappi"))).status).toBe(200);
    const ops = fakeActual.consultas[0].ops;
    expect(tiene(ops, "eq", "store_id", STORE) && tiene(ops, "eq", "canal_id", "rappi")).toBe(true);

    fakeActual = crearFakeSupabase(() => ({ data: [] }));
    await LIQ_GET(req("/api/canales/liquidacion"));
    expect(fakeActual.consultas[0].ops.some((o) => o.m === "eq" && o.a[0] === "canal_id")).toBe(false);

    fakeActual = crearFakeSupabase(() => ({ error: { code: "57014" } }));
    expect((await LIQ_GET(req("/api/canales/liquidacion"))).status).toBe(500);
  });

  it("I-709: POST — asiento creado pero el vínculo falla → 201 (la liquidación y el asiento existen) y se loguea para reconciliar", async () => {
    fakeActual = crearFakeSupabase((_t, ops) => (upd(ops) ? { error: { code: "40001" } } : { data: { id: "liq-1" } }));
    const res = await LIQ_POST(json("/api/canales/liquidacion", "POST", {
      canal_id: "rappi", periodo_desde: "2026-09-01", periodo_hasta: "2026-09-15", fecha_deposito: "2026-09-20",
      monto_bruto: 119000, comision: 11900,
    }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "liq-1", journal_entry_id: "asiento-1", monto_neto: 107100 });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("asiento asiento-1 creado pero no vinculado a la liquidación liq-1"));
    // No se borró la liquidación (eso es solo cuando NO hay asiento).
    expect(fakeActual.consultas.some((c) => tiene(c.ops, "delete"))).toBe(false);
  });
});

describe("GET /api/canales/orders — ramas", () => {
  it("I-710: ?canal=rappi filtra por canal además de tienda; error de BD → 500", async () => {
    fakeActual = crearFakeSupabase(() => ({ data: [] }));
    expect((await ORDENES_GET(req("/api/canales/orders?canal=rappi"))).status).toBe(200);
    const ops = fakeActual.consultas[0].ops;
    expect(tiene(ops, "eq", "store_id", STORE) && tiene(ops, "eq", "canal_id", "rappi")).toBe(true);

    fakeActual = crearFakeSupabase(() => ({ error: { code: "57014" } }));
    expect((await ORDENES_GET(req("/api/canales/orders"))).status).toBe(500);
  });
});

describe("ready / retry — ramas", () => {
  it("I-711: ready — error de BD → 500; orden de un canal sin flujo externo → lista, pero sin llamada a la plataforma", async () => {
    fakeActual = crearFakeSupabase(() => ({ error: { code: "40001" } }));
    expect((await READY(req("/x", { method: "POST" }), params({ id: ORDEN }))).status).toBe(500);

    fakeActual = crearFakeSupabase((_t, ops) =>
      upd(ops) ? { data: [{ id: ORDEN, canal_id: "instagram", external_order_id: "IG-1" }] } : { data: null }
    );
    const res = await READY(req("/x", { method: "POST" }), params({ id: ORDEN }));
    expect(res.status).toBe(200);
    expect(fakeActual.consultas.some((c) => c.tabla === "canal_outbox")).toBe(false);
  });

  it("I-712: retry — id no UUID → 404 sin tocar la BD; error de BD → 500 sin reprocesar", async () => {
    fakeActual = crearFakeSupabase(() => ({ data: null }));
    expect((await RETRY(req("/x", { method: "POST" }), params({ id: "1 OR 1=1" }))).status).toBe(404);
    expect(fakeActual.consultas).toHaveLength(0);

    fakeActual = crearFakeSupabase(() => ({ error: { code: "40001" } }));
    expect((await RETRY(req("/x", { method: "POST" }), params({ id: ORDEN }))).status).toBe(500);
    expect(fakeActual.rpc).not.toHaveBeenCalled();
  });
});

describe("cron /api/cron/canales-reconciliar — ramas", () => {
  const cron = () => RECONCILIAR(req("/api/cron/canales-reconciliar", { method: "POST", headers: { authorization: "Bearer secreto-cron" } }));

  it("I-713: error leyendo lo publicado → 500 sin encolar", async () => {
    fakeActual = crearFakeSupabase(() => ({ error: { code: "57014" } }));
    expect((await cron()).status).toBe(500);
    expect(fakeActual.consultas.some((c) => c.tabla === "canal_outbox")).toBe(false);
  });

  it("I-714: trabajo ya vivo (23505) no cuenta como encolado; un error al encolar no corta el resto", async () => {
    const OTRA = "123e4567-e89b-12d3-a456-4266141740ff";
    const TERCERA = "123e4567-e89b-12d3-a456-4266141740aa";
    let inserts = 0;
    fakeActual = crearFakeSupabase((tabla, ops) => {
      if (tabla === "canal_producto_config") {
        return { data: [{ store_id: STORE, canal_id: "rappi" }, { store_id: OTRA, canal_id: "rappi" }, { store_id: TERCERA, canal_id: "rappi" }] };
      }
      if (tabla === "canal_config") {
        return { data: [{ store_id: STORE, canal_id: "rappi" }, { store_id: OTRA, canal_id: "rappi" }, { store_id: TERCERA, canal_id: "rappi" }] };
      }
      if (tabla === "canal_outbox" && tiene(ops, "insert")) {
        inserts++;
        return inserts === 1 ? { error: { code: "23505" } } : inserts === 2 ? { error: { code: "08006" } } : {};
      }
      return {};
    });
    const res = await cron();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, encolados: 1, omitidos: 0 });
    expect(inserts).toBe(3);
    expect(errSpy).toHaveBeenCalledWith("[cron/canales-reconciliar] no se pudo encolar:", expect.stringContaining("08006"));
  });
});

describe("GET /api/canales/[canal]/preparacion — ramas", () => {
  it("I-715: error de BD en la config o en el catálogo → 500 sin devolver datos parciales", async () => {
    for (const tablaQueFalla of ["canal_config", "canal_producto_config"]) {
      fakeActual = crearFakeSupabase((tabla) => (tabla === tablaQueFalla ? { error: { code: "57014" } } : { data: null }));
      fakeActual.rpc.mockResolvedValue({ data: [], error: null });
      const res = await PREPARACION(req("/x"), params({ canal: "rappi" }));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Error interno del servidor" });
    }
  });
});
