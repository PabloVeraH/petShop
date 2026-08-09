/**
 * Tests I-280 a I-292, I-494 a I-497: GET /api/contabilidad/estado-resultado
 * Verifica que el endpoint retorne COGS desde las ventas reales (ground truth:
 * venta_items × productos.costo, neteado de reversos por devoluciones con
 * restitución de stock) con fallback a journal_detail contable.
 *
 * I-289 — REGRESIÓN: venta anulada NO infla venta_productos (neto créditos-débitos)
 * I-290 — REGRESIÓN: múltiples ventas y anulaciones → neto correcto
 * I-494 a I-497 — REGRESIÓN (ticket Trello 6a77e779e5698ef7e7e3afda): un
 *   asiento COGS huérfano (journal_entries sin journal_detail) ya no pierde el
 *   COGS de la venta activa correspondiente — el ground truth no depende de los
 *   asientos, y las devoluciones con restitución se netean del COGS.
 */
import { GET } from "@/app/api/contabilidad/estado-resultado/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

const STORE_ID = "store-uuid-001";
const STORE_NAME = "PetShop La Huella";

function makeRequest(params?: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/contabilidad/estado-resultado");
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new NextRequest(url);
}

function buildStoreResponse(storeName: string | null = STORE_NAME) {
  return { data: storeName ? { name: storeName } : { name: null }, error: null };
}

type SingleResult = { data: unknown; error: null };

function chainResolved(data: unknown, error: unknown = null) {
  return jest.fn().mockResolvedValue({ data, error });
}

type DetalleRow = { cuenta_codigo: string; debito: number; credito: number };

function makeDb(overrides: {
  storeResult?: SingleResult;
  emptyEntries?: boolean;
  detalleResult?: { data: DetalleRow[]; error: null };
  /** Simula COGS ground truth desde ventas reales (venta_items × productos.costo) */
  cogsActual?: number;
  /** Simula el costo devuelto por NC con restituir_stock=true en el período */
  cogsDevuelto?: number;
  /** Número de ventas activas que devuelve la query de ventas (default 1) */
  ventasActivas?: number;
}) {
  let callCount = 0;
  const cogsVentas = overrides.cogsActual ?? 0;
  const cogsDevuelto = overrides.cogsDevuelto ?? 0;
  const ventasActivas = overrides.ventasActivas ?? (cogsVentas > 0 ? 1 : 0);

  const mockFrom = jest.fn().mockImplementation((table: string) => {
    callCount++;

    if (table === "stores") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(overrides.storeResult ?? buildStoreResponse()),
      };
    }

    if (table === "ventas") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        neq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockResolvedValue({
          data: Array.from({ length: ventasActivas }, (_, i) => ({ id: `venta-${i + 1}` })),
          error: null,
        }),
      };
    }

    if (table === "venta_items") {
      return {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: cogsVentas > 0 ? [{ cantidad: 2, productos: { costo: cogsVentas / 2 } }] : [],
          error: null,
        }),
      };
    }

    if (table === "notas_credito") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockResolvedValue({
          data: cogsDevuelto > 0 ? [{ id: "nc-1" }] : [],
          error: null,
        }),
      };
    }

    if (table === "nota_credito_items") {
      return {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({
          data: cogsDevuelto > 0
            ? [{ cantidad_devuelta: 1, productos: { costo: cogsDevuelto } }]
            : [],
          error: null,
        }),
      };
    }

    if (table === "journal_entries") {
      if (overrides.emptyEntries) {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockResolvedValue({
          data: [{ id: "je-1" }, { id: "je-2" }],
          error: null,
        }),
      };
    }

    if (table === "journal_detail") {
      return {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue(
          overrides.detalleResult ?? {
            data: [
              { cuenta_codigo: "410101", debito: 0, credito: 100000 },
              { cuenta_codigo: "510101", debito: 60000, credito: 0 },
            ],
            error: null,
          }
        ),
      };
    }

    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockResolvedValue({ data: [], error: null }),
      in: jest.fn().mockResolvedValue({ data: [], error: null }),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });

  return { from: mockFrom };
}

