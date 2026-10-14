/**
 * Tests I-LU-01 a I-LU-07: GET/POST /api/admin/license/users (deshabilitar o
 * habilitar usuarios de la tienda por licencia, solo systemAdmin).
 *
 * REGRESIÓN (docs/informe_security.md, hallazgo 7): si banUser fallaba a mitad
 * del lote, el loop abortaba con 500 y clerk_users.is_disabled no se
 * actualizaba ni para los usuarios ya baneados en Clerk. Ahora cada usuario se
 * procesa por separado y la BD refleja exactamente los que Clerk aceptó.
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const ADMIN_ID = "user_sysadmin";

const mockAuth = jest.fn();
const mockBan = jest.fn();
const mockUnban = jest.fn();
const mockLogAudit = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn();
const mockIn = jest.fn();
let systemAdminEnBd = true;

jest.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
  clerkClient: async () => ({ users: { banUser: mockBan, unbanUser: mockUnban } }),
}));
jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler: unknown) => handler,
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({
    from: () => ({
      // requireSystemAdminConsistent: select → eq → single
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { system_admin: systemAdminEnBd }, error: null }),
          eq: () => ({ eq: async () => ({ data: [], error: null }) }),
        }),
      }),
      update: (vals: unknown) => {
        mockUpdate(vals);
        return { in: mockIn };
      },
    }),
  }),
}));

import { POST } from "@/app/api/admin/license/users/route";

function sesion(publicMetadata: Record<string, unknown>) {
  mockAuth.mockResolvedValue({ userId: ADMIN_ID, sessionClaims: { sub: ADMIN_ID, publicMetadata } });
}

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/license/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/license/users", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    systemAdminEnBd = true;
    sesion({ systemAdmin: true, storeId: STORE_ID });
    mockBan.mockResolvedValue({});
    mockUnban.mockResolvedValue({});
    mockIn.mockResolvedValue({ error: null });
  });

  it("I-LU-01: todos OK → 200, banea a cada uno y marca is_disabled=true solo para ellos", async () => {
    const res = await POST(req({ userIds: ["u1", "u2"], action: "disable" }));

    expect(res.status).toBe(200);
    expect(mockBan).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith({ is_disabled: true });
    expect(mockIn).toHaveBeenCalledWith("clerk_id", ["u1", "u2"]);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "BAN_USER", result: "success" }));
  });

  it("I-LU-02: REGRESIÓN — Clerk falla con el 2º de 3 → sigue con el 3º, la BD refleja los 2 exitosos y responde 500 con el detalle", async () => {
    mockBan.mockImplementation(async (id: string) => {
      if (id === "u2") throw new Error("clerk down");
      return {};
    });

    const res = await POST(req({ userIds: ["u1", "u2", "u3"], action: "disable" }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(mockBan).toHaveBeenCalledTimes(3);
    expect(mockIn).toHaveBeenCalledWith("clerk_id", ["u1", "u3"]);
    expect(body).toEqual(expect.objectContaining({ actualizados: ["u1", "u3"], fallidos: ["u2"] }));
    expect(body.error).toMatch(/1 de 3/);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ result: "partial" }));
  });

  it("I-LU-03: Clerk falla con todos → no toca la BD y audita failure", async () => {
    mockUnban.mockRejectedValue(new Error("clerk down"));

    const res = await POST(req({ userIds: ["u1"], action: "enable" }));

    expect(res.status).toBe(500);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UNBAN_USER", result: "failure" }));
  });

  it("I-LU-04: Clerk OK pero falla el update de clerk_users → 500 que lo dice (no se reporta éxito)", async () => {
    mockIn.mockResolvedValue({ error: { message: "db down" } });

    const res = await POST(req({ userIds: ["u1"], action: "enable" }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(mockUpdate).toHaveBeenCalledWith({ is_disabled: false });
    expect(body.error).toMatch(/base de datos/);
  });

  it("I-LU-05: storeAdmin → 403 sin llamar a Clerk", async () => {
    sesion({ storeAdmin: true, storeId: STORE_ID });

    const res = await POST(req({ userIds: ["u1"], action: "disable" }));

    expect(res.status).toBe(403);
    expect(mockBan).not.toHaveBeenCalled();
  });

  it("I-LU-06: JWT dice systemAdmin pero la BD no → 403 sin llamar a Clerk", async () => {
    systemAdminEnBd = false;

    const res = await POST(req({ userIds: ["u1"], action: "disable" }));

    expect(res.status).toBe(403);
    expect(mockBan).not.toHaveBeenCalled();
  });

  it("I-LU-07: deshabilitarse a sí mismo o body inválido → 400 sin llamar a Clerk", async () => {
    expect((await POST(req({ userIds: [ADMIN_ID], action: "disable" }))).status).toBe(400);
    expect((await POST(req({ userIds: [], action: "disable" }))).status).toBe(400);
    expect((await POST(req({ userIds: ["u1"], action: "borrar" }))).status).toBe(400);
    expect(mockBan).not.toHaveBeenCalled();
  });
});
