/**
 * Tests U-230 a U-234: registro en audit_logs de accesos denegados (403 vía
 * withErrorLogging, action LOGIN_FAILED) y de consultas (registrarConsulta,
 * action VIEW). Ejercitan la cadena real hasta el INSERT en audit_logs
 * (createServiceClient mockeado captura el insert).
 */
import { NextRequest, NextResponse } from "next/server";

const mockGetStoreId = jest.fn();
const mockInsert = jest.fn().mockResolvedValue({ error: null });
const mockFrom = jest.fn(() => ({ insert: mockInsert }));
let afterDisponible = true;

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    // Sin request scope after() lanza; aquí se ejecuta en el acto, o se
    // simula el lanzamiento real para probar que nunca rompe la respuesta.
    after: jest.fn((cb: () => void) => {
      if (!afterDisponible) throw new Error("`after` was called outside a request scope");
      cb();
    }),
  };
});

import { registrarConsulta, withErrorLogging } from "@/lib/audit";

// Drena la cadena de promesas agendada por after() (getStoreId → insert).
const drenar = () => new Promise((r) => setImmediate(r));
const auditInserts = () =>
  mockFrom.mock.calls
    .map((c, i) => [c, mockInsert.mock.calls[i]?.[0]] as const)
    .filter(([c]) => (c as unknown[])[0] === "audit_logs")
    .map(([, row]) => row as Record<string, unknown>);

const req = () => new NextRequest("http://localhost/api/x", {
  headers: { "x-forwarded-for": "10.0.0.1", "user-agent": "jest" },
});

describe("withErrorLogging — accesos denegados (403)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    afterDisponible = true;
    mockGetStoreId.mockResolvedValue({ storeId: "store-1", userId: "worker-1" });
  });

  it("U-230: un 403 con sesión queda en audit_logs como LOGIN_FAILED/failure con usuario, tienda, endpoint e IP", async () => {
    const wrapped = withErrorLogging(async (_r: NextRequest) => NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      { endpoint: "PATCH /api/ventas/id" });

    const res = await wrapped(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    await drenar();

    const filas = auditInserts();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      store_id: "store-1",
      user_id: "worker-1",
      action: "LOGIN_FAILED",
      entity_type: "acceso",
      change_description: "Acceso denegado: PATCH /api/ventas/id",
      ip_address: "10.0.0.1",
      user_agent: "jest",
      result: "failure",
    });
  });

  it("U-231: un 403 sin sesión (webhook) no se registra; 200 y 404 tampoco", async () => {
    mockGetStoreId.mockResolvedValue(null);
    await withErrorLogging(async () => NextResponse.json({}, { status: 403 }), { endpoint: "POST /api/whatsapp/webhook" })();
    mockGetStoreId.mockResolvedValue({ storeId: "store-1", userId: "worker-1" });
    await withErrorLogging(async () => NextResponse.json({}, { status: 200 }), { endpoint: "GET /api/x" })();
    await withErrorLogging(async () => NextResponse.json({}, { status: 404 }), { endpoint: "GET /api/x" })();
    await drenar();
    expect(auditInserts()).toHaveLength(0);
  });

  it("U-232: si after() o el INSERT fallan, la respuesta 403 se devuelve igual", async () => {
    afterDisponible = false;
    let res = await withErrorLogging(async () => NextResponse.json({ error: "Forbidden" }, { status: 403 }), { endpoint: "GET /api/x" })();
    expect(res.status).toBe(403);

    afterDisponible = true;
    mockInsert.mockRejectedValueOnce(new Error("db caída"));
    res = await withErrorLogging(async () => NextResponse.json({ error: "Forbidden" }, { status: 403 }), { endpoint: "GET /api/x" })();
    expect(res.status).toBe(403);
    await drenar();
  });
});

describe("registrarConsulta", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    afterDisponible = true;
  });

  it("U-233: inserta una fila VIEW con usuario, tienda, entidad e IP del request", async () => {
    registrarConsulta(req(), {
      storeId: "store-1",
      userId: "worker-1",
      entityType: "venta",
      entityId: "venta-1",
      changeDescription: "Recibo de la venta 20261026-AAA abierto",
    });
    await drenar();

    const filas = auditInserts();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      store_id: "store-1",
      user_id: "worker-1",
      action: "VIEW",
      entity_type: "venta",
      entity_id: "venta-1",
      ip_address: "10.0.0.1",
      result: "success",
    });
  });

  it("U-234: fuera de request scope o con el INSERT fallando no lanza", async () => {
    afterDisponible = false;
    expect(() => registrarConsulta(req(), { storeId: "s", userId: "u", entityType: "cliente" })).not.toThrow();

    afterDisponible = true;
    mockInsert.mockRejectedValueOnce(new Error("db caída"));
    expect(() => registrarConsulta(req(), { storeId: "s", userId: "u", entityType: "cliente" })).not.toThrow();
    await drenar();
  });
});
