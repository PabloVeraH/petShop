import { createHmac } from "crypto";
import { UberEatsChannel } from "@/lib/canales/ubereats/adapter";
import type { CanalConfig } from "@/lib/canales/types";

describe("canales/ubereats/adapter", () => {
  let channel: UberEatsChannel;
  let mockConfig: CanalConfig;

  beforeEach(() => {
    channel = new UberEatsChannel();
    mockConfig = {
      storeId: "store123",
      canalId: "ubereats",
      externalStoreId: "ext-store-456",
      credentials: { client_id: "cid", client_secret: "secret" },
      webhookSecret: "whsec_test",
      comisionPct: 30,
    };
  });

  describe("UberEatsChannel", () => {
    it("has correct id", () => {
      expect(channel.id).toBe("ubereats");
    });

    it("requires webhook", () => {
      expect(channel.requiresWebhook).toBe(true);
    });
  });

  describe("validateWebhook", () => {
    it("returns true for valid signature", () => {
      const rawBody = JSON.stringify({ event_type: "orders.create", occurrence: { delivery_id: "123" } });
      const secret = "test-secret";
      const signature = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

      const headers = { "x-ubereats-signature": signature };
      const result = channel.validateWebhook(headers, rawBody, secret);

      expect(result).toBe(true);
    });

    it("returns false for invalid signature", () => {
      const rawBody = JSON.stringify({ event_type: "orders.create" });
      const headers = { "x-ubereats-signature": "sha256=invalid" };

      const result = channel.validateWebhook(headers, rawBody, "secret");

      expect(result).toBe(false);
    });

    it("returns false for missing signature", () => {
      const rawBody = JSON.stringify({ event_type: "orders.create" });
      const headers = {};

      const result = channel.validateWebhook(headers, rawBody, "secret");

      expect(result).toBe(false);
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses orders.create event", () => {
      const body = {
        event_type: "orders.create",
        occurrence: { delivery_id: "ORD-123", status: "created" },
      };

      const result = channel.parseWebhookEvent(body);

      expect(result.type).toBe("order");
      expect(result.data).toEqual(body);
    });

    it("parses orders.status_change event", () => {
      const body = {
        event_type: "orders.status_change",
        occurrence: { delivery_id: "ORD-123", status: "confirmed" },
      };

      const result = channel.parseWebhookEvent(body);

      expect(result.type).toBe("status_change");
    });

    it("parses orders.cancel event", () => {
      const body = {
        event_type: "orders.cancel",
        occurrence: { delivery_id: "ORD-123" },
      };

      const result = channel.parseWebhookEvent(body);

      expect(result.type).toBe("cancellation");
    });

    it("returns 'other' for unknown event", () => {
      const body = { event_type: "unknown.event", data: {} };

      const result = channel.parseWebhookEvent(body);

      expect(result.type).toBe("other");
    });
  });

  describe("parseOrder", () => {
    it("maps UberEats order to CanalOrden", () => {
      const rawOrder = {
        uuid: "ORD-456",
        cart_items: [
          { id: "PROD-1", quantity: 1, price: { amount: 5000, currency_code: "CLP" } },
          { id: "PROD-2", quantity: 2, price: { amount: 2500, currency_code: "CLP" } },
        ],
        total: { amount: 10000, currency_code: "CLP" },
      };

      const result = channel.parseOrder(rawOrder);

      expect(result.externalOrderId).toBe("ORD-456");
      expect(result.canal).toBe("ubereats");
      expect(result.items).toHaveLength(2);
      expect(result.items[0].externalProductId).toBe("PROD-1");
      expect(result.items[0].cantidad).toBe(1);
      expect(result.totalExterno).toBe(10000);
    });
  });

  describe("isTokenExpired", () => {
    it("returns true when no token cached", () => {
      const result = channel.isTokenExpired(mockConfig);
      expect(result).toBe(true);
    });
  });
});