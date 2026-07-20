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
    gt:     jest.fn(),
    in:     jest.fn(),
    order:  jest.fn(),
    limit:  jest.fn().mockReturnValue(resolved),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    then:   undefined as unknown as jest.Mock,
  };
  // Todos los chainables devuelven el mismo objeto (thenable)
  ["select","eq","neq","gte","lte","gt","in","order"].forEach(k => c[k].mockReturnValue(c));
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
    const res = await GET(new NextRequest("http://localhost/api/dashboard"));
    expect(res.status).toBe(401);
  });

  // I-77b
  it("I-77b: con auth → 200 y contiene clave ventasHoy", async () => {
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    const { GET } = await import("@/app/api/dashboard/route");
    const res = await GET(new NextRequest("http://localhost/api/dashboard"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("ventasHoy");
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
    const res = await GET(new NextRequest("http://localhost/api/dashboard"));
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
    const res = await GET(new NextRequest("http://localhost/api/dashboard"));
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
    const res = await GET(new NextRequest("http://localhost/api/dashboard"));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Bruto: 30000 + 20000 = 50000. NC: -30000 (clamped a 0 para v1). Neto: 0 + 20000 = 20000
    expect(body.ventasHoy).toBe(20000);
    const canalPos = body.ventasPorCanal.find((c: { canal: string }) => c.canal === "pos");
    expect(canalPos.total).toBe(20000);
    const procPresencial = body.ventasPorProcedencia.find((p: { procedencia: string }) => p.procedencia === "presencial");
    expect(procPresencial.total).toBe(20000);
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
    const res = await GET(new NextRequest("http://localhost/api/dashboard/stock-alertas"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.total).toBe("number");
    expect(Array.isArray(body.items)).toBe(true);
  });
});
