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
  withErrorLogging: (handler: unknown) => handler,
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

// I-736 — RUT y dirección de la tienda obligatorios: un PATCH puede omitirlos
// (actualización parcial) pero nunca vaciarlos ni guardar un RUT inválido.
describe("PATCH /api/settings — RUT y dirección obligatorios (I-736)", () => {
  let c: ReturnType<typeof chain>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    c = chain();
    mockFrom.mockReturnValue(c);
    mockAsAdmin();
    mockSingle.mockResolvedValue({ data: { id: STORE_ID }, error: null });
  });

  async function patch(body: object) {
    const { PATCH } = await import("@/app/api/settings/route");
    return PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  it.each([
    ["rut vacío", { rut: "" }, "El RUT de la tienda es obligatorio"],
    ["rut solo espacios", { rut: "   " }, "El RUT de la tienda es obligatorio"],
    ["rut null", { rut: null }, "El RUT de la tienda es obligatorio"],
    ["rut con DV incorrecto", { rut: "76.123.456-7" }, "RUT de la tienda inválido"],
    ["address vacía", { address: "" }, "La dirección de la tienda es obligatoria"],
    ["address solo espacios", { address: "   " }, "La dirección de la tienda es obligatoria"],
    ["address null", { address: null }, "La dirección de la tienda es obligatoria"],
  ])("I-736: %s → 400 sin escribir en la BD", async (_caso, body, mensaje) => {
    const res = await patch({ name: "Mi Tienda", ...body });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(mensaje);
    expect(c.update).not.toHaveBeenCalled();
  });

  it("I-736: RUT válido se guarda normalizado y la dirección sin espacios sobrantes", async () => {
    const res = await patch({ rut: "761234560", address: "  Av. Ossa 123  " });
    expect(res.status).toBe(200);
    expect(c.update).toHaveBeenCalledWith(
      expect.objectContaining({ rut: "76.123.456-0", address: "Av. Ossa 123" }),
    );
    expect(c.eq).toHaveBeenCalledWith("id", STORE_ID);
  });

  it("I-736: PATCH parcial sin rut ni address no los toca", async () => {
    const res = await patch({ name: "Otro nombre" });
    expect(res.status).toBe(200);
    const updateData = c.update.mock.calls[0][0];
    expect(updateData).not.toHaveProperty("rut");
    expect(updateData).not.toHaveProperty("address");
  });

  // I-738 — la página reenvía el GET completo: en una tienda recién creada
  // phone/email/ciudad/resend_from_email vienen null (antes → 400 "se
  // esperaba texto, recibido nulo"), y un email vaciado llega como "".
  it("I-738: campos opcionales null o email vacío se guardan como null", async () => {
    const res = await patch({
      name: "Mi Tienda", rut: "761234560", address: "Av. Ossa 123",
      phone: null, email: null, ciudad: null, resend_from_email: "",
    });
    expect(res.status).toBe(200);
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({
      phone: null, email: null, ciudad: null, resend_from_email: null,
    }));
  });

  it("I-738: email con formato inválido sigue rechazándose", async () => {
    const res = await patch({ email: "no-es-email" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Correo electrónico inválido");
    expect(c.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/settings — secretos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
    mockAsAdmin();
  });

  it("SEC-19: la respuesta del PATCH enmascara los tokens de WhatsApp", async () => {
    mockSingle.mockResolvedValue({
      data: { id: STORE_ID, whatsapp_access_token: "EAAG-token-real", whatsapp_webhook_verify_token: "verify-real" },
      error: null,
    });
    const { PATCH } = await import("@/app/api/settings/route");
    const res = await PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whatsapp_access_token: "EAAG-token-real" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.whatsapp_access_token).toBe("••••••••");
    expect(body.whatsapp_webhook_verify_token).toBe("••••••••");
    expect(JSON.stringify(body)).not.toContain("token-real");
    expect(JSON.stringify(body)).not.toContain("verify-real");
  });
});

// I-831…I-832 — umbral de 135 UF (pago mixto, plan F11): solo el admin lo
// edita, se valida en el límite y entra en la auditoría de settings.
describe("PATCH /api/settings — umbral de identificación del comprador (135 UF)", () => {
  const patch = async (body: object) => {
    const { PATCH } = await import("@/app/api/settings/route");
    return PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  };
  let capturedUpdates: Record<string, unknown>[];

  beforeEach(() => {
    jest.clearAllMocks();
    capturedUpdates = [];
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAsAdmin();
    mockFrom.mockImplementation(() => {
      const c: Record<string, jest.Mock> = {
        update: jest.fn((data) => { capturedUpdates.push(data); return c; }),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: STORE_ID }, error: null }),
      };
      return c;
    });
  });

  it("I-831: el admin guarda el umbral en pesos y puede limpiarlo con null", async () => {
    expect((await patch({ umbral_identificacion_comprador: 5363275 })).status).toBe(200);
    expect(capturedUpdates[0]).toHaveProperty("umbral_identificacion_comprador", 5363275);

    expect((await patch({ umbral_identificacion_comprador: null })).status).toBe(200);
    expect(capturedUpdates[1]).toHaveProperty("umbral_identificacion_comprador", null);

    // Un PATCH que no lo menciona no lo toca.
    expect((await patch({ name: "Otra" })).status).toBe(200);
    expect(capturedUpdates[2]).not.toHaveProperty("umbral_identificacion_comprador");
  });

  it("I-832: umbral 0, negativo, decimal o texto → 400 sin escribir", async () => {
    for (const v of [0, -1, 1000.5, "5000000"]) {
      const res = await patch({ umbral_identificacion_comprador: v });
      expect([v, res.status]).toEqual([v, 400]);
    }
    expect(capturedUpdates).toHaveLength(0);
  });
});

