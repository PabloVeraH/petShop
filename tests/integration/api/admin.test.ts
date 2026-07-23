/**
 * Tests I-92 a I-97, I-290 a I-292, I-444 a I-451:
 * GET /api/admin/stores, POST /api/admin/users, PATCH /api/admin/users/[id],
 * DB cross-verify stale JWT
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

/**
 * Crea una cadena de mock para supabase.from(table).select()...
 * Soporta dos llamadas: la primera es la DB cross-verify (clerk_users),
 * la segunda es la query de negocio (stores, etc).
 * 
 * @param dataForQueries - datos para la segunda llamada (query de negocio)
 * @param clerkDbResult - resultado de la DB cross-verify para clerk_users
 */
function chain(
  dataForQueries: unknown[] = [],
  clerkDbResult: { system_admin: boolean } = { system_admin: true }
) {
  const mockSingle = jest.fn();
  const resolved = Promise.resolve({ data: dataForQueries, error: null });
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
    single: mockSingle,
    then: jest.fn().mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: dataForQueries, error: null })
    ),
  };
  ["select","eq","order","upsert"].forEach(k => c[k].mockReturnValue(c));

  // Primera llamada a .single() = DB cross-verify (clerk_users)
  // Segunda llamada = query de negocio (stores, clerk_users para conteo, etc)
  const clerkSingle = jest.fn().mockResolvedValue({ data: clerkDbResult, error: null });
  const bizSingle = jest.fn().mockResolvedValue({ data: dataForQueries[0] ?? null, error: null });

  let singleCallCount = 0;
  mockSingle.mockImplementation(() => {
    singleCallCount++;
    if (singleCallCount === 1) return clerkSingle();
    return bizSingle();
  });

  c.order = jest.fn().mockReturnValue(resolved);
  // For chain() style that returns a thenable (stores route)
  c.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) => {
    // Determine what data to return based on how many times then is called
    if (singleCallCount === 0) {
      // No single() called yet — this is likely the first query (stores)
      return resolve({ data: dataForQueries, error: null });
    }
    return resolve({ data: dataForQueries, error: null });
  });
  return c;
}

/**
 * Default minimal chain for DB cross-verify (select/eq/single on clerk_users).
 * Used in tests that set up a custom mock for the business query (e.g., upsert)
 * but still need the DB cross-verify to work.
 */
function defaultChain(): Record<string, jest.Mock> {
  const c: Record<string, jest.Mock> = {};
  c.select = jest.fn().mockReturnValue(c);
  c.eq = jest.fn().mockReturnValue(c);
  c.single = jest.fn().mockResolvedValue({ data: { system_admin: true }, error: null });
  c.upsert = jest.fn().mockRejectedValue(new Error("unexpected upsert"));
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

  // I-444: REGRESIÓN — JWT dice systemAdmin pero DB dice storeAdmin → 403
  it("I-444: JWT stale (systemAdmin en JWT pero no en DB) → 403", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    // DB cross-verify returns system_admin=false (stale JWT)
    mockFrom.mockReturnValue(chain([], { system_admin: false }));
    const { GET } = await import("@/app/api/admin/stores/route");
    const res = await GET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  // I-445: REGRESIÓN — storeAdmin NO puede crear usuarios (POST /api/admin/users requiere systemAdmin)
  it("I-445: storeAdmin → POST /api/admin/users 403 (requiere systemAdmin)", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", storeId: STORE_ID, role: "storeWorker" }),
    }));
    expect(res.status).toBe(403);
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

  // I-96: REGRESIÓN — asignar usuario sin lastName en Clerk NO debe pasar nombre:null al upsert
  it("I-96: Clerk user sin lastName → upsert NO incluye clave nombre (no sobreescribe existente)", async () => {
    const capturedPayload: unknown[] = [];
    const mockUpsertCapture = jest.fn((data) => {
      capturedPayload.push(data);
      return Promise.resolve({ data: null, error: null });
    });
    // Need to support both DB cross-verify and upsert in same mock chain
    mockFrom.mockImplementation((table: string) => {
      if (table === "clerk_users") {
        return {
          ...defaultChain(),
          upsert: mockUpsertCapture,
        };
      }
      return { upsert: mockUpsertCapture };
    });
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

  // I-446: REGRESIÓN — JWT stale (systemAdmin en JWT, DB storeAdmin) en POST /api/admin/users → 403
  it("I-446: JWT stale systemAdmin en POST /api/admin/users → 403", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    mockFrom.mockReturnValue(chain([], { system_admin: false }));
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", storeId: STORE_ID, role: "storeWorker" }),
    }));
    expect(res.status).toBe(403);
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
    // Support both DB cross-verify (select/eq/single) and upsert
    mockFrom.mockImplementation((table: string) => {
      if (table === "clerk_users") {
        return {
          ...defaultChain(),
          upsert: mockUpsertCapture,
        };
      }
      return { upsert: mockUpsertCapture };
    });
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

