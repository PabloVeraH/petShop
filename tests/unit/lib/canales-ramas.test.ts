/**
 * Tests U-195 a U-205 y CTR-15 a CTR-18: ramas de lib/canales que la suite
 * de las Fases 2–6 no ejercitaba (auditoría de cobertura del 2026-09-26 sobre
 * las líneas cambiadas en feat/stockCanales).
 *
 * Cubre: firma de webhook malformada y payloads inválidos de Rappi (seguridad
 * del límite de confianza), token sin access_token, errores no-401 que no
 * invalidan el token, contexto sin credenciales, outbox (encolado, reclamo,
 * canal desconocido, re-verificación que falla), publicación de catálogo y
 * disponibilidad cuando la BD falla, y las funciones puras del registry y de
 * campos de credenciales.
 */
import { createHmac } from "crypto";
import fs from "fs";
import path from "path";
import { crearFakeSupabase, tiene, argsDe, type Op } from "../../helpers/fake-supabase";

// loadChannelContext real por defecto; U-203 lo reemplaza para no descifrar.
// (la factory de jest.mock se eleva sobre las declaraciones: solo puede
// referenciar mockLoadCtx de forma diferida, dentro de la función).
const mockLoadCtx = jest.fn();
jest.mock("@/lib/canales/infrastructure/context", () => {
  const actual = jest.requireActual("@/lib/canales/infrastructure/context");
  return { ...actual, loadChannelContext: (...a: unknown[]) => mockLoadCtx(...a) };
});
const { loadChannelContext: loadChannelContextReal } = jest.requireActual("@/lib/canales/infrastructure/context");

import { canalImplementado, obtenerAdaptador } from "@/lib/canales/adapters/registry";
import { esCanalConfigurable } from "@/lib/canales/campos";
import { PayloadInvalidoError, PlataformaError, type ChannelAdapter, type ChannelContext } from "@/lib/canales/adapters/port";
import { RappiAdapter, firmaRappiValida } from "@/lib/canales/adapters/rappi/adapter";
import { limpiarCacheTokens, rappiFetch } from "@/lib/canales/adapters/rappi/client";
import { loadChannelContext, CredencialesInvalidasError } from "@/lib/canales/infrastructure/context";
import { encolarOutbox, encolarTrabajoTienda, procesarOutbox } from "@/lib/canales/application/outbox";
import { publicarCatalogo } from "@/lib/canales/application/catalogo";
import { publicarDisponibilidad } from "@/lib/canales/application/disponibilidad";

const STORE = "123e4567-e89b-12d3-a456-426614174000";
const SECRETO = "secreto-de-prueba";
const AHORA_MS = Date.UTC(2026, 8, 26, 12, 0, 0);
const TS = Math.floor(AHORA_MS / 1000);

const CTX: ChannelContext = {
  storeId: STORE,
  canalId: "rappi",
  externalStoreId: "900105814",
  credentials: { client_id: "cid", client_secret: "csec", store_id: "900105814", webhook_secret: SECRETO },
  recargoPct: 0,
  comisionPct: 0,
};

const fixture = (evento: string) =>
  fs.readFileSync(path.join(process.cwd(), "tests/fixtures/canales/rappi", `${evento}.json`), "utf8");
const firma = (body: string, ts = TS, secreto = SECRETO) =>
  createHmac("sha256", secreto).update(`${ts}.${body}`).digest("hex");
const upd = (ops: Op[]) => argsDe(ops, "update")?.[0] as Record<string, unknown> | undefined;

const envOriginal = { ENABLED_CHANNELS: process.env.ENABLED_CHANNELS };
beforeEach(() => {
  process.env.ENABLED_CHANNELS = "rappi";
  mockLoadCtx.mockReset();
  mockLoadCtx.mockImplementation(loadChannelContextReal);
});
afterAll(() => Object.assign(process.env, envOriginal));