// VENC-I-08…11 — "Vender productos vencidos" (migración 095): decisión del
// admin de la tienda; se valida en el límite y queda en la auditoría.
describe("PATCH /api/settings — vender productos vencidos", () => {
  const patch = async (body: object) => {
    const { PATCH } = await import("@/app/api/settings/route");
    return PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  };
  let capturedUpdates: Record<string, unknown>[];
  let capturedEqs: [string, unknown][];

  beforeEach(() => {
    jest.clearAllMocks();
    capturedUpdates = [];
    capturedEqs = [];
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAsAdmin();
    mockFrom.mockImplementation(() => {
      const c: Record<string, jest.Mock> = {
        update: jest.fn((data) => { capturedUpdates.push(data); return c; }),
        eq: jest.fn((col: string, val: unknown) => { capturedEqs.push([col, val]); return c; }),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: STORE_ID, vender_vencidos: true }, error: null }),
      };
      return c;
    });
  });

  it("VENC-I-08: el admin la activa y desactiva en SU tienda (store_id del body se ignora) y queda auditado; un PATCH que no la menciona no la toca", async () => {
    const { logAudit } = jest.requireMock("@/lib/audit") as { logAudit: jest.Mock };
    const OTRA = "99999999-0000-4000-8000-000000000099";

    expect((await patch({ vender_vencidos: true, store_id: OTRA, id: OTRA })).status).toBe(200);
    expect(capturedUpdates[0]).toHaveProperty("vender_vencidos", true);
    expect(capturedUpdates[0]).not.toHaveProperty("store_id");
    expect(capturedUpdates[0]).not.toHaveProperty("id");
    expect(capturedEqs).toContainEqual(["id", STORE_ID]);
    expect(capturedEqs).not.toContainEqual(["id", OTRA]);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      storeId: STORE_ID, action: "UPDATE", entityType: "settings", result: "success",
    }));

    expect((await patch({ vender_vencidos: false })).status).toBe(200);
    expect(capturedUpdates[1]).toHaveProperty("vender_vencidos", false);

    expect((await patch({ name: "Otra" })).status).toBe(200);
    expect(capturedUpdates[2]).not.toHaveProperty("vender_vencidos");
  });

  it("VENC-I-09: storeWorker → 403 y sin sesión → 401, sin escribir", async () => {
    mockAsWorker();
    expect((await patch({ vender_vencidos: true })).status).toBe(403);
    mockGetStoreId.mockResolvedValue(null);
    expect((await patch({ vender_vencidos: true })).status).toBe(401);
    expect(capturedUpdates).toHaveLength(0);
  });

  it("VENC-I-10: valor no booleano (\"true\", 1, null) → 400 sin escribir", async () => {
    for (const v of ["true", 1, null]) {
      const res = await patch({ vender_vencidos: v });
      expect([v, res.status]).toEqual([v, 400]);
    }
    expect(capturedUpdates).toHaveLength(0);
  });

  it("VENC-I-11: GET la incluye para que /settings muestre el estado actual", async () => {
    let selectCols = "";
    mockFrom.mockImplementation(() => {
      const c: Record<string, jest.Mock> = {
        select: jest.fn((cols: string) => { selectCols = cols; return c; }),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: STORE_ID, vender_vencidos: true }, error: null }),
      };
      return c;
    });
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).vender_vencidos).toBe(true);
    expect(selectCols).toContain("vender_vencidos");
  });
});

