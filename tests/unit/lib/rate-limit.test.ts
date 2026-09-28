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

// U-209 — REGRESIÓN (QA 2026-09-27, BUG 2): todos los limitadores compartían
// un único diccionario por IP; el tráfico del navegador agotaba el cupo del
// webhook de canales (y la ventana la fijaba el primero que creaba la entrada).
describe("limitadores independientes (U-209)", () => {
  it("U-209: agotar el límite general no bloquea el webhook, y viceversa", async () => {
    jest.resetModules();
    const { apiGeneralLimit, webhookLimit } = await import("@/middleware/rateLimit");

    expect(await contarPermitidas(apiGeneralLimit, 100)).toBe(100);
    expect(((await apiGeneralLimit(req())) as Response).status).toBe(429);
    expect(await webhookLimit(req())).toBeNull();

    expect(await contarPermitidas(webhookLimit, 49)).toBe(49);
    expect(((await webhookLimit(req())) as Response).status).toBe(429);
  });

  it("U-209: dos limitadores creados con createRateLimit no comparten contador", async () => {
    const { createRateLimit } = await import("@/middleware/rateLimit");
    const a = createRateLimit({ windowMs: 60_000, maxRequests: 1 });
    const b = createRateLimit({ windowMs: 60_000, maxRequests: 1 });
    expect(await a(req())).toBeNull();
    expect(await b(req())).toBeNull();
    expect(((await a(req())) as Response).status).toBe(429);
  });
});

// U-214 — REGRESIÓN (QA 2026-09-27): con 100 req / 15 min por IP, una tienda
// (varias cajas detrás de una IP) y el polling de pedidos del POS (cada 10–20 s)
// agotaban el límite. Con sesión el límite es por usuario (600 / 5 min).
describe("aplicarRateLimit — por usuario con sesión (U-214)", () => {
  const reqA = (path = "/api/canales/orders?estado=accepted") => new NextRequest(`http://localhost${path}`);

  beforeEach(() => jest.resetModules());

  it("U-214: con sesión permite 600 requests por usuario y bloquea la 601 con 429", async () => {
    delete process.env.RATE_LIMIT_USER_MAX;
    const { aplicarRateLimit } = await import("@/middleware/rateLimit");
    let permitidas = 0;
    for (let i = 0; i < 600; i++) if ((await aplicarRateLimit(reqA(), "user_a")) === null) permitidas++;
    expect(permitidas).toBe(600);
    expect(((await aplicarRateLimit(reqA(), "user_a")) as Response).status).toBe(429);
  });

  it("U-214: dos usuarios detrás de la misma IP no comparten cupo; el tráfico con sesión no gasta el cupo por IP", async () => {
    process.env.RATE_LIMIT_USER_MAX = "5";
    const { aplicarRateLimit } = await import("@/middleware/rateLimit");
    for (let i = 0; i < 5; i++) await aplicarRateLimit(reqA(), "user_a");
    expect(((await aplicarRateLimit(reqA(), "user_a")) as Response).status).toBe(429);
    expect(await aplicarRateLimit(reqA(), "user_b")).toBeNull();
    // Sin sesión (misma IP "unknown"): contador por IP intacto.
    expect(await aplicarRateLimit(reqA(), null)).toBeNull();
    delete process.env.RATE_LIMIT_USER_MAX;
  });

  it("U-214: sin sesión sigue el límite por IP (100 / 15 min)", async () => {
    delete process.env.RATE_LIMIT_API_MAX;
    const { aplicarRateLimit } = await import("@/middleware/rateLimit");
    for (let i = 0; i < 100; i++) await aplicarRateLimit(reqA(), undefined);
    expect(((await aplicarRateLimit(reqA(), undefined)) as Response).status).toBe(429);
  });

  it("U-214: el webhook de canales usa su propio límite aunque traiga usuario y aunque el general esté agotado", async () => {
    process.env.RATE_LIMIT_USER_MAX = "1";
    const { aplicarRateLimit } = await import("@/middleware/rateLimit");
    await aplicarRateLimit(reqA(), "user_a");
    expect(((await aplicarRateLimit(reqA(), "user_a")) as Response).status).toBe(429);
    expect(await aplicarRateLimit(reqA("/api/canales/webhook/rappi"), "user_a")).toBeNull();
    delete process.env.RATE_LIMIT_USER_MAX;
  });
});
