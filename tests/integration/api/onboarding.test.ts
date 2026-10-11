/**
 * Tests I-90 a I-91, I-737: POST /api/onboarding/complete
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const USER_ID = "user_clerk_123";
const DATOS_TIENDA = { rut: "76.123.456-0", address: "Av. Ossa 123" };

const mockAuth = jest.fn();
const mockClerkClient = jest.fn();
const mockFrom = jest.fn();
const mockSingle = jest.fn();

jest.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  clerkClient: mockClerkClient,
}));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

function chain() {
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    insert: jest.fn(),
    upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
    eq: jest.fn(),
    single: mockSingle,
  };
  ["select","insert","upsert","eq"].forEach(k => c[k].mockReturnValue(c));
  return c;
}

function makeClerkClient() {
  return {
    users: {
      getUser: jest.fn().mockResolvedValue({
        emailAddresses: [{ emailAddress: "test@example.com" }],
      }),
      updateUserMetadata: jest.fn().mockResolvedValue({}),
    },
  };
}

function req(body: object) {
  return new NextRequest("http://localhost/api/onboarding/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/onboarding/complete", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockClerkClient.mockResolvedValue(makeClerkClient());
    mockFrom.mockReturnValue(chain());
  });

  // I-90
  it("I-90: usuario ya tiene store → 409", async () => {
    mockSingle.mockResolvedValue({
      data: { store_id: STORE_ID },
      error: null,
    });
    const { POST } = await import("@/app/api/onboarding/complete/route");
    const res = await POST(req({ storeName: "Mi Tienda", ...DATOS_TIENDA }));
    expect(res.status).toBe(409);
  });

  // I-91
  it("I-91: primera vez → crea store y retorna 200 con storeId", async () => {
    // First single() call: no existing user (clerk_users lookup)
    // Second single() call: newly created store
    mockSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: STORE_ID, name: "Mi Tienda" }, error: null });
    const { POST } = await import("@/app/api/onboarding/complete/route");
    const res = await POST(req({ storeName: "Mi Tienda", ...DATOS_TIENDA }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("storeId");
  });

  // I-737 — la tienda nace con nombre, RUT y dirección
  it("I-737: crea la tienda con RUT normalizado y dirección; campos ajenos se ignoran", async () => {
    const c = chain();
    mockFrom.mockReturnValue(c);
    mockSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: STORE_ID }, error: null });
    const { POST } = await import("@/app/api/onboarding/complete/route");
    const res = await POST(req({ storeName: "Mi Tienda", rut: "761234560", address: " Av. Ossa 123 ", id: "x", license_end_date: "2099-01-01" }));
    expect(res.status).toBe(200);
    expect(c.insert).toHaveBeenCalledWith({ name: "Mi Tienda", rut: "76.123.456-0", address: "Av. Ossa 123" });
  });

  it.each([
    ["sin rut", { address: "Av. Ossa 123" }, "El RUT de la tienda es obligatorio"],
    ["rut inválido", { rut: "76.123.456-7", address: "Av. Ossa 123" }, "RUT de la tienda inválido"],
    ["sin dirección", { rut: "76.123.456-0" }, "La dirección de la tienda es obligatoria"],
    ["dirección vacía", { rut: "76.123.456-0", address: "  " }, "La dirección de la tienda es obligatoria"],
  ])("I-737: %s → 400 sin crear tienda", async (_caso, datos, mensaje) => {
    const c = chain();
    mockFrom.mockReturnValue(c);
    const { POST } = await import("@/app/api/onboarding/complete/route");
    const res = await POST(req({ storeName: "Mi Tienda", ...datos }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(mensaje);
    expect(c.insert).not.toHaveBeenCalled();
  });

  it("I-737: sin sesión → 401 sin crear tienda", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const { POST } = await import("@/app/api/onboarding/complete/route");
    const res = await POST(req({ storeName: "Mi Tienda", ...DATOS_TIENDA }));
    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
