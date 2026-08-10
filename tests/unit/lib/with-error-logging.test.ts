/**
 * Tests U-146 a U-149: withErrorLogging (src/lib/audit.ts)
 *
 * Ticket Trello 6a77eec7a32c85d594ee7a62: los errores 500 reales del backend
 * nunca llegaban a la grilla Admin > Auditoría > "Errores de sistema" porque
 * la tabla error_logs estaba vacía (verificado en el proyecto real
 * wnxrdbnvreofrrmhcybc: 0 filas) y ningún endpoint invocaba
 * logError()/handleRouteError(). withErrorLogging es el mecanismo compartido:
 * registra excepciones lanzadas y respuestas con status >= 500 en error_logs
 * (agendado vía after() de next/server) manteniendo el contrato HTTP de la
 * ruta.
 *
 * Estos tests ejercitan la cadena REAL wrapper → logError → INSERT en
 * error_logs (createServiceClient mockeado captura el insert), no un mock de
 * logError: validan que el mecanismo efectivamente escribe el registro.
 */
import { NextResponse } from "next/server";

const mockGetStoreId = jest.fn();
const mockInsert = jest.fn().mockResolvedValue({ error: null });
const mockFrom = jest.fn(() => ({ insert: mockInsert }));

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    // after() requiere request scope (lanza fuera de él, ver
    // node_modules/next/dist/server/after/after.js). En tests invocamos el
    // wrapper directamente sin request scope: ejecutamos el callback al
    // toque, replicando el mismo patrón que tests/integration/api/ventas*.
    after: jest.fn((cb: () => void) => cb()),
  };
});

import { withErrorLogging } from "@/lib/audit";

// after() (mockeado arriba) invoca el callback sin esperar a que termine —
// igual que la plataforma real, que solo garantiza que corra tras la
// respuesta, no que corra en el mismo tick. El callback primero resuelve
// bestEffortErrorContext() (otro await) antes de llamar a logError(), así
// que el INSERT en error_logs queda pendiente por más de un microtask tick
// después de que `wrapped()` ya resolvió. Se drena la cola de microtasks
// (setImmediate = macrotask, corre después de que TODOS los microtasks
// pendientes se hayan procesado) antes de inspeccionar el mock — no es una
// espera arbitraria de tiempo, es la forma estándar de esperar una cadena de
// promesas fire-and-forget en Jest.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function errorLogsInsert(): Promise<Record<string, unknown>> {
  await flushMicrotasks();
  expect(mockFrom).toHaveBeenCalledWith("error_logs");
  return mockInsert.mock.calls[0][0] as Record<string, unknown>;
}

describe("withErrorLogging — ticket 6a77eec7a32c85d594ee7a62", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ storeId: "store-uuid-001", userId: "user-001" });
  });

  // U-146
  it("U-146: excepción lanzada → INSERT en error_logs con mensaje/stack/endpoint/ctx y 500 genérico sin filtrar detalles", async () => {
    const handler: () => Promise<Response> = async () => {
      throw new Error("boom interno del servidor");
    };
    const wrapped = withErrorLogging(handler, { endpoint: "POST /api/contabilidad/aporte-capital" });

    const res = await wrapped();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Error interno del servidor");
    expect(JSON.stringify(body)).not.toContain("boom interno");

    const row = await errorLogsInsert();
    expect(row).toMatchObject({
      store_id: "store-uuid-001",
      user_id: "user-001",
      endpoint: "POST /api/contabilidad/aporte-capital",
      error_message: "boom interno del servidor",
      severity: "ERROR",
    });
    expect(String(row.stack_trace)).toContain("boom interno del servidor");
  });

  // U-147
  it("U-147: respuesta 500 inline → INSERT en error_logs y la respuesta original se devuelve intacta", async () => {
    const handler = async () =>
      NextResponse.json({ error: "Error al registrar el aporte de capital" }, { status: 500 });
    const wrapped = withErrorLogging(handler, { endpoint: "POST /api/contabilidad/aporte-capital" });

    const res = await wrapped();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Error al registrar el aporte de capital");

    const row = await errorLogsInsert();
    expect(row).toMatchObject({
      store_id: "store-uuid-001",
      user_id: "user-001",
      endpoint: "POST /api/contabilidad/aporte-capital",
      error_message: "HTTP 500 en POST /api/contabilidad/aporte-capital",
      severity: "ERROR",
    });
  });

  // U-148
  it("U-148: respuesta no-500 (403) → no se escribe nada en error_logs", async () => {
    const handler = async () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const wrapped = withErrorLogging(handler, { endpoint: "GET /api/error-logs" });

    const res = await wrapped();
    expect(res.status).toBe(403);
    await flushMicrotasks();
    expect(mockFrom).not.toHaveBeenCalledWith("error_logs");
  });

  // U-149
  it("U-149: getStoreId falla en el path de error → el 500 no se rompe y el registro igual se escribe", async () => {
    mockGetStoreId.mockRejectedValue(new Error("auth caído"));
    const handler: () => Promise<Response> = async () => {
      throw new Error("base de datos no disponible");
    };
    const wrapped = withErrorLogging(handler, { endpoint: "GET /api/dashboard" });

    const res = await wrapped();
    expect(res.status).toBe(500);
    const row = await errorLogsInsert();
    expect(row).toMatchObject({
      endpoint: "GET /api/dashboard",
      error_message: "base de datos no disponible",
    });
    expect(row.store_id).toBeNull();
  });
});
