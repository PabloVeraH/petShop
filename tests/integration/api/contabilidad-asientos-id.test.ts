/**
 * Tests A-DEL-01 a A-DEL-05: DELETE /api/contabilidad/asientos/[id]
 *
 * REGRESIÓN: asientos $0/$0 generados por lineasPagoProveedor(0) quedaban
 * persistidos en la BD sin mecanismo de eliminación.
 *
 * El endpoint solo permite borrar entradas donde total_debito=0 y total_credito=0.
 * Los asientos con movimiento económico devuelven 409.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn().mockReturnValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

const STORE_ID  = "store-uuid-cont-001";
const ENTRY_ID  = "entry-uuid-zero-001";

function makeRequest(id: string) {
  return new NextRequest(`http://localhost/api/contabilidad/asientos/${id}`, {
    method: "DELETE",
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// Construye un cliente Supabase con cadenas de mock configurables
function makeDb(options: {
  entry?: object | null;
  fetchError?: boolean;
  detailDeleteError?: boolean;
  entryDeleteError?: boolean;
}) {
  const {
    entry = null,
    fetchError = false,
    detailDeleteError = false,
    entryDeleteError = false,
  } = options;

  const mockFrom = jest.fn((table: string) => {
    if (table === "journal_entries") {
      // Primer uso: SELECT para verificar ownership y montos
      // Segundo uso: DELETE del entry
      let callCount = 0;
      const handler = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(
          fetchError
            ? { data: null, error: { message: "not found" } }
            : { data: entry, error: entry ? null : { message: "not found" } }
        ),
        delete: jest.fn().mockReturnThis(),
      };

      // Para el DELETE del entry, el .eq().eq() final resuelve el resultado
      const deleteChain = {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockResolvedValue(
            entryDeleteError ? { error: { message: "DB error" } } : { error: null }
          ),
        })),
      };

      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue(
            fetchError || !entry
              ? { data: null, error: { message: "not found" } }
              : { data: entry, error: null }
          ),
        }),
        delete: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue(
              entryDeleteError ? { error: { message: "DB error" } } : { error: null }
            ),
          }),
        }),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    }

    if (table === "journal_detail") {
      return {
        delete: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue(
            detailDeleteError ? { error: { message: "FK error" } } : { error: null }
          ),
        }),
      };
    }

    return {};
  });

  return { from: mockFrom };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/contabilidad/asientos/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({
      storeId: STORE_ID,
      userId: "user-001",
    });
  });

  // A-DEL-01
  it("A-DEL-01: retorna 401 cuando no hay sesión autenticada", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/contabilidad/asientos/[id]/route");
    const res = await DELETE(makeRequest(ENTRY_ID), makeParams(ENTRY_ID));
    expect(res.status).toBe(401);
  });

  // A-DEL-02
  it("A-DEL-02: retorna 404 cuando el asiento no existe en el store", async () => {
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(
      makeDb({ entry: null })
    );
    const { DELETE } = await import("@/app/api/contabilidad/asientos/[id]/route");
    const res = await DELETE(makeRequest(ENTRY_ID), makeParams(ENTRY_ID));
    expect(res.status).toBe(404);
  });

  // A-DEL-03 — REGRESIÓN: no se puede eliminar un asiento con movimiento económico
  it(
    "A-DEL-03: retorna 409 cuando el asiento tiene montos no cero " +
      "(protege contra eliminación accidental de asientos válidos)",
    async () => {
      const entryConMonto = {
        id: ENTRY_ID,
        numero_asiento: 10,
        total_debito: 15000,
        total_credito: 15000,
        descripcion: "Venta efectivo",
      };
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(
        makeDb({ entry: entryConMonto })
      );
      const { DELETE } = await import("@/app/api/contabilidad/asientos/[id]/route");
      const res = await DELETE(makeRequest(ENTRY_ID), makeParams(ENTRY_ID));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toMatch(/movimiento económico/i);
    }
  );

  // A-DEL-04 — caso principal: elimina un asiento $0/$0 y sus detalles
  it(
    "A-DEL-04: REGRESIÓN — elimina asiento $0/$0 (tipo asiento #43 'Pago proveedor' " +
      "con monto=0) y devuelve ok:true",
    async () => {
      const entryZero = {
        id: ENTRY_ID,
        numero_asiento: 43,
        total_debito: 0,
        total_credito: 0,
        descripcion: "Pago a Proveedor ABC — $0",
      };
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(
        makeDb({ entry: entryZero })
      );
      const { DELETE } = await import("@/app/api/contabilidad/asientos/[id]/route");
      const res = await DELETE(makeRequest(ENTRY_ID), makeParams(ENTRY_ID));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    }
  );

  // A-DEL-05
  it("A-DEL-05: retorna 500 cuando falla la eliminación de journal_detail", async () => {
    const entryZero = {
      id: ENTRY_ID,
      numero_asiento: 43,
      total_debito: 0,
      total_credito: 0,
      descripcion: "Pago proveedor sin monto",
    };
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue(
      makeDb({ entry: entryZero, detailDeleteError: true })
    );
    const { DELETE } = await import("@/app/api/contabilidad/asientos/[id]/route");
    const res = await DELETE(makeRequest(ENTRY_ID), makeParams(ENTRY_ID));
    expect(res.status).toBe(500);
  });
});
