/**
 * Tests U-190 a U-194: Fase 6 de docs/canales-stock/stock_canales_externos.md.
 *   - evaluarPreparacion (6.2): checklist de salida a producción.
 *   - scripts/canales/simular-rappi.mjs (6.1): el simulador firma y arma los
 *     eventos EXACTAMENTE como los acepta el adaptador real de Rappi (se
 *     ejecuta el script contra un servidor HTTP local y se valida con
 *     firmaRappiValida + parseEvent).
 */
import { createServer, type IncomingMessage } from "node:http";
import { execFile } from "node:child_process";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { evaluarPreparacion, listoParaProduccion, type DatosPreparacion } from "@/lib/canales/application/preparacion";
import { RappiAdapter, firmaRappiValida } from "@/lib/canales/adapters/rappi/adapter";

const AHORA = Date.parse("2026-09-25T12:00:00Z");

function base(): DatosPreparacion {
  return {
    produccion: true,
    adaptadorDesplegado: true,
    env: { encryptionKey: true, cronSecret: true, apiBase: true, authBase: true },
    habilitadoGlobal: true,
    licenciaVigente: true,
    config: {
      existe: true,
      activo: true,
      credenciales: "ok",
      externalStoreId: true,
      ultimoEventoAt: new Date(AHORA - 2 * 60_000).toISOString(),
      ultimoEventoTipo: "PING",
      menuEstado: "aprobado",
      menuDetalle: null,
    },
    productos: { habilitados: 3, publicados: 3, sinMinimo: [] },
    crons: [
      { jobname: "petshop-canales-outbox", active: true },
      { jobname: "petshop-canales-reconciliar", active: true },
    ],
    outboxMuertos: 0,
    ahoraMs: AHORA,
  };
}
const estado = (d: DatosPreparacion, id: string) => evaluarPreparacion(d).find((i) => i.id === id)!;

describe("evaluarPreparacion", () => {
  it("U-190: todo configurado → todos 'ok' y listo para producción", () => {
    const items = evaluarPreparacion(base());
    expect(items.every((i) => i.estado === "ok")).toBe(true);
    expect(listoParaProduccion(items)).toBe(true);
    expect(items.map((i) => i.id)).toEqual([
      "despliegue", "entorno", "global", "licencia", "config", "credenciales",
      "webhook", "catalogo", "menu", "stock_minimo", "crons", "outbox",
    ]);
  });

  it("U-191: webhook — sin eventos → pendiente; evento reciente → ok; más de 15 min → error", () => {
    const d = base();
    d.config.ultimoEventoAt = null;
    expect(estado(d, "webhook").estado).toBe("pendiente");
    d.config.ultimoEventoAt = new Date(AHORA - 16 * 60_000).toISOString();
    expect(estado(d, "webhook")).toMatchObject({ estado: "error", detalle: expect.stringMatching(/Sin eventos hace 16 min/) });
    d.config.ultimoEventoAt = new Date(AHORA - 15 * 60_000).toISOString();
    expect(estado(d, "webhook").estado).toBe("ok");
  });

  it("U-192: menú enviado → pendiente (24–72 h); rechazado → error con motivo; stock mínimo 0 → pendiente con nombres", () => {
    const d = base();
    d.config.menuEstado = "enviado";
    expect(estado(d, "menu")).toMatchObject({ estado: "pendiente", detalle: expect.stringMatching(/24–72 h/) });
    d.config.menuEstado = "rechazado";
    d.config.menuDetalle = "Faltan imágenes";
    expect(estado(d, "menu")).toMatchObject({ estado: "error", detalle: "Rechazado: Faltan imágenes." });
    d.productos.sinMinimo = Array.from({ length: 12 }, (_, i) => `P${i}`);
    const sm = estado(d, "stock_minimo");
    expect(sm.estado).toBe("pendiente");
    expect(sm.detalle).toMatch(/^12 producto/);
    expect(sm.detalle).toMatch(/P9, …\)\.$/);
    expect(listoParaProduccion(evaluarPreparacion(d))).toBe(false);
  });

  it("U-193: entorno, credenciales, crons y outbox — producción exige URLs; dev queda pendiente; nombres, nunca valores", () => {
    const d = base();
    d.env.apiBase = false;
    d.env.cronSecret = false;
    expect(estado(d, "entorno")).toMatchObject({ estado: "error", detalle: expect.stringMatching(/CRON_SECRET.*URL base de la API/) });
    d.produccion = false;
    d.env = { encryptionKey: true, cronSecret: true, apiBase: false, authBase: false };
    expect(estado(d, "entorno").estado).toBe("pendiente");
    d.config.credenciales = "invalidas";
    expect(estado(d, "credenciales").estado).toBe("error");
    d.crons = [{ jobname: "petshop-canales-outbox", active: false }];
    expect(estado(d, "crons")).toMatchObject({ estado: "pendiente", detalle: expect.stringMatching(/petshop-canales-outbox, petshop-canales-reconciliar/) });
    d.outboxMuertos = 2;
    expect(estado(d, "outbox").estado).toBe("error");
    d.productos = { habilitados: 0, publicados: 0, sinMinimo: [] };
    expect(estado(d, "catalogo").estado).toBe("error");
  });
});

