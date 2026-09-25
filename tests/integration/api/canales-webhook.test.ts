/**
 * Tests I-604 a I-624 (+ I-678, Fase 5): POST /api/canales/webhook/[canal] — webhook genérico de
 * canales externos (Fase 2, pasos 2.4–2.5 y 2.9 de
 * docs/canales-stock/stock_canales_externos.md).
 *
 * Reemplaza a canales-webhook-idempotency.test.ts, que probaba el formato
 * ANTERIOR (event_type en el cuerpo, order_id en la raíz) — contradicho por la
 * documentación de Rappi (evento por URL, order_detail.order_id). Sus tres
 * casos (duplicado, PING, firma inválida) siguen cubiertos aquí: I-613, I-617,
 * I-609.
 *
 * El adaptador y el caso de uso son REALES; se simulan Supabase y el
 * descifrado. La unicidad real (ON CONFLICT) se verifica con el script de
 * verificación de la migración 079.
 */
import { createHmac } from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return { ...actual, after: jest.fn((cb: () => void) => cb()) };
});

const mockFrom = jest.fn();
const mockDecrypt = jest.fn();
jest.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mockFrom }) }));
jest.mock("@/lib/canales/encryption", () => ({ decryptJSON: (...a: unknown[]) => mockDecrypt(...a) }));

const mockCancelar = jest.fn();
const mockProcesar = jest.fn();
const mockOutbox = jest.fn();
jest.mock("@/lib/canales/application/cancelar-orden", () => ({ cancelarOrdenCanal: (...a: unknown[]) => mockCancelar(...a) }));
jest.mock("@/lib/canales/application/procesar-orden", () => ({ procesarOrden: (...a: unknown[]) => mockProcesar(...a) }));
jest.mock("@/lib/canales/application/outbox", () => ({ procesarOutbox: (...a: unknown[]) => mockOutbox(...a) }));
const mockMenu = jest.fn();
jest.mock("@/lib/canales/application/menu", () => ({ registrarEstadoMenu: (...a: unknown[]) => mockMenu(...a) }));

import { POST } from "@/app/api/canales/webhook/[canal]/route";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const SECRETO = "secreto-webhook";
const CREDS = { client_id: "cid", client_secret: "csec", store_id: "900105814", webhook_secret: SECRETO };

function fixture(evento: string): string {
  return fs.readFileSync(path.join(process.cwd(), "tests/fixtures/canales/rappi", `${evento}.json`), "utf8");
}

function firma(body: string, secreto = SECRETO, ts = Math.floor(Date.now() / 1000)): string {
  return `t=${ts},sign=${createHmac("sha256", secreto).update(`${ts}.${body}`).digest("hex")}`;
}

function req(opts: { canal?: string; evento?: string | null; storeId?: string | null; body: string; signature?: string | null }) {
  const canal = opts.canal ?? "rappi";
  const qs = new URLSearchParams();
  if (opts.storeId !== null) qs.set("store_id", opts.storeId ?? STORE_ID);
  if (opts.evento !== null) qs.set("evento", opts.evento ?? "NEW_ORDER");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.signature !== null) headers["rappi-signature"] = opts.signature ?? firma(opts.body);
  return {
    request: new NextRequest(`http://localhost/api/canales/webhook/${canal}?${qs}`, { method: "POST", headers, body: opts.body }),
    ctx: { params: Promise.resolve({ canal }) },
  };
}

async function post(opts: Parameters<typeof req>[0]) {
  const { request, ctx } = req(opts);
  return POST(request, ctx);
}

// Supabase simulado por tabla.
let habilitado: boolean;
let config: Record<string, unknown> | null;
let upsertResult: { data: unknown; error: unknown };
const upsertSpy = jest.fn();
const updateSpy = jest.fn();
const configFilters: [string, unknown][] = [];
const updateFilters: [string, string, unknown][] = [];

function setupSupabase() {
  mockFrom.mockImplementation((table: string) => {
    if (table === "canales_externos") {
      const c: Record<string, jest.Mock> = {};
      c.select = jest.fn(() => c);
      c.eq = jest.fn(() => c);
      c.maybeSingle = jest.fn(async () => ({ data: { habilitado }, error: null }));
      return c;
    }
    if (table === "canal_config") {
      const c: Record<string, jest.Mock> = {};
      c.select = jest.fn(() => c);
      c.eq = jest.fn((k: string, v: unknown) => { configFilters.push([k, v]); return c; });
      c.maybeSingle = jest.fn(async () => ({ data: config, error: null }));
      return c;
    }
    if (table === "canal_ordenes") {
      const c: Record<string, jest.Mock> = {};
      c.upsert = jest.fn((row: unknown, o: unknown) => { upsertSpy(row, o); return c; });
      c.select = jest.fn(async () => upsertResult);
      c.update = jest.fn((row: unknown) => { updateSpy(row); return c; });
      c.eq = jest.fn((k: string, v: unknown) => { updateFilters.push(["eq", k, v]); return c; });
      return c;
    }
    throw new Error(`tabla inesperada ${table}`);
  });
}

