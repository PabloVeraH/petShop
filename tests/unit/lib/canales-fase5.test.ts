/**
 * Tests U-182 a U-188: piezas de la Fase 5 de
 * docs/canales-stock/stock_canales_externos.md.
 *   - lineasLiquidacionCanal (D24): asiento balanceado, IVA extraído.
 *   - LiquidacionCanalSchema: límite de confianza de la liquidación.
 *   - armarAlertas / esErrorCredenciales (5.3).
 *   - usuarioDeshabilitado (5.1): fail-closed.
 *   - registrarEstadoMenu (5.3): tenant, auditoría, no lanza.
 *   - rappiFetch: un 401 invalida el token cacheado (token expirado).
 */
import { crearFakeSupabase, tiene, argsDe } from "../../helpers/fake-supabase";

const mockLogAudit = jest.fn();
jest.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => mockLogAudit(...a) }));
let fakeActual: ReturnType<typeof crearFakeSupabase>;
jest.mock("@/lib/supabase", () => ({ createServiceClient: () => fakeActual.client }));

import { lineasLiquidacionCanal } from "@/lib/contabilidad/generador-asientos";
import { CUENTAS } from "@/lib/contabilidad/types";
import { extraerIva } from "@/lib/tax";
import { LiquidacionCanalSchema } from "@/lib/validation";
import { armarAlertas, esErrorCredenciales } from "@/lib/canales/application/alertas";
import { usuarioDeshabilitado } from "@/lib/usuario-habilitado";
import { registrarEstadoMenu } from "@/lib/canales/application/menu";
import { rappiFetch, limpiarCacheTokens } from "@/lib/canales/adapters/rappi/client";
import { PlataformaError } from "@/lib/canales/adapters/port";

const STORE = "123e4567-e89b-12d3-a456-426614174000";

beforeEach(() => {
  jest.clearAllMocks();
  mockLogAudit.mockResolvedValue(undefined);
});

describe("lineasLiquidacionCanal", () => {
  const suma = (ls: { debito: number; credito: number }[], k: "debito" | "credito") => ls.reduce((s, l) => s + l[k], 0);

  it("U-182: D24 — Banco neto + comisión neta + IVA crédito = CxC bruto (ejemplo del usuario)", () => {
    const ls = lineasLiquidacionCanal({ canal: "rappi", montoBruto: 100000, comision: 23800 });
    const neto = Object.fromEntries(ls.map((l) => [l.cuentaCodigo, l.debito - l.credito]));
    expect(neto).toEqual({
      [CUENTAS.BANCO.codigo]: 76200,
      [CUENTAS.COMISIONES_CANAL.codigo]: 20000,
      [CUENTAS.IVA_CREDITO_FISCAL.codigo]: 3800,
      [CUENTAS.CXC_RAPPI.codigo]: -100000,
    });
    expect(CUENTAS.COMISIONES_CANAL.tipo).toBe("GASTO");
    // Cada canal salda SU cuenta por cobrar.
    expect(lineasLiquidacionCanal({ canal: "pedidosya", montoBruto: 10, comision: 1 }).some((l) => l.cuentaCodigo === CUENTAS.CXC_PEDIDOSYA.codigo)).toBe(true);
    expect(() => lineasLiquidacionCanal({ canal: "pos", montoBruto: 10, comision: 1 })).toThrow();
  });

  it("U-183: siempre balanceado y sin líneas en cero para montos enteros (incluye comisión 0 y = bruto)", () => {
    const casos: [number, number][] = [[100000, 0], [100000, 100000], [1, 1], [99999, 12345], [7, 3]];
    for (let i = 0; i < 200; i++) {
      const bruto = 1 + Math.floor(Math.random() * 5_000_000);
      casos.push([bruto, Math.floor(Math.random() * (bruto + 1))]);
    }
    for (const [montoBruto, comision] of casos) {
      const ls = lineasLiquidacionCanal({ canal: "rappi", montoBruto, comision });
      expect(suma(ls, "debito")).toBe(suma(ls, "credito"));
      expect(suma(ls, "credito")).toBe(montoBruto);
      expect(ls.every((l) => l.debito !== 0 || l.credito !== 0)).toBe(true);
      const iva = ls.find((l) => l.cuentaCodigo === CUENTAS.IVA_CREDITO_FISCAL.codigo)?.debito ?? 0;
      expect(iva).toBe(extraerIva(comision));
    }
  });
});

describe("LiquidacionCanalSchema", () => {
  const OK = { canal_id: "rappi", periodo_desde: "2026-09-01", periodo_hasta: "2026-09-01", fecha_deposito: "2026-09-05", monto_bruto: 10, comision: 10 };
  it("U-184: acepta período de un día y comisión = bruto; rechaza campos extra, invertidos, decimales y canal no externo", () => {
    expect(LiquidacionCanalSchema.safeParse(OK).success).toBe(true);
    expect(LiquidacionCanalSchema.safeParse({ ...OK, referencia: "  R-1  " }).data?.referencia).toBe("R-1");
    for (const malo of [
      { ...OK, monto_neto: 0 },
      { ...OK, store_id: STORE },
      { ...OK, periodo_desde: "2026-09-02" },
      { ...OK, comision: 11 },
      { ...OK, monto_bruto: 0 },
      { ...OK, comision: 0.5 },
      { ...OK, canal_id: "instagram" },
      { ...OK, referencia: "x".repeat(121) },
    ]) {
      expect(LiquidacionCanalSchema.safeParse(malo).success).toBe(false);
    }
  });
});

