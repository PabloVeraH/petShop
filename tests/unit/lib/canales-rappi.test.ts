import { createHmac } from "crypto";
import { RappiChannel } from "@/lib/canales/rappi/adapter";
import type { CanalConfig } from "@/lib/canales/types";

describe("canales/rappi/adapter", () => {
  let channel: RappiChannel;
  let mockConfig: CanalConfig;

  beforeEach(() => {
    channel = new RappiChannel();
    mockConfig = {
      storeId: "store123",
      canalId: "rappi",
      externalStoreId: "ext-store-456",
      credentials: { client_id: "cid", client_secret: "secret" },
      webhookSecret: "whsec_test",
      comisionPct: 30,
    };
  });

  describe("RappiChannel", () => {
    it("has correct id", () => {
      expect(channel.id).toBe("rappi");
    });

    it("requires webhook", () => {
      expect(channel.requiresWebhook).toBe(true);
    });
  });

  describe("validateWebhook", () => {
    it("returns true for valid signature", () => {
      const rawBody = JSON.stringify({ order_id: "123", event_type: "NEW_ORDER" });
      const secret = "test-secret";
      const ts = String(Math.floor(Date.now() / 1000));
      const sign = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
      const headers = { "rappi-signature": `t=${ts},sign=${sign}` };

      expect(channel.validateWebhook(headers, rawBody, secret)).toBe(true);
    });

    it("returns false for invalid signature", () => {
      const rawBody = JSON.stringify({ order_id: "123" });
      const ts = String(Math.floor(Date.now() / 1000));
      const headers = { "rappi-signature": `t=${ts},sign=invalidsignature` };

      expect(channel.validateWebhook(headers, rawBody, "secret")).toBe(false);
    });

    it("returns false for missing signature", () => {
      const rawBody = JSON.stringify({ order_id: "123" });
      expect(channel.validateWebhook({}, rawBody, "secret")).toBe(false);
    });

    it("returns false for expired timestamp (anti-replay > 5 min)", () => {
      const rawBody = JSON.stringify({ order_id: "123" });
      const secret = "test-secret";
      const oldTs = String(Math.floor(Date.now() / 1000) - 400);
      const sign = createHmac("sha256", secret).update(`${oldTs}.${rawBody}`).digest("hex");
      const headers = { "rappi-signature": `t=${oldTs},sign=${sign}` };

      expect(channel.validateWebhook(headers, rawBody, secret)).toBe(false);
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses NEW_ORDER event", () => {
      const body = { event_type: "NEW_ORDER", order_id: "ORD-123" };
      const result = channel.parseWebhookEvent(body);
      expect(result.type).toBe("order");
      expect(result.data).toEqual(body);
    });

    it("parses PING event", () => {
      const body = { event_type: "PING" };
      const result = channel.parseWebhookEvent(body);
      expect(result.type).toBe("ping");
    });

    it("parses ORDER_OTHER_EVENT as status_change", () => {
      const body = { event_type: "ORDER_OTHER_EVENT", order_id: "ORD-123" };
      const result = channel.parseWebhookEvent(body);
      expect(result.type).toBe("status_change");
    });

    it("parses ORDER_EVENT_CANCEL as cancellation", () => {
      const body = { event_type: "ORDER_EVENT_CANCEL", order_id: "ORD-123" };
      const result = channel.parseWebhookEvent(body);
      expect(result.type).toBe("cancellation");
    });

    it("returns 'other' for unknown event", () => {
      const body = { event_type: "UNKNOWN_EVENT" };
      const result = channel.parseWebhookEvent(body);
      expect(result.type).toBe("other");
    });
  });

  describe("parseOrder", () => {
    it("maps Rappi order to CanalOrden", () => {
      const rawOrder = {
        order_id: "ORD-456",
        order_detail: {
          items: [
            { id: "PROD-1", quantity: 1, price: 5000 },
            { id: "PROD-2", quantity: 2, price: 2500 },
          ],
          total_order: 10000,
        },
      };

      const result = channel.parseOrder(rawOrder);

      expect(result.externalOrderId).toBe("ORD-456");
      expect(result.canal).toBe("rappi");
      expect(result.items).toHaveLength(2);
      expect(result.items[0].externalProductId).toBe("PROD-1");
      expect(result.items[0].cantidad).toBe(1);
      expect(result.totalExterno).toBe(10000);
    });
  });

  describe("isTokenExpired", () => {
    it("always returns false (real expiry check is in auth.ts)", () => {
      expect(channel.isTokenExpired(mockConfig)).toBe(false);
    });
  });
});
