import { NextRequest } from "next/server";

const mockRpc = jest.fn();

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ rpc: mockRpc })),
}));

function makeRequest(secret?: string) {
  return new NextRequest("http://localhost/api/cron/audit-cleanup", {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("POST /api/cron/audit-cleanup", () => {
  const CRON_SECRET = "test-cron-secret";

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("I-268: retorna 401 sin token de autorización", async () => {
    const { POST } = await import("@/app/api/cron/audit-cleanup/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("I-269: retorna 401 con token incorrecto", async () => {
    const { POST } = await import("@/app/api/cron/audit-cleanup/route");
    const res = await POST(makeRequest("wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("I-270: limpia logs antiguos y retorna ok con token válido", async () => {
    mockRpc.mockResolvedValue({ error: null });
    const { POST } = await import("@/app/api/cron/audit-cleanup/route");
    const res = await POST(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("clean_old_audit_logs");
  });
});
