/**
 * Tests CTR-01 a CTR-14: contrato de adaptadores de canal (Fase 2, paso 2.8
 * de docs/canales-stock/stock_canales_externos.md).
 *
 * La parte genérica corre sobre CADA adaptador implementado (hoy solo Rappi):
 * firma válida / inválida / replay, parseo de cada evento desde fixtures,
 * payload inválido, credenciales inválidas. Luego, específicos de Rappi:
 * llamadas salientes con las credenciales del contexto (C4) y URL base (C19).
 *
 * Fixtures: tests/fixtures/canales/<canal>/<EVENTO>.json, basados en la
 * documentación pública (no capturados del sandbox — ver README del directorio).
 */
import { createHmac } from "crypto";
import fs from "fs";
import path from "path";
import { adaptadoresImplementados } from "@/lib/canales/adapters/registry";
import { PayloadInvalidoError, type ChannelAdapter, type ChannelContext } from "@/lib/canales/adapters/port";
import { RappiAdapter, RAPPI_TOLERANCIA_FIRMA_SEG } from "@/lib/canales/adapters/rappi/adapter";
import { limpiarCacheTokens, margenRenovacionMs, rappiApiBase } from "@/lib/canales/adapters/rappi/client";

const SECRETO = "secreto-de-prueba";
const AHORA_MS = Date.UTC(2026, 8, 25, 12, 0, 0);

function fixture(canal: string, evento: string): string {
  return fs.readFileSync(path.join(process.cwd(), "tests/fixtures/canales", canal, `${evento}.json`), "utf8");
}

function ctxDe(adapter: ChannelAdapter, credentials: Record<string, string> = {}): ChannelContext {
  return {
    storeId: "123e4567-e89b-12d3-a456-426614174000",
    canalId: adapter.id,
    externalStoreId: "900105814",
    credentials: { client_id: "cid", client_secret: "csec", store_id: "900105814", webhook_secret: SECRETO, ...credentials },
    recargoPct: 0,
    comisionPct: 0,
  };
}

// Firma por canal (cada adaptador define su esquema).
const FIRMADORES: Record<string, (body: string, secreto: string, ts: number) => Headers> = {
  rappi: (body, secreto, ts) => {
    const sign = createHmac("sha256", secreto).update(`${ts}.${body}`).digest("hex");
    return new Headers({ "Rappi-Signature": `t=${ts},sign=${sign}` });
  },
};

// Evento representativo por tipo, por canal.
const EVENTOS: Record<string, Record<string, string>> = {
  rappi: {
    orden_creada: "NEW_ORDER",
    orden_cancelada: "ORDER_EVENT_CANCEL",
    estado_cambiado: "ORDER_OTHER_EVENT",
    ping: "PING",
    menu_rechazado: "MENU_REJECTED",
  },
};

