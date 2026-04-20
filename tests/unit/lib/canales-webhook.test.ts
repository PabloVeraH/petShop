import { verifyWebhookSignature, parseWebhookBody } from "@/lib/canales/webhook";

describe("canales/webhook", () => {
  describe("verifyWebhookSignature", () => {
    it("returns true for valid signature", () => {
      const payload = JSON.stringify({ order_id: "123", status: "completed" });
      const secret = "test-secret-key";
      const signature =
        "sha256=" +
        require("crypto")
          .createHmac("sha256", secret)
          .update(payload)
          .digest("hex");

      expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
    });

    it("returns false for invalid signature", () => {
      const payload = JSON.stringify({ order_id: "123" });
      const secret = "test-secret-key";

      expect(
        verifyWebhookSignature(payload, "sha256=invalid", secret)
      ).toBe(false);
    });

    it("returns false for empty signature", () => {
      const payload = JSON.stringify({ order_id: "123" });
      const secret = "test-secret-key";

      expect(verifyWebhookSignature(payload, "", secret)).toBe(false);
    });

    it("returns false for empty secret", () => {
      const payload = JSON.stringify({ order_id: "123" });

      expect(verifyWebhookSignature(payload, "sha256=abc", "")).toBe(false);
    });
  });

  describe("parseWebhookBody", () => {
    it("parses valid JSON", () => {
      const body = JSON.stringify({ order_id: "123", status: "completed" });
      const parsed = parseWebhookBody<{ order_id: string; status: string }>(body);

      expect(parsed?.order_id).toBe("123");
      expect(parsed?.status).toBe("completed");
    });

    it("returns null for invalid JSON", () => {
      const body = "not valid json";
      const parsed = parseWebhookBody<unknown>(body);

      expect(parsed).toBeNull();
    });
  });
});