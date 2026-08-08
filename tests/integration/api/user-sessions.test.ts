/**
 * Tests I-245 a I-248: GET /api/user-sessions
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

describe("GET /api/user-sessions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // I-245
  it("I-245: GET user-sessions sin auth → 401", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    mockFrom.mockReturnValue(makeChain());
    const { GET } = await import("@/app/api/user-sessions/route");
    const res = await GET(new NextRequest("http://localhost/api/user-sessions"));
    expect(res.status).toBe(401);
  });

  // I-246
  it("I-246: storeAdmin → 200 filtrado a su tienda", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
    mockFrom.mockReturnValue(makeChain([{ id: "sess-1", user_id: "user-1", event_type: "session.created" }], 1));

    const { GET } = await import("@/app/api/user-sessions/route");
    const res = await GET(new NextRequest("http://localhost/api/user-sessions"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.count).toBe(1);
  });

  // I-247
  it("I-247: filtro event_type funciona", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    const chain = makeChain([], 0);
    mockFrom.mockReturnValue(chain);

    const { GET } = await import("@/app/api/user-sessions/route");
    await GET(new NextRequest("http://localhost/api/user-sessions?event_type=session.created"));

    expect(chain.eq).toHaveBeenCalledWith("event_type", "session.created");
  });

  // I-248
  it("I-248: systemAdmin puede filtrar por store_id externo", async () => {
    const externalStoreId = "999e4567-e89b-12d3-a456-426614174099";
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    const chain = makeChain([], 0);
    mockFrom.mockReturnValue(chain);

    const { GET } = await import("@/app/api/user-sessions/route");
    await GET(new NextRequest(`http://localhost/api/user-sessions?store_id=${externalStoreId}`));

    expect(chain.eq).toHaveBeenCalledWith("store_id", externalStoreId);
  });

  // I-488
  it("I-488: filtro event_type=session.removed es un evento real y funciona", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    const chain = makeChain([], 0);
    mockFrom.mockReturnValue(chain);

    const { GET } = await import("@/app/api/user-sessions/route");
    const res = await GET(new NextRequest("http://localhost/api/user-sessions?event_type=session.removed"));

    expect(res.status).toBe(200);
    expect(chain.eq).toHaveBeenCalledWith("event_type", "session.removed");
  });

  // I-489
  it("I-489: REGRESIÓN (ticket 6a76c9994e8b17f267f71641) — event_type=session.ended se rechaza con 400", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    mockFrom.mockReturnValue(makeChain());

    const { GET } = await import("@/app/api/user-sessions/route");
    const res = await GET(new NextRequest("http://localhost/api/user-sessions?event_type=session.ended"));

    expect(res.status).toBe(400);
  });
});