describe.each(adaptadoresImplementados().map((a) => [a.id, a] as const))("contrato de adaptador: %s", (id, adapter) => {
  const firmar = FIRMADORES[id];
  const eventos = EVENTOS[id];
  const tsSeg = Math.floor(AHORA_MS / 1000);

  it("CTR-01: tiene firmador y fixtures en la suite (un adaptador nuevo debe agregarlos)", () => {
    expect(firmar).toBeDefined();
    expect(eventos).toBeDefined();
  });

  it("CTR-02: firma válida → verifyWebhook true", () => {
    const body = fixture(id, eventos.orden_creada);
    const req = { headers: firmar(body, SECRETO, tsSeg), rawBody: body, evento: eventos.orden_creada };
    expect(adapter.verifyWebhook(req, ctxDe(adapter), AHORA_MS)).toBe(true);
  });

  it("CTR-03: firma con otro secreto, cuerpo alterado o sin header → false", () => {
    const body = fixture(id, eventos.orden_creada);
    const ctx = ctxDe(adapter);
    const evento = eventos.orden_creada;
    expect(adapter.verifyWebhook({ headers: firmar(body, "otro", tsSeg), rawBody: body, evento }, ctx, AHORA_MS)).toBe(false);
    expect(adapter.verifyWebhook({ headers: firmar(body, SECRETO, tsSeg), rawBody: body + " ", evento }, ctx, AHORA_MS)).toBe(false);
    expect(adapter.verifyWebhook({ headers: new Headers(), rawBody: body, evento }, ctx, AHORA_MS)).toBe(false);
  });

  it("CTR-04: replay — firma válida pero vieja → false", () => {
    const body = fixture(id, eventos.orden_creada);
    const viejo = tsSeg - RAPPI_TOLERANCIA_FIRMA_SEG - 1;
    const req = { headers: firmar(body, SECRETO, viejo), rawBody: body, evento: eventos.orden_creada };
    expect(adapter.verifyWebhook(req, ctxDe(adapter), AHORA_MS)).toBe(false);
  });

  it.each(["orden_creada", "orden_cancelada", "estado_cambiado", "ping", "menu_rechazado"])(
    "CTR-05: parsea el evento %s desde su fixture",
    (tipo) => {
      const evento = eventos[tipo];
      const parsed = adapter.parseEvent({ headers: new Headers(), rawBody: fixture(id, evento), evento });
      expect(parsed.tipo).toBe(tipo);
    }
  );

  it("CTR-06: orden_creada queda normalizada (sku, cantidad, precio unitario bruto, ids de tienda)", () => {
    const evento = eventos.orden_creada;
    const parsed = adapter.parseEvent({ headers: new Headers(), rawBody: fixture(id, evento), evento });
    if (parsed.tipo !== "orden_creada") throw new Error("tipo inesperado");
    expect(parsed.orden.externalOrderId).toBeTruthy();
    expect(parsed.orden.items.length).toBeGreaterThan(0);
    for (const item of parsed.orden.items) {
      expect(item.sku).toBeTruthy();
      expect(Number.isInteger(item.cantidad) && item.cantidad > 0).toBe(true);
      expect(item.precioUnitarioBruto).toBeGreaterThanOrEqual(0);
    }
    expect(parsed.orden.externalStoreIds.length).toBeGreaterThan(0);
  });

  it("CTR-07: payload inválido → PayloadInvalidoError (JSON roto, orden sin ítems, cantidad no entera)", () => {
    const evento = eventos.orden_creada;
    const parse = (rawBody: string) => () => adapter.parseEvent({ headers: new Headers(), rawBody, evento });
    expect(parse("{no es json")).toThrow(PayloadInvalidoError);
    const base = JSON.parse(fixture(id, evento));
    expect(parse(JSON.stringify({ ...base, order_detail: { ...base.order_detail, items: [] } }))).toThrow(PayloadInvalidoError);
    const cantidadRara = structuredClone(base);
    cantidadRara.order_detail.items[0].quantity = 1.5;
    expect(parse(JSON.stringify(cantidadRara))).toThrow(PayloadInvalidoError);
  });

  it("CTR-08: credenciales inválidas → el schema las rechaza (faltantes, vacías, claves desconocidas)", () => {
    const validas = ctxDe(adapter).credentials;
    expect(adapter.credentialsSchema.safeParse(validas).success).toBe(true);
    expect(adapter.credentialsSchema.safeParse({}).success).toBe(false);
    const primera = Object.keys(validas)[0];
    expect(adapter.credentialsSchema.safeParse({ ...validas, [primera]: "   " }).success).toBe(false);
    expect(adapter.credentialsSchema.safeParse({ ...validas, clave_desconocida: "x" }).success).toBe(false);
  });
});

