/**
 * Tests I-104 a I-109, I-739: POST /api/webhooks/clerk
 */
import { NextRequest } from "next/server";

const CLERK_WEBHOOK_SECRET = "whsec_test_secret_12345678901234567890";

const mockVerify = jest.fn();
const mockFrom = jest.fn();
const mockUpsert = jest.fn();
const mockDelete = jest.fn();
const mockGetUser = jest.fn();

jest.mock("svix", () => ({
  Webhook: jest.fn().mockImplementation(() => ({ verify: mockVerify })),
}));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
// after() (usado por withErrorLogging en los 500) exige request scope.
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: jest.fn(),
}));
jest.mock("@clerk/nextjs/server", () => ({
  clerkClient: jest.fn(async () => ({ users: { getUser: mockGetUser } })),
}));

// Estado ACTUAL del usuario en Clerk (lo que devuelve users.getUser).
function clerkUser(o: {
  id: string; firstName?: string | null; lastName?: string | null;
  email?: string; publicMetadata?: Record<string, unknown>;
}) {
  return {
    id: o.id,
    firstName: o.firstName ?? null,
    lastName: o.lastName ?? null,
    emailAddresses: o.email ? [{ emailAddress: o.email }] : [],
    publicMetadata: o.publicMetadata ?? {},
    banned: false,
  };
}

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
    mockFrom.mockImplementation(makeFrom());
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
    mockGetUser.mockResolvedValue(clerkUser({
      id: "user_abc", email: "test@example.com",
      publicMetadata: { storeAdmin: true, storeId: "store_xyz" },
    }));
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
    mockGetUser.mockResolvedValue(clerkUser({
      id: event.data.id, firstName: event.data.first_name, lastName: event.data.last_name,
      email: event.data.email_addresses[0].email_address,
      publicMetadata: event.data.public_metadata,
    }));
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
    mockGetUser.mockResolvedValue(clerkUser({
      id: event.data.id, firstName: event.data.first_name, lastName: event.data.last_name,
      email: event.data.email_addresses[0].email_address,
      publicMetadata: event.data.public_metadata,
    }));
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
    mockGetUser.mockResolvedValue(clerkUser({
      id: event.data.id, firstName: event.data.first_name, lastName: event.data.last_name,
      email: event.data.email_addresses[0].email_address,
      publicMetadata: event.data.public_metadata,
    }));
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

  // I-739: REGRESIÓN — Clerk no garantiza el orden de los webhooks. Al crear un
  // usuario desde /admin, el user.created (sin metadata) llegó DESPUÉS del
  // user.updated y pisó store_id/rol con null: el usuario desapareció del
  // listado (mascotaspetshop, 2026-10-12). El webhook escribe el estado actual
  // de Clerk, no el del evento.
  describe("I-739: usa el estado actual de Clerk, no el del evento", () => {
    function post(event: object) {
      mockVerify.mockReturnValue(event);
      return import("@/app/api/webhooks/clerk/route").then(({ POST }) =>
        POST(new NextRequest("http://localhost/api/webhooks/clerk", {
          method: "POST", headers: svixHeaders(), body: JSON.stringify(event),
        })));
    }
    const eventoCreadoViejo = {
      type: "user.created",
      data: {
        id: "user_nuevo", first_name: "Sucursal", last_name: "Dos",
        email_addresses: [{ email_address: "nuevo@test.com" }],
        public_metadata: {},
      },
    };

    it("I-739: user.created atrasado sin metadata → conserva store_id y rol actuales", async () => {
      mockGetUser.mockResolvedValue(clerkUser({
        id: "user_nuevo", firstName: "Sucursal", lastName: "Dos", email: "nuevo@test.com",
        publicMetadata: { storeId: "store_xyz", storeWorker: true, storeAdmin: false },
      }));
      const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
      mockFrom.mockReturnValue({ upsert });

      const res = await post(eventoCreadoViejo);

      expect(res.status).toBe(200);
      expect(mockGetUser).toHaveBeenCalledWith("user_nuevo");
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          clerk_id: "user_nuevo", store_id: "store_xyz",
          store_worker: true, store_admin: false, system_admin: false,
        }),
        { onConflict: "clerk_id" },
      );
    });

    it("I-739: usuario ya borrado en Clerk (404) → 200 sin recrear la fila", async () => {
      const { ClerkAPIResponseError } = await import("@clerk/nextjs/errors");
      mockGetUser.mockRejectedValue(new ClerkAPIResponseError("Not Found", { data: [], status: 404 }));
      const upsert = jest.fn();
      mockFrom.mockReturnValue({ upsert });

      const res = await post(eventoCreadoViejo);

      expect(res.status).toBe(200);
      expect(upsert).not.toHaveBeenCalled();
    });

    it("I-739: Clerk no responde → 500 (Svix reintenta) sin escribir datos del evento", async () => {
      mockGetUser.mockRejectedValue(new Error("network down"));
      const upsert = jest.fn();
      mockFrom.mockReturnValue({ upsert });

      const res = await post(eventoCreadoViejo);

      expect(res.status).toBe(500);
      expect(upsert).not.toHaveBeenCalled();
    });

    it("I-739: falla el upsert en clerk_users → 500 para que Svix reintente", async () => {
      mockGetUser.mockResolvedValue(clerkUser({ id: "user_nuevo", email: "nuevo@test.com" }));
      mockFrom.mockReturnValue({
        upsert: jest.fn().mockResolvedValue({ data: null, error: { message: "db down" } }),
      });

      const res = await post(eventoCreadoViejo);

      expect(res.status).toBe(500);
    });
  });
});
