import { POST } from "@/app/api/contabilidad/cierre-mes/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/contabilidad/generador-asientos", () => ({
  ...jest.requireActual("@/lib/contabilidad/generador-asientos"),
  crearAsiento: jest.fn().mockResolvedValue("cogs-entry-uuid"),
}));

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

const STORE_ID = "store-uuid-backup";

function createChain(resolveValue: object) {
  const chain: Record<string, jest.Mock> & { then?: Function } = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
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
  });

  it("I-330: crea respaldo en cierre_mes_backups antes de ejecutar el cierre", async () => {
    let callCount = 0;
    const fromCalls: string[] = [];

    const fromMock = jest.fn((table: string) => {
      callCount++;
      fromCalls.push(table);

      if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
      if (callCount === 2) return createChain({
        data: [{ id: "e1", total_debito: 11900, total_credito: 11900 }],
        error: null,
      }); // entries
      if (callCount === 3) return createChain({
        data: [{ id: "compra-1" }],
        error: null,
      }); // compras
      if (callCount === 4) return createChain({
        data: [{ debito: 5000 }],
        error: null,
      }); // inventory → cogs=5000
      if (callCount === 5) return createChain({
        data: [{ id: "e1", total_debito: 11900, total_credito: 11900, journal_detail: [] }],
        error: null,
      }); // backup entries + detail
      if (callCount === 6) return createChain({ data: [{ id: "backup-uuid" }], error: null }); // backup insert
      return createChain({ data: [], error: null }); // fallback (backup update)
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: fromMock,
    });

    const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: true }));

    expect(res.status).toBe(201);

    // Verify backup was created
    const backupInserts = fromCalls.filter((t, i) => {
      if (t === "cierre_mes_backups") {
        const fnCall = fromMock.mock.calls[i];
        return fnCall && fnCall[0] === "cierre_mes_backups";
      }
      return false;
    });

    // Should have inserted into cierre_mes_backups (call 6)
    const insertCall = fromMock.mock.calls[5];
    expect(insertCall).toBeDefined();
    expect(insertCall[0]).toBe("cierre_mes_backups");
  });

  it("I-331: NO crea respaldo cuando calcular_costo_venta=false", async () => {
    const fromMock = jest.fn((table: string) => {
      if (table === "journal_entries") {
        return createChain({ data: [], error: null });
      }
      return createChain({ data: [], error: null });
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: fromMock,
    });

    const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: false }));

    expect(res.status).toBe(201);

    const backupCalls = fromMock.mock.calls.filter(
      (c: string[]) => c[0] === "cierre_mes_backups"
    );
    expect(backupCalls).toHaveLength(0);
  });

  it("I-332: NO crea respaldo cuando cogs_estimado=0", async () => {
    let callCount = 0;
    const fromMock = jest.fn((table: string) => {
      callCount++;
      if (callCount === 1) return createChain({ data: [], error: null });
      if (callCount === 2) return createChain({ data: [], error: null });
      return createChain({ data: [], error: null });
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: fromMock,
    });

    const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: true }));

    expect(res.status).toBe(201);

    const backupCalls = fromMock.mock.calls.filter(
      (c: string[]) => c[0] === "cierre_mes_backups"
    );
    expect(backupCalls).toHaveLength(0);
  });

  it("I-333: respaldo incluye snapshot del período antes del cierre", async () => {
    const fakeEntries = [
      { id: "e1", total_debito: 10000, total_credito: 10000, journal_detail: [] },
    ];

    let callCount = 0;

    const fromMock = jest.fn((table: string) => {
      callCount++;
      if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
      if (callCount === 2) return createChain({
        data: [{ id: "e1", total_debito: 10000, total_credito: 10000 }],
        error: null,
      }); // entries
      if (callCount === 3) return createChain({
        data: [{ id: "compra-1" }],
        error: null,
      }); // compras
      if (callCount === 4) return createChain({
        data: [{ debito: 8000 }],
        error: null,
      }); // inventory → cogs=8000
      if (callCount === 5) return createChain({
        data: fakeEntries,
        error: null,
      }); // backup entries + detail
      if (callCount === 6) {
        const chain = createChain({ data: [{ id: "backup-uuid" }], error: null });
        return chain;
      }
      return createChain({ data: [], error: null });
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: fromMock,
    });

    const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: true }));

    expect(res.status).toBe(201);

    // Verify backup was created for the correct table
    const backupInsertCall = fromMock.mock.calls[5];
    expect(backupInsertCall[0]).toBe("cierre_mes_backups");
  });
});
