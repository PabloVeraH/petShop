/**
 * Tests I-816 a I-827: pago mixto en reportes, dashboard y export CSV (F10).
 * Las ventas con metodo_pago='mixto' se reparten entre sus métodos reales
 * (tabla pagos) y se agrega el monto a boletear (Res. Ex. SII 176/2020).
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();
let mockClaims: Record<string, unknown> | null = null;

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ sessionClaims: mockClaims }) }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

type Chain = Record<string, jest.Mock>;
function chain(data: unknown[] = []): Chain {
  const c: Chain = {};
  for (const k of ["select", "eq", "neq", "gte", "lte", "lt", "gt", "in", "not", "order", "limit", "insert"]) {
    c[k] = jest.fn().mockReturnValue(c);
  }
  c.single = jest.fn().mockResolvedValue({ data: null, error: null });
  c.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) => resolve({ data, error: null, count: data.length }));
  return c;
}

// Tablas con datos; el resto vacías. Guarda el chain de cada tabla para
// inspeccionar filtros.
let chains: Record<string, Chain[]> = {};
function tablas(datos: Record<string, unknown[]>) {
  chains = {};
  mockFrom.mockImplementation((t: string) => {
    const c = chain(datos[t] ?? []);
    (chains[t] ??= []).push(c);
    return c;
  });
}

const VENTAS = [
  // Mixta: efectivo 5.000 + débito 12.000
  { id: "vm", total: 17000, subtotal: 17000, descuento: 0, created_at: new Date().toISOString(), metodo_pago: "mixto", canal: "pos", procedencia: "presencial", clientes: null },
  // Antigua sin filas en pagos, efectivo
  { id: "vo", total: 3000, subtotal: 3000, descuento: 0, created_at: new Date().toISOString(), metodo_pago: "efectivo", canal: "pos", procedencia: "presencial", clientes: null },
  // Tarjeta 100 %
  { id: "vt", total: 8000, subtotal: 8000, descuento: 0, created_at: new Date().toISOString(), metodo_pago: "credito", canal: "pos", procedencia: "presencial", clientes: null },
  // Canal externo: no se boletea desde el POS
  { id: "vr", total: 9000, subtotal: 9000, descuento: 0, created_at: new Date().toISOString(), metodo_pago: "plataforma", canal: "rappi", procedencia: "presencial", clientes: null },
];
const PAGOS = [
  { venta_id: "vm", metodo: "efectivo", monto: 5000 },
  { venta_id: "vm", metodo: "debito", monto: 12000 },
  { venta_id: "vt", metodo: "credito", monto: 8000 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  mockClaims = { publicMetadata: { storeAdmin: true, storeId: STORE_ID } };
  tablas({ ventas: VENTAS, pagos: PAGOS });
});

describe("GET /api/reports — pago mixto", () => {
  async function get() {
    const { GET } = await import("@/app/api/reports/route");
    return GET(new NextRequest("http://localhost/api/reports?periodo=30"));
  }

  it("I-816: la venta mixta se reparte entre sus métodos y 'mixto' no aparece", async () => {
    const body = await (await get()).json();
    expect(body.metodos).toEqual({ efectivo: 8000, debito: 12000, credito: 8000, plataforma: 9000 });
    expect(body.metodos.mixto).toBeUndefined();
    expect(body.totalPeriodo).toBe(37000);
  });

  it("I-817: montoBoleta = efectivo de la mixta + venta antigua sin pagos; tarjeta y canal no suman", async () => {
    const body = await (await get()).json();
    expect(body.montoBoleta).toBe(8000);
    expect(body.boletaPorMetodo).toEqual({ efectivo: 8000 });
  });

  it("I-818: la query a pagos es una sola y filtra por el store_id de la sesión", async () => {
    await get();
    expect(chains.pagos).toHaveLength(1);
    expect(chains.pagos[0].eq).toHaveBeenCalledWith("store_id", STORE_ID);
    expect(chains.pagos[0].in).toHaveBeenCalledWith("venta_id", ["vm", "vo", "vt"]);
  });

  it("I-819: sin sesión → 401 sin consultar pagos", async () => {
    mockGetStoreId.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(chains.pagos).toBeUndefined();
  });

  it("I-820: período sin ventas → montoBoleta 0 y sin query a pagos", async () => {
    tablas({});
    const body = await (await get()).json();
    expect(body.montoBoleta).toBe(0);
    expect(body.boletaPorMetodo).toEqual({});
    expect(chains.pagos).toBeUndefined();
  });
});

describe("GET /api/dashboard — pago mixto", () => {
  async function get() {
    const { GET } = await import("@/app/api/dashboard/route");
    return GET();
  }

  it("I-821: topMetodo cuenta la mixta en cada método real, nunca 'mixto'; devuelve montoBoleta", async () => {
    // 2 mixtas efectivo+débito y 1 crédito → efectivo 2, débito 2, crédito 1
    tablas({
      ventas: [
        { id: "m1", total: 17000, metodo_pago: "mixto", canal: "pos" },
        { id: "m2", total: 17000, metodo_pago: "mixto", canal: "pos" },
        { id: "c1", total: 8000, metodo_pago: "credito", canal: "pos" },
      ],
      pagos: [
        { venta_id: "m1", metodo: "efectivo", monto: 5000 },
        { venta_id: "m1", metodo: "debito", monto: 12000 },
        { venta_id: "m2", metodo: "debito", monto: 12000 },
        { venta_id: "m2", metodo: "efectivo", monto: 5000 },
        { venta_id: "c1", metodo: "credito", monto: 8000 },
      ],
    });
    const body = await (await get()).json();
    expect(["efectivo", "debito"]).toContain(body.topMetodo);
    expect(body.montoBoleta).toBe(10000);
    expect(body.boletaPorMetodo).toEqual({ efectivo: 10000 });
  });

  it("I-822: la query a pagos filtra por store_id de la sesión", async () => {
    await get();
    expect(chains.pagos).toHaveLength(1);
    expect(chains.pagos[0].eq).toHaveBeenCalledWith("store_id", STORE_ID);
  });

  it("I-823: storeWorker → la boleta se calcula sobre ventas filtradas por worker_clerk_id", async () => {
    mockGetStoreId.mockResolvedValue({ userId: "w1", storeId: STORE_ID });
    mockClaims = { publicMetadata: { storeId: STORE_ID } };
    await get();
    expect(chains.ventas[0].eq).toHaveBeenCalledWith("worker_clerk_id", "w1");
  });

  it("I-824: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(chains.pagos).toBeUndefined();
  });
});

describe("GET /api/reports/export — pago mixto", () => {
  async function get() {
    const { GET } = await import("@/app/api/reports/export/route");
    return GET(new NextRequest("http://localhost/api/reports/export?tipo=ventas"));
  }

  it("I-825: CSV con 'Detalle pagos' (escapado) y 'Monto a boletear'; venta antigua usa metodo_pago", async () => {
    tablas({
      ventas: [
        { id: "vm", numero_comprobante: "V-1", created_at: "2026-11-12T12:00:00Z", total: 1017000, metodo_pago: "mixto", canal: "pos", estado: "completada", worker_clerk_id: null, clientes: null },
        { id: "vo", numero_comprobante: "V-2", created_at: "2026-11-12T13:00:00Z", total: 3000, metodo_pago: "transferencia", canal: "pos", estado: "completada", worker_clerk_id: null, clientes: null },
        { id: "vr", numero_comprobante: "V-3", created_at: "2026-11-12T14:00:00Z", total: 9000, metodo_pago: "plataforma", canal: "rappi", estado: "completada", worker_clerk_id: null, clientes: null },
      ],
      pagos: [
        { venta_id: "vm", metodo: "efectivo", monto: 5000 },
        { venta_id: "vm", metodo: "debito", monto: 1012000 },
      ],
    });
    const lineas = (await (await get()).text()).trim().split("\n");
    expect(lineas[0].endsWith(",Estado,Detalle pagos,Monto a boletear")).toBe(true);
    expect(lineas[1].endsWith(",completada,Efectivo $5.000; Débito $1.012.000,5000")).toBe(true);
    expect(lineas[2].endsWith(",completada,Transferencia $3.000,3000")).toBe(true);
    // Canal externo: sin monto a boletear
    expect(lineas[3].endsWith(",completada,Plataforma $9.000,")).toBe(true);
  });

  it("I-826: detalle con coma o comilla se escapa con esc()", async () => {
    tablas({
      ventas: [{ id: "vx", numero_comprobante: "V-9", created_at: "2026-11-12T12:00:00Z", total: 100, metodo_pago: "mixto", canal: "pos", estado: "completada", worker_clerk_id: null, clientes: null }],
      pagos: [{ venta_id: "vx", metodo: 'raro,"x"', monto: 100 }],
    });
    const lineas = (await (await get()).text()).trim().split("\n");
    expect(lineas[1]).toContain(',"raro,""x"" $100",100');
  });

  it("I-827: una sola query a pagos, con store_id de la sesión; storeWorker → 403 sin consultar", async () => {
    await get();
    expect(chains.pagos).toHaveLength(1);
    expect(chains.pagos[0].eq).toHaveBeenCalledWith("store_id", STORE_ID);

    jest.clearAllMocks();
    tablas({ ventas: VENTAS, pagos: PAGOS });
    mockClaims = { publicMetadata: { storeId: STORE_ID } };
    const res = await get();
    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
