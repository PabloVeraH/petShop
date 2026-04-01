/**
 * Tests I-90 a I-91: POST /api/onboarding/complete
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const USER_ID = "user_clerk_123";

const mockAuth = jest.fn();
const mockClerkClient = jest.fn();
const mockFrom = jest.fn();
const mockSingle = jest.fn();

jest.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  clerkClient: mockClerkClient,
}));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

function chain() {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    insert: jest.fn(),
    upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
    eq: jest.fn(),
    single: mockSingle,
  };
  ["select","insert","upsert","eq"].forEach(k => c[k].mockReturnValue(c));
  return c;
}

function makeClerkClient() {
  return {
    users: {
      getUser: jest.fn().mockResolvedValue({
        emailAddresses: [{ emailAddress: "test@example.com" }],
      }),
      updateUserMetadata: jest.fn().mockResolvedValue({}),
    },
  };
}

function req(body: object) {
  return new NextRequest("http://localhost/api/onboarding/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/onboarding/complete", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockClerkClient.mockResolvedValue(makeClerkClient());
    mockFrom.mockReturnValue(chain());
  });

  // I-90
  it("I-90: usuario ya tiene store → 409", async () => {
    mockSingle.mockResolvedValue({
      data: { store_id: STORE_ID },
      error: null,
    });
    const { POST } = await import("@/app/api/onboarding/complete/route");
    const res = await POST(req({ storeName: "Mi Tienda" }));
    expect(res.status).toBe(409);
  });

  // I-91
  it("I-91: primera vez → crea store y retorna 200 con storeId", async () => {
    // First single() call: no existing user (clerk_users lookup)
    // Second single() call: newly created store
    mockSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: STORE_ID, name: "Mi Tienda" }, error: null });
    const { POST } = await import("@/app/api/onboarding/complete/route");
    const res = await POST(req({ storeName: "Mi Tienda" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("storeId");
  });
});