// PATCH /api/admin/users/[id] — REGRESIÓN encontrada al revisar el fix del ticket
// Trello 6a61a8b2792efeb5e59de96a: handlePatchUser actualizaba el rol solo en la
// tabla espejo clerk_users, nunca en Clerk publicMetadata (la fuente real de
// autorización vía JWT) — un usuario "degradado" desde el panel conservaba su
// rol viejo en el JWT para siempre.
describe("PATCH /api/admin/users/[id]", () => {
  const TARGET_ID = "clerk_target_user";

  /**
   * Mock de supabase.from("clerk_users") para el flujo de handlePatchUser.
   * Primera llamada a .single() = la que hace requireSystemAdminConsistent
   * (cross-verify del que llama) o el targetUser fetch de la rama storeAdmin
   * (según quién llama). Segunda llamada = oldUser fetch dentro de handlePatchUser.
   */
  function makePatchChain({
    firstSingleResult,
    oldUser = {
      email: "old@store.com",
      nombre: "Old Name",
      store_admin: false,
      store_worker: true,
      system_admin: false,
      store_id: STORE_ID,
    },
    updateResult = { error: null },
  }: {
    firstSingleResult: unknown;
    oldUser?: Record<string, unknown> | null;
    updateResult?: { error: unknown };
  }) {
    let singleCallCount = 0;
    const c: Record<string, jest.Mock> = {};
    c.select = jest.fn().mockReturnValue(c);
    c.eq = jest.fn().mockReturnValue(c);
    c.single = jest.fn().mockImplementation(() => {
      singleCallCount++;
      if (singleCallCount === 1) return Promise.resolve({ data: firstSingleResult, error: null });
      return Promise.resolve({ data: oldUser, error: null });
    });
    c.update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue(updateResult) });
    return c;
  }

  function patchReq(body: unknown) {
    return new NextRequest(`http://localhost/api/admin/users/${TARGET_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // I-447: REGRESIÓN — systemAdmin degrada a otro systemAdmin a storeAdmin →
  // Clerk publicMetadata debe reflejar el nuevo rol, no solo la tabla clerk_users
  it("I-447: systemAdmin degrada systemAdmin→storeAdmin → sincroniza Clerk publicMetadata", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    mockFrom.mockReturnValue(makePatchChain({
      firstSingleResult: { system_admin: true }, // cross-verify: caller es systemAdmin real
      oldUser: {
        email: "target@store.com", nombre: "Target", store_admin: false,
        store_worker: false, system_admin: true, store_id: STORE_ID,
      },
    }));
    const mockUpdateUserMetadata = jest.fn().mockResolvedValue({});
    mockClerkClient.mockResolvedValue({
      users: { updateUserMetadata: mockUpdateUserMetadata, getUserList: jest.fn(), updateUser: jest.fn() },
      emailAddresses: { createEmailAddress: jest.fn() },
    });

    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const res = await PATCH(patchReq({ role: "storeAdmin" }), { params: Promise.resolve({ id: TARGET_ID }) });

    expect(res.status).toBe(200);
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith(TARGET_ID, {
      publicMetadata: { systemAdmin: false, storeAdmin: true, storeWorker: false, storeId: STORE_ID },
    });
  });

  // I-448: promoción a systemAdmin → publicMetadata limpio, sin storeId/storeAdmin/storeWorker residual
  it("I-448: systemAdmin promueve storeWorker→systemAdmin → Clerk publicMetadata limpio (sin storeId residual)", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    mockFrom.mockReturnValue(makePatchChain({
      firstSingleResult: { system_admin: true },
      oldUser: {
        email: "worker@store.com", nombre: "Worker", store_admin: false,
        store_worker: true, system_admin: false, store_id: STORE_ID,
      },
    }));
    const mockUpdateUserMetadata = jest.fn().mockResolvedValue({});
    mockClerkClient.mockResolvedValue({
      users: { updateUserMetadata: mockUpdateUserMetadata, getUserList: jest.fn(), updateUser: jest.fn() },
      emailAddresses: { createEmailAddress: jest.fn() },
    });

    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const res = await PATCH(patchReq({ role: "systemAdmin" }), { params: Promise.resolve({ id: TARGET_ID }) });

    expect(res.status).toBe(200);
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith(TARGET_ID, {
      publicMetadata: { systemAdmin: true, storeAdmin: false, storeWorker: false, storeId: null },
    });
  });

  // I-449: usuario sin store_id no puede recibir un rol de tienda — 400, sin tocar Clerk
  it("I-449: usuario sin store_id → rol de tienda rechazado con 400, no llama a Clerk", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    mockFrom.mockReturnValue(makePatchChain({
      firstSingleResult: { system_admin: true },
      oldUser: {
        email: "orphan@x.com", nombre: "Orphan", store_admin: false,
        store_worker: false, system_admin: true, store_id: null,
      },
    }));
    const mockUpdateUserMetadata = jest.fn().mockResolvedValue({});
    mockClerkClient.mockResolvedValue({
      users: { updateUserMetadata: mockUpdateUserMetadata, getUserList: jest.fn(), updateUser: jest.fn() },
      emailAddresses: { createEmailAddress: jest.fn() },
    });

    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const res = await PATCH(patchReq({ role: "storeAdmin" }), { params: Promise.resolve({ id: TARGET_ID }) });

    expect(res.status).toBe(400);
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  // I-450: storeAdmin edita a un worker de su propia tienda → también sincroniza Clerk
  it("I-450: storeAdmin edita worker de su tienda → sincroniza Clerk publicMetadata con su propia storeId", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
    mockFrom.mockReturnValue(makePatchChain({
      firstSingleResult: { store_id: STORE_ID }, // targetUser fetch de la rama storeAdmin
      oldUser: {
        email: "worker@store.com", nombre: "Worker", store_admin: false,
        store_worker: true, system_admin: false, store_id: STORE_ID,
      },
    }));
    const mockUpdateUserMetadata = jest.fn().mockResolvedValue({});
    mockClerkClient.mockResolvedValue({
      users: { updateUserMetadata: mockUpdateUserMetadata, getUserList: jest.fn(), updateUser: jest.fn() },
      emailAddresses: { createEmailAddress: jest.fn() },
    });

    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const res = await PATCH(patchReq({ role: "storeAdmin" }), { params: Promise.resolve({ id: TARGET_ID }) });

    expect(res.status).toBe(200);
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith(TARGET_ID, {
      publicMetadata: { systemAdmin: false, storeAdmin: true, storeWorker: false, storeId: STORE_ID },
    });
  });

  // I-451: REGRESIÓN — JWT stale (systemAdmin en JWT, DB storeAdmin) en PATCH → 403
  it("I-451: JWT stale systemAdmin en PATCH /api/admin/users/[id] → 403", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    mockFrom.mockReturnValue(makePatchChain({ firstSingleResult: { system_admin: false } }));
    const mockUpdateUserMetadata = jest.fn().mockResolvedValue({});
    mockClerkClient.mockResolvedValue({
      users: { updateUserMetadata: mockUpdateUserMetadata, getUserList: jest.fn(), updateUser: jest.fn() },
      emailAddresses: { createEmailAddress: jest.fn() },
    });

    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const res = await PATCH(patchReq({ role: "storeAdmin" }), { params: Promise.resolve({ id: TARGET_ID }) });

    expect(res.status).toBe(403);
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });
});
