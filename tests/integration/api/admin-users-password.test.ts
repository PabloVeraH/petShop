/**
 * Tests I-768 a I-775: POST /api/admin/users/[id]/password — cambio de
 * contraseña de un usuario. Solo systemAdmin (confirmado en la BD); la
 * contraseña va directo a Clerk y nunca queda en la auditoría.
 * admin-check real; Clerk y Supabase mockeados.
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const TARGET = "user_target123";
const PASSWORD = "NuevaClave2026!";

const mockAuth = jest.fn();
const mockUpdateUser = jest.fn();
const mockLogAudit = jest.fn().mockResolvedValue(undefined);
// Respuestas de clerk_users según las columnas pedidas: system_admin (lo
// consulta requireSystemAdminConsistent) o email/store_id (usuario objetivo).
let adminEnBd: { system_admin: boolean } | null = { system_admin: true };
let usuarioObjetivo: { email: string; store_id: string | null } | null = { email: "vendedor@tienda.cl", store_id: STORE_ID };
const mockFrom = jest.fn((tabla: string) => {
  let columnas = "";
  const c: Record<string, jest.Mock> = {
    select: jest.fn((cols: string) => { columnas = cols; return c; }),
    eq: jest.fn(() => c),
    single: jest.fn(async () => ({
      data: tabla === "clerk_users" && columnas.includes("system_admin") ? adminEnBd : usuarioObjetivo,
      error: null,
    })),
  };
  return c;
});

jest.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
  clerkClient: async () => ({ users: { updateUser: mockUpdateUser } }),
}));
jest.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mockFrom }) }));
jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler: unknown) => handler,
  logAudit: mockLogAudit,
  getRequestMetadata: jest.fn(() => ({ ipAddress: "10.0.0.1", userAgent: "jest" })),
}));

function sesion(publicMetadata: Record<string, unknown> | null) {
  mockAuth.mockResolvedValue({ sessionClaims: publicMetadata ? { sub: "user_admin", publicMetadata } : null });
}

async function cambiar(body: unknown = { password: PASSWORD }) {
  const { POST } = await import("@/app/api/admin/users/[id]/password/route");
  return POST(
    new NextRequest(`http://localhost/api/admin/users/${TARGET}/password`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: TARGET }) },
  );
}

describe("POST /api/admin/users/[id]/password", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    adminEnBd = { system_admin: true };
    usuarioObjetivo = { email: "vendedor@tienda.cl", store_id: STORE_ID };
    mockUpdateUser.mockResolvedValue({});
    sesion({ systemAdmin: true });
  });

  it("I-768: sin sesión → 403 sin tocar Clerk", async () => {
    sesion(null);
    expect((await cambiar()).status).toBe(403);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it.each([
    ["storeAdmin de la tienda", { storeAdmin: true, storeId: STORE_ID }],
    ["storeWorker", { storeWorker: true, storeId: STORE_ID }],
    ["sin rol", { storeId: STORE_ID }],
  ])("I-769: %s → 403 sin tocar Clerk ni auditar", async (_n, meta) => {
    sesion(meta);
    expect((await cambiar()).status).toBe(403);
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("I-770: JWT con systemAdmin pero la BD ya no lo confirma (rol quitado) → 403", async () => {
    adminEnBd = { system_admin: false };
    expect((await cambiar()).status).toBe(403);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("I-771: systemAdmin cambia la contraseña en Clerk y cierra las sesiones del usuario", async () => {
    const res = await cambiar();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockUpdateUser).toHaveBeenCalledWith(TARGET, { password: PASSWORD, signOutOfOtherSessions: true });
  });

  it("I-772: el cambio queda en auditoría (quién, a quién, tienda del usuario) y la contraseña NO", async () => {
    await cambiar();
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    const fila = mockLogAudit.mock.calls[0][0];
    expect(fila).toMatchObject({
      storeId: STORE_ID,
      userId: "user_admin",
      action: "UPDATE",
      entityType: "usuario",
      newValues: { clerk_id: TARGET },
      ipAddress: "10.0.0.1",
    });
    expect(fila.result).toBeUndefined();
    expect(JSON.stringify(fila)).not.toContain(PASSWORD);
  });

  it.each([
    ["corta", { password: "corta" }],
    ["ausente", {}],
    ["no string", { password: 12345678 }],
  ])("I-773: contraseña %s → 400 sin tocar Clerk", async (_n, body) => {
    const res = await cambiar(body);
    expect(res.status).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("I-774: usuario inexistente → 404 sin tocar Clerk", async () => {
    usuarioObjetivo = null;
    expect((await cambiar()).status).toBe(404);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("I-775: Clerk rechaza la contraseña (filtrada) → 422 con su mensaje y auditoría failure sin la contraseña", async () => {
    mockUpdateUser.mockRejectedValue({
      errors: [{ code: "form_password_pwned", longMessage: "Password has been found in an online data breach." }],
    });
    const res = await cambiar();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Password has been found in an online data breach." });
    const fila = mockLogAudit.mock.calls[0][0];
    expect(fila).toMatchObject({ result: "failure", errorMessage: "Password has been found in an online data breach." });
    expect(JSON.stringify(fila)).not.toContain(PASSWORD);
  });
});
