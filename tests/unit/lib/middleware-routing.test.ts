/**
 * Tests MW-01 a MW-19: lógica de routing por rol, license check y CSP (extraída del middleware)
 * Verifica que storeWorker solo accede a /pos, admins no son bloqueados,
 * que un error transitorio de Supabase en la verificación de licencia no bloquea al usuario,
 * y que el CSP generado es correcto en todos los entornos.
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

function simulateRouting(meta: Record<string, unknown>, pathname: string):
  "allow" | "redirect:/pos" | "redirect:/pos?_denied=1" | "redirect:/dashboard" | "redirect:/admin" {
  const isSystemAdmin = Boolean(meta.systemAdmin);
  const isStoreWorker = Boolean(meta.storeWorker) && !Boolean(meta.storeAdmin) && !isSystemAdmin;

  // Rutas admin-only (vendedores)
  if (pathname.startsWith("/vendedores") && !isSystemAdmin && !meta.storeAdmin) {
    return "redirect:/pos?_denied=1";
  }

  // storeWorker solo puede usar /pos y /api — incluye _denied=1 para informar al usuario
  if (isStoreWorker && !pathname.startsWith("/pos") && !pathname.startsWith("/api")) {
    return "redirect:/pos?_denied=1";
  }

  // Root redirect por rol
  if (pathname === "/") {
    if (isSystemAdmin)       return "redirect:/admin";
    if (meta.storeAdmin)     return "redirect:/dashboard";
    if (meta.storeWorker)    return "redirect:/pos";
    return "redirect:/dashboard";
  }

  return "allow";
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Middleware — routing por rol", () => {

  // MW-01: storeWorker es redirigido al intentar acceder a /dashboard — con _denied=1
  it("MW-01: storeWorker redirigido de /dashboard a /pos?_denied=1", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/dashboard")).toBe("redirect:/pos?_denied=1");
  });

  // MW-02: storeWorker es redirigido al intentar acceder a /inventory — con _denied=1
  it("MW-02: storeWorker redirigido de /inventory a /pos?_denied=1", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/inventory")).toBe("redirect:/pos?_denied=1");
  });

  // MW-03: storeWorker es redirigido al intentar acceder a /contabilidad — con _denied=1
  it("MW-03: storeWorker redirigido de /contabilidad a /pos?_denied=1", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/contabilidad")).toBe("redirect:/pos?_denied=1");
  });

  // MW-04: storeWorker redirigido de /customers — con _denied=1 (Clientes ya no está en su nav)
  it("MW-04: storeWorker redirigido de /customers a /pos?_denied=1", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/customers")).toBe("redirect:/pos?_denied=1");
  });

  // MW-05: storeWorker puede acceder a /pos (su ruta permitida)
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

  // MW-09: systemAdmin puede acceder a cualquier ruta, incluyendo /admin
  it("MW-09: systemAdmin puede acceder a /vendedores", () => {
    expect(simulateRouting(buildMeta("systemAdmin"), "/vendedores")).toBe("allow");
  });

  // MW-10: storeWorker redirigido de /vendedores — con _denied=1
  it("MW-10: storeWorker redirigido de /vendedores a /pos?_denied=1", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/vendedores")).toBe("redirect:/pos?_denied=1");
  });

  // MW-16: REGRESIÓN — redirect a ruta no permitida incluye _denied=1 para feedback al usuario
  it("MW-16: redirect por acceso denegado incluye _denied=1 en la URL destino", () => {
    // storeWorker: cualquier ruta no-pos incluye el param
    expect(simulateRouting(buildMeta("storeWorker"), "/sales")).toBe("redirect:/pos?_denied=1");
    expect(simulateRouting(buildMeta("storeWorker"), "/admin")).toBe("redirect:/pos?_denied=1");
    // storeAdmin intentando /vendedores (no es storeAdmin guard) — ruta normal
    expect(simulateRouting(buildMeta("storeAdmin"), "/sales")).toBe("allow");
  });

  // MW-17: storeWorker puede acceder a /pos y a subpaths — nunca se le niega con _denied
  it("MW-17: storeWorker accediendo a /pos no recibe _denied=1", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/pos")).toBe("allow");
    expect(simulateRouting(buildMeta("storeWorker"), "/pos/historial")).toBe("allow");
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
});
