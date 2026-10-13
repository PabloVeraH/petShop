/**
 * SEC-20: logAudit nunca persiste secretos en audit_logs (los admins los leen
 * vía /api/audit-logs).
 */
const mockInsert = jest.fn().mockResolvedValue({ error: null });

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: jest.fn(() => ({ insert: mockInsert })) })),
}));
jest.mock("@/lib/security-alerts", () => ({ logSecurityAlert: jest.fn() }));
jest.mock("@/lib/auth", () => ({ getStoreId: jest.fn() }));

import { logAudit, redactarSecretos } from "@/lib/audit";

describe("SEC-20: redacción de secretos en auditoría", () => {
  it("redacta claves sensibles (también anidadas) y conserva el resto", () => {
    expect(
      redactarSecretos({
        name: "Tienda",
        whatsapp_access_token: "EAAG-real",
        whatsapp_webhook_verify_token: "",
        credenciales: { client_secret: "x" },
        config: { api_key: "k", modo: "prod" },
      }),
    ).toEqual({
      name: "Tienda",
      whatsapp_access_token: "[REDACTED]",
      whatsapp_webhook_verify_token: "",
      credenciales: "[REDACTED]",
      config: { api_key: "[REDACTED]", modo: "prod" },
    });
  });

  it("logAudit inserta old/new values sin el valor del token", async () => {
    await logAudit({
      storeId: "s1",
      userId: "u1",
      action: "UPDATE",
      entityType: "settings",
      oldValues: { whatsapp_access_token: "viejo-secreto" },
      newValues: { whatsapp_access_token: "nuevo-secreto", name: "T" },
    });
    const fila = JSON.stringify(mockInsert.mock.calls[0][0]);
    expect(fila).not.toContain("secreto");
    expect(fila).toContain("[REDACTED]");
  });
});
