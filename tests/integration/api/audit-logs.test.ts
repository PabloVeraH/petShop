/**
 * Tests I-223 a I-232: GET /api/audit-logs
 * Audit logs endpoint con auth, roles, filtros, paginación y manejo de errores.
 */
import { NextRequest } from "next/server";

const STORE_ID     = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_STORE  = "123e4567-e89b-12d3-a456-426614174001";
const USER_ID      = "user_admin_01";

const mockAuth         = jest.fn();
const mockGetAdminStatus = jest.fn();
const mockFrom         = jest.fn();

jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
jest.mock("@/lib/admin-check", () => ({ getAdminStatus: mockGetAdminStatus }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

function makeUrl(path: string, params?: Record<string, string>) {
  const url = new URL(`http://localhost${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, v);
    });
  }
  return new NextRequest(url.toString());
}

function auditLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-001",
    store_id: STORE_ID,
    user_id: "u1",
    action: "CREATE",
    entity_type: "producto",
    entity_id: "prod-1",
    old_values: null,
    new_values: { nombre: "Producto A" },
    change_description: "Creado",
    ip_address: "127.0.0.1",
    user_agent: "test",
    result: "success",
    error_message: null,
    created_at: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

function chain(data: unknown[] = [], count?: number) {
  const resolved = Promise.resolve({ data, error: null, count: count ?? data.length });
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    eq: jest.fn(),
    gte: jest.fn(),
    lte: jest.fn(),
    order: jest.fn(),
    range: jest.fn(),
    throwOnError: jest.fn(),
  };
  ["select", "eq", "gte", "lte"].forEach(k => c[k].mockReturnValue(c));
  c.order.mockReturnValue(c);
  c.range.mockReturnValue(c);
  c.throwOnError.mockReturnValue(resolved);
  return c;
}

// ──────────────────────────────────────────────────────────────────────────────
// I-223: sin autenticación → 401
// ──────────────────────────────────────────────────────────────────────────────

describe("GET /api/audit-logs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // I-223
  it("I-223: sin autenticación → 401", async () => {
    mockAuth.mockResolvedValue({ userId: null, sessionClaims: null });

    const { GET } = await import("@/app/api/audit-logs/route");
    const res = await GET(makeUrl("/api/audit-logs"));

    expect(res.status).toBe(401);
  });

  // I-224
  it("I-224: storeWorker → 403", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeWorker: true } },
    });
    mockGetAdminStatus.mockReturnValue({
      isSystemAdmin: false,
      isStoreAdmin: false,
      isStoreWorker: true,
      storeId: STORE_ID,
      userId: USER_ID,
    });

    const { GET } = await import("@/app/api/audit-logs/route");
    const res = await GET(makeUrl("/api/audit-logs"));

    expect(res.status).toBe(403);
  });

  // I-225
  it("I-225: storeAdmin → 200 con datos de su tienda", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({
      isSystemAdmin: false,
      isStoreAdmin: true,
      storeId: STORE_ID,
      userId: USER_ID,
    });

    const logs = [auditLog(), auditLog({ id: "log-002", action: "UPDATE" })];
    mockFrom.mockReturnValue(chain(logs, 2));

    const { GET } = await import("@/app/api/audit-logs/route");
    const res = await GET(makeUrl("/api/audit-logs"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.count).toBe(2);
    expect(body.offset).toBe(0);
    expect(body.limit).toBe(50);
  });

  // I-226
  it("I-226: storeAdmin no puede ver otros stores", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({
      isSystemAdmin: false,
      isStoreAdmin: true,
      storeId: STORE_ID,
      userId: USER_ID,
    });

    const c = chain([]);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/audit-logs/route");
    const res = await GET(makeUrl("/api/audit-logs", { store_id: OTHER_STORE }));

    expect(res.status).toBe(200);
    // El store_id del query params es ignorado; se usa el del admin
    expect(c.eq).toHaveBeenCalledWith("store_id", STORE_ID);
  });

  // I-227
  it("I-227: systemAdmin puede filtrar por cualquier store_id", async () => {
    mockAuth.mockResolvedValue({
      userId: "sysadmin_01",
      sessionClaims: { publicMetadata: { systemAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({
      isSystemAdmin: true,
      isStoreAdmin: false,
      storeId: null,
      userId: "sysadmin_01",
    });

    const logs = [auditLog({ store_id: OTHER_STORE })];
    const c = chain(logs, 1);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/audit-logs/route");
    const res = await GET(makeUrl("/api/audit-logs", { store_id: OTHER_STORE }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].store_id).toBe(OTHER_STORE);
    expect(c.eq).toHaveBeenCalledWith("store_id", OTHER_STORE);
  });

  // I-228
  it("I-228: filtros de acción y entity_type funcionan", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({
      isSystemAdmin: false,
      isStoreAdmin: true,
      storeId: STORE_ID,
      userId: USER_ID,
    });

    const filteredLogs = [auditLog({ action: "DELETE", entity_type: "venta" })];
    const c = chain(filteredLogs, 1);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/audit-logs/route");
    const res = await GET(makeUrl("/api/audit-logs", {
      action: "DELETE",
      entity_type: "venta",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].action).toBe("DELETE");
    expect(body.data[0].entity_type).toBe("venta");
    expect(c.eq).toHaveBeenCalledWith("action", "DELETE");
    expect(c.eq).toHaveBeenCalledWith("entity_type", "venta");
  });

  // I-229
  it("I-229: filtro de fechas funciona", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({
      isSystemAdmin: false,
      isStoreAdmin: true,
      storeId: STORE_ID,
      userId: USER_ID,
    });

    const logs = [auditLog({ created_at: "2026-01-10T10:00:00Z" })];
    const c = chain(logs, 1);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/audit-logs/route");
    const res = await GET(makeUrl("/api/audit-logs", {
      desde: "2026-01-01T00:00:00Z",
      hasta: "2026-01-31T23:59:59Z",
    }));

    expect(res.status).toBe(200);
    expect(c.gte).toHaveBeenCalledWith("created_at", "2026-01-01T00:00:00Z");
    expect(c.lte).toHaveBeenCalledWith("created_at", "2026-01-31T23:59:59Z");
  });

  // I-230
  it("I-230: paginación funciona", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({
      isSystemAdmin: false,
      isStoreAdmin: true,
      storeId: STORE_ID,
      userId: USER_ID,
    });

    const logs = [auditLog({ id: "log-051" }), auditLog({ id: "log-052" })];
    const c = chain(logs, 200);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/audit-logs/route");
    const res = await GET(makeUrl("/api/audit-logs", {
      offset: "50",
      limit: "20",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.offset).toBe(50);
    expect(body.limit).toBe(20);
    expect(body.count).toBe(200);
    expect(c.range).toHaveBeenCalledWith(50, 69);
  });

  // I-231
  it("I-231: limit máximo es 100", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({
      isSystemAdmin: false,
      isStoreAdmin: true,
      storeId: STORE_ID,
      userId: USER_ID,
    });

    const c = chain([], 0);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/audit-logs/route");
    const res = await GET(makeUrl("/api/audit-logs", { limit: "200" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  // I-232
  it("I-232: error de BD → 500", async () => {
    mockAuth.mockResolvedValue({
      userId: USER_ID,
      sessionClaims: { publicMetadata: { storeId: STORE_ID, storeAdmin: true } },
    });
    mockGetAdminStatus.mockReturnValue({
      isSystemAdmin: false,
      isStoreAdmin: true,
      storeId: STORE_ID,
      userId: USER_ID,
    });

    const errorResult = Promise.resolve({ data: null, error: { message: "connection refused" }, count: 0 });
    const c: Record<string, jest.Mock> = {
      select: jest.fn(),
      eq: jest.fn(),
      gte: jest.fn(),
      lte: jest.fn(),
      order: jest.fn(),
      range: jest.fn(),
      throwOnError: jest.fn(),
    };
    ["select", "eq", "gte", "lte"].forEach(k => c[k].mockReturnValue(c));
    c.order.mockReturnValue(c);
    c.range.mockReturnValue(c);
    c.throwOnError.mockReturnValue(errorResult);
    mockFrom.mockReturnValue(c);

    const { GET } = await import("@/app/api/audit-logs/route");
    const res = await GET(makeUrl("/api/audit-logs"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Error interno del servidor");
  });
});
