import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "crypto";

const TEST_STORE_ID = "test-store-id";
const RAPPI_ORDER_ID = `TEST-${Date.now()}`;

describe("canales webhook idempotency", () => {
  it("should not duplicate orden on same webhook payload", async () => {
    const rawBody = JSON.stringify({
      event_type: "order.created",
      order_id: RAPPI_ORDER_ID,
      total: 15000,
      items: [{ id: "PROD-1", quantity: 2, unit_price: 7500 }],
    });

    const secret = "test-webhook-secret";
    const signature = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

    const headers = {
      "content-type": "application/json",
      "x-rappi-signature": signature,
    };

    const webhookUrl = `/api/canales/webhook/rappi`;

    const res1 = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: rawBody,
    });

    expect(res1.status).toBeGreaterThanOrEqual(200);
    expect(res1.status).toBeLessThan(300);

    const res2 = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: rawBody,
    });

    const data = await res2.json();
    expect(data.message || data.status).toContain("ya procesada");
  });

  it("should respond PONG to ping event", async () => {
    const rawBody = JSON.stringify({
      event_type: "ping",
      timestamp: new Date().toISOString(),
    });

    const secret = "test-webhook-secret";
    const signature = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

    const headers = {
      "content-type": "application/json",
      "x-rappi-signature": signature,
    };

    const webhookUrl = `/api/canales/webhook/rappi`;

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: rawBody,
    });

    const data = await res.json();
    expect(data.message).toBe("PONG");
  });

  it("should reject invalid signature", async () => {
    const rawBody = JSON.stringify({
      event_type: "order.created",
      order_id: "INVALID-SIG-TEST",
      total: 10000,
    });

    const headers = {
      "content-type": "application/json",
      "x-rappi-signature": "sha256=invalid",
    };

    const webhookUrl = `/api/canales/webhook/rappi`;

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: rawBody,
    });

    expect(res.status).toBe(401);
  });
});