describe("alertas", () => {
  it("U-185: esErrorCredenciales reconoce credenciales inválidas, token rechazado y 401/403; no otros errores", () => {
    expect(esErrorCredenciales("Credenciales del canal inválidas: revisar client_id")).toBe(true);
    expect(esErrorCredenciales("Rappi: autenticación rechazada (401)")).toBe(true);
    expect(esErrorCredenciales("Rappi: PUT /orders respondió 401")).toBe(true);
    expect(esErrorCredenciales("Rappi: PUT /orders respondió 403")).toBe(true);
    expect(esErrorCredenciales("Rappi: PUT /orders respondió 503")).toBe(false);
    expect(esErrorCredenciales("Rappi: PUT /orders respondió 4010")).toBe(false);
    expect(esErrorCredenciales(null)).toBe(false);
  });

  it("U-186: una alerta de credenciales por canal; dead con outbox_id (reintentable); reintentando sin él", () => {
    const j = (id: string, estado: string, err: string, canal = "rappi") =>
      ({ id, canal_id: canal, tipo: "confirm", estado, intentos: 3, last_error: err, updated_at: null });
    const a = armarAlertas(
      [j("1", "dead", "Rappi: autenticación rechazada (401)"), j("2", "pending", "Rappi: PUT /x respondió 401"), j("3", "pending", "timeout")],
      [],
      []
    );
    expect(a.filter((x) => x.tipo === "credenciales")).toHaveLength(1);
    expect(a.find((x) => x.tipo === "llamada_detenida")).toMatchObject({ outbox_id: "1", severidad: "alta" });
    expect(a.filter((x) => x.tipo === "llamada_reintentando").every((x) => x.outbox_id === undefined)).toBe(true);
    expect(armarAlertas([], [], [])).toEqual([]);
  });
});

describe("usuarioDeshabilitado", () => {
  it("U-187: true si is_disabled; false si no o sin fila (systemAdmin); error de BD → true (fail-closed); filtra por clerk_id", async () => {
    fakeActual = crearFakeSupabase(() => ({ data: { is_disabled: true } }));
    expect(await usuarioDeshabilitado("u1")).toBe(true);
    expect(tiene(fakeActual.consultas[0].ops, "eq", "clerk_id", "u1")).toBe(true);
    fakeActual = crearFakeSupabase(() => ({ data: { is_disabled: false } }));
    expect(await usuarioDeshabilitado("u1")).toBe(false);
    fakeActual = crearFakeSupabase(() => ({ data: null }));
    expect(await usuarioDeshabilitado("u1")).toBe(false);
    fakeActual = crearFakeSupabase(() => ({ error: { code: "08006" } }));
    expect(await usuarioDeshabilitado("u1")).toBe(true);
  });
});

describe("registrarEstadoMenu", () => {
  it("U-188: actualiza la config de ESA tienda/canal; rechazo trunca el detalle y audita con el id de la config; error no lanza", async () => {
    const fake = crearFakeSupabase(() => ({ data: [{ id: "cfg-1" }] }));
    await registrarEstadoMenu(fake.client, STORE, "rappi", "rechazado", "x".repeat(900));
    const q = fake.consultas[0];
    const u = argsDe(q.ops, "update")?.[0] as Record<string, unknown>;
    expect(u).toMatchObject({ menu_estado: "rechazado" });
    expect(String(u.menu_detalle)).toHaveLength(500);
    expect(tiene(q.ops, "eq", "store_id", STORE) && tiene(q.ops, "eq", "canal_id", "rappi")).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ entityId: "cfg-1", result: "failure", userId: "sistema:canales" }));

    mockLogAudit.mockClear();
    await registrarEstadoMenu(fake.client, STORE, "rappi", "aprobado", "ignorado");
    expect(argsDe(fake.consultas[1].ops, "update")?.[0]).toMatchObject({ menu_estado: "aprobado", menu_detalle: null });
    expect(mockLogAudit).not.toHaveBeenCalled();

    const roto = crearFakeSupabase(() => ({ error: { code: "42703" } }));
    await expect(registrarEstadoMenu(roto.client, STORE, "rappi", "rechazado", "x")).resolves.toBeUndefined();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});

describe("rappiFetch — token expirado", () => {
  const original = global.fetch;
  afterAll(() => {
    global.fetch = original;
  });

  it("U-189: un 401 de la API invalida el token cacheado: el siguiente intento vuelve a autenticarse", async () => {
    limpiarCacheTokens();
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    let apiStatus = 401;
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/token/")
        ? { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }) }
        : { ok: apiStatus < 400, status: apiStatus, json: async () => ({}) }
    );
    const ctx = { storeId: STORE, canalId: "rappi" as const, externalStoreId: "9", credentials: { client_id: "c", client_secret: "s" }, recargoPct: 0, comisionPct: 0 };
    const tokens = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/token/")).length;

    await expect(rappiFetch(ctx, "PUT", "/x")).rejects.toBeInstanceOf(PlataformaError);
    expect(tokens()).toBe(1);
    apiStatus = 200;
    await rappiFetch(ctx, "PUT", "/x");
    expect(tokens()).toBe(2); // se pidió un token nuevo
    await rappiFetch(ctx, "PUT", "/x");
    expect(tokens()).toBe(2); // y ese sí se reutiliza
  });
});
