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
