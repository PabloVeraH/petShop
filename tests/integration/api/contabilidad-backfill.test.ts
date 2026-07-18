/**
 * Integration tests for POST /api/contabilidad/backfill
 *
 * I-400 — Backfill crea asiento de ingreso + COGS para venta sin ningún asiento
 * I-401 — Backfill NO salta venta que tiene solo asiento COGS (bug: antes saltaba
 *         porque COGS y VENTA comparten tipo_movimiento="VENTA")
 * I-402 — Backfill crea COGS faltante cuando venta solo tiene asiento de ingreso
 * I-403 — Backfill salta venta que tiene ambos asientos (ingreso + COGS)
 * I-404 — Backfill no crea COGS si costoTotal=0
 * I-419 — 401 cuando no hay sesión
 * I-420 — 403 cuando el usuario no es storeAdmin ni systemAdmin
 */

import { NextRequest } from "next/server";

const mockAuthFn = jest.fn();

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuthFn }));

jest.mock("@/lib/contabilidad/generador-asientos", () => {
  const actual = jest.requireActual("@/lib/contabilidad/generador-asientos");
  return { ...actual, crearAsiento: jest.fn().mockResolvedValue("asiento-uuid") };
});

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";
import { crearAsiento } from "@/lib/contabilidad/generador-asientos";
import { logAudit } from "@/lib/audit";
import { POST } from "@/app/api/contabilidad/backfill/route";

const STORE_ID = "store-1111-2222-3333";

function backfillReq(): NextRequest {
  return new NextRequest("http://localhost/api/contabilidad/backfill", { method: "POST" });
}

function chain(thenData: unknown = { data: null, error: null }) {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(() => c),
    insert: jest.fn(() => c),
    update: jest.fn(() => c),
    eq: jest.fn(() => c),
    neq: jest.fn(() => c),
    in: jest.fn(() => c),
    order: jest.fn(() => c),
    not: jest.fn(() => c),
    ilike: jest.fn(() => c),
    gte: jest.fn(() => c),
    lte: jest.fn(() => c),
    maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
    single: jest.fn(() => Promise.resolve({ data: null, error: null })),
    then: function (resolve: (v: unknown) => void) { return resolve(thenData); },
  };
  return c;
}

describe("POST /api/contabilidad/backfill", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: STORE_ID, userId: "u1" });
    (crearAsiento as jest.Mock).mockResolvedValue("asiento-uuid");
    mockAuthFn.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
  });

  describe("autorización", () => {
    it("I-419: retorna 401 cuando no hay sesión", async () => {
      (authModule.getStoreId as jest.Mock).mockResolvedValue(null);
      const res = await POST(backfillReq());
      expect(res.status).toBe(401);
    });

    it("I-420: retorna 403 cuando el usuario no es storeAdmin ni systemAdmin", async () => {
      mockAuthFn.mockResolvedValue({
        sessionClaims: { publicMetadata: { storeWorker: true, storeId: STORE_ID } },
      });
      const res = await POST(backfillReq());
      expect(res.status).toBe(403);
    });
  });

  describe("lógica de backfill", () => {

  // I-400
  it("I-400: Backfill crea ingreso + COGS para venta sin ningún asiento", async () => {
    setupMock({
      ventas: [
        { id: "v1", created_at: "2026-06-01T10:00:00Z", total: 54740, metodo_pago: "efectivo", numero_comprobante: "20260601-ABC123" },
      ],
      incomeEntries: [],
      cogsByVenta: { v1: [] },
      ventaItems: [
        { venta_id: "v1", cantidad: 2, productos: { costo: 4000 } },
      ],
    });

    const res = await POST(backfillReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.creados).toBe(2);
    expect(crearAsiento).toHaveBeenCalledTimes(2);

    const incomeCall = (crearAsiento as jest.Mock).mock.calls[0][0];
    expect(incomeCall.tipoMovimiento).toBe("VENTA");
    expect(incomeCall.descripcion).toMatch(/^Venta /);
    expect(incomeCall.referenciaId).toBe("v1");

    const cogsCall = (crearAsiento as jest.Mock).mock.calls[1][0];
    expect(cogsCall.tipoMovimiento).toBe("VENTA");
    expect(cogsCall.descripcion).toMatch(/^COGS /);
  });

  // I-401 — THE MAIN BUG FIX
  it("I-401: Backfill crea asiento de ingreso faltante cuando venta solo tiene COGS", async () => {
    setupMock({
      ventas: [
        { id: "v1", created_at: "2026-06-01T10:00:00Z", total: 54740, metodo_pago: "efectivo", numero_comprobante: "20260601-ABC123" },
      ],
      incomeEntries: [],
      cogsByVenta: { v1: [{ id: "cogs-1" }] },
      ventaItems: [
        { venta_id: "v1", cantidad: 2, productos: { costo: 4000 } },
      ],
    });

    const res = await POST(backfillReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.creados).toBe(1);
    expect(crearAsiento).toHaveBeenCalledTimes(1);

    const incomeCall = (crearAsiento as jest.Mock).mock.calls[0][0];
    expect(incomeCall.descripcion).toMatch(/^Venta /);
    expect(body.detalle_creados).toContain("VENTA (ingreso):20260601-ABC123");
  });

  // I-402
  it("I-402: Backfill crea COGS faltante cuando venta solo tiene ingreso", async () => {
    setupMock({
      ventas: [
        { id: "v1", created_at: "2026-06-01T10:00:00Z", total: 54740, metodo_pago: "efectivo", numero_comprobante: "20260601-ABC123" },
      ],
      incomeEntries: [{ referencia_id: "v1" }],
      cogsByVenta: { v1: [] },
      ventaItems: [
        { venta_id: "v1", cantidad: 2, productos: { costo: 4000 } },
      ],
    });

    const res = await POST(backfillReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.creados).toBe(1);
    expect(crearAsiento).toHaveBeenCalledTimes(1);

    const cogsCall = (crearAsiento as jest.Mock).mock.calls[0][0];
    expect(cogsCall.descripcion).toMatch(/^COGS /);
  });

  // I-403
  it("I-403: Backfill salta venta que tiene ambos asientos", async () => {
    setupMock({
      ventas: [
        { id: "v1", created_at: "2026-06-01T10:00:00Z", total: 54740, metodo_pago: "efectivo", numero_comprobante: "20260601-ABC123" },
      ],
      incomeEntries: [{ referencia_id: "v1" }],
      cogsByVenta: { v1: [{ id: "cogs-1" }] },
      ventaItems: [],
    });

    const res = await POST(backfillReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.creados).toBe(0);
    expect(crearAsiento).not.toHaveBeenCalled();
  });

  // I-404
  it("I-404: Backfill no crea COGS si costoTotal=0", async () => {
    setupMock({
      ventas: [
        { id: "v1", created_at: "2026-06-01T10:00:00Z", total: 54740, metodo_pago: "efectivo", numero_comprobante: "20260601-ABC123" },
      ],
      incomeEntries: [{ referencia_id: "v1" }],
      cogsByVenta: { v1: [] },
      ventaItems: [
        { venta_id: "v1", cantidad: 2, productos: { costo: 0 } },
      ],
    });

    const res = await POST(backfillReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.creados).toBe(0);
    expect(crearAsiento).not.toHaveBeenCalled();
  });

  // I-413 — REGRESIÓN: una venta anulada que perdió su asiento de ingreso
  // original (mismo bug de U-124) no debe recibir uno nuevo vía backfill —
  // crear ingreso para una venta sin efecto económico vigente sería un
  // ingreso fantasma (mismo principio que 685f07a: anuladas fuera de
  // ingresos). La query de ventas del backfill debe filtrar por
  // estado != 'anulada' antes de decidir a quién le falta el asiento.
  it("I-413: REGRESIÓN — la consulta de ventas para backfill excluye estado='anulada'", async () => {
    const ventasChain = chain(Promise.resolve({ data: [], error: null }));

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "ventas") return ventasChain;
        return chain(Promise.resolve({ data: [], error: null }));
      }),
      rpc: jest.fn(),
    });

    const res = await POST(backfillReq());
    expect(res.status).toBe(200);

    expect(ventasChain.neq).toHaveBeenCalledWith("estado", "anulada");
    expect(crearAsiento).not.toHaveBeenCalled();
  });
  }); // describe lógica de backfill
});

