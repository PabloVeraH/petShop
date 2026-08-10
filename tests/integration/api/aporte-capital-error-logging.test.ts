/**
 * Test I-512: POST /api/contabilidad/aporte-capital — ticket Trello
 * 6a77eec7a32c85d594ee7a62.
 *
 * Repro del ticket: crearAsiento retorna null → la ruta devuelve 500 "Error al
 * registrar el aporte de capital". Antes del fix ese 500 real no se registraba
 * en error_logs (tabla vacía en producción) y la pestaña "Errores de sistema"
 * mostraba "Mostrando 1-0 de 0 registros" pese a los 500 confirmados.
 *
 * Este test difiere de I-463 (contabilidad-aporte-capital.test.ts, que solo
 * afirma el status 500): aquí se verifica la cadena REAL wrapper →
 * logError → INSERT en error_logs, con endpoint, store_id, user_id y mensaje,
 * es decir que el 500 del repro queda visible para el panel de Auditoría.
 * El store_id lo deriva withErrorLogging vía getStoreId() (best-effort).
 */
import { NextRequest } from "next/server";

const mockAuth = jest.fn();
const mockGetStoreId = jest.fn();
const mockInsertErrorLog = jest.fn().mockResolvedValue({ error: null });
const mockCreateServiceClient = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: mockCreateServiceClient }));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    // after() requiere request scope (lanza fuera de él); en tests se invoca
    // POST() directamente sin request scope real (mismo patrón que
    // tests/integration/api/ventas*.test.ts y with-error-logging.test.ts).
    after: jest.fn((cb: () => void) => cb()),
  };
});
jest.mock("@/lib/contabilidad/generador-asientos", () => ({
  ...jest.requireActual("@/lib/contabilidad/generador-asientos"),
  crearAsiento: jest.fn(),
}));

import { crearAsiento } from "@/lib/contabilidad/generador-asientos";
import { POST } from "@/app/api/contabilidad/aporte-capital/route";

const STORE_ID = "store-uuid-aporte-log";
const USER_ID = "user-001";

function genericChain() {
  const chain: Record<string, jest.Mock> & { then?: (resolve: (v: unknown) => unknown) => unknown } = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
  };
  chain.then = (resolve) => resolve({ data: [], error: null });
  return chain;
}

function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/contabilidad/aporte-capital", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contabilidad/aporte-capital — registro de 500 en error_logs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ storeId: STORE_ID, userId: USER_ID });
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
    mockCreateServiceClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "error_logs") return { insert: mockInsertErrorLog };
        return genericChain();
      }),
    });
    (crearAsiento as jest.Mock).mockResolvedValue(null);
  });

  it("I-512: crearAsiento retorna null → 500 real y la cadena completa escribe el registro en error_logs (endpoint, store_id, user_id, mensaje)", async () => {
    const res = await POST(makeRequest({ cuentaDestino: "caja", monto: 100000 }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Error al registrar el aporte de capital");

    // El INSERT se agenda dentro de after() y solo se llama tras resolver
    // bestEffortErrorContext() (otro await) — queda pendiente por más de un
    // microtask tick después de que POST() ya resolvió. setImmediate corre
    // como macrotask, después de drenar toda la cola de microtasks.
    await new Promise((resolve) => setImmediate(resolve));

    // La cadena completa debe haber insertado en error_logs con el contexto
    // derivado (getStoreId) y el endpoint del repro.
    expect(mockCreateServiceClient).toHaveBeenCalled();
    expect(mockInsertErrorLog).toHaveBeenCalledTimes(1);
    const row = mockInsertErrorLog.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      store_id: STORE_ID,
      user_id: USER_ID,
      endpoint: "POST /api/contabilidad/aporte-capital",
      error_message: "HTTP 500 en POST /api/contabilidad/aporte-capital",
      severity: "ERROR",
    });
  });
});
