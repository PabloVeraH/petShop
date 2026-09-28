/**
 * Tests U-210: fetchJson / mensajeErrorApi / reintentarQuery (QA 2026-09-27,
 * BUG 2). Un 429 o 5xx no debe llegar a la UI como datos ("Sin productos",
 * "Venta no encontrada", nombre de tienda por defecto).
 */
import { ApiError, fetchJson, mensajeErrorApi, reintentarQuery } from "@/lib/api-client";

function respuesta(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => (body === undefined ? Promise.reject(new Error("no json")) : Promise.resolve(body)),
  } as unknown as Response;
}

describe("fetchJson (U-210)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("U-210: 200 devuelve el cuerpo", async () => {
    global.fetch = jest.fn().mockResolvedValue(respuesta(200, [{ id: 1 }]));
    await expect(fetchJson("/api/x")).resolves.toEqual([{ id: 1 }]);
  });

  it("U-210: 429 lanza ApiError con Retry-After y mensaje 'Demasiadas solicitudes'", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      respuesta(429, { error: "Too many requests. Please try again later." }, { "Retry-After": "300" })
    );
    const err = await fetchJson("/api/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.retryAfterSeg).toBe(300);
    expect(err.message).toBe("Demasiadas solicitudes. Reintenta en 300 s.");
  });

  it("U-210: 500 no expone el mensaje interno", async () => {
    global.fetch = jest.fn().mockResolvedValue(respuesta(500, { error: "deadlock detected" }));
    const err = await fetchJson("/api/x").catch((e) => e);
    expect(err.status).toBe(500);
    expect(err.message).toBe("Error del servidor. Intenta de nuevo en unos momentos.");
  });

  it("U-210: 4xx usa el mensaje de negocio de la API; sin cuerpo JSON usa el status", async () => {
    global.fetch = jest.fn().mockResolvedValue(respuesta(404, { error: "Venta no encontrada" }));
    await expect(fetchJson("/api/x")).rejects.toMatchObject({ status: 404, message: "Venta no encontrada" });
    global.fetch = jest.fn().mockResolvedValue(respuesta(403, undefined));
    await expect(fetchJson("/api/x")).rejects.toMatchObject({ status: 403, message: "Error 403" });
  });
});

describe("mensajeErrorApi / reintentarQuery (U-210)", () => {
  it("U-210: 429 sin Retry-After da un mensaje genérico", () => {
    expect(mensajeErrorApi(429)).toBe("Demasiadas solicitudes. Reintenta en unos segundos.");
  });

  it("U-210: no reintenta 429 ni 4xx; reintenta una vez 5xx y errores de red", () => {
    expect(reintentarQuery(0, new ApiError("x", 429))).toBe(false);
    expect(reintentarQuery(0, new ApiError("x", 404))).toBe(false);
    expect(reintentarQuery(0, new ApiError("x", 500))).toBe(true);
    expect(reintentarQuery(1, new ApiError("x", 500))).toBe(false);
    expect(reintentarQuery(0, new TypeError("Failed to fetch"))).toBe(true);
  });
});