describe("scripts/canales/simular-rappi.mjs", () => {
  const SCRIPT = path.join(process.cwd(), "scripts", "canales", "simular-rappi.mjs");
  const SECRETO = "secreto-e2e";
  const STORE = "123e4567-e89b-12d3-a456-426614174000";

  function correr(argumentos: string[], puerto: number): Promise<{ ok: boolean; stdout: string }> {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [SCRIPT, "--url", `http://127.0.0.1:${puerto}`, "--store-id", STORE, ...argumentos],
        { env: { ...process.env, RAPPI_WEBHOOK_SECRET: SECRETO } },
        (err, stdout) => resolve({ ok: !err, stdout })
      );
    });
  }

  it("U-194: PING, NEW_ORDER y MENU_REJECTED firmados que el adaptador real acepta, con store_id y evento en la URL", async () => {
    const recibidos: { url: string; headers: IncomingMessage["headers"]; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        recibidos.push({ url: req.url ?? "", headers: req.headers, body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"status":"ok"}');
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const puerto = (server.address() as AddressInfo).port;
    try {
      expect((await correr(["--evento", "PING"], puerto)).ok).toBe(true);
      expect((await correr(["--evento", "NEW_ORDER", "--rappi-store", "900", "--item", "SKU-1:2:15990", "--item", "SKU-2:1:3990"], puerto)).ok).toBe(true);
      expect((await correr(["--evento", "MENU_REJECTED", "--motivo", "Faltan fotos"], puerto)).ok).toBe(true);
    } finally {
      server.close();
    }

    const adapter = new RappiAdapter();
    const ctx = { storeId: STORE, canalId: "rappi" as const, externalStoreId: "900", credentials: { client_id: "c", client_secret: "s", store_id: "900", webhook_secret: SECRETO }, recargoPct: 0, comisionPct: 0 };
    expect(recibidos).toHaveLength(3);
    for (const r of recibidos) {
      const url = new URL(r.url, "http://x");
      expect(url.pathname).toBe("/api/canales/webhook/rappi");
      expect(url.searchParams.get("store_id")).toBe(STORE);
      const evento = url.searchParams.get("evento");
      const headers = new Headers({ "rappi-signature": String(r.headers["rappi-signature"]) });
      expect(firmaRappiValida(headers.get("rappi-signature"), r.body, SECRETO, Date.now())).toBe(true);
      expect(adapter.verifyWebhook({ headers, rawBody: r.body, evento }, ctx)).toBe(true);
    }
    const orden = adapter.parseEvent({ headers: new Headers(), rawBody: recibidos[1].body, evento: "NEW_ORDER" });
    expect(orden).toMatchObject({
      tipo: "orden_creada",
      orden: {
        externalStoreIds: ["900", "900"],
        items: [
          { sku: "SKU-1", cantidad: 2, precioUnitarioBruto: 15990 },
          { sku: "SKU-2", cantidad: 1, precioUnitarioBruto: 3990 },
        ],
        totalBruto: 35970,
      },
    });
    expect(adapter.parseEvent({ headers: new Headers(), rawBody: recibidos[2].body, evento: "MENU_REJECTED" })).toEqual({ tipo: "menu_rechazado", detalle: "Faltan fotos" });
  }, 30_000);
});
