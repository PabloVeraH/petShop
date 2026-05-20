/**
 * Tests I-249 a I-250: GET /api/audit-logs/summary
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const USER_ID = "user_admin";

const mockAuth = jest.fn();
const mockFrom = jest.fn();

jest.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
}));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom })),
}));

describe("GET /api/audit-logs/summary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // I-249
  it("I-249: GET audit-logs/summary sin auth → 401", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const { GET } = await import("@/app/api/audit-logs/summary/route");
    const res = await GET(new NextRequest("http://localhost/api/audit-logs/summary"));
    expect(res.status).toBe(401);
  });

  // I-250
  it("I-250: storeAdmin → 200 con estructura correcta", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });

    const mockAuditLogs = [
      { action: "CREATE", user_id: "user-1", result: "success", created_at: "2026-05-20T10:00:00Z" },
      { action: "UPDATE", user_id: "user-1", result: "success", created_at: "2026-05-19T10:00:00Z" },
      { action: "DELETE", user_id: "user-2", result: "failure", created_at: "2026-05-18T10:00:00Z" },
    ];

    const selectMock = jest.fn().mockReturnThis();
    const eqMock = jest.fn().mockReturnThis();
    const gteMock = jest.fn().mockReturnThis();

    let callCount = 0;
    const resolvedValue = (data: unknown[]) => ({
      data,
      error: null,
    });

    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: selectMock.mockReturnThis(),
          eq: eqMock.mockReturnThis(),
          gte: gteMock.mockResolvedValue(resolvedValue(mockAuditLogs)),
        };
      }
      return {
        select: selectMock.mockReturnThis(),
        eq: eqMock.mockReturnThis(),
        gte: gteMock.mockResolvedValue(resolvedValue([])),
      };
    });
    eqMock.mockReturnValue({
      select: selectMock.mockReturnThis(),
      eq: eqMock.mockReturnThis(),
      gte: gteMock.mockResolvedValue(resolvedValue([])),
    });
    selectMock.mockReturnValue({
      eq: eqMock.mockReturnThis(),
      gte: gteMock.mockResolvedValue(resolvedValue([])),
    });

    const { GET } = await import("@/app/api/audit-logs/summary/route");
    const res = await GET(new NextRequest("http://localhost/api/audit-logs/summary"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("total_last_30_days");
    expect(body).toHaveProperty("by_action");
    expect(body).toHaveProperty("by_user");
    expect(body).toHaveProperty("failures_last_7_days");
    expect(body).toHaveProperty("critical_errors_last_24h");
    expect(Array.isArray(body.by_action)).toBe(true);
    expect(Array.isArray(body.by_user)).toBe(true);
  });
});
