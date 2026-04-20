const mockFrom = jest.fn();
const mockDecryptJSON = jest.fn();

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom })),
}));
jest.mock("@/lib/canales/encryption", () => ({
  decryptJSON: mockDecryptJSON,
}));

import { POST } from "@/app/api/canales/webhook/[canal]/route";
import { NextRequest } from "next/server";
import { createHmac } from "crypto";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const SECRET = "test-webhook-secret";

function makeRappiSignature(rawBody: string): string {
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = createHmac("sha256", SECRET).update(`${ts}.${rawBody}`).digest("hex");
  return `t=${ts},sign=${sign}`;
}

function buildReq(body: string, signature: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/canales/webhook/rappi?store_id=${STORE_ID}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "rappi-signature": signature },
      body,
    }
  );
}

const CONFIG_ROW = {
  credenciales_encriptada: "enc",
  credenciales_iv: "iv",
  credenciales_auth_tag: "tag",
};

function configChain(data: object | null, error: object | null = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error }),
  };
}

describe("canales webhook unit tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDecryptJSON.mockReturnValue({ webhook_secret: SECRET });
  });

  it("should return 'Orden ya procesada' for duplicate order", async () => {
    const rawBody = JSON.stringify({
      event_type: "NEW_ORDER",
      order_id: "ORD-IDEM-001",
      order_detail: {
        items: [{ id: "P1", quantity: 1, price: 5000 }],
        total_order: 5000,
      },
    });
    const signature = makeRappiSignature(rawBody);

    mockFrom.mockImplementation((table: string) => {
      if (table === "canal_config") return configChain(CONFIG_ROW);
      if (table === "canal_ordenes") return configChain({ id: "existing-id" }); // already exists
      return configChain(null);
    });

    const res = await POST(buildReq(rawBody, signature));
    const data = await res.json();
    expect((data.message ?? data.status) as string).toContain("ya procesada");
  });

  it("should respond OK to PING event", async () => {
    const rawBody = JSON.stringify({ event_type: "PING" });
    const signature = makeRappiSignature(rawBody);

    mockFrom.mockImplementation(() => configChain(CONFIG_ROW));

    const res = await POST(buildReq(rawBody, signature));
    const data = await res.json();
    expect(data.status).toBe("OK");
    expect(data.description).toBe("Tienda prendida");
  });

  it("should reject invalid signature with 401", async () => {
    const rawBody = JSON.stringify({ event_type: "NEW_ORDER", order_id: "INV" });
    const badSignature = "t=12345,sign=invalidsignature";

    mockFrom.mockImplementation(() => configChain(CONFIG_ROW));

    const res = await POST(buildReq(rawBody, badSignature));
    expect(res.status).toBe(401);
  });
});
