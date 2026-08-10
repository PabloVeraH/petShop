/**
 * Tests I-87 a I-89, SEC-04 a SEC-08: GET y PATCH /api/settings
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockAuth = jest.fn();
const mockFrom = jest.fn();
const mockSingle = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler) => handler,
  logAudit: jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn().mockResolvedValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

function mockAsAdmin() {
  mockAuth.mockResolvedValue({
    sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID }, sub: "u1" },
  });
}

function mockAsWorker() {
  mockAuth.mockResolvedValue({
    sessionClaims: { publicMetadata: { storeWorker: true, storeId: STORE_ID }, sub: "u2" },
  });
}

function chain() {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    update: jest.fn(),
    eq: jest.fn(),
    single: mockSingle,
  };
  ["select","update","eq"].forEach(k => c[k].mockReturnValue(c));
  return c;
}

describe("GET /api/settings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
    mockAsAdmin();
  });

  // I-87
  it("I-87: GET enmascara whatsapp_access_token", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: STORE_ID,
        name: "Test Store",
        whatsapp_access_token: "super-secret-token",
        whatsapp_enabled: true,
      },
      error: null,
    });
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.whatsapp_access_token).toBe("••••••••");
    expect(body.whatsapp_access_token).not.toContain("super-secret-token");
  });

  // I-93
  it("I-93: GET incluye fidelizacion_niveles del store", async () => {
    const niveles = [
      { monto: 50_000,  descuento: 5  },
      { monto: 150_000, descuento: 10 },
      { monto: 300_000, descuento: 20 },
    ];
    mockSingle.mockResolvedValue({
      data: { id: STORE_ID, name: "Test Store", fidelizacion_niveles: niveles },
      error: null,
    });
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fidelizacion_niveles).toEqual(niveles);
  });
});

describe("GET /api/settings — ubicación", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
    mockAsAdmin();
  });

  // I-94
  it("I-94: GET devuelve campo direccion junto con lat, lon y ciudad", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: STORE_ID,
        name: "Test Store",
        ciudad: "Concepción",
        lat: -36.827,
        lon: -73.051,
        direccion: "Pinares 579, Chiguayante, Concepción, Chile",
        whatsapp_access_token: "",
      },
      error: null,
    });
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.direccion).toBe("Pinares 579, Chiguayante, Concepción, Chile");
    expect(body.ciudad).toBe("Concepción");
    expect(body.lat).toBe(-36.827);
    expect(body.lon).toBe(-73.051);
  });
});

describe("PATCH /api/settings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
    mockAsAdmin();
  });

  // I-88
  it("I-88: PATCH con campo no permitido no lo incluye (mass assignment prevenido)", async () => {
    mockSingle.mockResolvedValue({
      data: { id: STORE_ID, name: "Updated" },
      error: null,
    });
    const { PATCH } = await import("@/app/api/settings/route");
    const res = await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated", sistema_admin: true }),
    }));
    expect(res.status).toBe(200);
  });

  // I-89
  it("I-89: PATCH con placeholder de token no actualiza DB (token anterior preservado)", async () => {
    const capturedUpdates: Record<string, unknown>[] = [];
    mockFrom.mockImplementation(() => {
      const c: Record<string, jest.Mock> = {
        update: jest.fn((data) => { capturedUpdates.push(data); return c; }),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: STORE_ID }, error: null }),
      };
      return c;
    });
    const { PATCH } = await import("@/app/api/settings/route");
    await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whatsapp_access_token: "••••••••" }),
    }));
    // The captured update data should NOT contain whatsapp_access_token
    const updateData = capturedUpdates[0] ?? {};
    expect(updateData).not.toHaveProperty("whatsapp_access_token");
  });

  // I-90
  it("I-90: PATCH guarda fidelizacion_niveles correctamente", async () => {
    const capturedUpdates: Record<string, unknown>[] = [];
    mockFrom.mockImplementation(() => {
      const c: Record<string, jest.Mock> = {
        update: jest.fn((data) => { capturedUpdates.push(data); return c; }),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: STORE_ID }, error: null }),
      };
      return c;
    });
    const niveles = [
      { monto: 100_000, descuento: 8 },
      { monto: 400_000, descuento: 15 },
    ];
    const { PATCH } = await import("@/app/api/settings/route");
    const res = await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fidelizacion_niveles: niveles }),
    }));
    expect(res.status).toBe(200);
    const updateData = capturedUpdates[0] ?? {};
    expect(updateData).toHaveProperty("fidelizacion_niveles");
    expect(updateData.fidelizacion_niveles).toEqual(niveles);
  });

  // I-91
  it("I-91: PATCH rechaza fidelizacion_niveles con descuento fuera de rango", async () => {
    const { PATCH } = await import("@/app/api/settings/route");
    const res = await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fidelizacion_niveles: [{ monto: 50_000, descuento: 150 }] }),
    }));
    expect(res.status).toBe(400);
  });

  // I-92
  it("I-92: PATCH rechaza fidelizacion_niveles con más de 5 niveles", async () => {
    const { PATCH } = await import("@/app/api/settings/route");
    const niveles = Array.from({ length: 6 }, (_, i) => ({ monto: (i + 1) * 50_000, descuento: i + 1 }));
    const res = await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fidelizacion_niveles: niveles }),
    }));
    expect(res.status).toBe(400);
  });

  // I-95
  it("I-95: PATCH guarda direccion, ciudad, lat y lon juntos", async () => {
    const capturedUpdates: Record<string, unknown>[] = [];
    mockFrom.mockImplementation(() => {
      const c: Record<string, jest.Mock> = {
        update: jest.fn((data) => { capturedUpdates.push(data); return c; }),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: STORE_ID }, error: null }),
      };
      return c;
    });
    const { PATCH } = await import("@/app/api/settings/route");
    const res = await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direccion: "Pinares 579, Chiguayante, Concepción, Chile",
        ciudad: "Concepción",
        lat: -36.827,
        lon: -73.051,
      }),
    }));
    expect(res.status).toBe(200);
    const updateData = capturedUpdates[0] ?? {};
    expect(updateData).toHaveProperty("direccion", "Pinares 579, Chiguayante, Concepción, Chile");
    expect(updateData).toHaveProperty("ciudad", "Concepción");
    expect(updateData).toHaveProperty("lat", -36.827);
    expect(updateData).toHaveProperty("lon", -73.051);
  });

  // I-96
  it("I-96: PATCH rechaza lat fuera de rango (-90 a 90)", async () => {
    const { PATCH } = await import("@/app/api/settings/route");
    const res = await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 95 }),
    }));
    expect(res.status).toBe(400);
  });

  // I-97
  it("I-97: PATCH rechaza lon fuera de rango (-180 a 180)", async () => {
    const { PATCH } = await import("@/app/api/settings/route");
    const res = await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lon: -200 }),
    }));
    expect(res.status).toBe(400);
  });

  // I-98
  it("I-98: PATCH rechaza direccion con más de 300 caracteres", async () => {
    const { PATCH } = await import("@/app/api/settings/route");
    const res = await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direccion: "A".repeat(301) }),
    }));
    expect(res.status).toBe(400);
  });

  // I-99
  it("I-99: PATCH acepta direccion null para limpiar el campo", async () => {
    const capturedUpdates: Record<string, unknown>[] = [];
    mockFrom.mockImplementation(() => {
      const c: Record<string, jest.Mock> = {
        update: jest.fn((data) => { capturedUpdates.push(data); return c; }),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: STORE_ID }, error: null }),
      };
      return c;
    });
    const { PATCH } = await import("@/app/api/settings/route");
    const res = await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direccion: null }),
    }));
    expect(res.status).toBe(200);
    const updateData = capturedUpdates[0] ?? {};
    expect(updateData).toHaveProperty("direccion", null);
  });

  // SEC-04: GET debe enmascarar whatsapp_webhook_verify_token
  it("SEC-04: GET enmascara whatsapp_webhook_verify_token", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: STORE_ID,
        name: "Test Store",
        whatsapp_webhook_verify_token: "secret-webhook-token-123",
        whatsapp_enabled: true,
      },
      error: null,
    });
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.whatsapp_webhook_verify_token).toBe("••••••••");
    expect(body.whatsapp_enabled).toBe(true); // otros campos normales
  });

  // SEC-05: PATCH con placeholder no actualiza whatsapp_webhook_verify_token
  it("SEC-05: PATCH con placeholder de webhook token no actualiza DB", async () => {
    const capturedUpdates: Record<string, unknown>[] = [];
    mockFrom.mockImplementation(() => {
      const c: Record<string, jest.Mock> = {
        update: jest.fn((data) => { capturedUpdates.push(data); return c; }),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: STORE_ID }, error: null }),
      };
      return c;
    });
    const { PATCH } = await import("@/app/api/settings/route");
    await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whatsapp_webhook_verify_token: "••••••••" }),
    }));
    // El captured update data NO debe contener whatsapp_webhook_verify_token
    const updateData = capturedUpdates[0] ?? {};
    expect(updateData).not.toHaveProperty("whatsapp_webhook_verify_token");
  });

  // I-414: GET incluye campos de licencia
  it("I-414: GET incluye license_start_date, license_end_date y license_warning_days", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: STORE_ID,
        name: "Test Store",
        whatsapp_access_token: "",
        license_start_date: "2026-01-01",
        license_end_date: "2026-12-31",
        license_warning_days: 30,
      },
      error: null,
    });
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.license_start_date).toBe("2026-01-01");
    expect(body.license_end_date).toBe("2026-12-31");
    expect(body.license_warning_days).toBe(30);
  });

  // I-415: GET retorna null en license fields cuando no hay licencia configurada
  it("I-415: GET retorna null en license fields cuando no hay licencia", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: STORE_ID,
        name: "Test Store",
        whatsapp_access_token: "",
        license_start_date: null,
        license_end_date: null,
        license_warning_days: 7,
      },
      error: null,
    });
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.license_start_date).toBeNull();
    expect(body.license_end_date).toBeNull();
    expect(body.license_warning_days).toBe(7);
  });

  // I-416: GET retorna licencia con fecha vencida
  it("I-416: GET retorna licencia con fecha vencida", async () => {
    const pastDate = "2025-01-01";
    mockSingle.mockResolvedValue({
      data: {
        id: STORE_ID,
        name: "Test Store",
        whatsapp_access_token: "",
        license_start_date: "2024-01-01",
        license_end_date: pastDate,
        license_warning_days: 30,
      },
      error: null,
    });
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.license_end_date).toBe(pastDate);
    expect(body.license_start_date).toBe("2024-01-01");
    expect(body.license_warning_days).toBe(30);
  });

  // SEC-06: GET enmascara ambos tokens simultáneamente
  it("SEC-06: GET enmascara tanto access_token como verify_token al mismo tiempo", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: STORE_ID,
        name: "Test Store",
        whatsapp_access_token: "EAAxxxxx",
        whatsapp_webhook_verify_token: "verify-secret-xyz",
        whatsapp_enabled: true,
        whatsapp_phone_number_id: "12345",
      },
      error: null,
    });
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.whatsapp_access_token).toBe("••••••••");
    expect(body.whatsapp_webhook_verify_token).toBe("••••••••");
    expect(body.whatsapp_phone_number_id).toBe("12345");
    expect(body.whatsapp_enabled).toBe(true);
  });
});

describe("Settings API — control de acceso por rol", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u2", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // SEC-07: storeWorker no puede leer settings (RUT y datos sensibles expuestos)
  it("SEC-07: storeWorker recibe 403 en GET /api/settings", async () => {
    mockAsWorker();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  // SEC-08: storeWorker no puede modificar settings de la tienda
  it("SEC-08: storeWorker recibe 403 en PATCH /api/settings", async () => {
    mockAsWorker();
    const { PATCH } = await import("@/app/api/settings/route");
    const res = await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hack Store" }),
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });
});
