/**
 * Tests I-476 a I-481: POST /api/admin/users/create
 * Creación de usuario administrador/worker vía Clerk.
 *
 * REGRESIÓN (ticket 6a76c8c5946f3e4288a6176d): Clerk rechaza con
 * form_password_pwned cuando la contraseña está en HIBP (breached). El código
 * lo trataba como "email ya existe" (form_identifier_exists) y devolvía un 409
 * engañoso "El email ya existe en Clerk pero no se pudo recuperar el usuario"
 * para emails nuevos — cualquier contraseña comprometida fallaba siempre,
 * sin importar el email.
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

  // I-478: email tomado pero irrecuperable → 409 legítimo con el mensaje de no recuperación
  it("I-478: form_identifier_exists sin usuario recuperable → 409", async () => {
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
    expect(body.error).toBe("El email ya existe en Clerk pero no se pudo recuperar el usuario");
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
});
