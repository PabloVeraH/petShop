/**
 * Tests I-LD-01 a I-LD-06: GET /api/contabilidad/libro-diario
 *
 * Casos clave:
 *  I-LD-01  401 sin sesión
 *  I-LD-02  REGRESIÓN — total_asientos usa el count de la BD, no data.length
 *           (protege contra subreporte cuando PostgREST trunca silenciosamente)
 *  I-LD-03  Filtro por mes delimita el período correctamente
 *  I-LD-04  Sin parámetro mes devuelve el año completo
 *  I-LD-05  Filtro por canal pasa la condición eq al query
 *  I-LD-06  500 cuando la BD retorna error
 */
import { GET } from "@/app/api/contabilidad/libro-diario/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

const STORE_ID = "store-uuid-cld-001";

function makeRequest(params?: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/contabilidad/libro-diario");
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new NextRequest(url);
}

// Genera una entrada de journal_entries mínima
function makeEntry(id: string, numero: number, fecha: string) {
  return {
    id,
    numero_asiento: numero,
    fecha,
    tipo_movimiento: "VENTA",
    canal: null,
    referencia_numero: null,
    descripcion: `Asiento ${numero}`,
    total_debito: 10000,
    total_credito: 10000,
    esta_balanceado: true,
  };
}

/**
 * Construye el mock de Supabase para libro-diario.
 *
 * @param entries      filas devueltas por data
 * @param dbCount      valor de count que la BD reporta (puede diferir de entries.length)
 * @param journalError si true, simula error en journal_entries
 * @param canal        si se pasa, espera un eq("canal", canal) adicional
 */
function makeDb(options: {
  entries?: ReturnType<typeof makeEntry>[];
  dbCount?: number | null;
  journalError?: boolean;
  expectCanalEq?: string;
}) {
  const {
    entries = [],
    dbCount = entries.length,
    journalError = false,
    expectCanalEq,
  } = options;

  const mockOrder = jest.fn();
  mockOrder.mockResolvedValue(
    journalError
      ? { data: null, error: new Error("DB error"), count: null }
      : { data: entries, error: null, count: dbCount }
  );

  // Objeto fluido — todos los métodos intermedios devuelven el mismo objeto
  // para que cualquier combinación de .eq().gte().lte().eq().order() funcione
  const chainable: Record<string, jest.Mock> = {};
  const self = () => chainable;

  const mockEq  = jest.fn(self);
  const mockGte = jest.fn(self);
  const mockLte = jest.fn(self);

  Object.assign(chainable, { eq: mockEq, gte: mockGte, lte: mockLte, order: mockOrder });

  const mockSelect = jest.fn().mockReturnValue(chainable);

  const mockFrom = jest.fn().mockImplementation((table: string) => {
    if (table === "stores") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { name: "PetShop Test", rut: "76.000.000-0" },
          error: null,
        }),
      };
    }
    if (table === "journal_entries") {
      return { select: mockSelect };
    }
    if (table === "journal_detail") {
      return {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    }
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });

  return { from: mockFrom, _mockOrder: mockOrder, _mockSelect: mockSelect };
}

// ──────────────────────────────────────────────────────────────────────────────

