/**
 * Tests I-564 a I-571: POST /api/lotes/[id]/merma — merma por vencimiento
 * (D23, Fase 1 de docs/canales-stock/stock_canales_externos.md, RPC merma_lote_vencido de la
 * migración 076).
 *
 * admin-check es el REAL: solo se simula la sesión Clerk. La semántica en BD
 * (activo=false sin DELETE, movimiento 'merma' con usuario, rechazo de lotes
 * no vencidos) se verifica con docs/canales-stock/stock_canales_fase1_verificacion.sql.
 */
import { NextRequest } from "next/server";

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return { ...actual, after: jest.fn((cb: () => void) => cb()) };
});

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const LOTE_ID = "123e4567-e89b-12d3-a456-426614174020";

const mockGetStoreId = jest.fn();
const mockAuth = jest.fn();
const mockRpc = jest.fn();
const mockLogAudit = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: () => mockGetStoreId() }));
jest.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ rpc: mockRpc }) }));
jest.mock("@/lib/audit", () => ({
  withErrorLogging: (h: unknown) => h,
  logAudit: (...a: unknown[]) => mockLogAudit(...a),
  getRequestMetadata: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

import { POST } from "@/app/api/lotes/[id]/merma/route";

async function post(body?: object, id = LOTE_ID) {
  const request = new NextRequest(`http://localhost/api/lotes/${id}/merma`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  mockAuth.mockResolvedValue({ sessionClaims: { sub: "u1", publicMetadata: { storeId: STORE_ID, storeAdmin: true } } });
  mockLogAudit.mockResolvedValue(undefined);
  mockRpc.mockResolvedValue({
    data: { lote: { id: LOTE_ID, numero_lote: "LOTE-3", activo: false }, cantidad_baja: 85 },
    error: null,
  });
});

describe("POST /api/lotes/[id]/merma", () => {
  it("I-564: admin da de baja un lote vencido → 200, RPC con tenant y usuario, auditoría", async () => {
    const res = await post({ motivo: "Vencido en bodega" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lote: { id: LOTE_ID, numero_lote: "LOTE-3", activo: false }, cantidad_baja: 85 });
    expect(mockRpc).toHaveBeenCalledWith("merma_lote_vencido", {
      p_store_id: STORE_ID,
      p_lote_id: LOTE_ID,
      p_motivo: "Vencido en bodega",
      p_user_id: "u1",
    });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "lote_producto",
      entityId: LOTE_ID,
      changeDescription: 'Merma por vencimiento: lote "LOTE-3" dado de baja (85 unidades)',
    }));
  });

  it("I-565: sin body (motivo opcional) → 200 con p_motivo null", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("merma_lote_vencido", expect.objectContaining({ p_motivo: null }));
  });

  it("I-566: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    expect((await post({})).status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // D23: solo storeAdmin/systemAdmin.
  it("I-567: storeWorker → 403", async () => {
    mockAuth.mockResolvedValue({ sessionClaims: { sub: "w1", publicMetadata: { storeId: STORE_ID } } });
    expect((await post({})).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // IDOR: lote de otra tienda → el RPC filtra por store_id → 404 genérico.
  it("I-568: lote de otra tienda → 404 genérico", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: `Lote no encontrado: ${LOTE_ID}` } });
    const res = await post({});
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Lote no encontrado" });
  });

  it("I-569: lote no vencido → 409 con el mensaje de la BD", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "El lote no está vencido (vence 2027-01-01)" } });
    const res = await post({});
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no está vencido/);
  });

  it("I-570: lote ya dado de baja → 409", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "El lote ya está dado de baja" } });
    expect((await post({})).status).toBe(409);
  });

  it("I-571: id no UUID → 404 sin llamar a la BD; motivo > 255 → 400", async () => {
    expect((await post({}, "abc")).status).toBe(404);
    expect((await post({ motivo: "x".repeat(256) })).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
