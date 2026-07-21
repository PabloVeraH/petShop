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
  ...jest.requireActual("@/lib/audit"),
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

function backfillReq(headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/contabilidad/backfill", { method: "POST", headers });
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

  describe("auditoría", () => {
    it("I-421: registra en logAudit action BACKFILL con ipAddress/userAgent extraídos del request", async () => {
      setupMock({ ventas: [], incomeEntries: [], cogsByVenta: {}, ventaItems: [] });

      const res = await POST(backfillReq({
        "user-agent": "Mozilla/5.0 TestAgent",
        "x-forwarded-for": "10.0.0.5",
      }));

      expect(res.status).toBe(200);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        storeId: STORE_ID,
        userId: "u1",
        action: "BACKFILL",
        entityType: "journal_entries",
        ipAddress: "10.0.0.5",
        userAgent: "Mozilla/5.0 TestAgent",
      }));
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

  // I-424 — REGRESIÓN: solo procesa OC 'recibida' (ticket Trello
  // 6a5e9533c7978fcb117449d7). Una OC 'pendiente' o 'enviada' aún no tiene
  // precio definido (subtotal=null), y 'cancelada' nunca se recibió. Sin este
  // filtro, todas aparecían como error "precio no definido" — ruido/falsa
  // alarma para el usuario. Antes del fix I-424 original (commit d1db895)
  // solo excluía 'cancelada', lo que dejaba pasar 'pendiente'/'enviada'.
  it("I-424: REGRESIÓN — la consulta de órdenes de compra para backfill filtra solo estado='recibida'", async () => {
    const ordenesChain = chain(Promise.resolve({ data: [], error: null }));

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "ordenes_compra") return ordenesChain;
        return chain(Promise.resolve({ data: [], error: null }));
      }),
      rpc: jest.fn(),
    });

    const res = await POST(backfillReq());
    expect(res.status).toBe(200);

    expect(ordenesChain.eq).toHaveBeenCalledWith("estado", "recibida");
    expect(crearAsiento).not.toHaveBeenCalled();
  });

  // I-432 — REGRESIÓN (ticket Trello 6a5e9533c7978fcb117449d7):
  // OC en estado 'pendiente' o 'enviada' no deben procesarse en el backfill
  // (aún no tienen precio definido). Solo las 'recibida' tienen efecto
  // económico real. Antes del fix, todas las OC no-canceladas se incluían,
  // generando errores 'precio no definido' para OCs en flujo normal.
  it("I-432: REGRESIÓN — OC pendiente/enviada no se procesan ni generan error 'precio no definido'", async () => {
    // Construimos un mock que simula el filtro .eq("estado", "recibida")
    // en la DB: solo devuelve las OCs recibidas (oc3).
    const ordenesMock = [
      { id: "oc-pendiente", created_at: "2026-07-01T10:00:00Z", subtotal: null, impuesto: null, total: null, numero: "OC-20260701-PEND" },
      { id: "oc-enviada",   created_at: "2026-07-02T10:00:00Z", subtotal: null, impuesto: null, total: null, numero: "OC-20260702-ENV" },
      { id: "oc-recibida",  created_at: "2026-07-03T10:00:00Z", subtotal: 50000, impuesto: 9500, total: 59500, numero: "OC-20260703-REC" },
    ];
    // Simulamos el filtro de BD: solo devolvemos la OC recibida
    const dataFiltrada = { data: [ordenesMock[2]], error: null };

    let callCount = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "ordenes_compra") {
          callCount++;
          if (callCount === 1) return chain(Promise.resolve(dataFiltrada));
          const c = chain();
          c.eq = jest.fn(() => c);
          c.maybeSingle = jest.fn(() => Promise.resolve({ data: { proveedores: { nombre: "Proveedor" } }, error: null }));
          return c;
        }
        if (table === "ventas") return chain(Promise.resolve({ data: [], error: null }));
        if (table === "notas_credito") return chain(Promise.resolve({ data: [], error: null }));
        if (table === "journal_entries") {
          const c = chain();
          c.eq = jest.fn(() => c);
          c.not = jest.fn(() => c);
          c.ilike = jest.fn(() => c);
          c.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
          return c;
        }
        return chain(Promise.resolve({ data: null, error: null }));
      }),
      rpc: jest.fn(),
    });

    const res = await POST(backfillReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    // Debe crear exactamente 1 asiento (solo la recibida)
    expect(body.creados).toBe(1);
    // No debe haber errores
    expect(body.errores).toBe(0);
    // La OC recibida debe aparecer en creados
    expect(body.detalle_creados).toContain("COMPRA:OC-20260703-REC");
    // Las OC pendiente/enviada NO deben aparecer ni en creados ni en errores
    expect(body.detalle_creados).not.toContain("OC-20260701-PEND");
    expect(body.detalle_creados).not.toContain("OC-20260702-ENV");
    expect(body.detalle_errores).not.toContain("OC-20260701-PEND");
    expect(body.detalle_errores).not.toContain("OC-20260702-ENV");
  });
  }); // describe lógica de backfill

  // I-422: REGRESIÓN — OC sin precio (subtotal=0 o total=0) reporta
  // "precio no definido" en vez de solo el código de OC. Antes del fix,
  // el error era genérico "COMPRA:OC-XXX" sin el motivo; ahora debe
  // especificar que el precio no está definido.
  // (ticket Trello 6a5c650fab...)
  it("I-422: REGRESIÓN — OC con subtotal=0 reporta 'precio no definido' en detalle_errores", async () => {
    setupOcBackfillMock({
      ordenesCompra: [
        { id: "oc1", created_at: "2026-07-01T10:00:00Z", subtotal: 0, impuesto: 0, total: 0, numero: "OC-20260701-NOPRICE" },
        { id: "oc2", created_at: "2026-07-02T10:00:00Z", subtotal: 10000, impuesto: 1900, total: 11900, numero: "OC-20260702-VALID" },
      ],
      compraEntries: [],
      proveedorPorOc: {
        oc1: "Proveedor Uno",
        oc2: "Proveedor Dos",
      },
    });

    const res = await POST(backfillReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    // OC sin precio debe reportar error específico
    expect(body.errores).toBe(1);
    expect(body.detalle_errores).toContain("COMPRA:OC-20260701-NOPRICE — precio no definido");
    // OC con precio válido debe crearse
    expect(body.creados).toBe(1);
    expect(body.detalle_creados).toContain("COMPRA:OC-20260702-VALID");
  });

  // I-423: REGRESIÓN — OC con precio válido pero crearAsiento falla
  // reporta "error al crear asiento contable" en vez de solo el código.
  it("I-423: REGRESIÓN — OC con subtotal válido pero crearAsiento falla reporta error específico", async () => {
    (crearAsiento as jest.Mock).mockResolvedValue(null);
    setupOcBackfillMock({
      ordenesCompra: [
        { id: "oc1", created_at: "2026-07-01T10:00:00Z", subtotal: 50000, impuesto: 9500, total: 59500, numero: "OC-20260701-FAIL" },
        { id: "oc2", created_at: "2026-07-02T10:00:00Z", subtotal: 30000, impuesto: 5700, total: 35700, numero: "OC-20260702-FAIL2" },
      ],
      compraEntries: [],
      proveedorPorOc: {
        oc1: "Proveedor Uno",
        oc2: "Proveedor Dos",
      },
    });

    const res = await POST(backfillReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.errores).toBe(2);
    expect(body.detalle_errores).toContain("COMPRA:OC-20260701-FAIL — error al crear asiento contable");
    expect(body.detalle_errores).toContain("COMPRA:OC-20260702-FAIL2 — error al crear asiento contable");
    expect(body.creados).toBe(0);
  });

  // I-NCC-BF-01 a I-NCC-BF-04: el backfill de NC también debía revertir el
  // COGS (mismo bug que I-400/I-402 pero del lado de las notas de crédito).
  // Usa un mock dedicado (no setupMock, que fija notas_credito a [] para
  // los escenarios de VENTA) para aislar el flujo de NC/nota_credito_items.
  describe("backfill de notas de crédito — reverso de COGS (I-NCC-BF)", () => {
    it("I-NCC-BF-01: NC sin ningún asiento → crea ingreso + reverso de COGS", async () => {
      setupNcBackfillMock({
        notas: [{ id: "nc1", created_at: "2026-06-01T10:00:00Z", monto_total: 3000, tipo_reembolso: "reembolso_directo", numero_nc: "NC-20260601-AAAA1111" }],
        ncIngresoEntries: [],
        ncCogsEntries: [],
        ncItemsByNc: { nc1: [{ cantidad_devuelta: 3, productos: { costo: 500 } }] },
      });

      const res = await POST(backfillReq());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.creados).toBe(2);
      expect(crearAsiento).toHaveBeenCalledTimes(2);

      const ingresoCall = (crearAsiento as jest.Mock).mock.calls[0][0];
      expect(ingresoCall.descripcion).toMatch(/^Devolución/);
      expect(body.detalle_creados).toContain("NC (ingreso):NC-20260601-AAAA1111");

      const cogsCall = (crearAsiento as jest.Mock).mock.calls[1][0];
      expect(cogsCall.descripcion).toMatch(/^Reverso COGS/);
      const lineaCogs = cogsCall.lineas.find((l: { cuentaCodigo: string }) => l.cuentaCodigo === "510101");
      expect(lineaCogs.credito).toBe(1500); // 3 x $500
      expect(body.detalle_creados).toContain("NC (COGS):NC-20260601-AAAA1111");
    });

    it("I-NCC-BF-02: NC con ingreso ya registrado pero sin COGS → crea solo el reverso de COGS", async () => {
      setupNcBackfillMock({
        notas: [{ id: "nc1", created_at: "2026-06-01T10:00:00Z", monto_total: 3000, tipo_reembolso: "reembolso_directo", numero_nc: "NC-20260601-AAAA1111" }],
        ncIngresoEntries: [{ referencia_id: "nc1" }],
        ncCogsEntries: [],
        ncItemsByNc: { nc1: [{ cantidad_devuelta: 3, productos: { costo: 500 } }] },
      });

      const res = await POST(backfillReq());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.creados).toBe(1);
      expect(crearAsiento).toHaveBeenCalledTimes(1);

      const cogsCall = (crearAsiento as jest.Mock).mock.calls[0][0];
      expect(cogsCall.descripcion).toMatch(/^Reverso COGS/);
    });

    it("I-NCC-BF-03: NC con ambos asientos ya registrados → no crea nada", async () => {
      setupNcBackfillMock({
        notas: [{ id: "nc1", created_at: "2026-06-01T10:00:00Z", monto_total: 3000, tipo_reembolso: "reembolso_directo", numero_nc: "NC-20260601-AAAA1111" }],
        ncIngresoEntries: [{ referencia_id: "nc1" }],
        ncCogsEntries: [{ referencia_id: "nc1" }],
        ncItemsByNc: { nc1: [{ cantidad_devuelta: 3, productos: { costo: 500 } }] },
      });

      const res = await POST(backfillReq());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.creados).toBe(0);
      expect(crearAsiento).not.toHaveBeenCalled();
    });

    it("I-NCC-BF-04: NC sin ítems con restituir_stock=true → no crea reverso de COGS (solo ingreso)", async () => {
      setupNcBackfillMock({
        notas: [{ id: "nc1", created_at: "2026-06-01T10:00:00Z", monto_total: 3000, tipo_reembolso: "reembolso_directo", numero_nc: "NC-20260601-AAAA1111" }],
        ncIngresoEntries: [],
        ncCogsEntries: [],
        ncItemsByNc: { nc1: [] }, // sin ítems restituir_stock=true — el query real ya los filtra
      });

      const res = await POST(backfillReq());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.creados).toBe(1);
      expect(crearAsiento).toHaveBeenCalledTimes(1);

      const ingresoCall = (crearAsiento as jest.Mock).mock.calls[0][0];
      expect(ingresoCall.descripcion).toMatch(/^Devolución/);
    });
  });
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

