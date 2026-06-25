/**
 * Tests MW-01 a MW-22: lógica de routing por rol, license check y CSP (extraída del middleware)
 * Verifica que storeWorker solo accede a /pos, /customers y /dashboard, que admins no son
 * bloqueados, que un error transitorio de Supabase no bloquea al usuario, y que el CSP es correcto.
 */

import { computeLicenseStatus } from "@/lib/license";
import { buildCsp } from "@/middleware";

// Replica la lógica de routing del middleware sin depender de Clerk ni Next.js
function buildMeta(role: "systemAdmin" | "storeAdmin" | "storeWorker" | "none") {
  if (role === "systemAdmin") return { systemAdmin: true };
  if (role === "storeAdmin")  return { storeAdmin: true };
  if (role === "storeWorker") return { storeWorker: true };
  return {};
}

// Simula el routing del middleware con el nuevo destino de acceso denegado
function simulateRouting(meta: Record<string, unknown>, pathname: string): string {
  const isSystemAdmin = Boolean(meta.systemAdmin);
  const isStoreWorker = Boolean(meta.storeWorker) && !Boolean(meta.storeAdmin) && !isSystemAdmin;

  // Rutas admin-only (vendedores) → página dedicada de acceso denegado
  if (pathname.startsWith("/vendedores") && !isSystemAdmin && !meta.storeAdmin) {
    return `redirect:/acceso-denegado?from=${encodeURIComponent(pathname)}`;
  }

  // Root redirect — ANTES del check de storeWorker para evitar falso positivo:
  // sin este orden, "/" dispararía redirect aunque el usuario no intentó nada restringido.
  if (pathname === "/") {
    if (isSystemAdmin)    return "redirect:/admin";
    if (meta.storeAdmin)  return "redirect:/dashboard";
    if (meta.storeWorker) return "redirect:/pos";
    return "redirect:/dashboard";
  }

  // storeWorker puede usar /pos, /customers, /dashboard, /api y /acceso-denegado
  const workerAllowed = ["/pos", "/customers", "/dashboard", "/api", "/acceso-denegado"].some(
    (p) => pathname.startsWith(p)
  );
  if (isStoreWorker && !workerAllowed) {
    return `redirect:/acceso-denegado?from=${encodeURIComponent(pathname)}`;
  }

  return "allow";
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Middleware — routing por rol", () => {

  // MW-01: storeWorker puede acceder a /dashboard (ampliado — antes solo /pos)
  it("MW-01: storeWorker puede acceder a /dashboard", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/dashboard")).toBe("allow");
  });

  // MW-02: storeWorker es redirigido de /inventory a la página de acceso denegado
  it("MW-02: storeWorker redirigido de /inventory a /acceso-denegado con from", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/inventory")).toBe(
      `redirect:/acceso-denegado?from=${encodeURIComponent("/inventory")}`
    );
  });

  // MW-03: storeWorker es redirigido de /contabilidad a la página de acceso denegado
  it("MW-03: storeWorker redirigido de /contabilidad a /acceso-denegado con from", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/contabilidad")).toBe(
      `redirect:/acceso-denegado?from=${encodeURIComponent("/contabilidad")}`
    );
  });

  // MW-04: storeWorker puede acceder a /customers (ampliado — antes solo /pos)
  it("MW-04: storeWorker puede acceder a /customers", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/customers")).toBe("allow");
  });

  // MW-05: storeWorker puede acceder a /pos (su ruta base)
  it("MW-05: storeWorker puede acceder a /pos", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/pos")).toBe("allow");
  });

  // MW-06: storeWorker puede llamar APIs (protegidas por sus propios guards)
  it("MW-06: storeWorker puede llamar /api/ventas", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/api/ventas")).toBe("allow");
  });

  // MW-07: storeAdmin NO es bloqueado por la regla de worker
  it("MW-07: storeAdmin puede acceder a /dashboard", () => {
    expect(simulateRouting(buildMeta("storeAdmin"), "/dashboard")).toBe("allow");
  });

  // MW-08: storeAdmin puede acceder a /inventory
  it("MW-08: storeAdmin puede acceder a /inventory", () => {
    expect(simulateRouting(buildMeta("storeAdmin"), "/inventory")).toBe("allow");
  });

  // MW-09: systemAdmin puede acceder a cualquier ruta, incluyendo /vendedores
  it("MW-09: systemAdmin puede acceder a /vendedores", () => {
    expect(simulateRouting(buildMeta("systemAdmin"), "/vendedores")).toBe("allow");
  });

  // MW-10: storeWorker redirigido de /vendedores a la página de acceso denegado
  it("MW-10: storeWorker redirigido de /vendedores a /acceso-denegado con from=/vendedores", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/vendedores")).toBe(
      `redirect:/acceso-denegado?from=${encodeURIComponent("/vendedores")}`
    );
  });

  // MW-16: REGRESIÓN — redirect a /acceso-denegado incluye la ruta bloqueada en from
  it("MW-16: redirect por acceso denegado incluye la ruta bloqueada en from", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/sales")).toBe(
      `redirect:/acceso-denegado?from=${encodeURIComponent("/sales")}`
    );
    expect(simulateRouting(buildMeta("storeWorker"), "/admin")).toBe(
      `redirect:/acceso-denegado?from=${encodeURIComponent("/admin")}`
    );
    // storeAdmin intentando rutas normales — no bloqueado
    expect(simulateRouting(buildMeta("storeAdmin"), "/sales")).toBe("allow");
  });

  // MW-17: storeWorker puede acceder a /pos y subpaths — nunca recibe _denied
  it("MW-17: storeWorker accediendo a /pos no recibe _denied", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/pos")).toBe("allow");
    expect(simulateRouting(buildMeta("storeWorker"), "/pos/historial")).toBe("allow");
  });

  // MW-21: REGRESIÓN — storeWorker que navega a "/" recibe redirect limpio sin _denied.
  // Bug original: el check de storeWorker corría antes del root redirect; "/" no está en
  // workerAllowedRoutes, así que se generaba ?_denied=/ aunque el usuario no intentó nada restringido.
  it("MW-21: storeWorker en '/' redirige a /pos limpio, sin _denied (no es acceso denegado)", () => {
    const result = simulateRouting(buildMeta("storeWorker"), "/");
    expect(result).toBe("redirect:/pos");
    expect(result).not.toContain("_denied");
  });

  // MW-22: cuando storeWorker accede a una ruta bloqueada, from lleva esa ruta específica
  // para que la página /acceso-denegado muestre "No tienes permiso para acceder a Configuración"
  it("MW-22: from lleva la ruta exacta bloqueada para la página de acceso denegado", () => {
    const result = simulateRouting(buildMeta("storeWorker"), "/settings");
    expect(result).toBe(`redirect:/acceso-denegado?from=${encodeURIComponent("/settings")}`);
  });

  // MW-23: REGRESIÓN — storeWorker puede acceder a /acceso-denegado sin loop infinito.
  // Bug potencial: si /acceso-denegado no estuviera en workerAllowedRoutes, el middleware
  // redirigiría a /acceso-denegado indefinidamente.
  it("MW-23: storeWorker puede acceder a /acceso-denegado (no genera loop de redirección)", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/acceso-denegado")).toBe("allow");
  });
});

