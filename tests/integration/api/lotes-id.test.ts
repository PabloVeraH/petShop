/**
 * Tests I-473/I-474: PATCH, DELETE /api/lotes/[id]
 * Sin cobertura previa para este endpoint — se agrega junto con el fix del
 * ticket Trello 6a62eb37bfe280fc94919d5e (changeDescription ausente en el
 * audit log de "lote_producto"/"lotes_producto").
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const LOTE_ID = "123e4567-e89b-12d3-a456-426614174020";

const mockGetStoreId = jest.fn();
const mockAuth = jest.fn();
const mockGetAdminStatus = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
jest.mock("@/lib/admin-check", () => ({ getAdminStatus: mockGetAdminStatus }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn().mockReturnValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
  getChangedFields: jest.requireActual("@/lib/audit").getChangedFields,
}));

import { PATCH, DELETE } from "@/app/api/lotes/[id]/route";

function req(method: string, body?: object) {
  return new NextRequest(`http://localhost/api/lotes/${LOTE_ID}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

const idParams = Promise.resolve({ id: LOTE_ID });

const LOTE_EXISTENTE = {
  id: LOTE_ID,
  store_id: STORE_ID,
  producto_id: "prod-1",
  numero_lote: "LOTE-A",
  cantidad_inicial: 20,
  cantidad_actual: 20,
  fecha_vencimiento: "2026-12-01",
  activo: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStoreId.mockResolvedValue({ userId: "user-1", storeId: STORE_ID });
  mockAuth.mockResolvedValue({ sessionClaims: { publicMetadata: { storeAdmin: true } } });
  mockGetAdminStatus.mockReturnValue({ isStoreAdmin: true, isSystemAdmin: false });
});

describe("PATCH /api/lotes/[id]", () => {
  // I-473 — MEJORA (ticket Trello 6a62eb37bfe280fc94919d5e): mismo defecto
  // que "lotes_producto" en ordenes-compra/[id]/route.ts — changeDescription
  // ausente en este llamador de logAudit (mismo helper compartido).
  it("I-473: audit log de edición de lote incluye changeDescription con los campos cambiados", async () => {
    const actualizado = { ...LOTE_EXISTENTE, cantidad_actual: 15 };
    let lotesCalls = 0;

    // supabase.from("lotes_producto") se llama dos veces en el PATCH real
    // (SELECT existing, luego UPDATE...select().single()) — mockImplementation
    // crea un objeto nuevo por cada llamada a .from(), así que hay que
    // distinguir por orden de invocación, no encadenar mockResolvedValueOnce
    // sobre un único mock (ese "single" nunca se reutiliza entre llamadas).
    mockFrom.mockImplementation((table: string) => {
      if (table === "lotes_producto") {
        lotesCalls++;
        const data = lotesCalls === 1 ? LOTE_EXISTENTE : actualizado;
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data, error: null }),
        };
      }
      return {};
    });

    const { logAudit } = await import("@/lib/audit");
    const res = await PATCH(req("PATCH", { cantidad_actual: 15 }), { params: idParams });

    expect(res.status).toBe(200);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "lote_producto",
        changeDescription: expect.stringContaining("cantidad_actual: 20 → 15"),
        ipAddress: "127.0.0.1",
        userAgent: "test",
      })
    );
  });

  it("sin admin → 403", async () => {
    mockGetAdminStatus.mockReturnValue({ isStoreAdmin: false, isSystemAdmin: false });
    const res = await PATCH(req("PATCH", { cantidad_actual: 5 }), { params: idParams });
    expect(res.status).toBe(403);
  });

  it("lote no encontrado → 404", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "lotes_producto") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
        };
      }
      return {};
    });

    const res = await PATCH(req("PATCH", { cantidad_actual: 5 }), { params: idParams });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/lotes/[id]", () => {
  // I-474 — MEJORA (ticket Trello 6a62eb37bfe280fc94919d5e): mismo defecto.
  it("I-474: audit log de desactivación de lote incluye changeDescription con el número de lote", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "lotes_producto") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: LOTE_EXISTENTE, error: null }),
        };
      }
      return {};
    });

    const { logAudit } = await import("@/lib/audit");
    const res = await DELETE(req("DELETE"), { params: idParams });

    expect(res.status).toBe(200);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "lote_producto",
        changeDescription: 'Lote "LOTE-A" desactivado',
        ipAddress: "127.0.0.1",
        userAgent: "test",
      })
    );
  });

  it("sin admin → 403", async () => {
    mockGetAdminStatus.mockReturnValue({ isStoreAdmin: false, isSystemAdmin: false });
    const res = await DELETE(req("DELETE"), { params: idParams });
    expect(res.status).toBe(403);
  });
});
