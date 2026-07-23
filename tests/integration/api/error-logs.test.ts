/**
 * Tests I-239 a I-244: GET/PATCH /api/error-logs
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const USER_ID = "user_admin";

const mockAuth = jest.fn();
const mockFrom = jest.fn();

jest.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
}));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom })),
}));

function makeChain(data: unknown[] = [], count: number = 0) {
  const chain: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { system_admin: true }, error: null }),
    throwOnError: jest.fn().mockResolvedValue({ data, error: null, count }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.gte.mockReturnValue(chain);
  chain.lte.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.range.mockReturnValue(chain);
  return chain;
}

describe("GET /api/error-logs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // I-239
  it("I-239: GET error-logs sin auth → 401", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    mockFrom.mockReturnValue(makeChain());
    const { GET } = await import("@/app/api/error-logs/route");
    const res = await GET(new NextRequest("http://localhost/api/error-logs"));
    expect(res.status).toBe(401);
  });

  // I-240
  it("I-240: storeAdmin → 200 con datos filtrados a su tienda", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
    mockFrom.mockReturnValue(makeChain([{ id: "err-1", error_message: "Test error", severity: "ERROR" }], 1));

    const { GET } = await import("@/app/api/error-logs/route");
    const res = await GET(new NextRequest("http://localhost/api/error-logs"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.count).toBe(1);
  });

  // I-241
  it("I-241: filtro severity funciona", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    const chain = makeChain([], 0);
    mockFrom.mockReturnValue(chain);

    const { GET } = await import("@/app/api/error-logs/route");
    await GET(new NextRequest("http://localhost/api/error-logs?severity=CRITICAL"));

    expect(chain.eq).toHaveBeenCalledWith("severity", "CRITICAL");
  });

  // I-242
  it("I-242: filtro resolved=false funciona", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
    const chain = makeChain([], 0);
    mockFrom.mockReturnValue(chain);

    const { GET } = await import("@/app/api/error-logs/route");
    await GET(new NextRequest("http://localhost/api/error-logs?resolved=false"));

    expect(chain.eq).toHaveBeenCalledWith("resolved", false);
  });
});

describe("PATCH /api/error-logs/[id]/resolve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // I-243
  it("I-243: PATCH error-logs/[id]/resolve → marca resuelto", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
    const updateMock = jest.fn().mockReturnThis();
    const eqMock = jest.fn().mockReturnThis();
    const selectMock = jest.fn().mockReturnThis();
    const singleMock = jest.fn().mockResolvedValue({
      data: { id: "err-1", resolved: true, resolved_at: "2026-05-20T10:00:00Z", resolved_by: USER_ID },
      error: null,
    });
    const chain = { update: updateMock, eq: eqMock, select: selectMock, single: singleMock };
    updateMock.mockReturnValue(chain);
    eqMock.mockReturnValue(chain);
    selectMock.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);

    const { PATCH } = await import("@/app/api/error-logs/[id]/resolve/route");
    const res = await PATCH(
      new NextRequest("http://localhost/api/error-logs/err-1/resolve"),
      { params: Promise.resolve({ id: "err-1" }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({
      resolved: true,
      resolved_at: expect.any(String),
      resolved_by: USER_ID,
    });
  });

  // I-244
  it("I-244: PATCH error-logs/[id]/resolve por no-admin → 403", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeWorker: true, storeId: STORE_ID } },
    });
    mockFrom.mockReturnValue(makeChain());

    const { PATCH } = await import("@/app/api/error-logs/[id]/resolve/route");
    const res = await PATCH(
      new NextRequest("http://localhost/api/error-logs/err-1/resolve"),
      { params: Promise.resolve({ id: "err-1" }) }
    );

    expect(res.status).toBe(403);
  });
});
