/**
 * Tests I-280 a I-283: GET /api/contabilidad/estado-resultado
 * Verifica que el endpoint retorne el nombre de la tienda desde la DB
 * y que no use el fallback hardcodeado "petShop".
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

function makeDb(overrides: {
  storeResult?: SingleResult;
  emptyEntries?: boolean;
  detalleResult?: { data: Array<{ cuenta_codigo: string; debito: number; credito: number }>; error: null };
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

  // I-284
  it("retorna datos financieros correctos con entradas", async () => {
    const db = makeDb({
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
    expect(body.empresa.nombre).toBe(STORE_NAME);
    expect(body.ingresos.venta_productos).toBe(856707);
    expect(body.ingresos.devoluciones).toBe(-5000);
    expect(body.ingresos.total_ingresos_operacionales).toBe(851707);
    expect(body.gastos.costo_venta).toBe(450000);
    expect(body.utilidad_bruta).toBe(401707);
    expect(body.utilidad_neta).toBe(401707);
  });
});