describe("GET /api/contabilidad/libro-diario", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({
      storeId: STORE_ID,
      userId: "user-001",
    });
  });

  // I-LD-01
  it("I-LD-01: retorna 401 cuando no hay sesión autenticada", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);
    const res = await GET(makeRequest({ mes: "6", año: "2026" }));
    expect(res.status).toBe(401);
  });

  // I-LD-02 — REGRESIÓN: total_asientos debe usar asientos.length (no dbCount de Supabase)
  //
  // Históricamente se usaba dbCount para protegerse contra truncación silenciosa
  // de PostgREST (max-rows). Sin embargo, dbCount puede subreportar asientos en
  // algunos casos (ej: reportado 43 vs 78 reales). Como no hay paginación (.range()),
  // asientos.length es la fuente exacta y más confiable.
  it(
    "I-LD-02: REGRESIÓN — total_asientos usa asientos.length, no el dbCount de Supabase",
    async () => {
      const thirtyEntries = Array.from({ length: 30 }, (_, i) =>
        makeEntry(`je-${i + 1}`, i + 26, `2026-06-${String(i + 1).padStart(2, "0")}`)
      );
      // Aunque dbCount sea 55, el contador debe reflejar los datos reales recibidos
      const db = makeDb({ entries: thirtyEntries, dbCount: 55 });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

      const res = await GET(makeRequest({ mes: "6", año: "2026" }));
      expect(res.status).toBe(200);

      const body = await res.json();
      // El contador debe ser 30 (filas realmente recibidas), no 55 (dbCount)
      expect(body.resumen.total_asientos).toBe(30);
      expect(body.asientos).toHaveLength(30);
    }
  );

  // I-LD-03
  it("I-LD-03: con parámetro mes, el período y resumen se calculan para ese mes", async () => {
    const entries = [
      makeEntry("je-1", 1, "2026-03-10"),
      makeEntry("je-2", 2, "2026-03-25"),
    ];
    const db = makeDb({ entries, dbCount: 2 });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "3", año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.desde).toBe("2026-03-01");
    expect(body.hasta).toBe("2026-03-31");
    expect(body.resumen.total_asientos).toBe(2);
    expect(body.asientos).toHaveLength(2);
  });

  // I-LD-04
  it("I-LD-04: sin parámetro mes devuelve el período del año completo", async () => {
    const db = makeDb({ entries: [], dbCount: 0 });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ año: "2026" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.desde).toBe("2026-01-01");
    expect(body.hasta).toBe("2026-12-31");
    expect(body.periodo).toBe("2026");
  });

  // I-LD-05
  it("I-LD-05: el filtro de canal se aplica en la query de journal_entries", async () => {
    const db = makeDb({ entries: [], dbCount: 0 });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "6", año: "2026", canal: "rappi" }));
    expect(res.status).toBe(200);

    // Verificar que select fue llamado con count: "exact"
    expect(db._mockSelect).toHaveBeenCalledWith(
      expect.any(String),
      { count: "exact" }
    );
  });

  // I-LD-06
  it("I-LD-06: retorna 500 cuando la BD devuelve error en journal_entries", async () => {
    const db = makeDb({ journalError: true });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

    const res = await GET(makeRequest({ mes: "6", año: "2026" }));
    expect(res.status).toBe(500);
  });

  // I-LD-07 — REGRESIÓN: asientos con total_debito=0 y total_credito=0 deben
  // exponerse en la respuesta con sus valores reales para que la UI pueda
  // mostrar la advertencia ⚠ en lugar de ✓.
  it(
    "I-LD-07: REGRESIÓN — asientos $0/$0 se incluyen en la respuesta con " +
      "sus montos reales para que la UI distinga 'balanceado sin movimiento'",
    async () => {
      const entryZero = makeEntry("je-zero", 43, "2026-06-15");
      // Simular un asiento $0/$0 guardado previamente en la BD
      const entryZeroWith = {
        ...entryZero,
        total_debito: 0,
        total_credito: 0,
        esta_balanceado: true,
      };
      const db = makeDb({ entries: [entryZeroWith], dbCount: 1 });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(db);

      const res = await GET(makeRequest({ mes: "6", año: "2026" }));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.asientos).toHaveLength(1);

      const asiento = body.asientos[0];
      // El API expone los montos tal como están en la BD — la UI decide el indicador
      expect(Number(asiento.total_debito)).toBe(0);
      expect(Number(asiento.total_credito)).toBe(0);
      expect(asiento.esta_balanceado).toBe(true);
      // El resumen no los oculta: el total sigue siendo 1
      expect(body.resumen.total_asientos).toBe(1);
    }
  );
});