const envOriginal = process.env.ENABLED_CHANNELS;
beforeEach(() => {
  jest.clearAllMocks();
  configFilters.length = 0;
  updateFilters.length = 0;
  process.env.ENABLED_CHANNELS = "rappi";
  habilitado = true;
  config = {
    external_store_id: "900105814",
    comision_pct: 30,
    recargo_pct: 0,
    credenciales_encriptada: "enc",
    credenciales_iv: "iv",
    credenciales_auth_tag: "tag",
  };
  upsertResult = { data: [{ id: "orden-1" }], error: null };
  mockDecrypt.mockReturnValue({ ...CREDS });
  setupSupabase();
});
afterAll(() => { process.env.ENABLED_CHANNELS = envOriginal; });

describe("POST /api/canales/webhook/[canal] — habilitación y validación", () => {
  it("I-604: canal fuera de ENABLED_CHANNELS → 404 sin tocar la BD", async () => {
    process.env.ENABLED_CHANNELS = "";
    const res = await post({ body: fixture("NEW_ORDER") });
    expect(res.status).toBe(404);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("I-605: PedidosYa / UberEats (integración pendiente) o canal desconocido → 404 aunque estén en ENABLED_CHANNELS", async () => {
    process.env.ENABLED_CHANNELS = "rappi,pedidosya,ubereats,pos";
    for (const canal of ["pedidosya", "ubereats", "pos", "instagram", "no-existe"]) {
      const res = await post({ canal, body: "{}" });
      expect(res.status).toBe(404);
    }
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("I-606: store_id ausente o no UUID → 400", async () => {
    expect((await post({ storeId: null, body: fixture("NEW_ORDER") })).status).toBe(400);
    expect((await post({ storeId: "abc", body: fixture("NEW_ORDER") })).status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("I-607: canal deshabilitado globalmente (canales_externos.habilitado) o sin config activa en la tienda → 404", async () => {
    habilitado = false;
    expect((await post({ body: fixture("NEW_ORDER") })).status).toBe(404);
    habilitado = true;
    config = null;
    expect((await post({ body: fixture("NEW_ORDER") })).status).toBe(404);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("I-608: la config se busca con el store_id de la URL, el canal y activo = true (tenant)", async () => {
    await post({ body: fixture("NEW_ORDER") });
    expect(configFilters).toEqual(expect.arrayContaining([
      ["store_id", STORE_ID], ["canal_id", "rappi"], ["activo", true],
    ]));
  });

  it("I-609: firma inválida, de otro secreto o ausente → 401 sin persistir", async () => {
    const body = fixture("NEW_ORDER");
    expect((await post({ body, signature: "t=123,sign=abc" })).status).toBe(401);
    expect((await post({ body, signature: firma(body, "otro") })).status).toBe(401);
    expect((await post({ body, signature: null })).status).toBe(401);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("I-610: replay — firma válida con timestamp de hace 10 minutos → 401", async () => {
    const body = fixture("NEW_ORDER");
    const res = await post({ body, signature: firma(body, SECRETO, Math.floor(Date.now() / 1000) - 600) });
    expect(res.status).toBe(401);
  });

  it("I-611: credenciales guardadas con los campos ANTERIORES de Rappi (api_key…) o indescifrables → 503, sin exponerlas", async () => {
    mockDecrypt.mockReturnValue({ api_key: "k", api_secret: "s", store_id: "1", webhook_secret: SECRETO });
    const res = await post({ body: fixture("NEW_ORDER") });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/api_key|secreto/);
    mockDecrypt.mockImplementation(() => { throw new Error("bad tag"); });
    expect((await post({ body: fixture("NEW_ORDER") })).status).toBe(503);
  });

  it("I-612: payload inválido (firmado) o evento ausente → 400 sin persistir", async () => {
    const roto = JSON.stringify({ order_detail: { order_id: "1", items: [] } });
    expect((await post({ body: roto })).status).toBe(400);
    expect((await post({ evento: null, body: fixture("NEW_ORDER") })).status).toBe(401); // sin evento no hay secreto que verificar
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/canales/webhook/[canal] — eventos", () => {
  it("I-613: NEW_ORDER → 201 y upsert idempotente con ítems normalizados y tenant de la URL", async () => {
    const res = await post({ body: fixture("NEW_ORDER") });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ status: "ok", ordenId: "orden-1" });

    const [fila, opciones] = upsertSpy.mock.calls[0];
    expect(opciones).toEqual({ onConflict: "store_id,canal_id,external_order_id", ignoreDuplicates: true });
    expect(fila).toMatchObject({
      store_id: STORE_ID,
      canal_id: "rappi",
      external_order_id: "2150558091",
      estado: "pending",
      total_externo: 91970,
      items: [
        { sku: "SKU-ALIM-15K", nombre: "Alimento perro adulto 15 kg", cantidad: 2, precio_unitario_bruto: 43990 },
        { sku: "SKU-JUG-01", nombre: "Juguete pelota", cantidad: 1, precio_unitario_bruto: 3990 },
      ],
    });
    expect(new Date(fila.aceptar_antes_de).getTime()).toBeGreaterThan(Date.now());
  });

  it("I-614: reentrega de la misma orden (ON CONFLICT DO NOTHING no devuelve fila) → 200 duplicada", async () => {
    upsertResult = { data: [], error: null };
    const res = await post({ body: fixture("NEW_ORDER") });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", duplicada: true });
  });

  it("I-615: error de BD al guardar → 500 genérico sin detalles internos", async () => {
    upsertResult = { data: null, error: { code: "23505", message: "detalle interno" } };
    const res = await post({ body: fixture("NEW_ORDER") });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/detalle interno/);
  });

  it("I-616: evento de OTRA tienda de la plataforma (store_id distinto al configurado) → 403 sin persistir", async () => {
    config = { ...config!, external_store_id: "111111" };
    const res = await post({ body: fixture("NEW_ORDER") });
    expect(res.status).toBe(403);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("I-617: PING → 200 con la respuesta exacta que exige Rappi", async () => {
    const res = await post({ evento: "PING", body: fixture("PING") });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "OK", description: "Store on" });
  });

  // Fase 3 (3.5): la cancelación delega en cancelarOrdenCanal (probado en
  // canales-ciclo-orden.test.ts: pending → cancelled, aceptada → anular venta).
  it("I-618: ORDER_EVENT_CANCEL → cancelarOrdenCanal con tienda, canal, orden y motivo; en proceso → 503; error → 500", async () => {
    mockCancelar.mockResolvedValue({ resultado: "cancelada" });
    const res = await post({ evento: "ORDER_EVENT_CANCEL", body: fixture("ORDER_EVENT_CANCEL") });
    expect(res.status).toBe(200);
    expect(mockCancelar).toHaveBeenCalledWith(expect.anything(), STORE_ID, "rappi", "2150558091", "canceled_with_charge");

    mockCancelar.mockResolvedValue({ resultado: "en_proceso" });
    expect((await post({ evento: "ORDER_EVENT_CANCEL", body: fixture("ORDER_EVENT_CANCEL") })).status).toBe(503);
    mockCancelar.mockResolvedValue({ resultado: "error", error: "x" });
    expect((await post({ evento: "ORDER_EVENT_CANCEL", body: fixture("ORDER_EVENT_CANCEL") })).status).toBe(500);
  });

  // Fase 3 (3.3): la orden nueva se procesa DESPUÉS de responder (after()).
  it("I-658: NEW_ORDER nueva agenda procesarOrden + outbox tras responder; una duplicada no", async () => {
    await post({ body: fixture("NEW_ORDER") });
    expect(mockProcesar).toHaveBeenCalledWith(expect.anything(), STORE_ID, "orden-1");
    expect(mockOutbox).toHaveBeenCalled();
    mockProcesar.mockClear();
    upsertResult = { data: [], error: null };
    await post({ body: fixture("NEW_ORDER") });
    expect(mockProcesar).not.toHaveBeenCalled();
  });

  // Fase 5 (5.3): MENU_APPROVED ya no es "sin escribir" — registra el estado
  // del menú (I-678). El resto sigue sin efectos.
  it("I-619: ORDER_OTHER_EVENT y eventos ignorados → 200 sin escribir", async () => {
    for (const evento of ["ORDER_OTHER_EVENT", "STORE_CONNECTIVITY", "NEW_ORDER_SCHEDULED"]) {
      const body = evento === "ORDER_OTHER_EVENT" ? fixture("ORDER_OTHER_EVENT") : "{}";
      const res = await post({ evento, body });
      expect(res.status).toBe(200);
    }
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mockMenu).not.toHaveBeenCalled();
  });

  it("I-678: MENU_APPROVED / MENU_REJECTED firmados → estado del menú de ESTA tienda (con el motivo del rechazo)", async () => {
    expect((await post({ evento: "MENU_APPROVED", body: "{}" })).status).toBe(200);
    expect(mockMenu).toHaveBeenLastCalledWith(expect.anything(), STORE_ID, "rappi", "aprobado");
    expect((await post({ evento: "MENU_REJECTED", body: fixture("MENU_REJECTED") })).status).toBe(200);
    expect(mockMenu).toHaveBeenLastCalledWith(expect.anything(), STORE_ID, "rappi", "rechazado", "Faltan imágenes");
    // Sin firma válida no se registra nada.
    mockMenu.mockClear();
    expect((await post({ evento: "MENU_REJECTED", body: fixture("MENU_REJECTED"), signature: null })).status).toBe(401);
    expect(mockMenu).not.toHaveBeenCalled();
  });

  it("I-620: la firma se verifica con el secreto del evento cuando existe webhook_secret_<EVENTO>", async () => {
    mockDecrypt.mockReturnValue({ ...CREDS, webhook_secret_PING: "secreto-ping" });
    const body = fixture("PING");
    expect((await post({ evento: "PING", body, signature: firma(body, SECRETO) })).status).toBe(401);
    expect((await post({ evento: "PING", body, signature: firma(body, "secreto-ping") })).status).toBe(200);
  });
});
