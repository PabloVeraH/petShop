/**
 * Tests I-693 a I-696: GET /api/canales/[canal]/preparacion — checklist de
 * salida a producción (Fase 6, paso 6.2 de
 * docs/canales-stock/stock_canales_externos.md). La lógica de cada ítem está
 * en U-190..U-193; aquí: autorización, tenant, lectura de datos, que nunca se
 * exponen secretos ni valores de variables de entorno, y las URLs del webhook.
 */
import { NextRequest } from "next/server";
import { crearFakeSupabase, tiene } from "../../helpers/fake-supabase";

jest.mock("@/lib/audit", () => ({ withErrorLogging: (h: unknown) => h }));
const mockDeshabilitado = jest.fn();
jest.mock("@/lib/usuario-habilitado", () => ({ usuarioDeshabilitado: (...a: unknown[]) => mockDeshabilitado(...a) }));
const mockDecrypt = jest.fn();
jest.mock("@/lib/canales/encryption", () => ({ decryptJSON: (...a: unknown[]) => mockDecrypt(...a) }));
let fakeActual: ReturnType<typeof crearFakeSupabase>;
jest.mock("@/lib/supabase", () => ({ createServiceClient: () => fakeActual.client }));
const mockGetStoreId = jest.fn();
jest.mock("@/lib/auth", () => ({ getStoreId: () => mockGetStoreId() }));
const mockAuth = jest.fn();
jest.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

import { GET } from "@/app/api/canales/[canal]/preparacion/route";

const STORE = "123e4567-e89b-12d3-a456-426614174000";
const SECRETO_CREDS = "valor-super-secreto";
const CREDS = { client_id: "cid", client_secret: SECRETO_CREDS, store_id: "900", webhook_secret: "wh" };

const env = { ENABLED_CHANNELS: process.env.ENABLED_CHANNELS, CRON_SECRET: process.env.CRON_SECRET, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY };
afterAll(() => Object.assign(process.env, env));

function montar(opts: { config?: Record<string, unknown> | null; crons?: unknown; cronError?: boolean } = {}) {
  const config = opts.config === undefined
    ? {
        activo: true,
        external_store_id: "900",
        credenciales_encriptada: "enc",
        credenciales_iv: "iv",
        credenciales_auth_tag: "tag",
        ultimo_evento_at: new Date(Date.now() - 60_000).toISOString(),
        ultimo_evento_tipo: "PING",
        menu_estado: "enviado",
        menu_detalle: null,
      }
    : opts.config;
  fakeActual = crearFakeSupabase((tabla) => {
    if (tabla === "canales_externos") return { data: { habilitado: true } };
    if (tabla === "stores") return { data: { license_end_date: null, license_warning_days: 7 } };
    if (tabla === "canal_config") return { data: config };
    if (tabla === "canal_producto_config") {
      return {
        data: [
          { publicado_at: "t", productos: { nombre: "Alimento", stock_minimo: 0, activo: true, store_id: STORE } },
          { publicado_at: null, productos: { nombre: "Juguete", stock_minimo: 3, activo: true, store_id: STORE } },
          { publicado_at: "t", productos: { nombre: "Ajeno", stock_minimo: 0, activo: true, store_id: "otra" } },
        ],
      };
    }
    if (tabla === "canal_outbox") return { data: null, count: 0 };
    return { data: null };
  });
  fakeActual.rpc.mockResolvedValue(
    opts.cronError ? { data: null, error: { code: "42883" } } : { data: opts.crons ?? [], error: null }
  );
}
const llamar = (canal = "rappi") =>
  GET(new NextRequest(`https://app.ejemplo.cl/api/canales/${canal}/preparacion`), { params: Promise.resolve({ canal }) });
const item = (body: { items: { id: string; estado: string; detalle: string }[] }, id: string) => body.items.find((i) => i.id === id)!;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ENABLED_CHANNELS = "rappi";
  process.env.CRON_SECRET = "cron-secreto-valor";
  process.env.ENCRYPTION_KEY = "clave-valor";
  mockDeshabilitado.mockResolvedValue(false);
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE });
  mockAuth.mockResolvedValue({ sessionClaims: { sub: "u1", publicMetadata: { storeId: STORE, storeAdmin: true } } });
  mockDecrypt.mockReturnValue(CREDS);
});

