/**
 * Tests I-201 to I-204: POST /api/email/send-alerts
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockSendEmailAlertsForStore = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/email-alerts", () => ({ sendEmailAlertsForStore: mockSendEmailAlertsForStore }));

describe("POST /api/email/send-alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  it("I-201: retorna sent=0 cuando email_reminder_enabled=false", async () => {
    mockSendEmailAlertsForStore.mockResolvedValue({ sent: 0, skipped: 0, reason: "disabled" });
    const { POST } = await import("@/app/api/email/send-alerts/route");
    const res = await POST(new NextRequest("http://localhost/api/email/send-alerts", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(0);
    expect(body.reason).toBe("disabled");
  });

  it("I-202: sin authorization retorna 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/email/send-alerts/route");
    const res = await POST(new NextRequest("http://localhost/api/email/send-alerts", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("I-203: envía correctamente y retorna sent > 0", async () => {
    mockSendEmailAlertsForStore.mockResolvedValue({ sent: 2, skipped: 0 });
    const { POST } = await import("@/app/api/email/send-alerts/route");
    const res = await POST(new NextRequest("http://localhost/api/email/send-alerts", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(2);
  });

  it("I-204: skips clientes sin email", async () => {
    mockSendEmailAlertsForStore.mockResolvedValue({ sent: 1, skipped: 3 });
    const { POST } = await import("@/app/api/email/send-alerts/route");
    const res = await POST(new NextRequest("http://localhost/api/email/send-alerts", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(3);
  });
});