// ─── Registry y campos (funciones puras) ────────────────────────────────────
describe("registry y campos de credenciales", () => {
  it("U-195: canalImplementado solo es true para canales con adaptador (hoy Rappi), nunca para claves del prototipo", () => {
    expect(canalImplementado("rappi")).toBe(true);
    expect(canalImplementado("pedidosya")).toBe(false);
    expect(canalImplementado("ubereats")).toBe(false);
    for (const clave of ["toString", "constructor", "__proto__"]) {
      expect(canalImplementado(clave as never)).toBe(false);
    }
    // Implementado no implica habilitado: sin ENABLED_CHANNELS no hay adaptador.
    process.env.ENABLED_CHANNELS = "";
    expect(obtenerAdaptador("rappi")).toBeNull();
    // Con ENABLED_CHANNELS ausente (no solo vacío) tampoco.
    delete process.env.ENABLED_CHANNELS;
    expect(obtenerAdaptador("rappi")).toBeNull();
  });

  // Regresión (2026-09-26): con `valor in CAMPOS_CREDENCIALES` las claves del
  // prototipo ("toString", "__proto__", "constructor"…) pasaban como canal.
  it("U-196: esCanalConfigurable acepta solo ids conocidos (ni strings arbitrarios, ni claves del prototipo, ni no-strings)", () => {
    for (const ok of ["rappi", "pedidosya", "ubereats", "instagram"]) expect(esCanalConfigurable(ok)).toBe(true);
    for (const malo of ["", "shopify", "RAPPI", "__proto__", "toString", "constructor", "hasOwnProperty", "valueOf", null, undefined, 1, {}]) {
      expect(esCanalConfigurable(malo)).toBe(false);
    }
  });
});

// ─── Firma de webhook de Rappi: headers malformados (límite de confianza) ───
describe("firmaRappiValida — headers malformados", () => {
  const body = fixture("NEW_ORDER");

  it("CTR-15: t no numérico, sign no hexadecimal, segmentos sin '=' o faltantes → false (nunca lanza)", () => {
    const sign = firma(body);
    const casos = [
      `t=abc,sign=${sign}`,            // t no numérico
      `t=${TS},sign=zz${sign.slice(2)}`, // sign con caracteres no hex
      `t=${TS}`,                        // sin sign
      `sign=${sign}`,                   // sin t
      `t${TS},sign${sign}`,             // segmentos sin '='
      `=${TS},=${sign}`,                // clave vacía
      ",,,",
      "",
    ];
    for (const header of casos) {
      expect(firmaRappiValida(header, body, SECRETO, AHORA_MS)).toBe(false);
    }
  });

  it("CTR-16: header válido con espacios y segmentos extra se acepta; sin secreto → false", () => {
    const header = ` t = ${TS} , otro=1 , sign = ${firma(body)} `;
    expect(firmaRappiValida(header, body, SECRETO, AHORA_MS)).toBe(true);
    expect(firmaRappiValida(header, body, "", AHORA_MS)).toBe(false);
    // Firma de otro largo (truncada) → false sin lanzar en timingSafeEqual.
    expect(firmaRappiValida(`t=${TS},sign=${firma(body).slice(0, 10)}`, body, SECRETO, AHORA_MS)).toBe(false);
  });
});

