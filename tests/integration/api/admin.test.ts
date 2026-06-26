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
    single: jest.fn().mockResolvedValue({ data: data[0] ?? null, error: null }),
    then: jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data, error: null })
    ),
  };
  ["select","eq","order","upsert","single"].forEach(k => c[k].mockReturnValue(c));
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

  // I-96: REGRESIÓN — asignar usuario sin lastName en Clerk NO debe pasar nombre:null al upsert.
  // Bug original: firstName && lastName requería ambos; si faltaba uno, nombre=null se pasaba
  // explícitamente al upsert sobreescribiendo un nombre previo en clerk_users.
  it("I-96: Clerk user sin lastName → upsert NO incluye clave nombre (no sobreescribe existente)", async () => {
    const capturedPayload: unknown[] = [];
    const mockUpsertCapture = jest.fn((data) => {
      capturedPayload.push(data);
      return Promise.resolve({ data: null, error: null });
    });
    mockFrom.mockReturnValue({ upsert: mockUpsertCapture });
    mockClerkClient.mockResolvedValue({
      users: {
        getUserList: jest.fn().mockResolvedValue({
          data: [{ id: "clerk_pablo", firstName: "Pablo", lastName: null }],
        }),
        updateUserMetadata: jest.fn().mockResolvedValue({}),
      },
    });
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "pablo@store.com", storeId: STORE_ID, role: "storeWorker" }),
    }));
    expect(res.status).toBe(200);
    // firstName="Pablo", lastName=null → nombre="Pablo" (no null) → incluido en upsert
    expect(capturedPayload[0]).toMatchObject({ nombre: "Pablo" });
  });

  // I-290: storeAdmin GET stores → 200 con su propia tienda
  it("I-290: storeAdmin → GET stores devuelve su propia tienda", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });

    const mockSingle = jest.fn().mockResolvedValue({
      data: { id: STORE_ID, name: "Mi Tienda", rut: null, email: null, phone: null, created_at: "2024-01-01", whatsapp_enabled: false, openrouter_model: null },
      error: null,
    });
    const mockThen = jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [{ store_id: STORE_ID }], error: null })
    );
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();

    mockFrom.mockReturnValue({ select: mockSelect, eq: mockEq, single: mockSingle, then: mockThen });

    const { GET } = await import("@/app/api/admin/stores/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(STORE_ID);
    expect(body[0].name).toBe("Mi Tienda");
  });

  // I-291: storeAdmin GET users → 200 con usuarios de su tienda
  it("I-291: storeAdmin → GET users devuelve usuarios de su tienda", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });

    const users = [
      { clerk_id: "u1", email: "a@store.com", nombre: "Alice", store_admin: true, store_worker: false, system_admin: false },
    ];
    const mockThen = jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: users, error: null })
    );
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockOrder = jest.fn().mockReturnThis();

    mockFrom.mockReturnValue({ select: mockSelect, eq: mockEq, order: mockOrder, then: mockThen, single: jest.fn() });

    const { GET } = await import("@/app/api/admin/users/route");
    const res = await GET(new NextRequest("http://localhost/api/admin/users?storeId=other-store-id"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);

    // storeAdmin debe ignorar el storeId del query param y usar el propio
    expect(mockEq).toHaveBeenCalledWith("store_id", STORE_ID);
  });

  // I-292: storeAdmin sin storeId en metadata (fallback) → 403
  it("I-292: storeAdmin sin storeId en metadata → GET stores 403", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeAdmin: true } },
    });
    const { GET } = await import("@/app/api/admin/stores/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  // I-97: Clerk user sin nombre alguno → upsert NO incluye clave nombre.
  it("I-97: Clerk user sin firstName ni lastName → upsert NO incluye clave nombre", async () => {
    const capturedPayload: unknown[] = [];
    const mockUpsertCapture = jest.fn((data) => {
      capturedPayload.push(data);
      return Promise.resolve({ data: null, error: null });
    });
    mockFrom.mockReturnValue({ upsert: mockUpsertCapture });
    mockClerkClient.mockResolvedValue({
      users: {
        getUserList: jest.fn().mockResolvedValue({
          data: [{ id: "clerk_noname", firstName: null, lastName: null }],
        }),
        updateUserMetadata: jest.fn().mockResolvedValue({}),
      },
    });
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "noname@store.com", storeId: STORE_ID, role: "storeWorker" }),
    }));
    expect(res.status).toBe(200);
    expect(capturedPayload[0]).not.toHaveProperty("nombre");
  });
});
