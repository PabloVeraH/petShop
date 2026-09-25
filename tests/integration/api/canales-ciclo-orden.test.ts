/**
 * Tests I-638 a I-657: ciclo de vida de órdenes de canal (Fase 3 de
 * docs/canales-stock/stock_canales_externos.md): cancelación desde la
 * plataforma (3.5), outbox con reintentos (3.4), "Marcar lista" (3.8),
 * reintento de fallidas por admin (3.7), listado y cron de barrido (3.4).
 *
 * Supabase se simula con tests/helpers/fake-supabase (una consulta por
 * from()). La reclamación real de la outbox (FOR UPDATE SKIP LOCKED) se
 * verifica con docs/canales-stock/stock_canales_fase3_verificacion.sql.
 */
import { NextRequest } from "next/server";
import { crearFakeSupabase, tiene, argsDe, type Op } from "../../helpers/fake-supabase";

// Fase 5 (5.1): /api/canales/** rechaza usuarios deshabilitados; por defecto habilitado.
const mockDeshabilitado = jest.fn().mockResolvedValue(false);
jest.mock("@/lib/usuario-habilitado", () => ({ usuarioDeshabilitado: (...a: unknown[]) => mockDeshabilitado(...a) }));
jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return { ...actual, after: jest.fn((cb: () => unknown) => cb()) };
});

const mockAnular = jest.fn();
jest.mock("@/lib/ventas/anular-venta", () => ({ anularVenta: (...a: unknown[]) => mockAnular(...a) }));
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
const mockProcesarOrden = jest.fn();
jest.mock("@/lib/canales/application/procesar-orden", () => {
  const actual = jest.requireActual("@/lib/canales/application/procesar-orden");
  return { ...actual, procesarOrden: (...a: unknown[]) => mockProcesarOrden(...a) };
});
let fakeActual: ReturnType<typeof crearFakeSupabase>;
jest.mock("@/lib/supabase", () => ({ createServiceClient: () => fakeActual.client }));
const mockGetStoreId = jest.fn();
jest.mock("@/lib/auth", () => ({ getStoreId: () => mockGetStoreId() }));
const mockAuth = jest.fn();
jest.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

import { cancelarOrdenCanal } from "@/lib/canales/application/cancelar-orden";
import { procesarOutbox, proximoIntentoMs, OUTBOX_MAX_INTENTOS } from "@/lib/canales/application/outbox";
import { RappiAdapter } from "@/lib/canales/adapters/rappi/adapter";
import { PlataformaError } from "@/lib/canales/adapters/port";
import { POST as READY } from "@/app/api/canales/orders/[id]/ready/route";
import { POST as RETRY } from "@/app/api/canales/orders/[id]/retry/route";
import { GET as LISTAR } from "@/app/api/canales/orders/route";
import { POST as CRON } from "@/app/api/cron/canales-outbox/route";

const STORE = "123e4567-e89b-12d3-a456-426614174000";
const OTRA = "123e4567-e89b-12d3-a456-4266141740ff";
const ORDEN = "223e4567-e89b-12d3-a456-426614174001";
const CTX = { storeId: STORE, canalId: "rappi", externalStoreId: "9", credentials: {}, recargoPct: 0, comisionPct: 0 };

const envOriginal = { ENABLED_CHANNELS: process.env.ENABLED_CHANNELS, CRON_SECRET: process.env.CRON_SECRET };
beforeEach(() => {
  jest.clearAllMocks();
  process.env.ENABLED_CHANNELS = "rappi";
  process.env.CRON_SECRET = "secreto-cron";
  mockLogAudit.mockResolvedValue(undefined);
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE });
  mockAuth.mockResolvedValue({ sessionClaims: { sub: "u1", publicMetadata: { storeId: STORE, storeAdmin: true } } });
  mockLoadCtx.mockResolvedValue(CTX);
});
afterAll(() => Object.assign(process.env, envOriginal));