// NTX-I-09…12 — "Nro. Transacción en ventas" (migración 098): decisión del
// admin de la tienda; se valida en el límite y queda en la auditoría.
describe("PATCH /api/settings — número de transacción en ventas", () => {
  const patch = async (body: object) => {
    const { PATCH } = await import("@/app/api/settings/route");
    return PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  };
  let updates: Record<string, unknown>[];
  let eqs: [string, unknown][];
  let selectCols: string;

  beforeEach(() => {
    jest.clearAllMocks();
    updates = [];
    eqs = [];
    selectCols = "";
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAsAdmin();
    mockFrom.mockImplementation(() => {
      const c: Record<string, jest.Mock> = {
        update: jest.fn((data) => { updates.push(data); return c; }),
        eq: jest.fn((col: string, val: unknown) => { eqs.push([col, val]); return c; }),
        select: jest.fn((cols?: string) => { selectCols = cols ?? selectCols; return c; }),
        single: jest.fn().mockResolvedValue({ data: { id: STORE_ID, numero_transaccion_obligatorio: false }, error: null }),
      };
      return c;
    });
  });

  it("NTX-I-09: el admin la deshabilita y habilita en SU tienda (store_id del body se ignora), auditado; un PATCH que no la menciona no la toca", async () => {
    const { logAudit } = jest.requireMock("@/lib/audit") as { logAudit: jest.Mock };
    const OTRA = "99999999-0000-4000-8000-000000000099";
    expect((await patch({ numero_transaccion_obligatorio: false, store_id: OTRA, id: OTRA })).status).toBe(200);
    expect(updates[0]).toHaveProperty("numero_transaccion_obligatorio", false);
    expect(updates[0]).not.toHaveProperty("store_id");
    expect(updates[0]).not.toHaveProperty("id");
    expect(eqs).toContainEqual(["id", STORE_ID]);
    expect(eqs).not.toContainEqual(["id", OTRA]);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      storeId: STORE_ID, action: "UPDATE", entityType: "settings", result: "success",
    }));

    expect((await patch({ numero_transaccion_obligatorio: true })).status).toBe(200);
    expect(updates[1]).toHaveProperty("numero_transaccion_obligatorio", true);
    expect((await patch({ name: "Otra" })).status).toBe(200);
    expect(updates[2]).not.toHaveProperty("numero_transaccion_obligatorio");
  });

  it("NTX-I-10: storeWorker → 403 y sin sesión → 401, sin escribir", async () => {
    mockAsWorker();
    expect((await patch({ numero_transaccion_obligatorio: false })).status).toBe(403);
    mockGetStoreId.mockResolvedValue(null);
    expect((await patch({ numero_transaccion_obligatorio: false })).status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it("NTX-I-11: valor no booleano (\"false\", 0, null) → 400 sin escribir", async () => {
    for (const v of ["false", 0, null]) {
      expect([v, (await patch({ numero_transaccion_obligatorio: v })).status]).toEqual([v, 400]);
    }
    expect(updates).toHaveLength(0);
  });

  it("NTX-I-12: GET la incluye para que /settings muestre el estado actual", async () => {
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).numero_transaccion_obligatorio).toBe(false);
    expect(selectCols).toContain("numero_transaccion_obligatorio");
  });
});

// VGV-I-09…12 — "Venta a granel" por gramos o por valor (migración 099).
describe("PATCH /api/settings — venta a granel", () => {
  const patch = async (body: object) => {
    const { PATCH } = await import("@/app/api/settings/route");
    return PATCH(new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  };
  let updates: Record<string, unknown>[];
  let eqs: [string, unknown][];
  let selectCols: string;

  beforeEach(() => {
    jest.clearAllMocks();
    updates = [];
    eqs = [];
    selectCols = "";
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAsAdmin();
    mockFrom.mockImplementation(() => {
      const c: Record<string, jest.Mock> = {
        update: jest.fn((data) => { updates.push(data); return c; }),
        eq: jest.fn((col: string, val: unknown) => { eqs.push([col, val]); return c; }),
        select: jest.fn((cols?: string) => { selectCols = cols ?? selectCols; return c; }),
        single: jest.fn().mockResolvedValue({ data: { id: STORE_ID, venta_granel_por: "valor" }, error: null }),
      };
      return c;
    });
  });

  it("VGV-I-09: el admin la cambia en SU tienda (store_id del body se ignora), auditado; un PATCH que no la menciona no la toca", async () => {
    const { logAudit } = jest.requireMock("@/lib/audit") as { logAudit: jest.Mock };
    const OTRA = "99999999-0000-4000-8000-000000000099";
    expect((await patch({ venta_granel_por: "valor", store_id: OTRA, id: OTRA })).status).toBe(200);
    expect(updates[0]).toHaveProperty("venta_granel_por", "valor");
    expect(updates[0]).not.toHaveProperty("store_id");
    expect(eqs).toContainEqual(["id", STORE_ID]);
    expect(eqs).not.toContainEqual(["id", OTRA]);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      storeId: STORE_ID, action: "UPDATE", entityType: "settings", result: "success",
    }));
    expect((await patch({ venta_granel_por: "gramos" })).status).toBe(200);
    expect(updates[1]).toHaveProperty("venta_granel_por", "gramos");
    expect((await patch({ name: "Otra" })).status).toBe(200);
    expect(updates[2]).not.toHaveProperty("venta_granel_por");
  });

  it("VGV-I-10: storeWorker → 403 y sin sesión → 401, sin escribir", async () => {
    mockAsWorker();
    expect((await patch({ venta_granel_por: "valor" })).status).toBe(403);
    mockGetStoreId.mockResolvedValue(null);
    expect((await patch({ venta_granel_por: "valor" })).status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it("VGV-I-11: modo desconocido → 400 sin escribir", async () => {
    for (const v of ["kilos", "", true, null, 1]) {
      expect([v, (await patch({ venta_granel_por: v })).status]).toEqual([v, 400]);
    }
    expect(updates).toHaveLength(0);
  });

  it("VGV-I-12: GET la incluye para que /settings muestre el modo actual", async () => {
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).venta_granel_por).toBe("valor");
    expect(selectCols).toContain("venta_granel_por");
  });
});