describe("GET /api/contabilidad/estado-resultado", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({
      storeId: STORE_ID,
      userId: "user-001",
    });
  });

  // I-280
  it("retorna 401 cuando no hay sesión", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  // I-281
  it("retorna empresa.nombre desde la DB en vez del fallback hardcodeado", async () => {
    const db = makeDb({});
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "6", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.empresa).toBeDefined();
    expect(body.empresa.nombre).toBe(STORE_NAME);
    expect(body.empresa.nombre).not.toBe("petShop");
  });

  // I-282
  it("incluye empresa.nombre incluso cuando no hay transacciones", async () => {
    const db = makeDb({ emptyEntries: true });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "1", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.empresa).toBeDefined();
    expect(body.empresa.nombre).toBe(STORE_NAME);
    expect(body.ingresos.venta_productos).toBe(0);
  });

  // I-283
  it("retorna string vacío en empresa.nombre si la tienda no tiene nombre", async () => {
    const db = makeDb({ storeResult: { data: { name: null }, error: null }, emptyEntries: true });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.empresa.nombre).toBe("");
  });

  // I-284: COGS desde journal_detail (fallback, sin ventas reales)
  it("I-284: COGS desde fallback journal_detail cuando no hay ventas reales", async () => {
    const db = makeDb({
      detalleResult: {
        data: [
          { cuenta_codigo: "410101", debito: 0, credito: 856707 },
          { cuenta_codigo: "510101", debito: 450000, credito: 0 },
          { cuenta_codigo: "410102", debito: 5000, credito: 0 },
        ],
        error: null,
      },
      // sin cogsActual → ventas devuelve [] → costoVentaActual = 0 → usa fallback
    });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "6", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.empresa.nombre).toBe(STORE_NAME);
    expect(body.ingresos.venta_productos).toBe(856707);
    expect(body.ingresos.devoluciones).toBe(-5000);
    expect(body.ingresos.total_ingresos_operacionales).toBe(851707);
    expect(body.gastos.costo_venta).toBe(450000);
    expect(body.utilidad_bruta).toBe(401707);
    expect(body.utilidad_neta).toBe(401707);
  });

  // I-285: COGS ground truth (ventas reales) tiene prioridad sobre journal_detail
  it("I-285: COGS ground truth tiene prioridad sobre journal_detail", async () => {
    const db = makeDb({
      cogsActual: 320000,
      detalleResult: {
        data: [
          { cuenta_codigo: "410101", debito: 0, credito: 856707 },
          { cuenta_codigo: "510101", debito: 450000, credito: 0 },
          { cuenta_codigo: "410102", debito: 5000, credito: 0 },
        ],
        error: null,
      },
    });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "6", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.gastos.costo_venta).toBe(320000);
    expect(body.utilidad_bruta).toBe(531707);
  });

  // I-286: COGS > 0 incluso sin journal_entries (solo ventas reales)
  it("I-286: calcula COGS desde ventas reales cuando no hay asientos contables", async () => {
    const db = makeDb({
      cogsActual: 150000,
      emptyEntries: true,
    });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "6", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.gastos.costo_venta).toBe(150000);
    expect(body.ingresos.venta_productos).toBe(0); // sin journal entries
    expect(body.utilidad_bruta).toBe(-150000);
  });

  // I-287: sin ventas ni journal entries → todo 0
  it("I-287: sin ventas ni asientos retorna 0 en todo", async () => {
    const db = makeDb({ emptyEntries: true });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "1", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.gastos.costo_venta).toBe(0);
    expect(body.ingresos.venta_productos).toBe(0);
  });

  // I-288: REGRESIÓN — COGS no es 0 cuando hay ventas con costo (productos.costo)
  it("I-288: COGS distinto de 0 cuando hay ventas con costo real", async () => {
    const db = makeDb({ cogsActual: 75000 });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "6", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.gastos.costo_venta).toBeGreaterThan(0);
    expect(body.gastos.costo_venta).toBe(75000);
  });

  // I-289: REGRESIÓN — venta_productos es neto (créditos - débitos) para excluir anulaciones
  it("I-289: venta_productos neto — venta $10.000 anulada no aparece como ingreso", async () => {
    const db = makeDb({
      detalleResult: {
        data: [
          // Venta original: Cr VENTAS $10.000
          { cuenta_codigo: "410101", debito: 0, credito: 10000 },
          // Anulación: Dr VENTAS $10.000 (contra-asiento)
          { cuenta_codigo: "410101", debito: 10000, credito: 0 },
        ],
        error: null,
      },
    });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "6", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    // Antes del fix: venta_productos = $10.000 (ignoraba el débito)
    // Después del fix: venta_productos = $10.000 - $10.000 = $0
    expect(body.ingresos.venta_productos).toBe(0);
    expect(body.ingresos.total_ingresos_operacionales).toBe(0);
  });

  // I-290: REGRESIÓN — COGS neto en fallback cuando hay reverso COGS por anulación
  it("I-290: COGS fallback neto — reverso de COGS por anulación descuenta correctamente", async () => {
    const db = makeDb({
      detalleResult: {
        data: [
          // Venta original: Cr VENTAS $10.000
          { cuenta_codigo: "410101", debito: 0, credito: 10000 },
          // COGS original: Dr COGS $6.000
          { cuenta_codigo: "510101", debito: 6000, credito: 0 },
          // Anulación: Dr VENTAS $10.000
          { cuenta_codigo: "410101", debito: 10000, credito: 0 },
          // Reverso COGS: Cr COGS $6.000
          { cuenta_codigo: "510101", debito: 0, credito: 6000 },
        ],
        error: null,
      },
      // sin cogsActual → usa fallback journal_detail
    });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "6", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ingresos.venta_productos).toBe(0);     // neto: 10k - 10k
    expect(body.gastos.costo_venta).toBe(0);            // neto: 6k - 6k
    expect(body.utilidad_neta).toBe(0);
  });

  // I-494: REGRESIÓN (ticket 6a77e779e5698ef7e7e3afda) — asiento COGS huérfano
  // no pierde el COGS de la venta activa. Reproduce el caso real: dos ventas
  // activas, pero un asiento COGS (de una de ellas) existe en journal_entries
  // SIN filas en journal_detail (huérfano). El fallback de asientos solo suma
  // $13.000 (la otra venta); el ground truth desde ventas reales recupera los
  // $21.000 completos. Antes del fix, la query de ground truth usaba una
  // columna inexistente (venta_item_lotes.costo_unitario), devolvía 0, y el
  // reporte caía al fallback perdiendo los $8.000.
  it("I-494: asiento COGS huérfano no excluye el COGS de la venta activa (ground truth)", async () => {
    const db = makeDb({
      cogsActual: 21000, // ventas reales: 8.000 + 13.000
      ventasActivas: 2,
      detalleResult: {
        data: [
          // Solo la venta B tiene su asiento COGS con detalle (la A es huérfana)
          { cuenta_codigo: "410101", debito: 0, credito: 48000 },
          { cuenta_codigo: "510101", debito: 13000, credito: 0 },
        ],
        error: null,
      },
    });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "8", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    // Antes del fix: costo_venta = $13.000 (fallback perdía el huérfano $8.000)
    expect(body.gastos.costo_venta).toBe(21000);
  });

  // I-495: las devoluciones con restitución de stock se netean del COGS ground
  // truth. La venta activa aporta su costo, pero el costo de lo devuelto (NC con
  // restituir_stock=true) no debe quedar como gasto del período — su asiento
  // reverso acredita COGS (lineasNotaCreditoCOGS).
  it("I-495: devolución con restitución de stock descuenta el COGS ground truth", async () => {
    const db = makeDb({
      cogsActual: 38500,   // COGS ventas activas del período
      cogsDevuelto: 13000, // COGS devuelto por NC con restituir_stock
      ventasActivas: 5,
    });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "8", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.gastos.costo_venta).toBe(25500); // 38.500 - 13.000
  });

  // I-496: las devoluciones SIN restitución de stock NO netean el COGS ground
  // truth (la mercadería no vuelve a inventario, el gasto se mantiene).
  it("I-496: devolución sin restitución de stock no descuenta el COGS", async () => {
    const db = makeDb({
      cogsActual: 8000,
      ventasActivas: 1,
      // sin cogsDevuelto → notas_credito devuelve [] → no hay netting
    });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "8", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.gastos.costo_venta).toBe(8000);
  });

  // I-497: si las devoluciones superan a las ventas, el neto NO se clamp a 0 —
  // un período con devoluciones que exceden a las ventas puede tener COGS
  // negativo, consistente con el netting del fallback de journal_detail.
  it("I-497: devoluciones mayores que ventas → COGS neto negativo (sin clamp)", async () => {
    const db = makeDb({
      cogsActual: 8000,
      cogsDevuelto: 10000,
      ventasActivas: 1,
    });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "8", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.gastos.costo_venta).toBe(-2000); // 8.000 - 10.000
  });
});
