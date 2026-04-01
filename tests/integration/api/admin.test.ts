/**
 * Tests I-92 a I-95: GET /api/admin/stores, POST /api/admin/users
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const USER_ID = "user_clerk_admin";

const mockAuth = jest.fn();
const mockClerkClient = jest.fn();
const mockFrom = jest.fn();

jest.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  clerkClient: mockClerkClient,
}));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

function chain(data: unknown[] = []) {
  const resolved = Promise.resolve({ data, error: null });
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
    then: jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data, error: null })
    ),
  };
  ["select","eq","order","upsert"].forEach(k => c[k].mockReturnValue(c));
  c.order = jest.fn().mockReturnValue(resolved);
  return c;
}

describe("GET /api/admin/stores", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(chain());
  });

  // I-92
  it("I-92: sin rol systemAdmin → 403", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: false } },
    });
    const { GET } = await import("@/app/api/admin/stores/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  // I-93
  it("I-93: con systemAdmin → 200 y lista stores", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    mockFrom.mockReturnValue(chain([{ id: STORE_ID, name: "Store A" }]));
    const { GET } = await import("@/app/api/admin/stores/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("POST /api/admin/users", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    mockFrom.mockReturnValue(chain());
  });

  // I-94
  it("I-94: rol inválido → 400", async () => {
    mockClerkClient.mockResolvedValue({
      users: { getUserList: jest.fn(), updateUserMetadata: jest.fn() },
    });
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", storeId: STORE_ID, role: "superAdmin" }),
    }));
    expect(res.status).toBe(400);
  });

  // I-95
  it("I-95: rol válido → 200 y Clerk actualizado", async () => {
    const mockUpdateUserMetadata = jest.fn().mockResolvedValue({});
    mockClerkClient.mockResolvedValue({
      users: {
        getUserList: jest.fn().mockResolvedValue({ data: [{ id: "clerk_target" }] }),
        updateUserMetadata: mockUpdateUserMetadata,
      },
    });
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "worker@store.com", storeId: STORE_ID, role: "storeWorker" }),
    }));
    expect(res.status).toBe(200);
    expect(mockUpdateUserMetadata).toHaveBeenCalled();
  });
});
