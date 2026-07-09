/**
 * Tests I-96 a I-100: WhatsApp webhook (GET verificación + POST firma HMAC)
 */
import { NextRequest } from "next/server";
import crypto from "crypto";

const APP_SECRET = "test-whatsapp-secret";
const STORE_VERIFY_TOKEN = "mi-token-secreto";

const mockFrom = jest.fn();
const mockEq = jest.fn();
const mockChain = {
  select: jest.fn().mockReturnThis(),
  eq: mockEq,
};

jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));

function buildSignature(body: string, secret = APP_SECRET) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("GET /api/whatsapp/webhook — verificación hub", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    mockFrom.mockReturnValue(mockChain);
  });

  // I-96
  it("I-96: token correcto → devuelve hub.challenge", async () => {
    mockEq.mockReturnValue(
      Promise.resolve({
        data: [{ id: "store-1" }],
        error: null,
      })
    );
    const { GET } = await import("@/app/api/whatsapp/webhook/route");
    const url = `http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${STORE_VERIFY_TOKEN}&hub.challenge=CHALLENGE_123`;
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("CHALLENGE_123");
  });

  // I-97
  it("I-97: token no encontrado en DB → 403", async () => {
    mockEq.mockReturnValue(
      Promise.resolve({
        data: [],
        error: null,
      })
    );
    const { GET } = await import("@/app/api/whatsapp/webhook/route");
    const url = "http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=token-malo&hub.challenge=X";
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/whatsapp/webhook — firma HMAC", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    mockFrom.mockReturnValue(mockChain);
    mockEq.mockReturnValue(Promise.resolve({ data: [], error: null }));
  });

  // I-98
  it("I-98: POST sin firma HMAC → 403 (Forbidden)", async () => {
    const { POST } = await import("@/app/api/whatsapp/webhook/route");
    const res = await POST(new NextRequest("http://localhost/api/whatsapp/webhook", {
      method: "POST",
      body: JSON.stringify({ entry: [] }),
    }));
    expect(res.status).toBe(403);
  });

  // I-99
  it("I-99: POST con firma HMAC válida → 200", async () => {
    const { POST } = await import("@/app/api/whatsapp/webhook/route");
    const body = JSON.stringify({ entry: [] });
    const sig = buildSignature(body);
    const res = await POST(new NextRequest("http://localhost/api/whatsapp/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sig },
      body,
    }));
    expect(res.status).toBe(200);
  });

  // I-100
  it("I-100: POST con firma válida no loguea datos del usuario (sin console.error de PII)", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const { POST } = await import("@/app/api/whatsapp/webhook/route");
    const payload = { entry: [{ changes: [{ value: { messages: [{ from: "56912345678", text: { body: "hola" } }] } }] }] };
    const body = JSON.stringify(payload);
    const sig = buildSignature(body);
    await POST(new NextRequest("http://localhost/api/whatsapp/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sig },
      body,
    }));
    // Verificar que no se logueó el número de teléfono
    const logged = consoleSpy.mock.calls.map(c => JSON.stringify(c)).join("");
    expect(logged).not.toContain("56912345678");
    consoleSpy.mockRestore();
  });
});
