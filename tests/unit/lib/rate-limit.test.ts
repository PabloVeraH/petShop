/**
 * Tests U-207 a U-208: límite general de la API configurable con
 * RATE_LIMIT_API_MAX (en local todas las requests caen en la clave "unknown"
 * y 100 / 15 min se agotaba en minutos → 429 en toda la app).
 */

import { NextRequest } from "next/server";

jest.mock("@/lib/security-alerts", () => ({ logSecurityAlert: jest.fn() }));

const req = () => new NextRequest("http://localhost/api/inventario");

async function contarPermitidas(limiter: (r: NextRequest) => Promise<unknown>, intentos: number) {
  let permitidas = 0;
  for (let i = 0; i < intentos; i++) {
    if ((await limiter(req())) === null) permitidas++;
  }
  return permitidas;
}

describe("maxRequestsDesdeEnv (U-207)", () => {
  const { maxRequestsDesdeEnv } = jest.requireActual("@/middleware/rateLimit");

  it.each([
    ["5000", 5000],
    [" 250 ", 250],
  ])("U-207: valor válido %p → %p", (valor, esperado) => {
    expect(maxRequestsDesdeEnv(valor, 100)).toBe(esperado);
  });

  it.each([undefined, "", "0", "-5", "abc", "1e3", "12.5", "100abc"])(
    "U-207: valor ausente o inválido %p → valor por defecto (no desactiva el límite)",
    (valor) => {
      expect(maxRequestsDesdeEnv(valor, 100)).toBe(100);
    }
  );
});

describe("apiGeneralLimit con RATE_LIMIT_API_MAX (U-208)", () => {
  const original = process.env.RATE_LIMIT_API_MAX;
  afterEach(() => {
    if (original === undefined) delete process.env.RATE_LIMIT_API_MAX;
    else process.env.RATE_LIMIT_API_MAX = original;
  });

  // Módulo fresco en cada test: la env se lee al importar y el contador vive
  // en memoria del módulo.
  async function cargarLimiter() {
    jest.resetModules();
    const mod = await import("@/middleware/rateLimit");
    return mod.apiGeneralLimit;
  }

  it("U-208: sin la variable, mantiene 100 requests y la 101 recibe 429", async () => {
    delete process.env.RATE_LIMIT_API_MAX;
    const limiter = await cargarLimiter();
    expect(await contarPermitidas(limiter, 100)).toBe(100);
    const bloqueada = (await limiter(req())) as Response;
    expect(bloqueada.status).toBe(429);
  });

  it("U-208: con RATE_LIMIT_API_MAX=150 permite 150 y bloquea la 151", async () => {
    process.env.RATE_LIMIT_API_MAX = "150";
    const limiter = await cargarLimiter();
    expect(await contarPermitidas(limiter, 150)).toBe(150);
    const bloqueada = (await limiter(req())) as Response;
    expect(bloqueada.status).toBe(429);
  });

  it("U-208: valor inválido no desactiva el límite (vuelve a 100)", async () => {
    process.env.RATE_LIMIT_API_MAX = "ilimitado";
    const limiter = await cargarLimiter();
    expect(await contarPermitidas(limiter, 101)).toBe(100);
  });
});
