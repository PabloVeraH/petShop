/**
 * Tests U-136 a U-139: admin-check functions (DB cross-verify, stale JWT)
 *
 * U-136 requireSystemAdminConsistent lanza Error si admin es null
 * U-136b requireSystemAdminConsistent lanza Error si isSystemAdmin es false
 * U-137 requireSystemAdminConsistent lanza Error si DB no confirma system_admin
 * U-138 requireSystemAdminConsistent pasa si DB confirma system_admin
 * U-139 resolveAdminContext corrige claim stale (JWT systemAdmin, DB storeAdmin)
 */

const mockFrom = jest.fn();
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

function makeDbResult(system_admin: boolean) {
  const c: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { system_admin }, error: null }),
  };
  return c;
}

describe("requireSystemAdminConsistent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("U-136: lanza Error si admin es null", async () => {
    const { requireSystemAdminConsistent } = await import("@/lib/admin-check");
    await expect(requireSystemAdminConsistent(null)).rejects.toThrow("System admin required");
  });

  it("U-136b: lanza Error si admin no es systemAdmin", async () => {
    const { requireSystemAdminConsistent } = await import("@/lib/admin-check");
    await expect(
      requireSystemAdminConsistent({ userId: "u1", storeId: "s1", isStoreAdmin: true, isSystemAdmin: false })
    ).rejects.toThrow("System admin required");
  });

  it("U-137: lanza Error si DB no confirma system_admin", async () => {
    mockFrom.mockReturnValue(makeDbResult(false));
    const { requireSystemAdminConsistent } = await import("@/lib/admin-check");
    await expect(
      requireSystemAdminConsistent({ userId: "u1", storeId: "s1", isStoreAdmin: false, isSystemAdmin: true })
    ).rejects.toThrow("System admin required");
    // Verifica que consultó clerk_users
    expect(mockFrom).toHaveBeenCalledWith("clerk_users");
  });

  it("U-138: no lanza si DB confirma system_admin", async () => {
    mockFrom.mockReturnValue(makeDbResult(true));
    const { requireSystemAdminConsistent } = await import("@/lib/admin-check");
    await expect(
      requireSystemAdminConsistent({ userId: "u1", storeId: "s1", isStoreAdmin: false, isSystemAdmin: true })
    ).resolves.toBeUndefined();
    expect(mockFrom).toHaveBeenCalledWith("clerk_users");
  });
});

describe("resolveAdminContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("U-139: corrige JWT stale (JWT systemAdmin, DB storeAdmin)", async () => {
    mockFrom.mockReturnValue(makeDbResult(false));
    const { resolveAdminContext } = await import("@/lib/admin-check");
    const result = await resolveAdminContext({
      userId: "u1",
      storeId: "s1",
      isStoreAdmin: false,
      isSystemAdmin: true,
    });
    expect(result).toEqual({
      userId: "u1",
      storeId: "s1",
      isStoreAdmin: false,
      isSystemAdmin: false,
    });
  });

  it("U-139b: NO corrige si DB confirma system_admin", async () => {
    mockFrom.mockReturnValue(makeDbResult(true));
    const { resolveAdminContext } = await import("@/lib/admin-check");
    const result = await resolveAdminContext({
      userId: "u1",
      storeId: "s1",
      isStoreAdmin: false,
      isSystemAdmin: true,
    });
    expect(result).toEqual({
      userId: "u1",
      storeId: "s1",
      isStoreAdmin: false,
      isSystemAdmin: true,
    });
  });

  it("U-139c: retorna admin sin cambios si no es systemAdmin", async () => {
    const { resolveAdminContext } = await import("@/lib/admin-check");
    const result = await resolveAdminContext({
      userId: "u1",
      storeId: "s1",
      isStoreAdmin: true,
      isSystemAdmin: false,
    });
    expect(result).toEqual({
      userId: "u1",
      storeId: "s1",
      isStoreAdmin: true,
      isSystemAdmin: false,
    });
    // No debe consultar DB para no-systemAdmin
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("U-139d: retorna null si input es null", async () => {
    const { resolveAdminContext } = await import("@/lib/admin-check");
    const result = await resolveAdminContext(null);
    expect(result).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
