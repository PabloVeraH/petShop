/**
 * Tests I-280 a I-289: GET /api/contabilidad/estado-resultado
 * Verifica que el endpoint retorne COGS desde venta_item_lotes (actual)
 * con fallback a journal_detail contable.
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

function makeDb(overrides: {
  storeResult?: SingleResult;
  emptyEntries?: boolean;
  detalleResult?: { data: Array<{ cuenta_codigo: string; debito: number; credito: number }>; error: null };
  /** Simula COGS desde venta_item_lotes: si se pasa, mockea ventas/venta_items/venta_item_lotes */
  cogsActual?: number;
}) {
  let callCount = 0;
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
      if (overrides.cogsActual && overrides.cogsActual > 0) {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          neq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockResolvedValue({ data: [{ id: "venta-1" }], error: null }),
        };
      }
      // Sin ventas en el período
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        neq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    }

    if (table === "venta_items") {
      return {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [{ id: "vi-1" }], error: null }),
      };
    }

    if (table === "venta_item_lotes") {
      const costo = overrides.cogsActual ?? 0;
      return {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: costo > 0 ? [{ cantidad: 2, costo_unitario: costo / 2 }] : [],
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

  // I-285: COGS desde venta_item_lotes (actual) tiene prioridad sobre journal_detail
  it("I-285: COGS desde venta_item_lotes tiene prioridad sobre journal_detail", async () => {
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
  it("I-286: calcula COGS desde venta_item_lotes cuando no hay asientos contables", async () => {
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

  // I-288: REGRESIÓN — COGS no es 0 cuando hay venta_item_lotes con costo
  it("I-288: COGS distinto de 0 cuando hay ventas con costo en venta_item_lotes", async () => {
    const db = makeDb({ cogsActual: 75000 });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "6", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.gastos.costo_venta).toBeGreaterThan(0);
    expect(body.gastos.costo_venta).toBe(75000);
  });
});
