/**
 * Tests I-104 a I-106: POST /api/webhooks/clerk
 */
import { NextRequest } from "next/server";

const CLERK_WEBHOOK_SECRET = "whsec_test_secret_12345678901234567890";

const mockVerify = jest.fn();
const mockFrom = jest.fn();
const mockUpsert = jest.fn();
const mockDelete = jest.fn();

jest.mock("svix", () => ({
  Webhook: jest.fn().mockImplementation(() => ({ verify: mockVerify })),
}));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

function svixHeaders() {
  return {
    "svix-id": "msg_123",
    "svix-timestamp": "1234567890",
    "svix-signature": "v1,sig",
  };
}

function makeFrom() {
  return jest.fn(() => ({
    upsert: mockUpsert.mockReturnThis(),
    delete: mockDelete.mockReturnThis(),
    eq: jest.fn().mockResolvedValue({ data: null, error: null }),
  }));
}

describe("POST /api/webhooks/clerk", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLERK_WEBHOOK_SECRET = CLERK_WEBHOOK_SECRET;
    mockFrom.mockImplementation(makeFrom()());
  });

  // I-104
  it("I-104: sin headers svix → 400", async () => {
    const { POST } = await import("@/app/api/webhooks/clerk/route");
    const res = await POST(new NextRequest("http://localhost/api/webhooks/clerk", {
      method: "POST",
      body: JSON.stringify({ type: "user.created", data: {} }),
    }));
    expect(res.status).toBe(400);
  });

  // I-105
  it("I-105: user.created → upsert en clerk_users", async () => {
    const event = {
      type: "user.created",
      data: {
        id: "user_abc",
        email_addresses: [{ email_address: "test@example.com" }],
        public_metadata: { storeAdmin: true, storeId: "store_xyz" },
      },
    };
    mockVerify.mockReturnValue(event);
    mockFrom.mockReturnValue({
      upsert: mockUpsert.mockResolvedValue({ data: null, error: null }),
    });
    const { POST } = await import("@/app/api/webhooks/clerk/route");
    const res = await POST(new NextRequest("http://localhost/api/webhooks/clerk", {
      method: "POST",
      headers: svixHeaders(),
      body: JSON.stringify(event),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(mockUpsert).toHaveBeenCalled();
  });

  // I-107: REGRESIÓN — user.created con nombre en Clerk debe sincronizar nombre en clerk_users.
  // Bug original: first_name/last_name no se extraían del payload, nombre quedaba null
  // y el vendedor aparecía como "elfomaster@gmail.com" en el dropdown del POS.
  it("I-107: user.created con first_name y last_name → upsert incluye nombre", async () => {
    const event = {
      type: "user.created",
      data: {
        id: "user_pablo",
        first_name: "Pablo",
        last_name: "Vera",
        email_addresses: [{ email_address: "pablo@test.com" }],
        public_metadata: { storeWorker: true, storeId: "store_xyz" },
      },
    };
    mockVerify.mockReturnValue(event);
    const capturedPayload: unknown[] = [];
    mockFrom.mockReturnValue({
      upsert: jest.fn((data) => { capturedPayload.push(data); return Promise.resolve({ data: null, error: null }); }),
    });
    const { POST } = await import("@/app/api/webhooks/clerk/route");
    const res = await POST(new NextRequest("http://localhost/api/webhooks/clerk", {
      method: "POST",
      headers: svixHeaders(),
      body: JSON.stringify(event),
    }));
    expect(res.status).toBe(200);
    expect(capturedPayload[0]).toMatchObject({ nombre: "Pablo Vera" });
  });

  // I-108: REGRESIÓN — user.created sin nombre en Clerk NO debe pasar nombre al upsert
  // (evita sobreescribir un nombre existente con null en updates subsiguientes).
  it("I-108: user.created sin nombre en Clerk → upsert NO incluye clave nombre", async () => {
    const event = {
      type: "user.created",
      data: {
        id: "user_noname",
        first_name: null,
        last_name: null,
        email_addresses: [{ email_address: "noname@test.com" }],
        public_metadata: { storeWorker: true, storeId: "store_xyz" },
      },
    };
    mockVerify.mockReturnValue(event);
    const capturedPayload: unknown[] = [];
    mockFrom.mockReturnValue({
      upsert: jest.fn((data) => { capturedPayload.push(data); return Promise.resolve({ data: null, error: null }); }),
    });
    const { POST } = await import("@/app/api/webhooks/clerk/route");
    const res = await POST(new NextRequest("http://localhost/api/webhooks/clerk", {
      method: "POST",
      headers: svixHeaders(),
      body: JSON.stringify(event),
    }));
    expect(res.status).toBe(200);
    expect(capturedPayload[0]).not.toHaveProperty("nombre");
  });

  // I-109: user.updated con nombre → nombre se actualiza en clerk_users.
  it("I-109: user.updated con first_name y last_name → upsert incluye nombre actualizado", async () => {
    const event = {
      type: "user.updated",
      data: {
        id: "user_pablo",
        first_name: "Pablo",
        last_name: "Vera",
        email_addresses: [{ email_address: "pablo@test.com" }],
        public_metadata: { storeWorker: true, storeId: "store_xyz" },
      },
    };
    mockVerify.mockReturnValue(event);
    const capturedPayload: unknown[] = [];
    mockFrom.mockReturnValue({
      upsert: jest.fn((data) => { capturedPayload.push(data); return Promise.resolve({ data: null, error: null }); }),
    });
    const { POST } = await import("@/app/api/webhooks/clerk/route");
    const res = await POST(new NextRequest("http://localhost/api/webhooks/clerk", {
      method: "POST",
      headers: svixHeaders(),
      body: JSON.stringify(event),
    }));
    expect(res.status).toBe(200);
    expect(capturedPayload[0]).toMatchObject({ nombre: "Pablo Vera" });
  });

  // I-106
  it("I-106: user.deleted → delete de clerk_users", async () => {
    const event = {
      type: "user.deleted",
      data: {
        id: "user_abc",
        email_addresses: [],
        public_metadata: {},
      },
    };
    mockVerify.mockReturnValue(event);
    const eqMock = jest.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({
      delete: jest.fn().mockReturnValue({ eq: eqMock }),
    });
    const { POST } = await import("@/app/api/webhooks/clerk/route");
    const res = await POST(new NextRequest("http://localhost/api/webhooks/clerk", {
      method: "POST",
      headers: svixHeaders(),
      body: JSON.stringify(event),
    }));
    expect(res.status).toBe(200);
    expect(eqMock).toHaveBeenCalledWith("clerk_id", "user_abc");
  });
});
