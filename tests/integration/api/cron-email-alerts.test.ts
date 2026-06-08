import { NextRequest } from "next/server";

const mockFrom = jest.fn();
const mockSendAlerts = jest.fn();

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom })),
}));

jest.mock("@/lib/email-alerts", () => ({
  sendEmailAlertsForStore: mockSendAlerts,
}));

function makeRequest(secret?: string) {
  return new NextRequest("http://localhost/api/cron/email-alerts", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("GET /api/cron/email-alerts", () => {
  const CRON_SECRET = "test-cron-secret";

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("I-271: retorna 401 sin token de autorización", async () => {
    const { GET } = await import("@/app/api/cron/email-alerts/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("I-272: retorna processed:0 cuando no hay tiendas con email habilitado", async () => {
    mockFrom.mockReturnValue({
      data: [], error: null,
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    });
    const { GET } = await import("@/app/api/cron/email-alerts/route");
    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
  });

  it("I-273: procesa alertas para cada tienda habilitada", async () => {
    const stores = [{ id: "s1" }, { id: "s2" }];
    mockFrom.mockReturnValue({
      data: stores, error: null,
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    });
    mockSendAlerts.mockResolvedValue({ sent: 2 });
    const { GET } = await import("@/app/api/cron/email-alerts/route");
    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(2);
    expect(body.sent).toBe(4);
    expect(mockSendAlerts).toHaveBeenCalledTimes(2);
  });
});