const upd = (ops: Op[]) => argsDe(ops, "update")?.[0] as Record<string, unknown> | undefined;
const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init as never);

// ─── Cancelación desde la plataforma (3.5, C10) ─────────────────────────────
describe("cancelarOrdenCanal", () => {
  function montar(estado: string | null, updateDevuelve: unknown[] = [{ id: ORDEN }]) {
    return crearFakeSupabase((tabla, ops) => {
      if (tabla === "canal_ordenes" && tiene(ops, "maybeSingle")) {
        return { data: estado ? { id: ORDEN, estado, venta_id: estado === "pending" ? null : "venta-1" } : null };
      }
      if (tabla === "canal_ordenes" && upd(ops)) return { data: updateDevuelve };
      return { data: null };
    });
  }

  it("I-638: orden pending → cancelled sin venta, buscada por tienda + canal + external_order_id", async () => {
    const fake = montar("pending");
    expect(await cancelarOrdenCanal(fake.client, STORE, "rappi", "EXT-1")).toEqual({ resultado: "cancelada" });
    const busqueda = fake.consultas[0].ops;
    expect(tiene(busqueda, "eq", "store_id", STORE) && tiene(busqueda, "eq", "canal_id", "rappi") && tiene(busqueda, "eq", "external_order_id", "EXT-1")).toBe(true);
    expect(tiene(fake.consultas[1].ops, "eq", "estado", "pending")).toBe(true);
    expect(mockAnular).not.toHaveBeenCalled();
  });

  it("I-639: orden accepted/ready → anularVenta (§23.5) + cancelled + se descartan sus trabajos de outbox", async () => {
    for (const estado of ["accepted", "ready"]) {
      mockAnular.mockResolvedValue({ ok: true, venta: {} });
      const fake = montar(estado);
      expect(await cancelarOrdenCanal(fake.client, STORE, "rappi", "EXT-1", "canceled_with_charge")).toEqual({ resultado: "anulada" });
      expect(mockAnular).toHaveBeenLastCalledWith(fake.client, STORE, "venta-1", null);
      const cancel = fake.consultas.find((c) => c.tabla === "canal_ordenes" && upd(c.ops)?.estado === "cancelled")!;
      expect(tiene(cancel.ops, "in", "estado", ["accepted", "ready"])).toBe(true);
      const outbox = fake.consultas.find((c) => c.tabla === "canal_outbox")!;
      expect(upd(outbox.ops)).toMatchObject({ estado: "done" });
      expect(tiene(outbox.ops, "eq", "canal_orden_id", ORDEN) && tiene(outbox.ops, "eq", "store_id", STORE)).toBe(true);
    }
  });

  it("I-640: venta ya anulada (409, reentrega de la cancelación) → sigue y cancela; otro error → error sin cancelar", async () => {
    mockAnular.mockResolvedValue({ ok: false, status: 409, error: "La venta ya está anulada" });
    expect((await cancelarOrdenCanal(montar("accepted").client, STORE, "rappi", "EXT-1")).resultado).toBe("anulada");
    mockAnular.mockResolvedValue({ ok: false, status: 500, error: "x" });
    const fake = montar("accepted");
    expect((await cancelarOrdenCanal(fake.client, STORE, "rappi", "EXT-1")).resultado).toBe("error");
    expect(fake.consultas.some((c) => upd(c.ops)?.estado === "cancelled")).toBe(false);
  });

  it("I-641: processing → en_proceso (la plataforma reintenta); pending ganado por otro proceso → en_proceso", async () => {
    expect((await cancelarOrdenCanal(montar("processing").client, STORE, "rappi", "E")).resultado).toBe("en_proceso");
    expect((await cancelarOrdenCanal(montar("pending", []).client, STORE, "rappi", "E")).resultado).toBe("en_proceso");
  });

  it("I-642: inexistente, terminal o ya entregada → ignorada sin anular", async () => {
    for (const estado of [null, "rejected", "cancelled", "picked_up", "delivered"]) {
      expect((await cancelarOrdenCanal(montar(estado).client, STORE, "rappi", "E")).resultado).toBe("ignorada");
    }
    expect(mockAnular).not.toHaveBeenCalled();
  });
});