// ─── parseEvent de Rappi: payloads inválidos por evento ─────────────────────
describe("RappiAdapter.parseEvent — payloads inválidos", () => {
  const adapter = new RappiAdapter();
  const parse = (evento: string, rawBody: string) => () => adapter.parseEvent({ headers: new Headers(), rawBody, evento });

  it("CTR-17: ORDER_EVENT_CANCEL y ORDER_OTHER_EVENT sin order_id válido → PayloadInvalidoError", () => {
    for (const evento of ["ORDER_EVENT_CANCEL", "ORDER_OTHER_EVENT"]) {
      expect(parse(evento, JSON.stringify({}))).toThrow(PayloadInvalidoError);
      expect(parse(evento, JSON.stringify({ order_id: { no: "es string" } }))).toThrow(PayloadInvalidoError);
      expect(parse(evento, "[]")).toThrow(PayloadInvalidoError);
      expect(parse(evento, "{roto")).toThrow(PayloadInvalidoError);
    }
  });

  it("CTR-18: el mensaje de PayloadInvalidoError nombra el campo, no el contenido del cuerpo", () => {
    // order_id acepta string o número (idFlexible); un objeto es inválido.
    const base = JSON.parse(fixture("ORDER_EVENT_CANCEL"));
    const conDatos = { ...base, order_id: { cliente: "Juan Pérez +56911111111" } };
    try {
      adapter.parseEvent({ headers: new Headers(), rawBody: JSON.stringify(conDatos), evento: "ORDER_EVENT_CANCEL" });
      throw new Error("debió lanzar");
    } catch (e) {
      expect(e).toBeInstanceOf(PayloadInvalidoError);
      expect((e as Error).message).toMatch(/order_id/);
      expect((e as Error).message).not.toMatch(/Juan|56911111111/);
    }
  });
});

// ─── Cliente HTTP de Rappi ──────────────────────────────────────────────────
describe("rappiFetch — respuestas anómalas", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  beforeEach(() => {
    limpiarCacheTokens();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => { global.fetch = originalFetch; });

  it("U-197: token 200 sin access_token → PlataformaError y no se cachea nada", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ expires_in: 3600 }) });
    await expect(rappiFetch(CTX, "GET", "/menu")).rejects.toThrow(/sin access_token/);
    await expect(rappiFetch(CTX, "GET", "/menu")).rejects.toThrow(PlataformaError);
    // Ambas llamadas pidieron token: el fallo no dejó un token vacío en caché.
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/token/"))).toHaveLength(2);
  });

  it("U-198: error distinto de 401 (ej. 500) NO invalida el token cacheado", async () => {
    let llamadasApi = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/token/")) return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 86400 }) };
      llamadasApi++;
      return llamadasApi === 1 ? { ok: false, status: 500 } : { ok: true, status: 200 };
    });
    await expect(rappiFetch(CTX, "PUT", "/orders/1/take/5?x=1")).rejects.toThrow("Rappi: PUT /orders/1/take/5 respondió 500");
    await rappiFetch(CTX, "PUT", "/orders/1/take/5");
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/token/"))).toHaveLength(1);
  });
});

// ─── Contexto del canal ─────────────────────────────────────────────────────
describe("loadChannelContext — config activa sin credenciales", () => {
  it("U-199: canal habilitado y config activa pero sin credenciales guardadas → CredencialesInvalidasError", async () => {
    const incompletas = [
      { credenciales_encriptada: null, credenciales_iv: "iv", credenciales_auth_tag: "tag" },
      { credenciales_encriptada: "c", credenciales_iv: null, credenciales_auth_tag: "tag" },
      { credenciales_encriptada: "c", credenciales_iv: "iv", credenciales_auth_tag: null },
    ];
    for (const creds of incompletas) {
      const fake = crearFakeSupabase((tabla) =>
        tabla === "canales_externos"
          ? { data: { habilitado: true } }
          : { data: { external_store_id: "900105814", comision_pct: 0, recargo_pct: 0, ...creds } }
      );
      const p = loadChannelContext(fake.client, STORE, "rappi", new RappiAdapter());
      await expect(p).rejects.toBeInstanceOf(CredencialesInvalidasError);
      await expect(loadChannelContext(fake.client, STORE, "rappi", new RappiAdapter())).rejects.toThrow(/sin credenciales guardadas/);
      // La config se buscó por tienda, canal y activa.
      const cfg = fake.consultas.find((c) => c.tabla === "canal_config")!.ops;
      expect(tiene(cfg, "eq", "store_id", STORE) && tiene(cfg, "eq", "activo", true)).toBe(true);
    }
  });
});

