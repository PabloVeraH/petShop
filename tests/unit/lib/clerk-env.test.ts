/**
 * Tests U-127: Detección de claves de desarrollo Clerk
 *
 * Regla de negocio: Clerk muestra "Development mode" en el menú de perfil
 * cuando las API keys tienen prefijo pk_test_ / sk_test_. En un entorno de
 * producción deben usarse pk_live_ / sk_live_. La detección de claves dev
 * permite advertir al operador antes del deploy.
 */

import { isClerkDevKey, checkClerkEnv } from "@/lib/clerk-env";

describe("isClerkDevKey", () => {
  it("U-127a: pk_test_ detecta como desarrollo", () => {
    expect(isClerkDevKey("pk_test_d2VsY29tZS1mZWxpbmUtNDAuY2xlcmsuYWNjb3VudHMuZGV2JA")).toBe(true);
  });

  it("U-127b: sk_test_ detecta como desarrollo", () => {
    expect(isClerkDevKey("sk_test_W118EYSpqiyXK6HiuOUhL8XPoyQtzJnN1dG4H5IZcr")).toBe(true);
  });

  it("U-127c: pk_live_ NO detecta como desarrollo", () => {
    expect(isClerkDevKey("pk_live_YWJjZGVmZzEyMzQ1Njc4OTA")).toBe(false);
  });

  it("U-127d: sk_live_ NO detecta como desarrollo", () => {
    expect(isClerkDevKey("sk_live_YWJjZGVmZzEyMzQ1Njc4OTA")).toBe(false);
  });

  it("U-127e: cadena vacía retorna false", () => {
    expect(isClerkDevKey("")).toBe(false);
  });

  it("U-127f: cadena arbitraria retorna false", () => {
    expect(isClerkDevKey("some-random-string")).toBe(false);
  });
});

describe("checkClerkEnv", () => {
  const PREV_NODE_ENV = process.env.NODE_ENV;
  const PREV_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const PREV_SECRET_KEY = process.env.CLERK_SECRET_KEY;

  afterEach(() => {
    process.env.NODE_ENV = PREV_NODE_ENV;
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = PREV_PUBLISHABLE_KEY;
    process.env.CLERK_SECRET_KEY = PREV_SECRET_KEY;
  });

  it("U-127g: ambas claves dev → isDev: true, 2 warnings", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_fake";
    process.env.CLERK_SECRET_KEY = "sk_test_fake";
    const result = checkClerkEnv();
    expect(result.isDev).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(/pk_test_/);
    expect(result.warnings[1]).toMatch(/sk_test_/);
  });

  it("U-127h: clave pública dev + secreta live → isDev: true, 1 warning", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_fake";
    process.env.CLERK_SECRET_KEY = "sk_live_real";
    const result = checkClerkEnv();
    expect(result.isDev).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/pk_test_/);
  });

  it("U-127i: clave pública live + secreta dev → isDev: true, 1 warning", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_real";
    process.env.CLERK_SECRET_KEY = "sk_test_fake";
    const result = checkClerkEnv();
    expect(result.isDev).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/sk_test_/);
  });

  it("U-127j: ambas claves live → isDev: false, 0 warnings", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_real";
    process.env.CLERK_SECRET_KEY = "sk_live_real";
    const result = checkClerkEnv();
    expect(result.isDev).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("U-127k: claves undefined → isDev: false, 0 warnings", () => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
    const result = checkClerkEnv();
    expect(result.isDev).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });
});