// ─── Outbox (3.4, C11) ──────────────────────────────────────────────────────
describe("procesarOutbox", () => {
  function montar(filas: Record<string, unknown>[]) {
    const fake = crearFakeSupabase(() => ({ data: null }));
    fake.rpc.mockResolvedValue({ data: filas, error: null });
    return fake;
  }
  const fila = (tipo: string, intentos = 1, payload: Record<string, unknown> = { external_order_id: "EXT-1" }) =>
    ({ id: `job-${tipo}`, store_id: STORE, canal_id: "rappi", tipo, canal_orden_id: ORDEN, payload, intentos });

  it("I-643: reclama con claim_canal_outbox y despacha confirm/reject/ready al adaptador con el contexto de la tienda", async () => {
    const confirm = jest.spyOn(RappiAdapter.prototype, "confirmOrder").mockResolvedValue();
    const reject = jest.spyOn(RappiAdapter.prototype, "rejectOrder").mockResolvedValue();
    const ready = jest.spyOn(RappiAdapter.prototype, "markReady").mockResolvedValue();
    const fake = montar([fila("confirm"), fila("reject", 1, { external_order_id: "EXT-2", motivo: "ITEM_OUT_OF_STOCK" }), fila("ready")]);

    const r = await procesarOutbox(fake.client, 20);
    expect(fake.rpc).toHaveBeenCalledWith("claim_canal_outbox", { p_limit: 20 });
    expect(r).toEqual({ reclamados: 3, hechos: 3, reintentos: 0, muertos: 0 });
    expect(mockLoadCtx).toHaveBeenCalledWith(fake.client, STORE, "rappi", expect.anything());
    expect(confirm).toHaveBeenCalledWith(CTX, "EXT-1");
    expect(reject).toHaveBeenCalledWith(CTX, "EXT-2", "ITEM_OUT_OF_STOCK");
    expect(ready).toHaveBeenCalledWith(CTX, "EXT-1");
    for (const c of fake.consultas) {
      expect(upd(c.ops)).toMatchObject({ estado: "done" });
      expect(tiene(c.ops, "eq", "estado", "processing")).toBe(true);
    }
  });

  it("I-644: error de la plataforma → pending con backoff y last_error sin secretos; agotado → dead", async () => {
    jest.spyOn(RappiAdapter.prototype, "confirmOrder").mockRejectedValue(new PlataformaError("Rappi: PUT /orders respondió 503", 503));
    const fake = montar([fila("confirm", 2), { ...fila("confirm", OUTBOX_MAX_INTENTOS), id: "job-muerto" }]);
    const r = await procesarOutbox(fake.client);
    expect(r).toMatchObject({ reintentos: 1, muertos: 1 });
    const [c1, c2] = fake.consultas;
    expect(upd(c1.ops)).toMatchObject({ estado: "pending", last_error: "Rappi: PUT /orders respondió 503" });
    expect(upd(c2.ops)).toMatchObject({ estado: "dead" });
  });

  // Fase 4: 'availability'/'catalog' ya están implementados (I-664..I-666);
  // la invariante "tipo desconocido nunca termina como éxito" se prueba con un
  // tipo inexistente.
  it("I-645: canal deshabilitado o tipo desconocido → reintento, nunca éxito silencioso", async () => {
    process.env.ENABLED_CHANNELS = "";
    const r = await procesarOutbox(montar([fila("confirm")]).client);
    expect(r.hechos).toBe(0);
    process.env.ENABLED_CHANNELS = "rappi";
    const fake = montar([fila("tipo-inexistente", 1, {})]);
    const r2 = await procesarOutbox(fake.client);
    expect(r2).toMatchObject({ hechos: 0, reintentos: 1 });
    expect(upd(fake.consultas[0].ops)).toMatchObject({ estado: "pending", last_error: "Error" });
  });

  it("I-646: backoff exponencial acotado a 60 minutos", () => {
    const t0 = 1_000_000;
    expect(proximoIntentoMs(1, t0) - t0).toBe(60_000);
    expect(proximoIntentoMs(3, t0) - t0).toBe(4 * 60_000);
    expect(proximoIntentoMs(20, t0) - t0).toBe(60 * 60_000);
  });
});

