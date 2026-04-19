import { describe, it, expect, beforeEach } from "vitest";
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
      const rawBody = JSON.stringify({ order_id: "123", event_type: "order.created" });
      const secret = "test-secret";
      const signature =
        "sha256=" +
        createHmac("sha256", secret)
          .update(rawBody)
          .digest("hex");

      const headers = { "x-rappi-signature": signature };
      const result = channel.validateWebhook(headers, rawBody, secret);

      expect(result).toBe(true);
    });

    it("returns false for invalid signature", () => {
      const rawBody = JSON.stringify({ order_id: "123" });
      const headers = { "x-rappi-signature": "sha256=invalid" };

      const result = channel.validateWebhook(headers, rawBody, "secret");

      expect(result).toBe(false);
    });

    it("returns false for missing signature", () => {
      const rawBody = JSON.stringify({ order_id: "123" });
      const headers = {};

      const result = channel.validateWebhook(headers, rawBody, "secret");

      expect(result).toBe(false);
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses order.created event", () => {
      const body = {
        event_type: "order.created",
        order_id: "ORD-123",
        total: 15000,
        items: [{ id: "P1", quantity: 2, unit_price: 7500 }],
      };

      const result = channel.parseWebhookEvent(body);

      expect(result.type).toBe("order");
      expect(result.data).toEqual(body);
    });

    it("parses ping event", () => {
      const body = { event_type: "ping", timestamp: "2026-04-19T12:00:00Z" };

      const result = channel.parseWebhookEvent(body);

      expect(result.type).toBe("ping");
    });

    it("parses status_change event", () => {
      const body = {
        event_type: "order.status_changed",
        order_id: "ORD-123",
        status: "accepted",
      };

      const result = channel.parseWebhookEvent(body);

      expect(result.type).toBe("status_change");
    });

    it("parses cancellation event", () => {
      const body = {
        event_type: "order.cancelled",
        order_id: "ORD-123",
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
    it("maps Rappi order to CanalOrden", () => {
      const rawOrder = {
        order_id: "ORD-456",
        items: [
          { id: "PROD-1", quantity: 1, unit_price: 5000 },
          { id: "PROD-2", quantity: 2, unit_price: 2500 },
        ],
        total: 10000,
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
    it("returns true when no token cached", () => {
      const result = channel.isTokenExpired(mockConfig);
      expect(result).toBe(true);
    });
  });
});