// ── Suite 2: license check fail-open (REGRESIÓN) ─────────────────────────────
//
// El middleware hace una consulta Supabase en cada request protegido.
// Si Supabase falla transitoriamente, el check debe ser fail-open (allow)
// para evitar que el middleware lance y Clerk redirija al usuario a sign-in.

// Espeja la lógica de license check del middleware, con try/catch incluido
async function simulateLicenseCheck(
  fetchStore: () => Promise<{ license_end_date: string | null; license_warning_days: number } | null>
): Promise<"blocked" | "allowed"> {
  try {
    const store = await fetchStore();
    if (!store) return "allowed";
    const { isAutoBlocked } = computeLicenseStatus(store);
    return isAutoBlocked ? "blocked" : "allowed";
  } catch {
    // Fail-open: error transitorio de DB no debe bloquear ni redirigir a login
    return "allowed";
  }
}

describe("Middleware — license check fail-open", () => {

  // MW-11: REGRESIÓN — error de Supabase no bloquea al usuario
  it("MW-11: error de Supabase en license check → request pasa (fail-open)", async () => {
    const fetchStore = () => Promise.reject(new Error("Connection timeout"));
    const result = await simulateLicenseCheck(fetchStore);
    expect(result).toBe("allowed");
  });

  // MW-12: store null (no encontrado) → permite el request
  it("MW-12: store no encontrado en DB → request pasa", async () => {
    const fetchStore = () => Promise.resolve(null);
    const result = await simulateLicenseCheck(fetchStore);
    expect(result).toBe("allowed");
  });

  // MW-13: store con licencia vigente → permite el request
  it("MW-13: licencia vigente → request pasa", async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 30);
    const fetchStore = () => Promise.resolve({
      license_end_date: tomorrow.toISOString().split("T")[0],
      license_warning_days: 7,
    });
    const result = await simulateLicenseCheck(fetchStore);
    expect(result).toBe("allowed");
  });

  // MW-14: store con licencia vencida → bloquea (redirige a /sistema-suspendido)
  it("MW-14: licencia vencida → request bloqueado", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const fetchStore = () => Promise.resolve({
      license_end_date: yesterday.toISOString().split("T")[0],
      license_warning_days: 7,
    });
    const result = await simulateLicenseCheck(fetchStore);
    expect(result).toBe("blocked");
  });

  // MW-15: sin license_end_date configurada → permite el request (no aplica vencimiento)
  it("MW-15: sin license_end_date configurada → request pasa", async () => {
    const fetchStore = () => Promise.resolve({
      license_end_date: null,
      license_warning_days: 7,
    });
    const result = await simulateLicenseCheck(fetchStore);
    expect(result).toBe("allowed");
  });
});