// ─── POST /api/canales/orders/[id]/ready (3.8, D8) ──────────────────────────
describe("POST /api/canales/orders/[id]/ready", () => {
  const post = (id = ORDEN) => READY(req(`/api/canales/orders/${id}/ready`, { method: "POST" }), { params: Promise.resolve({ id }) });
  function montar(transiciona: boolean, estadoActual: string | null = "ready") {
    fakeActual = crearFakeSupabase((tabla, ops) => {
      if (tabla === "canal_ordenes" && upd(ops)) {
        return { data: transiciona ? [{ id: ORDEN, canal_id: "rappi", external_order_id: "EXT-1" }] : [] };
      }
      if (tabla === "canal_ordenes") return { data: estadoActual ? { estado: estadoActual } : null };
      return { data: null };
    });
  }

  it("I-647: storeWorker marca lista una orden accepted → 200, transición atómica accepted → ready y outbox 'ready'", async () => {
    mockAuth.mockResolvedValue({ sessionClaims: { sub: "w1", publicMetadata: { storeId: STORE } } });
    montar(true);
    const res = await post();
    expect(res.status).toBe(200);
    const t = fakeActual.consultas[0].ops;
    expect(upd(t)).toMatchObject({ estado: "ready" });
    expect(tiene(t, "eq", "store_id", STORE) && tiene(t, "eq", "estado", "accepted")).toBe(true);
    const outbox = fakeActual.consultas.find((c) => c.tabla === "canal_outbox")!;
    expect(argsDe(outbox.ops, "insert")?.[0]).toMatchObject({ tipo: "ready", dedupe_key: `ready:${ORDEN}` });
    expect(mockLogAudit).toHaveBeenCalled();
  });

  it("I-648: orden de otra tienda o inexistente → 404 sin confirmar existencia; id no UUID → 404", async () => {
    montar(false, null);
    expect((await post()).status).toBe(404);
    expect((await post("no-uuid")).status).toBe(404);
  });

  it("I-649: orden ya lista o en otro estado → 409, sin outbox", async () => {
    montar(false, "ready");
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/ya está marcada/);
    expect(fakeActual.consultas.some((c) => c.tabla === "canal_outbox")).toBe(false);
  });

  it("I-650: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    montar(true);
    expect((await post()).status).toBe(401);
    expect(fakeActual.consultas).toHaveLength(0);
  });
});