// ---------------------------------------------------------------------------
// Helper: mock dedicado para el backfill de notas de crédito (I-NCC-BF).
// setupMock fija notas_credito a [] porque sus escenarios son de VENTA; este
// helper hace lo contrario: ventas vacías y control total sobre notas_credito,
// journal_entries (distinguiendo las 5 queries por tipo_movimiento + .not) y
// nota_credito_items.
// ---------------------------------------------------------------------------
function setupNcBackfillMock(params: {
  notas: Array<Record<string, unknown>>;
  ncIngresoEntries: Array<{ referencia_id: string }>;
  ncCogsEntries: Array<{ referencia_id: string }>;
  ncItemsByNc: Record<string, Array<Record<string, unknown>>>;
}) {
  (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === "ventas") {
        // Sin ventas en estos tests — el flujo VENTA no hace nada
        return chain(Promise.resolve({ data: [], error: null }));
      }

      if (table === "notas_credito") {
        // Query lista (select + eq store + order → await) resuelve las NCs;
        // query detalle (select ventas!inner + eq id + maybeSingle) resuelve
        // sin cliente — el nombre es opcional en la descripción del asiento.
        const c = chain(Promise.resolve({ data: params.notas, error: null }));
        c.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
        return c;
      }

      if (table === "journal_entries") {
        // La ruta hace 5 queries sobre journal_entries; se distinguen por el
        // tipo_movimiento capturado en .eq() y si se llamó .not():
        //   VENTA + not            → ingreso ventas (vacío aquí)
        //   VENTA + ilike + ref    → COGS por venta (no se alcanza sin ventas)
        //   NOTA_CREDITO + not     → ncIngresoEntries
        //   NOTA_CREDITO + ilike   → ncCogsEntries
        //   COMPRA                 → vacío
        const c = chain();
        let tipo = "";
        let calledNot = false;
        c.eq = jest.fn((field: string, value: unknown) => {
          if (field === "tipo_movimiento") tipo = String(value);
          return c;
        });
        c.not = jest.fn(() => { calledNot = true; return c; });
        c.ilike = jest.fn(() => c);
        c.then = (resolve: (v: unknown) => void) => {
          if (tipo === "NOTA_CREDITO") {
            return resolve({ data: calledNot ? params.ncIngresoEntries : params.ncCogsEntries, error: null });
          }
          return resolve({ data: [], error: null });
        };
        return c;
      }

      if (table === "nota_credito_items") {
        // calcularCostoTotalNc: select + eq(nota_credito_id) + eq(restituir_stock)
        const c = chain();
        let ncId = "";
        c.eq = jest.fn((field: string, value: unknown) => {
          if (field === "nota_credito_id") ncId = String(value);
          return c;
        });
        c.then = (resolve: (v: unknown) => void) =>
          resolve({ data: params.ncItemsByNc[ncId] ?? [], error: null });
        return c;
      }

      // ordenes_compra y cualquier otra tabla — vacío
      return chain(Promise.resolve({ data: [], error: null }));
    }),
    rpc: jest.fn(),
  });
}