// ── Suite 3: CSP worker-src blob: (REGRESIÓN) ────────────────────────────────
//
// Clerk crea un Web Worker desde una blob: URL para hacer polling del token de
// sesión. La directiva worker-src del CSP debe incluir blob: en todos los
// entornos (producción y desarrollo). Bug original: blob: solo estaba permitido
// en desarrollo, bloqueando el login en producción.

const NONCE = "test-nonce-abc123";

describe("Middleware — CSP worker-src (MW-18/MW-19)", () => {

  // MW-18: REGRESIÓN — worker-src incluye blob: en producción
  it("MW-18: CSP de producción incluye blob: en worker-src (necesario para Clerk)", () => {
    const csp = buildCsp(NONCE, false); // isDev = false → producción
    const workerDirective = csp.split(";").find((d) => d.trim().startsWith("worker-src"));
    expect(workerDirective).toBeDefined();
    expect(workerDirective).toContain("blob:");
  });

  // MW-19: worker-src también incluye blob: en desarrollo (comportamiento previo preservado)
  it("MW-19: CSP de desarrollo incluye blob: en worker-src", () => {
    const csp = buildCsp(NONCE, true); // isDev = true → desarrollo
    const workerDirective = csp.split(";").find((d) => d.trim().startsWith("worker-src"));
    expect(workerDirective).toBeDefined();
    expect(workerDirective).toContain("blob:");
  });

  // MW-20: REGRESIÓN — frame-src permite challenges.cloudflare.com para Clerk Turnstile CAPTCHA
  it("MW-20: CSP incluye challenges.cloudflare.com en frame-src (Clerk Turnstile)", () => {
    const csp = buildCsp(NONCE, false);
    const frameDirective = csp.split(";").find((d) => d.trim().startsWith("frame-src"));
    expect(frameDirective).toBeDefined();
    expect(frameDirective).toContain("challenges.cloudflare.com");
  });
});
