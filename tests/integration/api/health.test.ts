import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("I-253: retorna status ok con timestamp ISO", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    expect(() => new Date(body.timestamp)).not.toThrow();
  });
});