// ---------------------------------------------------------------------------
// Helper: sets up createServiceClient mock to return controlled data
// per table and query pattern
// ---------------------------------------------------------------------------
function setupMock(params: {
  ventas: Array<Record<string, unknown>>;
  incomeEntries: Array<{ referencia_id: string }>;
  cogsByVenta: Record<string, Array<{ id: string }>>;
  ventaItems: Array<Record<string, unknown>>;
}) {
  let callCount = 0;

  (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
    from: jest.fn((table: string) => {
      callCount++;

      if (table === "ventas") {
        // First call: list all ventas
        // Subsequent calls: ventaDetalle (client name per venta)
        if (callCount === 1) {
          return chain(Promise.resolve({ data: params.ventas, error: null }));
        }
        // ventaDetalle query — return no client
        const c = chain();
        c.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
        return c;
      }

      if (table === "journal_entries") {
        // Income query:  .select().eq(store).eq(VENTA).not(desc ilike COGS)
        // COGS query:    .select().eq(store).eq(VENTA).eq(ref_id).ilike(COGS)
        // Determine which query this is at .then() time by tracking which
        // methods were called (.not vs .ilike + .eq ref_id).
        const c = chain();
        let calledNot = false;
        let capturedRefId = "";

        c.not = jest.fn(() => { calledNot = true; return c; });
        c.ilike = jest.fn(() => c);
        c.eq = jest.fn((field: string, value: unknown) => {
          if (field === "referencia_id") capturedRefId = String(value);
          return c;
        });
        c.then = (resolve: (v: unknown) => void) => {
          if (calledNot) {
            return resolve({ data: params.incomeEntries, error: null });
          }
          const cogs = params.cogsByVenta[capturedRefId] ?? [];
          return resolve({ data: cogs, error: null });
        };
        return c;
      }

      if (table === "venta_items") {
        const c = chain();
        c.select = jest.fn(() => c);
        c.eq = jest.fn(() => {
          c.then = (resolve: (v: unknown) => void) => resolve({ data: params.ventaItems, error: null });
          return c;
        });
        return c;
      }

      if (table === "ordenes_compra" || table === "notas_credito") {
        return chain(Promise.resolve({ data: [], error: null }));
      }

      return chain(Promise.resolve({ data: null, error: null }));
    }),
    rpc: jest.fn(),
  });
}
