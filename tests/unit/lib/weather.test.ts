/**
 * Tests U-WX-01 a U-WX-06: src/lib/weather.ts
 * @jest-environment node
 */
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { obtenerContextoClimatico } from "@/lib/weather";

const OPEN_METEO_RESPONSE = {
  current: { temperature_2m: 8.5, weather_code: 61 },
};

describe("obtenerContextoClimatico", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.isolateModules(() => {});
  });

  // U-WX-01: llama con las coordenadas exactas recibidas
  it("U-WX-01: llama a Open-Meteo con las coordenadas de Santiago", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => OPEN_METEO_RESPONSE });
    await obtenerContextoClimatico(-33.45, -70.67);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("latitude=-33.45"),
      expect.any(Object)
    );
  });

  // U-WX-02: llama con coordenadas de otra ciudad sin fallback
  it("U-WX-02: llama a Open-Meteo con las coordenadas de Puerto Montt", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => OPEN_METEO_RESPONSE });
    await obtenerContextoClimatico(-41.47, -72.94);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("latitude=-41.47"),
      expect.any(Object)
    );
  });

  // U-WX-03: temporada correcta en hemisferio sur (julio = invierno)
  it("U-WX-03: deriva temporada 'invierno' para julio en hemisferio sur", async () => {
    // 15-07 al mediodía de Chile. El mes es el de Chile: el 31-08 a las 22:00
    // (ya 1-09 en UTC) sigue siendo invierno — se verifica en U-WX-03b.
    jest.useFakeTimers({ now: new Date("2026-07-15T16:00:00Z"), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    mockFetch.mockResolvedValue({ ok: true, json: async () => OPEN_METEO_RESPONSE });
    const ctx = await obtenerContextoClimatico(-38.74, -72.60);
    expect(ctx.temporada).toBe("invierno");
    jest.useRealTimers();
  });

  it("U-WX-03b: el 31-08 a las 22:00 de Chile (1-09 en UTC) la temporada sigue siendo invierno", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-01T02:00:00Z"), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    mockFetch.mockResolvedValue({ ok: true, json: async () => OPEN_METEO_RESPONSE });
    const ctx = await obtenerContextoClimatico(-38.75, -72.61);
    expect(ctx.temporada).toBe("invierno");
    jest.useRealTimers();
  });

  // U-WX-04: temperatura < 12 → esFrio = true
  it("U-WX-04: esFrio=true cuando temperatura < 12°C", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => OPEN_METEO_RESPONSE }); // 8.5°C
    const ctx = await obtenerContextoClimatico(-33.04, -71.63);
    expect(ctx.esFrio).toBe(true);
    expect(ctx.esCalido).toBe(false);
  });

  // U-WX-05: HTTP error → retorna fallback sin lanzar
  it("U-WX-05: retorna contexto de fallback sin lanzar error ante HTTP 500", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(obtenerContextoClimatico(-36.82, -73.05)).resolves.toBeDefined();
  });

  // U-WX-06: temperatura > 25 → esCalido = true
  it("U-WX-06: esCalido=true cuando temperatura > 25°C", async () => {
    const calienteResponse = { current: { temperature_2m: 28.3, weather_code: 0 } };
    mockFetch.mockResolvedValue({ ok: true, json: async () => calienteResponse });
    const ctx = await obtenerContextoClimatico(-23.65, -70.40);
    expect(ctx.esCalido).toBe(true);
    expect(ctx.esFrio).toBe(false);
  });
});