// ─── Outbox ─────────────────────────────────────────────────────────────────
describe("outbox — encolado y reclamo", () => {
  it("U-200: encolarOutbox — 23505 (trabajo vivo igual) es idempotente; otro error lanza con el código", async () => {
    const job = { storeId: STORE, canalId: "rappi" as const, tipo: "confirm" as const, canalOrdenId: "o1", payload: {} };
    const dup = crearFakeSupabase(() => ({ error: { code: "23505" } }));
    await expect(encolarOutbox(dup.client, job)).resolves.toBeUndefined();
    const otro = crearFakeSupabase(() => ({ error: { code: "42501", message: "permiso" } }));
    await expect(encolarOutbox(otro.client, job)).rejects.toThrow("No se pudo encolar confirm de la orden o1: 42501");
    const sinCodigo = crearFakeSupabase(() => ({ error: { message: "timeout" } }));
    await expect(encolarOutbox(sinCodigo.client, job)).rejects.toThrow(/timeout/);
  });

  it("U-201: encolarTrabajoTienda — nuevo → true; 23505 → false (coalesce); otro error lanza", async () => {
    const job = { storeId: STORE, canalId: "rappi" as const, tipo: "catalog" as const, payload: {}, dedupeKey: `catalog:${STORE}:rappi` };
    expect(await encolarTrabajoTienda(crearFakeSupabase(() => ({})).client, job)).toBe(true);
    expect(await encolarTrabajoTienda(crearFakeSupabase(() => ({ error: { code: "23505" } })).client, job)).toBe(false);
    await expect(
      encolarTrabajoTienda(crearFakeSupabase(() => ({ error: { code: "08006" } })).client, job)
    ).rejects.toThrow("No se pudo encolar catalog de la tienda: 08006");
  });

  it("U-202: procesarOutbox — error al reclamar lanza sin tocar filas; canal desconocido → reintento, nunca éxito", async () => {
    const falla = crearFakeSupabase(() => ({}));
    falla.rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    await expect(procesarOutbox(falla.client)).rejects.toThrow("No se pudo reclamar la outbox: 57014");
    expect(falla.consultas).toHaveLength(0);

    const fake = crearFakeSupabase(() => ({}));
    fake.rpc.mockResolvedValue({
      data: [{ id: "j1", store_id: STORE, canal_id: "shopify", tipo: "confirm", canal_orden_id: "o1", payload: { external_order_id: "E" }, intentos: 1 }],
      error: null,
    });
    const r = await procesarOutbox(fake.client);
    expect(r).toEqual({ reclamados: 1, hechos: 0, reintentos: 1, muertos: 0 });
    expect(upd(fake.consultas[0].ops)).toMatchObject({ estado: "pending", last_error: "Error" });
  });

  it("U-203: disponibilidad publicada pero la re-verificación falla → sigue contando como hecho (no se reintenta)", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const push = jest.spyOn(RappiAdapter.prototype, "pushAvailability").mockResolvedValue();
    const fake = crearFakeSupabase((tabla) =>
      tabla === "canales_externos" ? { data: { habilitado: true } } : { data: null }
    );
    // Contexto: se evita el descifrado real devolviendo un contexto ya armado.
    mockLoadCtx.mockResolvedValue(CTX);
    fake.rpc.mockImplementation(async (fn: string) => {
      if (fn === "claim_canal_outbox") {
        return { data: [{ id: "j1", store_id: STORE, canal_id: "rappi", tipo: "availability", canal_orden_id: null, payload: {}, intentos: 1 }], error: null };
      }
      if (fn === "estado_disponibilidad_canal") {
        return { data: [{ producto_id: "p1", sku: "S1", disponible: true, cupo: 3, ultimo_disponible_publicado: false, ultima_cantidad_publicada: null }], error: null };
      }
      return { data: null, error: { code: "XX000" } }; // encolar_disponibilidad_canal falla
    });
    try {
      const r = await procesarOutbox(fake.client);
      expect(r).toMatchObject({ hechos: 1, reintentos: 0 });
      expect(push).toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("no se pudo re-verificar la disponibilidad (XX000)"));
    } finally {
      push.mockRestore();
      errSpy.mockRestore();
    }
  });
});

