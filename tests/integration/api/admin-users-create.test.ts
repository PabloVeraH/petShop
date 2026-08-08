/**
 * Tests I-476 a I-486: POST /api/admin/users/create
 * Creación de usuario administrador/worker vía Clerk.
 *
 * REGRESIÓN (ticket 6a76c8c5946f3e4288a6176d): Clerk rechaza con
 * form_password_pwned cuando la contraseña está en HIBP (breached). El código
 * lo trataba como "email ya existe" (form_identifier_exists) y devolvía un 409
 * engañoso "El email ya existe en Clerk pero no se pudo recuperar el usuario"
 * para emails nuevos — cualquier contraseña comprometida fallaba siempre,
 * sin importar el email.
 *
 * REGRESIÓN (ticket 6a76c861779de90209ed8ba3, I-478/I-486): el mismo mensaje
 * "El email ya existe en Clerk pero no se pudo recuperar el usuario" se
 * devolvía al usuario final en el caso irrecuperable genuino (email existente
 * en Clerk, típicamente reservado por un usuario borrado, sin usuario
 * recuperable vía getUserList). Exponía el proveedor interno (Clerk) y
 * sugería una desincronización. Ahora el usuario final ve "Ya existe un
 * usuario con este email" (mensaje de negocio) y el detalle técnico se
 * loguea vía logError para revisión técnica.
 *
 * I-482 a I-484 (revisión posterior, mismo archivo/endpoint): la rama
 * systemAdmin de la ruta (requireSystemAdminConsistent + storeId del body)
 * no tenía ningún test, y tampoco existía una prueba explícita de que
 * storeAdmin ignora un storeId ajeno enviado en el body (§6.2/§19.1 —
 * aislamiento de tenant en una mutación privilegiada). El código ya era
 * correcto en ambos casos; se cierra el hueco de cobertura.
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
const mockLogError = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/audit", () => ({ logError: mockLogError }));

function upsertChain() {
  return {
    upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
}

function storeAdminAuth() {
  mockAuth.mockResolvedValue({
    userId: USER_ID,
    sessionClaims: {
      sub: USER_ID,
      publicMetadata: { storeAdmin: true, storeId: STORE_ID },
    },
  });
}

const SYSADMIN_ID = "user_clerk_sysadmin";

function systemAdminAuth() {
  mockAuth.mockResolvedValue({
    userId: SYSADMIN_ID,
    sessionClaims: {
      sub: SYSADMIN_ID,
      publicMetadata: { systemAdmin: true },
    },
  });
}

// requireSystemAdminConsistent (admin-check.ts) cruza el JWT contra
// clerk_users.system_admin en BD — a diferencia de upsertChain() (solo
// upsert), esta cadena también sirve select().eq().single() para ese check.
function systemAdminChain() {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn().mockResolvedValue({ data: { system_admin: true }, error: null }),
    upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  c.select.mockReturnValue(c);
  c.eq.mockReturnValue(c);
  return c;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    email: "nuevo.worker@store.com",
    password: "ClaveSegura123!",
    firstName: "Nuevo",
    lastName: "Trabajador",
    role: "storeWorker",
    ...overrides,
  });
}

describe("POST /api/admin/users/create (storeAdmin)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeAdminAuth();
    mockFrom.mockReturnValue(upsertChain());
  });

  // I-476: REGRESIÓN — contraseña comprometida (form_password_pwned) NO es "email ya existe"
  it("I-476: password pwned → 422 con el mensaje real de Clerk, no un 409 de email duplicado", async () => {
    mockClerkClient.mockResolvedValue({
      users: {
        createUser: jest.fn().mockRejectedValue({
          errors: [{ code: "form_password_pwned", longMessage: "This password has been found in an online data leak." }],
          status: 400,
        }),
        getUserList: jest.fn().mockResolvedValue({ data: [] }),
      },
    });

    const { POST } = await import("@/app/api/admin/users/create/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody({ email: "brand.new.476@example.org" }),
    }));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("This password has been found in an online data leak.");
  });

  // I-477: email realmente tomado + usuario recuperado → prosigue con el existente
  it("I-477: form_identifier_exists con usuario recuperado → 200 y metadata actualizada", async () => {
    const mockUpdateUserMetadata = jest.fn().mockResolvedValue({});
    mockClerkClient.mockResolvedValue({
      users: {
        createUser: jest.fn().mockRejectedValue({
          errors: [{ code: "form_identifier_exists", message: "Email already exists" }],
          status: 400,
        }),
        getUserList: jest.fn().mockResolvedValue({ data: [{ id: "clerk_existente" }] }),
        updateUserMetadata: mockUpdateUserMetadata,
      },
    });

    const { POST } = await import("@/app/api/admin/users/create/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody({ email: "existe@store.com" }),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, clerkId: "clerk_existente" });
    expect(mockUpdateUserMetadata).toHaveBeenCalled();
  });

  // I-478: email tomado pero irrecuperable → 409 con mensaje claro orientado al usuario
  // (ticket 6a76c861779de90209ed8ba3): antes se devolvía "El email ya existe en Clerk
  // pero no se pudo recuperar el usuario", que exponía el proveedor interno (Clerk) y
  // sugería una desincronización. Ahora el usuario final ve un mensaje de negocio limpio
  // y el detalle técnico (email existe pero sin usuario recuperable) va a error_logs.
  it("I-478: form_identifier_exists sin usuario recuperable → 409 con mensaje claro, sin exponer Clerk", async () => {
    mockClerkClient.mockResolvedValue({
      users: {
        createUser: jest.fn().mockRejectedValue({
          errors: [{ code: "form_identifier_exists", message: "Email already exists" }],
          status: 400,
        }),
        getUserList: jest.fn().mockResolvedValue({ data: [] }),
      },
    });

    const { POST } = await import("@/app/api/admin/users/create/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody({ email: "duplicado@store.com" }),
    }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Ya existe un usuario con este email");
    expect(body.error).not.toContain("Clerk");
  });

  // I-486: el caso irrecuperable se loguea para revisión técnica (§20.5 — detección):
  // el usuario final no debe ver el detalle interno, pero el desface Clerk↔BD (email
  // reservado por usuario borrado, o inconsistencia) queda registrado en error_logs
  // con el email en contexto para diagnóstico.
  it("I-486: email existente sin usuario recuperable → se loguea con logError (detección técnica)", async () => {
    mockClerkClient.mockResolvedValue({
      users: {
        createUser: jest.fn().mockRejectedValue({
          errors: [{ code: "form_identifier_exists", message: "Email already exists" }],
          status: 400,
        }),
        getUserList: jest.fn().mockResolvedValue({ data: [] }),
      },
    });

    const { POST } = await import("@/app/api/admin/users/create/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody({ email: "duplicado@store.com" }),
    }));

    expect(res.status).toBe(409);
    expect(mockLogError).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "CLERK_EMAIL_TAKEN_UNRESOLVABLE",
      errorMessage: expect.stringContaining("duplicado@store.com"),
      severity: "WARNING",
      endpoint: "POST /api/admin/users/create",
      context: expect.objectContaining({ email: "duplicado@store.com" }),
    }));
  });

  // I-479: happy path — usuario creado correctamente
  it("I-479: crear usuario exitoso → 200 ok:true y metadata worker", async () => {
    const mockUpdateUserMetadata = jest.fn().mockResolvedValue({});
    mockClerkClient.mockResolvedValue({
      users: {
        createUser: jest.fn().mockResolvedValue({ id: "clerk_nuevo" }),
        updateUserMetadata: mockUpdateUserMetadata,
      },
    });

    const { POST } = await import("@/app/api/admin/users/create/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody(),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, clerkId: "clerk_nuevo" });
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith("clerk_nuevo", {
      publicMetadata: {
        storeId: STORE_ID,
        storeAdmin: false,
        storeWorker: true,
      },
    });
  });
});

describe("POST /api/admin/users/create (seguridad)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // I-480: sin sesión → 403
  it("I-480: no autenticado → 403", async () => {
    mockAuth.mockResolvedValue({ sessionClaims: null });

    const { POST } = await import("@/app/api/admin/users/create/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody(),
    }));

    expect(res.status).toBe(403);
  });

  // I-481: storeAdmin intenta crear un systemAdmin → 403
  it("I-481: storeAdmin creando systemAdmin → 403", async () => {
    storeAdminAuth();
    mockFrom.mockReturnValue(upsertChain());

    const { POST } = await import("@/app/api/admin/users/create/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody({ role: "systemAdmin" }),
    }));

    expect(res.status).toBe(403);
  });

  // I-483 — aislamiento de tenant (§6.2/§19.1): storeAdmin nunca lee storeId
  // del body (createClerkUser ni siquiera lo recibe en esa rama) — un
  // storeId de otra tienda en el payload se ignora, el usuario se crea
  // siempre en la tienda del admin autenticado.
  it("I-483: storeAdmin con storeId de otra tienda en el body → se ignora, usa la tienda del admin (no IDOR)", async () => {
    const OTRA_TIENDA = "999e4567-e89b-12d3-a456-426614179999";
    storeAdminAuth();
    mockFrom.mockReturnValue(upsertChain());
    const mockUpdateUserMetadata = jest.fn().mockResolvedValue({});
    mockClerkClient.mockResolvedValue({
      users: {
        createUser: jest.fn().mockResolvedValue({ id: "clerk_nuevo" }),
        updateUserMetadata: mockUpdateUserMetadata,
      },
    });

    const { POST } = await import("@/app/api/admin/users/create/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody({ storeId: OTRA_TIENDA }),
    }));

    expect(res.status).toBe(200);
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith("clerk_nuevo", expect.objectContaining({
      publicMetadata: expect.objectContaining({ storeId: STORE_ID }),
    }));
  });
});

describe("POST /api/admin/users/create (systemAdmin)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // I-482 — la rama systemAdmin (requireSystemAdminConsistent + cross-check
  // en BD) no tenía ningún test: a diferencia de storeAdmin, aquí storeId SÍ
  // viene del body (systemAdmin gestiona cualquier tienda) y se usa tal cual.
  it("I-482: systemAdmin crea usuario para una tienda arbitraria (storeId del body) → 200", async () => {
    const OTRA_TIENDA = "999e4567-e89b-12d3-a456-426614179999";
    systemAdminAuth();
    mockFrom.mockReturnValue(systemAdminChain());
    const mockUpdateUserMetadata = jest.fn().mockResolvedValue({});
    mockClerkClient.mockResolvedValue({
      users: {
        createUser: jest.fn().mockResolvedValue({ id: "clerk_por_sysadmin" }),
        updateUserMetadata: mockUpdateUserMetadata,
      },
    });

    const { POST } = await import("@/app/api/admin/users/create/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody({ storeId: OTRA_TIENDA, role: "storeAdmin" }),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, clerkId: "clerk_por_sysadmin" });
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith("clerk_por_sysadmin", {
      publicMetadata: { storeId: OTRA_TIENDA, storeAdmin: true, storeWorker: false },
    });
  });

  // I-484 — validación de negocio de la rama systemAdmin (línea 169-171 de
  // la ruta): un rol de tienda sin storeId es un payload incompleto, nunca
  // debe llegar a Clerk.
  it("I-484: systemAdmin crea storeWorker sin storeId → 400, no llega a Clerk", async () => {
    systemAdminAuth();
    mockFrom.mockReturnValue(systemAdminChain());
    const mockCreateUser = jest.fn();
    mockClerkClient.mockResolvedValue({ users: { createUser: mockCreateUser } });

    const { POST } = await import("@/app/api/admin/users/create/route");
    const res = await POST(new NextRequest("http://localhost/api/admin/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody({ role: "storeWorker" }), // sin storeId
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("storeId requerido para roles de tienda");
    expect(mockCreateUser).not.toHaveBeenCalled();
  });
});
