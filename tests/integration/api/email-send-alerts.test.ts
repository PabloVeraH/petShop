/**
 * Tests I-201 to I-204, I-756 a I-758: POST /api/email/send-alerts
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockSendEmailAlertsForStore = jest.fn();
const mockAuth = jest.fn();
const mockDeshabilitado = jest.fn();
const mockLogAudit = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/email-alerts", () => ({ sendEmailAlertsForStore: mockSendEmailAlertsForStore }));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
jest.mock("@/lib/usuario-habilitado", () => ({ usuarioDeshabilitado: (...a: unknown[]) => mockDeshabilitado(...a) }));
jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler: unknown) => handler,
  logAudit: mockLogAudit,
  getRequestMetadata: jest.fn(() => ({ ipAddress: "127.0.0.1", userAgent: "test-agent" })),
}));

const ADMIN = { sub: "u1", publicMetadata: { storeId: STORE_ID, storeAdmin: true } };
const WORKER = { sub: "u1", publicMetadata: { storeId: STORE_ID } };

const req = () => new NextRequest("http://localhost/api/email/send-alerts", { method: "POST" });

describe("POST /api/email/send-alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({ sessionClaims: ADMIN });
    mockDeshabilitado.mockResolvedValue(false);
  });

  it("I-201: retorna sent=0 cuando email_reminder_enabled=false", async () => {
    mockSendEmailAlertsForStore.mockResolvedValue({ sent: 0, skipped: 0, reason: "disabled" });
    const { POST } = await import("@/app/api/email/send-alerts/route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(0);
    expect(body.reason).toBe("disabled");
  });

  it("I-202: sin authorization retorna 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/email/send-alerts/route");
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it("I-203: envía correctamente y retorna sent > 0", async () => {
    mockSendEmailAlertsForStore.mockResolvedValue({ sent: 2, skipped: 0 });
    const { POST } = await import("@/app/api/email/send-alerts/route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(2);
  });

  it("I-204: skips clientes sin email", async () => {
    mockSendEmailAlertsForStore.mockResolvedValue({ sent: 1, skipped: 3 });
    const { POST } = await import("@/app/api/email/send-alerts/route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(3);
  });

  it("I-756: un vendedor (storeWorker) recibe 403 y no se envía nada", async () => {
    mockAuth.mockResolvedValue({ sessionClaims: WORKER });
    const { POST } = await import("@/app/api/email/send-alerts/route");
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mockSendEmailAlertsForStore).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("I-757: un usuario deshabilitado recibe 403 y no se envía nada", async () => {
    mockDeshabilitado.mockResolvedValue(true);
    const { POST } = await import("@/app/api/email/send-alerts/route");
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mockSendEmailAlertsForStore).not.toHaveBeenCalled();
  });

  it("I-758: el envío del admin queda en auditoría con quién, tienda y resultado", async () => {
    mockSendEmailAlertsForStore.mockResolvedValue({ sent: 2, skipped: 1 });
    const { POST } = await import("@/app/api/email/send-alerts/route");
    await POST(req());
    expect(mockSendEmailAlertsForStore).toHaveBeenCalledWith(STORE_ID);
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      storeId: STORE_ID,
      userId: "u1",
      action: "CREATE",
      entityType: "envio_alertas",
      newValues: { canal: "email", sent: 2, skipped: 1 },
      ipAddress: "127.0.0.1",
    }));
  });
});
