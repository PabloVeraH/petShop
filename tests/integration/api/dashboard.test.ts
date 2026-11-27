/**
 * Tests I-77 a I-78: GET /api/dashboard y /api/dashboard/stock-alertas
 * I-77c y I-77d cubren la regresión: dashboard mostraba métricas globales de tienda
 * a vendedores (storeWorker) que solo deberían ver sus propias ventas.
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockAuth      = jest.fn();
const mockFrom      = jest.fn();

jest.mock("@/lib/auth",              () => ({ getStoreId: mockGetStoreId }));
jest.mock("@clerk/nextjs/server",    () => ({ auth: mockAuth }));
jest.mock("@/lib/supabase",          () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

// Chain que soporta todos los métodos comunes y siempre resuelve vacío
function chain() {
  const resolved = Promise.resolve({ data: [], error: null, count: 0 });
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    eq:     jest.fn(),
    neq:    jest.fn(),
    gte:    jest.fn(),
    lte:    jest.fn(),
    lt:     jest.fn(),
    gt:     jest.fn(),
    in:     jest.fn(),
    order:  jest.fn(),
    limit:  jest.fn().mockReturnValue(resolved),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    then:   undefined as unknown as jest.Mock,
  };
  // Todos los chainables devuelven el mismo objeto (thenable)
  ["select","eq","neq","gte","lte","lt","gt","in","order"].forEach(k => c[k].mockReturnValue(c));
  // Hacer el chain thenable para que Promise.all funcione
  c.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 })
  );
  return c;
}

describe("GET /api/dashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(chain());
    // Por defecto: storeAdmin — los tests existentes no cambian de comportamiento
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID }, sub: "u1" },
    });
  });

  // I-77
  it("I-77: sin auth → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  // I-77b
  it("I-77b: con auth → 200 y contiene clave ventasHoy", async () => {
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    const { GET } = await import("@/app/api/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("ventasHoy");
  });

  // I-753 — REGRESIÓN: Vercel corre en UTC y startOfDay() de date-fns usaba
  // ese huso: desde las ~21:00 de Chile "Ventas hoy" pasaba a contar el día
  // siguiente (UTC). El rango es el día de Chile: [00:00, 24:00) en UTC.
  it("I-753: a las 22:30 de Chile 'Ventas hoy' filtra el día de Chile, no el día UTC", async () => {
    jest.useFakeTimers({ now: new Date("2026-10-23T01:30:00Z"), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    try {
      const ventasChain = chain();
      mockFrom.mockReturnValue(ventasChain);
      mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
      const { GET } = await import("@/app/api/dashboard/route");
      const res = await GET();
      expect(res.status).toBe(200);
      expect(ventasChain.gte).toHaveBeenCalledWith("created_at", "2026-10-22T03:00:00.000Z");
      expect(ventasChain.lt).toHaveBeenCalledWith("created_at", "2026-10-23T03:00:00.000Z");
    } finally {
      jest.useRealTimers();
    }
  });

  // I-77c: REGRESIÓN — storeWorker solo debe ver sus propias ventas.
  // Bug original: la query no filtraba por worker_clerk_id; el vendedor veía
  // las ventas de todos los vendedores de la tienda.
  it("I-77c: storeWorker → queries filtradas por worker_clerk_id del usuario", async () => {
    const ventasChain = chain();
    mockFrom.mockReturnValue(ventasChain);
    mockGetStoreId.mockResolvedValue({ userId: "worker-u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      sessionClaims: {
        publicMetadata: { storeWorker: true, storeId: STORE_ID },
        sub: "worker-u1",
      },
    });

    const { GET } = await import("@/app/api/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);

    // La query de ventas debe incluir el filtro por worker_clerk_id
    expect(ventasChain.eq).toHaveBeenCalledWith("worker_clerk_id", "worker-u1");
  });

  // I-77d: storeAdmin sigue viendo todas las ventas de la tienda (sin filtro de worker).
  it("I-77d: storeAdmin → queries NO filtradas por worker_clerk_id", async () => {
    const ventasChain = chain();
    mockFrom.mockReturnValue(ventasChain);
    mockGetStoreId.mockResolvedValue({ userId: "admin-u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      sessionClaims: {
        publicMetadata: { storeAdmin: true, storeId: STORE_ID },
        sub: "admin-u1",
      },
    });

    const { GET } = await import("@/app/api/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);

    // No debe filtrar por worker_clerk_id para admins
    expect(ventasChain.eq).not.toHaveBeenCalledWith("worker_clerk_id", expect.anything());
  });

  // I-428: REGRESIÓN — una venta devuelta al 100% vía Nota de Crédito
  // inflaba "Ventas hoy" (y ventasPorCanal/ventasPorProcedencia, que
  // derivan del mismo total) — mismo bug ya corregido en GET /api/workers
  // (I-425), presente también acá porque es una query independiente.
  it("I-428: REGRESIÓN — NC descuenta el monto devuelto de ventasHoy/ventasPorCanal/ventasPorProcedencia", async () => {
    const VENTAS = [
      { id: "v1", total: 30000, descuento: 0, metodo_pago: "efectivo", canal: "pos", procedencia: "presencial" },
      { id: "v2", total: 20000, descuento: 0, metodo_pago: "efectivo", canal: "pos", procedencia: "presencial" },
    ];
    const NCS = [
      { monto_total: 30000, venta_id: "v1" }, // v1 devuelta al 100%
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "ventas") {
        const c = chain();
        c.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
          resolve({ data: VENTAS, error: null })
        );
        return c;
      }
      if (table === "notas_credito") {
        const c = chain();
        c.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
          resolve({ data: NCS, error: null })
        );
        return c;
      }
      return chain();
    });
    mockGetStoreId.mockResolvedValue({ userId: "admin-u1", storeId: STORE_ID });

    const { GET } = await import("@/app/api/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    // Bruto: 30000 + 20000 = 50000. NC: -30000 (clamped a 0 para v1). Neto: 0 + 20000 = 20000
    expect(body.ventasHoy).toBe(20000);
    const canalPos = body.ventasPorCanal.find((c: { canal: string }) => c.canal === "pos");
    expect(canalPos.total).toBe(20000);
    const procPresencial = body.ventasPorProcedencia.find((p: { procedencia: string }) => p.procedencia === "presencial");
    expect(procPresencial.total).toBe(20000);
  });

  // I-510: REGRESIÓN (ticket Trello 6a77edec41f13cebd89d3d1e) — "Transacciones"
  // contaba las ventas 100% devueltas (que aportan $0 a "Ventas hoy"), inflando
  // el divisor de "Ticket promedio" (ej. 3 ventas, 2 devueltas → 8990/3 = 2997
  // cuando el valor real es 8990). Criterio: una venta cuenta como transacción
  // solo si su neto tras NC es > 0 — el mismo valor que alimenta el numerador.
  it("I-510: REGRESIÓN — 'Transacciones' excluye ventas 100% devueltas y 'Ticket promedio' queda consistente con 'Ventas hoy'", async () => {
    const VENTAS = [
      { id: "vA", total: 15458, descuento: 0, metodo_pago: "efectivo", canal: "pos", procedencia: "presencial" },
      { id: "vB", total: 8990, descuento: 0, metodo_pago: "efectivo", canal: "pos", procedencia: "presencial" },
      { id: "vC", total: 12990, descuento: 0, metodo_pago: "efectivo", canal: "pos", procedencia: "presencial" },
    ];
    const NCS = [
      { monto_total: 15458, venta_id: "vA" }, // A devuelta al 100%
      { monto_total: 12990, venta_id: "vC" }, // C devuelta al 100%
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "ventas") {
        const c = chain();
        c.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
          resolve({ data: VENTAS, error: null })
        );
        return c;
      }
      if (table === "notas_credito") {
        const c = chain();
        c.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
          resolve({ data: NCS, error: null })
        );
        return c;
      }
      return chain();
    });
    mockGetStoreId.mockResolvedValue({ userId: "admin-u1", storeId: STORE_ID });

    const { GET } = await import("@/app/api/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    // Neto: 0 + 8990 + 0 = 8990. Transacciones: solo vB. Ticket = 8990/1.
    expect(body.ventasHoy).toBe(8990);
    expect(body.transacciones).toBe(1);
    expect(body.ticketPromedio).toBe(8990);

    // Los breakdowns por canal/procedencia aplican el mismo criterio.
    const canalPos = body.ventasPorCanal.find((c: { canal: string }) => c.canal === "pos");
    expect(canalPos.total).toBe(8990);
    expect(canalPos.transacciones).toBe(1);
    const procPresencial = body.ventasPorProcedencia.find((p: { procedencia: string }) => p.procedencia === "presencial");
    expect(procPresencial.total).toBe(8990);
    expect(procPresencial.transacciones).toBe(1);
  });

  // I-511: una venta PARCIALMENTE devuelta sigue contando como transacción
  // (neto > 0) — el fix no debe excluir de más.
  it("I-511: devolución parcial no excluye la venta de Transacciones", async () => {
    const VENTAS = [
      { id: "v1", total: 20000, descuento: 0, metodo_pago: "efectivo", canal: "pos", procedencia: "presencial" },
      { id: "v2", total: 30000, descuento: 0, metodo_pago: "efectivo", canal: "pos", procedencia: "presencial" },
    ];
    const NCS = [{ monto_total: 5000, venta_id: "v1" }];

    mockFrom.mockImplementation((table: string) => {
      if (table === "ventas") {
        const c = chain();
        c.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
          resolve({ data: VENTAS, error: null })
        );
        return c;
      }
      if (table === "notas_credito") {
        const c = chain();
        c.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
          resolve({ data: NCS, error: null })
        );
        return c;
      }
      return chain();
    });
    mockGetStoreId.mockResolvedValue({ userId: "admin-u1", storeId: STORE_ID });

    const { GET } = await import("@/app/api/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    // Neto: (20000-5000) + 30000 = 45000. Ambas ventas siguen contando.
    expect(body.ventasHoy).toBe(45000);
    expect(body.transacciones).toBe(2);
    expect(body.ticketPromedio).toBe(22500);
  });
});

// I-848: "Top 5 productos hoy" cuenta sacos/unidades. Una línea a granel suma
// gramos / peso del saco (no los kg de venta_items.cantidad); los servicios
// quedan fuera; se redondea a 2 decimales.
describe("GET /api/dashboard — Top 5 productos con granel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID }, sub: "u1" } });
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("I-848: granel en sacos (60 kg de 20 kg = 3; 1 saco + 400 g = 1,02), servicios fuera, orden por esa cantidad", async () => {
    const VENTAS = [{ id: "v1", total: 1, descuento: 0, metodo_pago: "efectivo", canal: "pos", procedencia: "presencial" }];
    const SACO = { nombre: "Saco 20kg", peso_gramos: 20000 };
    const OTRO = { nombre: "Granel B", peso_gramos: 20000 };
    const ITEMS = [
      { producto_id: "pA", cantidad: 1, es_granel: false, gramos: null, productos: SACO },
      { producto_id: "pA", cantidad: 0.4, es_granel: true, gramos: 400, productos: SACO },
      { producto_id: "pB", cantidad: 60, es_granel: true, gramos: 60000, productos: OTRO },
      { producto_id: "pC", cantidad: 2, es_granel: false, gramos: null, productos: { nombre: "Lata", peso_gramos: 400 } },
      { producto_id: "pD", cantidad: 0.1, es_granel: true, gramos: 100, productos: { nombre: "Tercio", peso_gramos: 300 } },
      { producto_id: null, cantidad: 5, es_granel: false, gramos: null, productos: null },
    ];
    const items = chain();
    mockFrom.mockImplementation((table: string) => {
      const data = table === "ventas" ? VENTAS : table === "venta_items" ? ITEMS : [];
      const c = table === "venta_items" ? items : chain();
      c.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) => resolve({ data, error: null }));
      return c;
    });

    const { GET } = await import("@/app/api/dashboard/route");
    const body = await (await GET()).json();

    expect(items.in).toHaveBeenCalledWith("venta_id", ["v1"]);
    expect(body.topProductos).toEqual([
      { producto_id: "pB", nombre: "Granel B", cantidad: 3 },
      { producto_id: "pC", nombre: "Lata", cantidad: 2 },
      { producto_id: "pA", nombre: "Saco 20kg", cantidad: 1.02 },
      { producto_id: "pD", nombre: "Tercio", cantidad: 0.33 },
    ]);
  });
});

describe("GET /api/dashboard/stock-alertas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-78
  it("I-78: retorna 200 con total e items de alertas", async () => {
    const { GET } = await import("@/app/api/dashboard/stock-alertas/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.total).toBe("number");
    expect(Array.isArray(body.items)).toBe(true);
  });
});