describe("GET /api/canales/[canal]/preparacion", () => {
  it("I-693: arma el checklist con datos de ESTA tienda y las URLs del webhook por evento (store_id de la sesión)", async () => {
    montar({ crons: [{ jobname: "petshop-canales-outbox", active: true }] });
    const res = await llamar();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listo).toBe(false);
    expect(item(body, "webhook").estado).toBe("ok");
    expect(item(body, "credenciales").estado).toBe("ok");
    expect(item(body, "menu").estado).toBe("pendiente");
    // El producto de otra tienda no cuenta; "Alimento" sin mínimo.
    expect(item(body, "catalogo").detalle).toBe("1 de 2 habilitados publicados.");
    expect(item(body, "stock_minimo").detalle).toMatch(/Alimento/);
    expect(item(body, "stock_minimo").detalle).not.toMatch(/Ajeno/);
    expect(item(body, "crons").detalle).toMatch(/petshop-canales-reconciliar/);

    const eventos = body.webhook.urls.map((u: { evento: string }) => u.evento);
    expect(eventos).toEqual(["NEW_ORDER", "ORDER_EVENT_CANCEL", "ORDER_OTHER_EVENT", "MENU_APPROVED", "MENU_REJECTED", "PING"]);
    expect(body.webhook.urls[0].url).toBe(`https://app.ejemplo.cl/api/canales/webhook/rappi?store_id=${STORE}&evento=NEW_ORDER`);

    for (const c of fakeActual.consultas.filter((c) => c.tabla !== "canales_externos")) {
      expect(tiene(c.ops, "eq", c.tabla === "stores" ? "id" : "store_id", STORE)).toBe(true);
    }
  });

  it("I-694: la respuesta NUNCA incluye credenciales, secretos ni valores de variables de entorno", async () => {
    montar();
    const texto = JSON.stringify(await (await llamar()).json());
    for (const secreto of [SECRETO_CREDS, "cron-secreto-valor", "clave-valor"]) {
      expect(texto).not.toContain(secreto);
    }
    expect(texto).not.toMatch(/credenciales_encriptada|client_secret|webhook_secret/);
  });

  it("I-695: credenciales indescifrables o con campos antiguos → 'invalidas'; sin config → error; sin pg_cron → crons pendiente (no 500)", async () => {
    mockDecrypt.mockImplementation(() => { throw new Error("bad tag"); });
    montar({ cronError: true });
    let body = await (await llamar()).json();
    expect(item(body, "credenciales")).toMatchObject({ estado: "error", detalle: expect.stringMatching(/no son válidas/) });
    expect(item(body, "crons").estado).toBe("pendiente");

    mockDecrypt.mockReturnValue({ api_key: "x", api_secret: "y" });
    montar();
    body = await (await llamar()).json();
    expect(item(body, "credenciales").estado).toBe("error");

    montar({ config: null });
    body = await (await llamar()).json();
    expect(item(body, "config").estado).toBe("error");
    expect(item(body, "webhook").estado).toBe("pendiente");
  });

  it("I-696: 401 sin sesión, 403 deshabilitado o storeWorker, 404 canal desconocido, 409 canal sin adaptador", async () => {
    montar();
    mockGetStoreId.mockResolvedValueOnce(null);
    expect((await llamar()).status).toBe(401);
    mockDeshabilitado.mockResolvedValueOnce(true);
    expect((await llamar()).status).toBe(403);
    mockAuth.mockResolvedValueOnce({ sessionClaims: { sub: "u2", publicMetadata: { storeId: STORE, storeWorker: true } } });
    expect((await llamar()).status).toBe(403);
    expect(fakeActual.consultas).toHaveLength(0);
    expect((await llamar("instagram")).status).toBe(404);
    expect((await llamar("pedidosya")).status).toBe(409);
  });
});
