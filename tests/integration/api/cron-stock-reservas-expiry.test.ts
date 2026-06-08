import { NextRequest } from "next/server";

const mockFrom = jest.fn();

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom })),
}));

function makeRequest(secret?: string) {
  return new NextRequest("http://localhost/api/cron/stock-reservas-expiry", {
    method: "POST",
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
}

describe("POST /api/cron/stock-reservas-expiry", () => {
  const CRON_SECRET = "test-cron-secret";

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("I-274: retorna 401 sin token de autorización", async () => {
    const { POST } = await import("@/app/api/cron/stock-reservas-expiry/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("I-275: retorna ok con expired:0 cuando no hay reservas vencidas", async () => {
    mockFrom.mockReturnValue({
      data: [], error: null,
      select: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    });
    const { POST } = await import("@/app/api/cron/stock-reservas-expiry/route");
    const res = await POST(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.expired).toBe(0);
  });

  it("I-276: marca reservas como expiradas y retorna el conteo", async () => {
    const expiredReservations = [{ id: "r1" }, { id: "r2" }];
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) {
        return {
          data: expiredReservations, error: null,
          select: jest.fn().mockReturnThis(),
          lt: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
        };
      }
      return {
        error: null,
        update: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ error: null }),
      };
    });
    const { POST } = await import("@/app/api/cron/stock-reservas-expiry/route");
    const res = await POST(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expired).toBe(2);
  });
});