// ─── POST /api/canales/orders/[id]/retry (3.7, solo admin) ──────────────────
describe("POST /api/canales/orders/[id]/retry", () => {
  const post = (id = ORDEN) => RETRY(req(`/api/canales/orders/${id}/retry`, { method: "POST" }), { params: Promise.resolve({ id }) });
  function montar(transiciona: boolean, existe = true) {
    fakeActual = crearFakeSupabase((tabla, ops) => {
      if (tabla === "canal_ordenes" && upd(ops)) return { data: transiciona ? [{ id: ORDEN, external_order_id: "E", canal_id: "rappi" }] : [] };
      if (tabla === "canal_ordenes") return { data: existe ? { estado: "accepted" } : null };
      return { data: null };
    });
  }

  it("I-651: admin reintenta una orden failed → pending (intentos 0) y se reprocesa tras responder", async () => {
    montar(true);
    fakeActual.rpc.mockResolvedValue({ data: [], error: null });
    mockProcesarOrden.mockResolvedValue({ resultado: "aceptada" });
    const res = await post();
    expect(res.status).toBe(200);
    const t = fakeActual.consultas[0].ops;
    expect(upd(t)).toMatchObject({ estado: "pending", intentos: 0 });
    expect(tiene(t, "eq", "estado", "failed") && tiene(t, "eq", "store_id", STORE)).toBe(true);
    expect(mockProcesarOrden).toHaveBeenCalledWith(fakeActual.client, STORE, ORDEN);
  });

  it("I-652: storeWorker → 403 sin tocar la BD; admin de otra tienda → 403", async () => {
    montar(true);
    mockAuth.mockResolvedValue({ sessionClaims: { sub: "w1", publicMetadata: { storeId: STORE } } });
    expect((await post()).status).toBe(403);
    mockAuth.mockResolvedValue({ sessionClaims: { sub: "a9", publicMetadata: { storeId: OTRA, storeAdmin: true } } });
    expect((await post()).status).toBe(403);
    expect(fakeActual.consultas).toHaveLength(0);
  });

  it("I-653: orden que no está failed → 409; inexistente/otra tienda → 404", async () => {
    montar(false, true);
    expect((await post()).status).toBe(409);
    montar(false, false);
    expect((await post()).status).toBe(404);
    expect(mockProcesarOrden).not.toHaveBeenCalled();
  });
});

// ─── GET /api/canales/orders ────────────────────────────────────────────────
describe("GET /api/canales/orders", () => {
  it("I-654: lista las órdenes activas de la tienda (sin 'reserved'); filtros validados", async () => {
    fakeActual = crearFakeSupabase(() => ({ data: [{ id: ORDEN }] }));
    const res = await LISTAR(req("/api/canales/orders"));
    expect(res.status).toBe(200);
    const ops = fakeActual.consultas[0].ops;
    expect(tiene(ops, "eq", "store_id", STORE)).toBe(true);
    expect(tiene(ops, "in", "estado", ["processing", "accepted", "ready", "failed"])).toBe(true);
    expect((await LISTAR(req("/api/canales/orders?canal=instagram"))).status).toBe(400);
    expect((await LISTAR(req("/api/canales/orders?estado=reserved"))).status).toBe(400);
  });

  it("I-655: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    expect((await LISTAR(req("/api/canales/orders"))).status).toBe(401);
  });
});

// ─── Cron /api/cron/canales-outbox (3.4) ────────────────────────────────────
describe("POST /api/cron/canales-outbox", () => {
  const cron = (auth?: string) =>
    CRON(req("/api/cron/canales-outbox", { method: "POST", headers: auth ? { authorization: auth } : {} }));

  it("I-656: sin Bearer válido o sin CRON_SECRET configurado → 401 sin tocar la BD", async () => {
    fakeActual = crearFakeSupabase(() => ({ data: [] }));
    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer otro")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await cron("Bearer undefined")).status).toBe(401);
    expect(fakeActual.consultas).toHaveLength(0);
  });

  it("I-657: recupera processing atascadas, procesa pending olvidadas y corre la outbox", async () => {
    fakeActual = crearFakeSupabase((tabla, ops) => {
      if (tabla === "canal_ordenes" && upd(ops)) return { data: [{ id: "x" }] };
      if (tabla === "canal_ordenes") return { data: [{ id: ORDEN, store_id: STORE }] };
      return { data: null };
    });
    fakeActual.rpc.mockResolvedValue({ data: [], error: null });
    mockProcesarOrden.mockResolvedValue({ resultado: "aceptada" });

    const res = await cron("Bearer secreto-cron");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recuperadas: 1, ordenes: { aceptada: 1 } });
    const recupera = fakeActual.consultas[0].ops;
    expect(upd(recupera)).toMatchObject({ estado: "pending" });
    expect(tiene(recupera, "eq", "estado", "processing")).toBe(true);
    expect(mockProcesarOrden).toHaveBeenCalledWith(fakeActual.client, STORE, ORDEN);
    expect(fakeActual.rpc).toHaveBeenCalledWith("claim_canal_outbox", { p_limit: 20 });
  });
});