// ─── Catálogo y disponibilidad cuando la BD falla ───────────────────────────
describe("publicarCatalogo / publicarDisponibilidad — errores de BD", () => {
  const fila = {
    producto_id: "p1",
    precio_override: null,
    categoria_canal: null,
    descripcion_canal: null,
    productos: {
      id: "p1", store_id: STORE, sku: "S1", nombre: "Alimento", precio: 1000, precio_oferta: null,
      en_oferta: false, activo: true, imagen_url: null, categorias: null,
    },
  };
  const adapterFalso = () =>
    ({
      pushCatalog: jest.fn().mockResolvedValue(undefined),
      pushAvailability: jest.fn().mockResolvedValue(undefined),
      capabilities: { availabilityMode: "toggle" },
    }) as unknown as ChannelAdapter & { pushCatalog: jest.Mock; pushAvailability: jest.Mock };

  it("U-204: catálogo — error al leer no llama a la plataforma; error al registrar lo publicado o lo retirado lanza", async () => {
    const a1 = adapterFalso();
    const lectura = crearFakeSupabase(() => ({ error: { code: "42P01" } }));
    await expect(publicarCatalogo(lectura.client, a1, CTX)).rejects.toThrow("No se pudo leer el catálogo: 42P01");
    expect(a1.pushCatalog).not.toHaveBeenCalled();

    // 1ª update (publicado_at) falla.
    const a2 = adapterFalso();
    const pub = crearFakeSupabase((_t, ops) => (upd(ops) ? { error: { code: "40001" } } : { data: [fila] }));
    await expect(publicarCatalogo(pub.client, a2, CTX)).rejects.toThrow("No se pudo registrar el catálogo publicado: 40001");
    expect(a2.pushCatalog).toHaveBeenCalledTimes(1);

    // 2ª update (retiro de los que ya no van) falla.
    const a3 = adapterFalso();
    const retiro = crearFakeSupabase((_t, ops) =>
      upd(ops)?.publicado_at === null ? { error: { message: "conexión perdida" } } : { data: [fila] }
    );
    await expect(publicarCatalogo(retiro.client, a3, CTX)).rejects.toThrow(/conexión perdida/);
    const q = retiro.consultas.find((c) => upd(c.ops)?.publicado_at === null)!;
    expect(tiene(q.ops, "eq", "store_id", STORE) && tiene(q.ops, "not", "producto_id", "in", "(p1)")).toBe(true);
  });

  it("U-205: disponibilidad — error del RPC no publica; error al registrar lo publicado lanza (el trabajo se reintenta)", async () => {
    const a1 = adapterFalso();
    const rpcFalla = crearFakeSupabase(() => ({}));
    rpcFalla.rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
    await expect(publicarDisponibilidad(rpcFalla.client, a1, CTX, true)).rejects.toThrow("No se pudo leer la disponibilidad: P0001");
    expect(a1.pushAvailability).not.toHaveBeenCalled();

    const a2 = adapterFalso();
    const updFalla = crearFakeSupabase(() => ({ error: { code: "40P01" } }));
    updFalla.rpc.mockResolvedValue({
      data: [{ producto_id: "p1", sku: "S1", disponible: false, cupo: 0, ultimo_disponible_publicado: true, ultima_cantidad_publicada: null }],
      error: null,
    });
    await expect(publicarDisponibilidad(updFalla.client, a2, CTX, false)).rejects.toThrow(
      "No se pudo registrar la disponibilidad publicada: 40P01"
    );
    expect(a2.pushAvailability).toHaveBeenCalledWith(CTX, [{ sku: "S1", disponible: false }]);
  });
});
