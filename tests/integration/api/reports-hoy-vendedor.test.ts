/**
 * Tests RHV-I-01 a RHV-I-14: período "Hoy" y filtro por vendedor en
 * GET /api/reports y GET /api/reports/export (pedido de la tienda 2026-11-24).
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const VENDEDOR = "user_ana";
const ADMIN = { publicMetadata: { storeAdmin: true, storeId: STORE_ID } };

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();
const mockLogAudit = jest.fn();
let mockClaims: Record<string, unknown> | null = null;

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ sessionClaims: mockClaims }) }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/audit", () => ({
  withErrorLogging: (h: unknown) => h,
  getRequestMetadata: () => ({ ipAddress: "1.1.1.1", userAgent: "jest" }),
  logAudit: (...a: unknown[]) => { mockLogAudit(...a); return Promise.resolve(); },
}));

type Venta = Record<string, unknown>;
type Chain = Record<string, jest.Mock>;
let chains: Record<string, Chain[]> = {};

// `range` corta de verdad, como la API (máximo 1.000 filas por consulta).
function tablas(datos: Record<string, Venta[]>, errorEnConsulta: Record<string, number> = {}) {
  chains = {};
  mockFrom.mockImplementation((t: string) => {
    const c: Chain = {};
    let filas = (datos[t] ?? []).slice(0, 1000);
    for (const k of ["select", "eq", "neq", "gte", "lte", "gt", "in", "not", "order"]) c[k] = jest.fn().mockReturnValue(c);
    c.range = jest.fn().mockImplementation((a: number, b: number) => {
      filas = (datos[t] ?? []).slice(a, Math.min(b + 1, a + 1000));
      return c;
    });
    (chains[t] ??= []).push(c);
    const falla = chains[t].length === errorEnConsulta[t];
    c.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
      resolve(falla ? { data: null, error: { message: "boom" } } : { data: filas, error: null }));
    return c;
  });
}

const venta = (i: number, extra: Venta = {}): Venta => ({
  id: `v${i}`, numero_comprobante: `N-${i}`, created_at: "2026-11-24T15:00:00", total: 1000, subtotal: 1000,
  descuento: 0, impuesto: 160, metodo_pago: "efectivo", canal: "pos", estado: "completada",
  procedencia: "presencial", worker_clerk_id: VENDEDOR, clientes: null, ...extra,
});

async function reporte(qs: string) {
  const { GET } = await import("@/app/api/reports/route");
  return GET(new NextRequest(`http://localhost/api/reports${qs}`));
}
async function exportar(qs: string) {
  const { GET } = await import("@/app/api/reports/export/route");
  return GET(new NextRequest(`http://localhost/api/reports/export${qs}`));
}
const lineas = async (r: Response) => (await r.text()).trim().split("\n").slice(1);

beforeEach(() => {
  jest.clearAllMocks();
  // 23:30 del 24 en Chile (UTC−3) = 02:30 UTC del 25: "hoy" sigue siendo el 24.
  jest.useFakeTimers({ now: new Date("2026-11-25T02:30:00.000Z"), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  mockClaims = ADMIN;
  tablas({ ventas: [venta(1), venta(2)] });
});
afterEach(() => jest.useRealTimers());

describe("GET /api/reports — Hoy y vendedor", () => {
  it("RHV-I-01: periodo=hoy parte a las 00:00 de Chile, también de noche (cuando en UTC ya es mañana)", async () => {
    const body = await (await reporte("?periodo=hoy")).json();
    expect(chains.ventas[0].gte).toHaveBeenCalledWith("created_at", "2026-11-24T03:00:00.000Z");
    expect(body.periodo).toBe("hoy");
    expect(body.totalPeriodo).toBe(2000);
  });

  it("RHV-I-02: con Hoy no hay predicción, aunque haya 10 ventas o más (el día está a medias)", async () => {
    tablas({ ventas: Array.from({ length: 12 }, (_, i) => venta(i)) });
    const body = await (await reporte("?periodo=hoy")).json();
    expect(body.prediccion7dias).toBeNull();
    expect(body.promedioDiario).toBe(12000);
  });

  it("RHV-I-03: 7, 30 y 90 días siguen siendo los últimos N días; períodos inválidos → 400 sin consultar", async () => {
    await reporte("?periodo=7");
    const desde = new Date("2026-11-25T02:30:00.000Z");
    desde.setDate(desde.getDate() - 7);
    expect(chains.ventas[0].gte).toHaveBeenCalledWith("created_at", desde.toISOString());

    mockFrom.mockClear();
    for (const p of ["0", "-1", "366", "ayer", "1.5", "HOY"]) {
      expect((await reporte(`?periodo=${p}`)).status).toBe(400);
    }
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("RHV-I-04: vendedor filtra las ventas de la tienda de la sesión, junto con período y canal", async () => {
    expect((await reporte(`?periodo=hoy&canal=pos&vendedor=${VENDEDOR}`)).status).toBe(200);
    const eq = chains.ventas[0].eq;
    expect(eq).toHaveBeenCalledWith("store_id", STORE_ID);
    expect(eq).toHaveBeenCalledWith("worker_clerk_id", VENDEDOR);
    expect(eq).toHaveBeenCalledWith("canal", "pos");
    expect(chains.ventas[0].neq).toHaveBeenCalledWith("estado", "anulada");
  });

  it("RHV-I-05: sin vendedor (o vacío) no filtra por vendedor", async () => {
    await reporte("?periodo=30&vendedor=");
    expect(chains.ventas[0].eq.mock.calls.some(([c]) => c === "worker_clerk_id")).toBe(false);
  });

  it.each([
    ["storeWorker", { publicMetadata: { storeWorker: true, storeId: STORE_ID } }],
    ["storeAdmin de OTRA tienda", { publicMetadata: { storeAdmin: true, storeId: "otra" } }],
    ["sin metadata", {}],
  ])("RHV-I-06 (seguridad): %s con ?vendedor= → 403 sin consultar nada", async (_r, claims) => {
    mockClaims = claims;
    const res = await reporte(`?vendedor=${VENDEDOR}`);
    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("RHV-I-07: el storeWorker sigue viendo el reporte sin vendedor; systemAdmin puede filtrar; sin sesión → 401", async () => {
    mockClaims = { publicMetadata: { storeWorker: true, storeId: STORE_ID } };
    expect((await reporte("?periodo=hoy")).status).toBe(200);
    mockClaims = { publicMetadata: { systemAdmin: true } };
    expect((await reporte(`?vendedor=${VENDEDOR}`)).status).toBe(200);
    mockGetStoreId.mockResolvedValue(null);
    expect((await reporte(`?vendedor=${VENDEDOR}`)).status).toBe(401);
  });

  it("RHV-I-08 (seguridad): store_id enviado por el cliente se ignora; vendedor de más de 255 caracteres → 400", async () => {
    await reporte(`?vendedor=${VENDEDOR}&store_id=otra&storeId=otra`);
    expect(chains.ventas[0].eq).toHaveBeenCalledWith("store_id", STORE_ID);
    expect(chains.ventas[0].eq).not.toHaveBeenCalledWith("store_id", "otra");
    expect((await reporte(`?vendedor=${"x".repeat(256)}`)).status).toBe(400);
  });
});

describe("GET /api/reports/export — filtros", () => {
  it("RHV-I-09: el CSV respeta período, canal y vendedor, siempre en la tienda de la sesión", async () => {
    const res = await exportar(`?tipo=ventas&periodo=hoy&canal=pos&vendedor=${VENDEDOR}&store_id=otra`);
    expect(res.status).toBe(200);
    const c = chains.ventas[0];
    expect(c.gte).toHaveBeenCalledWith("created_at", "2026-11-24T03:00:00.000Z");
    expect(c.eq).toHaveBeenCalledWith("store_id", STORE_ID);
    expect(c.eq).toHaveBeenCalledWith("canal", "pos");
    expect(c.eq).toHaveBeenCalledWith("worker_clerk_id", VENDEDOR);
    expect(c.eq).not.toHaveBeenCalledWith("store_id", "otra");
    expect(await lineas(res)).toHaveLength(2);
  });

  it("RHV-I-10: pantalla y CSV usan el mismo inicio de período", async () => {
    for (const p of ["hoy", "7", "30", "90"]) {
      tablas({ ventas: [] });
      await reporte(`?periodo=${p}`);
      await exportar(`?tipo=ventas&periodo=${p}`);
      expect(chains.ventas[1].gte.mock.calls).toEqual(chains.ventas[0].gte.mock.calls);
    }
  });

  it("RHV-I-11: las anuladas siguen en el CSV con su Estado; sin filtros no limita fecha, canal ni vendedor", async () => {
    tablas({ ventas: [venta(1), venta(2, { estado: "anulada" })] });
    const filas = await lineas(await exportar("?tipo=ventas"));
    expect(filas[1]).toContain(",anulada,");
    const c = chains.ventas[0];
    expect(c.neq).not.toHaveBeenCalled();
    expect(c.gte).not.toHaveBeenCalled();
    expect(c.eq.mock.calls).toEqual([["store_id", STORE_ID]]);
  });

  it("RHV-I-12 (REGRESIÓN): con más de 1.000 ventas salen todas, una vez cada una y en orden, con sus pagos", async () => {
    const N = 2300;
    tablas({ ventas: Array.from({ length: N }, (_, i) => venta(i)) });
    const filas = await lineas(await exportar("?tipo=ventas&periodo=90"));
    expect(filas).toHaveLength(N);
    expect(filas.map((f) => f.split(",")[0])).toEqual(Array.from({ length: N }, (_, i) => `N-${i}`));
    expect(chains.ventas.map((c) => c.range.mock.calls[0])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    // Cada página conserva el filtro de tienda y de fecha.
    for (const c of chains.ventas) {
      expect(c.eq).toHaveBeenCalledWith("store_id", STORE_ID);
      expect(c.gte).toHaveBeenCalledTimes(1);
      expect(c.lte).toHaveBeenCalledWith("created_at", "2026-11-25T02:30:00.000Z");
    }
    for (const c of chains.pagos) {
      expect(c.in.mock.calls[0][1].length).toBeLessThanOrEqual(100);
      expect(c.eq).toHaveBeenCalledWith("store_id", STORE_ID);
    }
    expect(chains.pagos.flatMap((c) => c.in.mock.calls[0][1])).toHaveLength(N);
  });

  it("RHV-I-13: si falla una consulta de ventas (la primera u otra) → 500, nunca un CSV vacío o a medias", async () => {
    for (const n of [1, 2]) {
      tablas({ ventas: Array.from({ length: 1500 }, (_, i) => venta(i)) }, { ventas: n });
      const res = await exportar("?tipo=ventas&periodo=90");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Error interno" });
    }
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("RHV-I-14 (seguridad): storeWorker → 403 y filtro inválido → 400 sin consultar; la auditoría guarda los filtros", async () => {
    mockClaims = { publicMetadata: { storeWorker: true, storeId: STORE_ID } };
    expect((await exportar("?tipo=ventas&periodo=hoy")).status).toBe(403);
    mockClaims = ADMIN;
    expect((await exportar("?tipo=ventas&periodo=ayer")).status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();

    await exportar(`?tipo=ventas&periodo=hoy&vendedor=${VENDEDOR}`);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "EXPORT", storeId: STORE_ID, userId: "u1",
      newValues: { periodo: "hoy", canal: "todos", vendedor: VENDEDOR },
    }));
  });
});
