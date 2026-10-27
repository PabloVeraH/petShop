/**
 * Tests I-776 a I-785: auditoría de usuarios y eliminación con bloqueo en
 * Clerk.
 * - El id de Clerk ("user_…") no es uuid: nunca va en entity_id (la fila
 *   entera se rechazaba); va en old/new_values como clerk_id.
 * - Eliminar un usuario le quita tienda y roles en Clerk y lo bloquea
 *   (antes solo borraba la fila de clerk_users y seguía entrando).
 * admin-check real; Clerk, Supabase y logAudit mockeados.
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const ADMIN = "user_admin";
const TARGET = "user_target123";

const mockAuth = jest.fn();
const mockUpdateUserMetadata = jest.fn();
const mockBanUser = jest.fn();
const mockUpdateUser = jest.fn();
const mockGetUserList = jest.fn();
const mockLogAudit = jest.fn().mockResolvedValue(undefined);

// Estado de la BD simulada.
let adminEnBd: { system_admin: boolean } | null;
let usuarioObjetivo: Record<string, unknown> | null;
let errorDelete: { message: string } | null;
let errorUpdate: { message: string } | null;
let errorUpsert: { message: string } | null;
const operaciones: string[] = [];

const mockFrom = jest.fn((tabla: string) => {
  let columnas = "";
  let op = "select";
  const c: Record<string, jest.Mock> & { then?: unknown } = {
    select: jest.fn((cols: string) => { columnas = cols ?? ""; return c; }),
    eq: jest.fn(() => c),
    update: jest.fn(() => { op = "update"; return c; }),
    delete: jest.fn(() => { op = "delete"; operaciones.push(`${tabla}.delete`); return c; }),
    upsert: jest.fn(async () => ({ error: errorUpsert })),
    single: jest.fn(async () => ({
      data: columnas.includes("system_admin") && !columnas.includes("email") ? adminEnBd : usuarioObjetivo,
      error: null,
    })),
  };
  // update()/delete() se esperan directo (sin .single()).
  c.then = (resolve: (v: unknown) => void) =>
    resolve({ error: op === "delete" ? errorDelete : op === "update" ? errorUpdate : null });
  return c;
});

jest.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
  clerkClient: async () => ({
    users: {
      updateUserMetadata: (...a: unknown[]) => { operaciones.push("clerk.metadata"); return mockUpdateUserMetadata(...a); },
      banUser: (...a: unknown[]) => { operaciones.push("clerk.ban"); return mockBanUser(...a); },
      updateUser: mockUpdateUser,
      getUserList: mockGetUserList,
    },
    emailAddresses: { createEmailAddress: jest.fn() },
  }),
}));
jest.mock("@clerk/nextjs/errors", () => ({
  isClerkAPIResponseError: (e: unknown) => typeof e === "object" && e !== null && "clerkError" in e,
}));
jest.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mockFrom }) }));
jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler: unknown) => handler,
  logAudit: (...a: unknown[]) => mockLogAudit(...a),
  getRequestMetadata: () => ({ ipAddress: "10.0.0.1", userAgent: "jest" }),
}));
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: jest.fn((cb: () => void) => cb()),
}));

const errorClerk = (status: number, longMessage = "Clerk dijo que no") => ({ clerkError: true, status, errors: [{ longMessage }] });

function sesion(publicMetadata: Record<string, unknown>) {
  mockAuth.mockResolvedValue({ userId: ADMIN, sessionClaims: { sub: ADMIN, publicMetadata } });
}

const params = (id = TARGET) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/admin/users/${TARGET}`, { method, body: body ? JSON.stringify(body) : undefined });

const filaAudit = (i = 0) => mockLogAudit.mock.calls[i][0] as Record<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  operaciones.length = 0;
  adminEnBd = { system_admin: true };
  usuarioObjetivo = { clerk_id: TARGET, email: "vendedor@tienda.cl", store_id: STORE_ID, store_admin: false, store_worker: true, system_admin: false, nombre: "Ana" };
  errorDelete = null;
  errorUpdate = null;
  errorUpsert = null;
  mockUpdateUserMetadata.mockResolvedValue({});
  mockBanUser.mockResolvedValue({});
  mockUpdateUser.mockResolvedValue({});
  mockGetUserList.mockResolvedValue({ data: [] });
  sesion({ systemAdmin: true });
});

describe("PATCH /api/admin/users/[id] — auditoría", () => {
  it("I-776: editar queda en auditoría sin entity_id, con clerk_id, antes/después y la tienda del usuario", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const res = await PATCH(req("PATCH", { role: "storeAdmin", nombre: "Ana Pérez" }), params());
    expect(res.status).toBe(200);

    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    const fila = filaAudit();
    expect(fila).not.toHaveProperty("entityId");
    expect(fila).toMatchObject({
      storeId: STORE_ID,
      userId: ADMIN,
      action: "UPDATE",
      entityType: "usuario",
      result: "success",
      ipAddress: "10.0.0.1",
    });
    expect(fila.oldValues).toMatchObject({ clerk_id: TARGET, store_worker: true });
    expect(fila.newValues).toMatchObject({ clerk_id: TARGET, store_admin: true, nombre: "Ana Pérez" });
  });

  it("I-777: Clerk rechaza el cambio → 422 con su mensaje y auditoría failure", async () => {
    mockUpdateUserMetadata.mockRejectedValue(errorClerk(422, "Metadata inválida"));
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const res = await PATCH(req("PATCH", { role: "storeAdmin" }), params());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Metadata inválida" });
    expect(filaAudit()).toMatchObject({ result: "failure", errorMessage: "Metadata inválida", entityType: "usuario" });
    expect(filaAudit()).not.toHaveProperty("entityId");
  });

  it("I-777b: aplicado en Clerk pero falla el guardado en la base → 500 y auditoría failure", async () => {
    errorUpdate = { message: "db caída" };
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const res = await PATCH(req("PATCH", { role: "storeAdmin" }), params());
    expect(res.status).toBe(500);
    expect(filaAudit()).toMatchObject({ result: "failure", errorMessage: "db caída" });
  });
});

describe("DELETE /api/admin/users/[id] — bloqueo en Clerk y auditoría", () => {
  it("I-778: quita tienda y roles en Clerk, lo bloquea y recién entonces borra la fila; queda en auditoría", async () => {
    const { DELETE } = await import("@/app/api/admin/users/[id]/route");
    const res = await DELETE(req("DELETE"), params());
    expect(res.status).toBe(200);

    expect(mockUpdateUserMetadata).toHaveBeenCalledWith(TARGET, {
      publicMetadata: { systemAdmin: false, storeAdmin: false, storeWorker: false, storeId: null },
    });
    expect(mockBanUser).toHaveBeenCalledWith(TARGET);
    expect(operaciones).toEqual(["clerk.metadata", "clerk.ban", "clerk_users.delete"]);

    const fila = filaAudit();
    expect(fila).not.toHaveProperty("entityId");
    expect(fila).toMatchObject({ storeId: STORE_ID, userId: ADMIN, action: "DELETE", entityType: "usuario" });
    expect(fila.oldValues).toMatchObject({ clerk_id: TARGET, email: "vendedor@tienda.cl" });
    expect(fila.result).toBeUndefined();
  });

  it("I-779: si Clerk no puede bloquearlo → 502, la fila NO se borra y queda auditoría failure", async () => {
    mockBanUser.mockRejectedValue(errorClerk(500, "Clerk caído"));
    const { DELETE } = await import("@/app/api/admin/users/[id]/route");
    const res = await DELETE(req("DELETE"), params());
    expect(res.status).toBe(502);
    expect(operaciones).not.toContain("clerk_users.delete");
    expect(filaAudit()).toMatchObject({ action: "DELETE", result: "failure", errorMessage: "Clerk caído" });
  });

  it("I-780: si el usuario ya no existe en Clerk (404) se borra la fila igual", async () => {
    mockUpdateUserMetadata.mockRejectedValue(errorClerk(404, "not found"));
    const { DELETE } = await import("@/app/api/admin/users/[id]/route");
    const res = await DELETE(req("DELETE"), params());
    expect(res.status).toBe(200);
    expect(operaciones).toContain("clerk_users.delete");
  });

  it("I-781: bloqueado en Clerk pero falla el borrado en la base → 500 y auditoría failure que lo explica", async () => {
    errorDelete = { message: "db caída" };
    const { DELETE } = await import("@/app/api/admin/users/[id]/route");
    const res = await DELETE(req("DELETE"), params());
    expect(res.status).toBe(500);
    expect(mockBanUser).toHaveBeenCalled();
    expect(filaAudit()).toMatchObject({ result: "failure", errorMessage: "db caída" });
    expect(String(filaAudit().changeDescription)).toContain("bloqueado en Clerk");
  });

  it("I-782: el systemAdmin no puede eliminarse a sí mismo (400 sin tocar Clerk)", async () => {
    const { DELETE } = await import("@/app/api/admin/users/[id]/route");
    const res = await DELETE(req("DELETE"), params(ADMIN));
    expect(res.status).toBe(400);
    expect(mockBanUser).not.toHaveBeenCalled();
    expect(operaciones).toEqual([]);
  });

  it("I-783: usuario inexistente → 404 sin tocar Clerk", async () => {
    usuarioObjetivo = null;
    const { DELETE } = await import("@/app/api/admin/users/[id]/route");
    const res = await DELETE(req("DELETE"), params());
    expect(res.status).toBe(404);
    expect(mockBanUser).not.toHaveBeenCalled();
  });

  it.each([
    ["storeAdmin", { storeAdmin: true, storeId: STORE_ID }],
    ["storeWorker", { storeWorker: true, storeId: STORE_ID }],
  ])("I-784: %s no puede eliminar (403 sin bloquear ni borrar)", async (_n, meta) => {
    sesion(meta);
    const { DELETE } = await import("@/app/api/admin/users/[id]/route");
    const res = await DELETE(req("DELETE"), params());
    expect(res.status).toBe(403);
    expect(mockBanUser).not.toHaveBeenCalled();
    expect(operaciones).toEqual([]);
  });
});

describe("POST /api/admin/users (asignar) — auditoría", () => {
  beforeEach(() => {
    mockGetUserList.mockResolvedValue({ data: [{ id: TARGET, firstName: "Ana", lastName: "Pérez" }] });
  });
  const asignar = async () => {
    const { POST } = await import("@/app/api/admin/users/route");
    return POST(new NextRequest("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "vendedor@tienda.cl", storeId: STORE_ID, role: "storeWorker" }),
    }));
  };

  it("I-785: asignar queda en auditoría sin entity_id y con el clerk_id; si falla el guardado → 500 y failure", async () => {
    let res = await asignar();
    expect(res.status).toBe(200);
    expect(filaAudit()).not.toHaveProperty("entityId");
    expect(filaAudit()).toMatchObject({ action: "CREATE", entityType: "usuario", storeId: STORE_ID, newValues: { clerk_id: TARGET, email: "vendedor@tienda.cl", role: "storeWorker" } });

    mockLogAudit.mockClear();
    errorUpsert = { message: "db caída" };
    res = await asignar();
    expect(res.status).toBe(500);
    expect(filaAudit()).toMatchObject({ result: "failure", errorMessage: "db caída" });
  });
});
