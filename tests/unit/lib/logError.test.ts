/**
 * Tests U-109 a U-113: logError() y handleRouteError()
 */
const mockInsert = jest.fn();
const mockEq = jest.fn();

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: mockInsert,
    })),
  })),
}));

describe("logError()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
  });

  // U-109
  it("U-109: logError inserta en error_logs", async () => {
    const { logError } = await import("@/lib/audit");
    await logError({ errorMessage: "test error" });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        error_message: "test error",
        store_id: null,
        user_id: null,
        error_code: null,
        stack_trace: null,
        context: null,
        severity: "ERROR",
        endpoint: null,
        ip_address: null,
        user_agent: null,
      })
    );
  });

  // U-110
  it("U-110: logError con todos los campos opcionales", async () => {
    const { logError } = await import("@/lib/audit");
    await logError({
      storeId: "store-123",
      userId: "user-456",
      errorCode: "VENTA_CREATE_FAILED",
      errorMessage: "DB timeout",
      stackTrace: "Error at line 42",
      context: { endpoint: "/api/ventas", method: "POST" },
      severity: "CRITICAL",
      endpoint: "/api/ventas",
      ipAddress: "10.0.0.1",
      userAgent: "Chrome/120",
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        store_id: "store-123",
        user_id: "user-456",
        error_code: "VENTA_CREATE_FAILED",
        error_message: "DB timeout",
        stack_trace: "Error at line 42",
        context: { endpoint: "/api/ventas", method: "POST" },
        severity: "CRITICAL",
        endpoint: "/api/ventas",
        ip_address: "10.0.0.1",
        user_agent: "Chrome/120",
      })
    );
  });

  // U-111
  it("U-111: logError sin storeId usa null", async () => {
    const { logError } = await import("@/lib/audit");
    await logError({ errorMessage: "no store context" });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        store_id: null,
      })
    );
  });

  // U-112
  it("U-112: logError fallando en BD → solo console.error, no throw", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockInsert.mockResolvedValue({ error: { message: "Connection refused" } });

    const { logError } = await import("@/lib/audit");
    await expect(logError({ errorMessage: "should not throw" })).resolves.not.toThrow();

    expect(consoleSpy).toHaveBeenCalledWith(
      "[logError] Failed to save error log:",
      "Connection refused"
    );
    consoleSpy.mockRestore();
  });
});

describe("handleRouteError()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
  });

  // U-113
  it("U-113: handleRouteError retorna 500 y llama logError", async () => {
    const { handleRouteError } = await import("@/lib/audit");
    const err = new Error("DB connection failed");
    const response = await handleRouteError(err, {
      storeId: "store-123",
      userId: "user-456",
      endpoint: "/api/ventas",
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Error interno del servidor");
  });
});