// ---------------------------------------------------------------------------
// Helper: mock dedicado para el backfill de órdenes de compra (I-422, I-423).
// setupMock fija ordenes_compra a [] porque sus escenarios son de VENTA; este
// helper hace lo contrario: ventas y NC vacías, control total de OCs.
// ---------------------------------------------------------------------------
function setupOcBackfillMock(params: {
  ordenesCompra: Array<Record<string, unknown>>;
  compraEntries: Array<{ referencia_id: string }>;
  proveedorPorOc: Record<string, string>;
}) {
  let callCount = 0;
  (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === "ventas") {
        return chain(Promise.resolve({ data: [], error: null }));
      }

      if (table === "notas_credito") {
        return chain(Promise.resolve({ data: [], error: null }));
      }

      if (table === "ordenes_compra") {
        callCount++;
        // First call: list all OCs (select + eq store + order)
        if (callCount === 1) {
          return chain(Promise.resolve({ data: params.ordenesCompra, error: null }));
        }
        // Subsequent calls: proveedor detail per OC
        const c = chain();
        let capturedId = "";
        c.eq = jest.fn((field: string, value: unknown) => {
          if (field === "id") capturedId = String(value);
          return c;
        });
        c.maybeSingle = jest.fn(() => {
          const nombre = params.proveedorPorOc[capturedId] ?? "Proveedor Genérico";
          return Promise.resolve({ data: { proveedores: { nombre } }, error: null });
        });
        return c;
      }

      if (table === "journal_entries") {
        const c = chain();
        let tipo = "";
        c.eq = jest.fn((field: string, value: unknown) => {
          if (field === "tipo_movimiento") tipo = String(value);
          return c;
        });
        c.not = jest.fn(() => c);
        c.ilike = jest.fn(() => c);
        c.then = (resolve: (v: unknown) => void) => {
          if (tipo === "COMPRA") {
            return resolve({ data: params.compraEntries, error: null });
          }
          return resolve({ data: [], error: null });
        };
        return c;
      }

      return chain(Promise.resolve({ data: null, error: null }));
    }),
    rpc: jest.fn(),
  });
}
