/**
 * Tests adicionales: Clerk webhook session.created
 * I-251 a I-252
 */
import { NextRequest } from "next/server";

const CLERK_WEBHOOK_SECRET = "whsec_test_secret_12345678901234567890";

const mockVerify = jest.fn();
const mockFrom = jest.fn();
const mockInsert = jest.fn();
const mockSelect = jest.fn();

jest.mock("svix", () => ({
  Webhook: jest.fn().mockImplementation(() => ({ verify: mockVerify })),
}));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom })),
}));

function svixHeaders() {
  return {
    "svix-id": "msg_123",
    "svix-timestamp": "1234567890",
    "svix-signature": "v1,sig",
  };
}

describe("POST /api/webhooks/clerk — session.created", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLERK_WEBHOOK_SECRET = CLERK_WEBHOOK_SECRET;
  });

  // I-251
  it("I-251: session.created → inserta en user_sessions", async () => {
    const event = {
      type: "session.created",
      data: { user_id: "user_abc", id: "sess_xyz123" },
    };
    mockVerify.mockReturnValue(event);

    const singleMock = jest.fn().mockResolvedValue({ data: { store_id: "store_xyz" }, error: null });
    const eqMock = jest.fn().mockReturnValue({ single: singleMock });
    const selectChain = { eq: eqMock };
    mockFrom.mockImplementation((table: string) => {
      if (table === "clerk_users") return { select: mockSelect.mockReturnValue(selectChain) };
      return { insert: mockInsert.mockResolvedValue({ error: null }) };
    });
    mockSelect.mockReturnValue(selectChain);

    const { POST } = await import("@/app/api/webhooks/clerk/route");
    const res = await POST(
      new NextRequest("http://localhost/api/webhooks/clerk", {
        method: "POST",
        headers: svixHeaders(),
        body: JSON.stringify(event),
      })
    );

    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalled();
  });

  // I-252
  it("I-252: session.created sin clerk_user → no inserta", async () => {
    const event = {
      type: "session.created",
      data: { user_id: "unknown_user", id: "sess_unknown" },
    };
    mockVerify.mockReturnValue(event);

    const singleMock = jest.fn().mockResolvedValue({ data: null, error: null });
    const eqMock = jest.fn().mockReturnValue({ single: singleMock });
    const selectChain = { eq: eqMock };
    mockFrom.mockImplementation((table: string) => {
      if (table === "clerk_users") return { select: mockSelect.mockReturnValue(selectChain) };
      return { insert: mockInsert.mockResolvedValue({ error: null }) };
    });
    mockSelect.mockReturnValue(selectChain);

    const { POST } = await import("@/app/api/webhooks/clerk/route");
    const res = await POST(
      new NextRequest("http://localhost/api/webhooks/clerk", {
        method: "POST",
        headers: svixHeaders(),
        body: JSON.stringify(event),
      })
    );

    expect(res.status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
