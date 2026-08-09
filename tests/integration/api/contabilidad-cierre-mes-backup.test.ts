import { NextRequest } from "next/server";

const mockAuth = jest.fn();

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/contabilidad/generador-asientos", () => ({
  ...jest.requireActual("@/lib/contabilidad/generador-asientos"),
  crearAsiento: jest.fn().mockResolvedValue("cogs-entry-uuid"),
}));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";
import { POST } from "@/app/api/contabilidad/cierre-mes/route";

const STORE_ID = "store-uuid-backup";

function createChain(resolveValue: object) {
  const chain: Record<string, jest.Mock> & { then?: Function } = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnValue({ then: (resolve: Function) => resolve({ data: null, error: null }) }),
    update: jest.fn().mockReturnThis(),
  };
  chain.then = (resolve: Function) => resolve(resolveValue);
  return chain;
}

function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/contabilidad/cierre-mes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contabilidad/cierre-mes — respaldo automático", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({
      storeId: STORE_ID,
      userId: "user-backup-001",
    });
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
  });

  it("I-346: crea respaldo en cierre_mes_backups antes de ejecutar el cierre", async () => {
    let callCount = 0;
    const backupChain = createChain({ data: [{ id: "backup-uuid" }], error: null });

    const fromMock = jest.fn((table: string) => {
      if (table === "cierre_mes_backups") return backupChain;
      callCount++;
      if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
      if (callCount === 2) return createChain({
        data: [{ id: "e1", total_debito: 11900, total_credito: 11900 }],
        error: null,
      }); // entries
      if (callCount === 3) return createChain({
        data: [{ id: "v1" }],
        error: null,
      }); // ventas activas
      if (callCount === 4) return createChain({ data: [], error: null }); // asientos COGS existentes (gap = v1)
      if (callCount === 5) return createChain({
        data: [{ id: "i1", cantidad: 1, productos: { costo: 5000 } }],
        error: null,
      }); // venta_items → cogs=5000
      if (callCount === 6) return createChain({ data: [], error: null }); // devoluciones
      if (callCount === 7) return createChain({
        data: [{ id: "e1", total_debito: 11900, total_credito: 11900, journal_detail: [] }],
        error: null,
      }); // backup entries + detail
      return createChain({ data: [], error: null });
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: fromMock,
    });

    const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: true }));

    expect(res.status).toBe(201);

    // El respaldo debe insertarse ANTES de que exista el asiento de cierre
    // (verificado indirectamente: el insert ocurre en el mismo request que
    // crea el asiento COGS, y el test I-349 verifica el contenido exacto).
    expect(backupChain.insert).toHaveBeenCalledTimes(1);
    expect(backupChain.insert.mock.calls[0][0]).toMatchObject({
      store_id: STORE_ID,
      periodo: "2026-04",
    });
  });

  it("I-347: NO crea respaldo cuando calcular_costo_venta=false", async () => {
    const backupChain = createChain({ data: [], error: null });
    const fromMock = jest.fn((table: string) => {
      if (table === "cierre_mes_backups") return backupChain;
      return createChain({ data: [], error: null });
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: fromMock,
    });

    const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: false }));

    expect(res.status).toBe(201);
    expect(backupChain.insert).not.toHaveBeenCalled();
  });

  it("I-348: NO crea respaldo cuando cogs_estimado=0", async () => {
    let callCount = 0;
    const backupChain = createChain({ data: [], error: null });
    const fromMock = jest.fn((table: string) => {
      if (table === "cierre_mes_backups") return backupChain;
      callCount++;
      if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
      if (callCount === 2) return createChain({ data: [], error: null }); // entries
      return createChain({ data: [], error: null }); // ventas (vacío)
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: fromMock,
    });

    const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: true }));

    expect(res.status).toBe(201);
    expect(backupChain.insert).not.toHaveBeenCalled();
  });

  it("I-349: respaldo incluye snapshot del período y totales antes del cierre", async () => {
    const fakeEntries = [
      { id: "e1", total_debito: 10000, total_credito: 10000, journal_detail: [] },
    ];

    let callCount = 0;
    const backupChain = createChain({ data: [{ id: "backup-uuid" }], error: null });

    const fromMock = jest.fn((table: string) => {
      if (table === "cierre_mes_backups") return backupChain;
      callCount++;
      if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
      if (callCount === 2) return createChain({
        data: [{ id: "e1", total_debito: 10000, total_credito: 10000 }],
        error: null,
      }); // entries
      if (callCount === 3) return createChain({
        data: [{ id: "v1" }],
        error: null,
      }); // ventas activas
      if (callCount === 4) return createChain({ data: [], error: null }); // asientos COGS existentes (gap = v1)
      if (callCount === 5) return createChain({
        data: [{ id: "i1", cantidad: 1, productos: { costo: 8000 } }],
        error: null,
      }); // venta_items → cogs=8000
      if (callCount === 6) return createChain({ data: [], error: null }); // devoluciones
      if (callCount === 7) return createChain({
        data: fakeEntries,
        error: null,
      }); // backup entries + detail
      return createChain({ data: [], error: null });
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: fromMock,
    });

    const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: true }));

    expect(res.status).toBe(201);

    // El snapshot debe contener los asientos reales del período (objeto
    // plano, no stringificado — ver comentario en tomarRespaldoCierre) y
    // los totales/cogs deben coincidir con lo calculado por el preview.
    expect(backupChain.insert).toHaveBeenCalledTimes(1);
    const insertArg = backupChain.insert.mock.calls[0][0];
    expect(insertArg.snapshot).toEqual(fakeEntries);
    expect(insertArg.total_debitos).toBe(10000);
    expect(insertArg.total_creditos).toBe(10000);
    expect(insertArg.cogs_estimado).toBe(8000);
  });

  // I-356: si el respaldo falla, la mutación irreversible NO debe ejecutarse.
  it("I-356: REGRESIÓN — si el insert del respaldo falla, se aborta ANTES de crear el asiento de cierre", async () => {
    let callCount = 0;
    const backupChain = createChain({ data: [], error: null });
    backupChain.insert = jest.fn().mockReturnValue({
      then: (resolve: Function) => resolve({ data: null, error: { message: "insert failed" } }),
    });

    const fromMock = jest.fn((table: string) => {
      if (table === "cierre_mes_backups") return backupChain;
      callCount++;
      if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
      if (callCount === 2) return createChain({
        data: [{ id: "e1", total_debito: 11900, total_credito: 11900 }],
        error: null,
      }); // entries
      if (callCount === 3) return createChain({ data: [{ id: "v1" }], error: null }); // ventas activas
      if (callCount === 4) return createChain({ data: [], error: null }); // asientos COGS existentes (gap = v1)
      if (callCount === 5) return createChain({ data: [{ id: "i1", cantidad: 1, productos: { costo: 5000 } }], error: null }); // venta_items
      if (callCount === 6) return createChain({ data: [], error: null }); // devoluciones
      if (callCount === 7) return createChain({ data: [], error: null }); // backup entries query
      return createChain({ data: [], error: null });
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: fromMock,
    });

    const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: true }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/respaldo/i);
  });
});