describe("Rappi — específico", () => {
  const adapter = new RappiAdapter();
  const tsSeg = Math.floor(AHORA_MS / 1000);

  it("CTR-09: el evento viene en la URL; sin evento o desconocido → firma inválida y parseo rechazado", () => {
    const body = fixture("rappi", "NEW_ORDER");
    const headers = FIRMADORES.rappi(body, SECRETO, tsSeg);
    expect(adapter.verifyWebhook({ headers, rawBody: body, evento: null }, ctxDe(adapter), AHORA_MS)).toBe(false);
    expect(() => adapter.parseEvent({ headers, rawBody: body, evento: "NO_EXISTE" })).toThrow(PayloadInvalidoError);
  });

  it("CTR-10: secreto por evento — webhook_secret_<EVENTO> tiene prioridad sobre el general", () => {
    const body = fixture("rappi", "NEW_ORDER");
    const ctx = ctxDe(adapter, { webhook_secret_NEW_ORDER: "secreto-new-order" });
    const req = (secreto: string) => ({ headers: FIRMADORES.rappi(body, secreto, tsSeg), rawBody: body, evento: "NEW_ORDER" });
    expect(adapter.verifyWebhook(req("secreto-new-order"), ctx, AHORA_MS)).toBe(true);
    expect(adapter.verifyWebhook(req(SECRETO), ctx, AHORA_MS)).toBe(false);
  });

  it("CTR-11: NEW_ORDER usa el precio con descuento si viene, si no price; total de la plataforma", () => {
    const parsed = adapter.parseEvent({ headers: new Headers(), rawBody: fixture("rappi", "NEW_ORDER"), evento: "NEW_ORDER" });
    if (parsed.tipo !== "orden_creada") throw new Error("tipo inesperado");
    expect(parsed.orden.externalOrderId).toBe("2150558091");
    expect(parsed.orden.items).toEqual([
      { sku: "SKU-ALIM-15K", nombre: "Alimento perro adulto 15 kg", cantidad: 2, precioUnitarioBruto: 43990 },
      { sku: "SKU-JUG-01", nombre: "Juguete pelota", cantidad: 1, precioUnitarioBruto: 3990 },
    ]);
    expect(parsed.orden.totalBruto).toBe(91970);
    expect(parsed.orden.externalStoreIds).toEqual(["900105814", "900105814"]);
    expect(adapter.pingResponse()).toEqual({ status: 200, body: { status: "OK", description: "Store on" } });
  });

  describe("llamadas salientes (fetch simulado)", () => {
    const fetchMock = jest.fn();
    const originalFetch = global.fetch;
    beforeEach(() => {
      limpiarCacheTokens();
      fetchMock.mockReset();
      fetchMock.mockImplementation(async (url: string) =>
        url.includes("/token/")
          ? { ok: true, status: 200, json: async () => ({ access_token: "tok-1", expires_in: 86400 }) }
          : { ok: true, status: 200, json: async () => ({}) }
      );
      global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterAll(() => { global.fetch = originalFetch; });

    it("CTR-12: usa las credenciales y el id de tienda del contexto (C4), y cachea el token (C19)", async () => {
      const ctx = ctxDe(adapter);
      await adapter.confirmOrder(ctx, "ORD-1");
      await adapter.rejectOrder(ctx, "ORD-2", "ITEM_OUT_OF_STOCK");
      await adapter.pushAvailability(ctx, [{ sku: "A", disponible: true }, { sku: "B", disponible: false }]);

      const tokenCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("/token/"));
      expect(tokenCalls).toHaveLength(1);   // antes: buffer 24 h sobre token de 24 h → nunca cacheaba
      expect(JSON.parse(tokenCalls[0][1].body)).toEqual({ client_id: "cid", client_secret: "csec" });

      const [urlTake, optsTake] = fetchMock.mock.calls.find(([u]) => String(u).includes("/take/"))!;
      expect(urlTake).toMatch(/\/orders\/ORD-1\/take\/\d+$/);
      expect(optsTake.headers["x-authorization"]).toBe("Bearer tok-1");

      const [, optsReject] = fetchMock.mock.calls.find(([u]) => String(u).includes("/reject"))!;
      expect(JSON.parse(optsReject.body).cancel_type).toBe("ITEM_OUT_OF_STOCK");

      const [, optsAvail] = fetchMock.mock.calls.find(([u]) => String(u).includes("/availability/"))!;
      expect(JSON.parse(optsAvail.body)).toEqual([
        { store_integration_id: "900105814", items: { turn_on: ["A"], turn_off: ["B"] } },
      ]);
    });

    it("CTR-13: error HTTP de la plataforma → PlataformaError sin credenciales en el mensaje", async () => {
      fetchMock.mockImplementation(async (url: string) =>
        url.includes("/token/")
          ? { ok: false, status: 401, json: async () => ({}), text: async () => "client_secret=csec invalid" }
          : { ok: true, status: 200, json: async () => ({}) }
      );
      await expect(adapter.markReady(ctxDe(adapter), "ORD-3")).rejects.toThrow(/autenticación rechazada \(401\)/);
      await expect(adapter.markReady(ctxDe(adapter), "ORD-3")).rejects.not.toThrow(/csec/);
    });
  });

  it("CTR-14: C19 — sin RAPPI_API_BASE en producción falla (no cae al ambiente dev); con margen de token acotado", () => {
    const envOriginal = { ...process.env };
    try {
      delete process.env.RAPPI_API_BASE;
      Object.assign(process.env, { NODE_ENV: "production" });
      expect(() => rappiApiBase()).toThrow(/RAPPI_API_BASE no configurada/);
      Object.assign(process.env, { NODE_ENV: "test" });
      expect(rappiApiBase()).toMatch(/dev\.rappi\.com/);
      process.env.RAPPI_API_BASE = "https://prod.example/";
      expect(rappiApiBase()).toBe("https://prod.example");
    } finally {
      process.env = envOriginal;
    }
    expect(margenRenovacionMs(86400)).toBe(5 * 60 * 1000);
    expect(margenRenovacionMs(600)).toBe(60 * 1000);
  });
});
