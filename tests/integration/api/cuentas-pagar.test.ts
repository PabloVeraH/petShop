/**
 * Tests I-84 a I-86: PATCH /api/cuentas-pagar
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const CUENTA_ID = "123e4567-e89b-12d3-a456-426614174001";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();
const mockSingle = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/contabilidad/generador-asientos", () => ({
  crearAsiento: jest.fn().mockResolvedValue("asiento-id"),
  lineasPagoProveedor: jest.fn().mockReturnValue([]),
}));

import * as contabilidad from "@/lib/contabilidad/generador-asientos";

function chain() {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    update: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    single: mockSingle,
  };
  ["select","update","eq","order"].forEach(k => c[k].mockReturnValue(c));
  return c;
}

// El asiento contable de pago se dispara desde una IIFE fire-and-forget que
// hace un await previo (lookup del nombre de proveedor) antes de llamar a
// crearAsiento — hay que dejar correr la microtask queue antes de verificar.
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

function req(method = "PATCH", body?: object, id = CUENTA_ID) {
  const url = `http://localhost/api/cuentas-pagar?id=${id}`;
  return new NextRequest(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("PATCH /api/cuentas-pagar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-84
  it("I-84: estado inválido → 400", async () => {
    const { PATCH } = await import("@/app/api/cuentas-pagar/route");
    const res = await PATCH(req("PATCH", { estado: "invalido" }));
    expect(res.status).toBe(400);
  });

  // I-85
  it("I-85: cuenta de otro store → error (single retorna null)", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const { PATCH } = await import("@/app/api/cuentas-pagar/route");
    const res = await PATCH(req("PATCH", { estado: "pagada" }));
    expect(res.status).toBe(500);
  });

  // I-86
  it("I-86: estado válido actualizado → 200", async () => {
    mockSingle.mockResolvedValue({
      data: { id: CUENTA_ID, estado: "pagada", store_id: STORE_ID },
      error: null,
    });
    const { PATCH } = await import("@/app/api/cuentas-pagar/route");
    const res = await PATCH(req("PATCH", { estado: "pagada" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.estado).toBe("pagada");
  });
});

describe("GET /api/cuentas-pagar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  function makeGetChain(data: any[]) {
    const c = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gt: jest.fn().mockReturnThis(),
      order: jest.fn(function() { return this; }),
    };
    (c as any).then = function(resolve: any) {
      return resolve({ data, error: null });
    };
    return c;
  }

  // I-87
  it("I-87: GET sin filtro → lista todas las cuentas", async () => {
    mockFrom.mockReturnValue(makeGetChain([
      { id: "cp-1", monto: 3800, estado: "pendiente", proveedor_id: "prov-1" },
      { id: "cp-2", monto: 1500, estado: "pagada", proveedor_id: "prov-2" },
    ]));

    const { GET } = await import("@/app/api/cuentas-pagar/route");
    const res = await GET(new NextRequest("http://localhost/api/cuentas-pagar"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
  });

  // I-88
  it("I-88: GET con estado=pendiente → filtra por estado", async () => {
    mockFrom.mockReturnValue(makeGetChain([
      { id: "cp-1", monto: 3800, estado: "pendiente", proveedor_id: "prov-1" },
    ]));

    const { GET } = await import("@/app/api/cuentas-pagar/route");
    const res = await GET(new NextRequest("http://localhost/api/cuentas-pagar?estado=pendiente"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  // I-89
  it("I-89: GET con proveedor_id=X → filtra por proveedor", async () => {
    mockFrom.mockReturnValue(makeGetChain([
      { id: "cp-1", monto: 3800, estado: "pendiente", proveedor_id: "prov-1" },
    ]));

    const { GET } = await import("@/app/api/cuentas-pagar/route");
    const res = await GET(new NextRequest("http://localhost/api/cuentas-pagar?proveedor_id=prov-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  // I-113 — REGRESIÓN: cuentas con monto <= 0 no deben filtrarse al frontend
  it("I-113: GET filtra automáticamente cuentas con monto <= 0", async () => {
    const chain = makeGetChain([
      { id: "cp-1", monto: 5000, estado: "pendiente", proveedor_id: "prov-1" },
    ]);
    mockFrom.mockReturnValue(chain);

    const { GET } = await import("@/app/api/cuentas-pagar/route");
    const res = await GET(new NextRequest("http://localhost/api/cuentas-pagar"));

    expect(res.status).toBe(200);
    // Verificar que la query incluye .gt("monto", 0)
    expect(chain.gt).toHaveBeenCalledWith("monto", 0);
  });
});

describe("PATCH /api/cuentas-pagar mark-pagada", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  function markPagadaReq(body: object) {
    return new NextRequest(`http://localhost/api/cuentas-pagar?id=${CUENTA_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // I-90
  it("I-90: PATCH mark-pagada → 200 + estado actualizado", async () => {
    mockSingle.mockResolvedValue({
      data: { id: CUENTA_ID, estado: "pagada", monto: 3800, store_id: STORE_ID, updated_at: "2026-04-24T12:00:00Z" },
      error: null,
    });
    const { PATCH } = await import("@/app/api/cuentas-pagar/route");
    const res = await PATCH(markPagadaReq({ estado: "pagada" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.estado).toBe("pagada");
  });

  // I-107
  it("I-107: PATCH con metodo_pago inválido → 400", async () => {
    const { PATCH } = await import("@/app/api/cuentas-pagar/route");
    const res = await PATCH(markPagadaReq({ estado: "pagada", metodo_pago: "cheque" }));
    expect(res.status).toBe(400);
  });

  // I-108
  it("I-108: PATCH con metodo_pago=efectivo → 200 + metodo_pago en DB", async () => {
    mockSingle.mockResolvedValue({
      data: { id: CUENTA_ID, estado: "pagada", metodo_pago: "efectivo", monto: 3800, store_id: STORE_ID, updated_at: "2026-04-24T12:00:00Z" },
      error: null,
    });
    const { PATCH } = await import("@/app/api/cuentas-pagar/route");
    const res = await PATCH(markPagadaReq({ estado: "pagada", metodo_pago: "efectivo" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.metodo_pago).toBe("efectivo");
    expect(mockFrom).toHaveBeenCalledWith("cuentas_pagar");
    const updateCall = mockFrom().update.mock.calls[0][0];
    expect(updateCall.metodo_pago).toBe("efectivo");
  });

  // I-111
  it("I-111: PATCH mark-pagada → genera asiento contable de pago (crearAsiento + lineasPagoProveedor)", async () => {
    mockSingle.mockResolvedValue({
      data: { id: CUENTA_ID, estado: "pagada", metodo_pago: "efectivo", monto: 3800, store_id: STORE_ID, updated_at: "2026-04-24T12:00:00Z" },
      error: null,
    });
    const { PATCH } = await import("@/app/api/cuentas-pagar/route");
    const res = await PATCH(markPagadaReq({ estado: "pagada", metodo_pago: "efectivo" }));
    expect(res.status).toBe(200);

    await flushMicrotasks();

    expect(contabilidad.lineasPagoProveedor).toHaveBeenCalledWith(3800, "efectivo");
    expect(contabilidad.crearAsiento).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: STORE_ID,
        tipoMovimiento: "PAGO_PROVEEDOR",
        referenciaId: CUENTA_ID,
      })
    );
  });

  // I-112
  it("I-112: PATCH con estado=pendiente (sin pagar) → NO genera asiento contable", async () => {
    mockSingle.mockResolvedValue({
      data: { id: CUENTA_ID, estado: "pendiente", store_id: STORE_ID },
      error: null,
    });
    const { PATCH } = await import("@/app/api/cuentas-pagar/route");
    const res = await PATCH(markPagadaReq({ estado: "pendiente" }));
    expect(res.status).toBe(200);

    await flushMicrotasks();

    expect(contabilidad.crearAsiento).not.toHaveBeenCalled();
  });

  // I-109
  it("I-109: PATCH falla → response body con mensaje de error", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116", message: "No encontrada" } });
    const { PATCH } = await import("@/app/api/cuentas-pagar/route");
    const res = await PATCH(markPagadaReq({ estado: "pagada" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Error interno del servidor");
  });

  // I-110
  it("I-110: PATCH falla → console.error registra el error", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116", message: "No encontrada" } });
    const { PATCH } = await import("@/app/api/cuentas-pagar/route");
    await PATCH(markPagadaReq({ estado: "pagada" }));
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[cuentas-pagar]"),
      expect.any(String),
      expect.objectContaining({ id: CUENTA_ID })
    );
    consoleSpy.mockRestore();
  });
});
