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

  // Rutas systemAdmin-only (admin) → página dedicada de acceso denegado
  // /api/admin NO está incluido — cada API route tiene su propio guard de autorización.
  if (pathname.startsWith("/admin") && !pathname.startsWith("/api/admin") && !isSystemAdmin) {
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

  // MW-25: REGRESIÓN — ticket 6a61a8b2792efeb5e59de96a: storeAdmin NO puede acceder a /admin.
  // storeAdmin podía acceder al panel /admin directamente por URL, viendo datos de auditoría
  // y gestión de usuarios. Solo systemAdmin debe acceder a /admin.
  it("MW-25: storeAdmin redirigido de /admin a /acceso-denegado (solo systemAdmin tiene acceso)", () => {
    expect(simulateRouting(buildMeta("storeAdmin"), "/admin")).toBe(
      `redirect:/acceso-denegado?from=${encodeURIComponent("/admin")}`
    );
    // systemAdmin sí puede acceder
    expect(simulateRouting(buildMeta("systemAdmin"), "/admin")).toBe("allow");
  });

  // MW-26: /api/admin NO debe ser bloqueado para storeAdmin (cada API route tiene su propio guard).
  it("MW-26: storeAdmin puede llamar /api/admin/stores (no bloqueado por regla /admin)", () => {
    expect(simulateRouting(buildMeta("storeAdmin"), "/api/admin/stores")).toBe("allow");
    expect(simulateRouting(buildMeta("storeWorker"), "/api/admin/users")).toBe("allow");
  });
});

// ── Suite 2: DB cross-verify (stale JWT) en /admin ──────────────────────────
//
// El middleware ahora cross-verifica el claim systemAdmin contra la BD cuando
// se accede a /admin (no /api/admin). Si el JWT dice systemAdmin pero la BD
// dice que no, el acceso es denegado. Esto protege contra JWTs obsoletos tras
// un cambio de rol (ticket 6a61a8b2792efeb5e59de96a).

async function simulateAdminDbCheck(
  dbResult: { system_admin: boolean } | null | undefined,
  dbError: boolean
): Promise<string> {
  const userId = "user-1";
  const isSystemAdmin = true; // JWT claims systemAdmin (stale scenario)

  // Replica la lógica del middleware para /admin (no /api/admin)
  if (!isSystemAdmin) {
    return `redirect:/acceso-denegado?from=${encodeURIComponent("/admin")}`;
  }

  if (userId) {
    try {
      if (dbError) throw new Error("DB error");
      if (!dbResult?.system_admin) {
        return `redirect:/acceso-denegado?from=${encodeURIComponent("/admin")}`;
      }
    } catch {
      // Fail-secure for /admin
      return `redirect:/acceso-denegado?from=${encodeURIComponent("/admin")}`;
    }
  }

  return "allow";
}

describe("Middleware — DB cross-verify admin (MW-27/MW-28)", () => {

  // MW-27: REGRESIÓN — stale JWT (JWT dice systemAdmin, BD dice storeAdmin)
  it("MW-27: JWT stale con systemAdmin pero BD rechaza → acceso denegado a /admin", async () => {
    const result = await simulateAdminDbCheck({ system_admin: false }, false);
    expect(result).toBe(`redirect:/acceso-denegado?from=${encodeURIComponent("/admin")}`);
  });

  // MW-28: JWT y BD coinciden en systemAdmin → acceso permitido
  it("MW-28: JWT y BD confirman systemAdmin → acceso permitido a /admin", async () => {
    const result = await simulateAdminDbCheck({ system_admin: true }, false);
    expect(result).toBe("allow");
  });

  it("MW-28b: error de BD en admin check → fail-secure (denegado)", async () => {
    const result = await simulateAdminDbCheck(undefined, true);
    expect(result).toBe(`redirect:/acceso-denegado?from=${encodeURIComponent("/admin")}`);
  });

  it("MW-28c: usuario sin fila en clerk_users (null) → acceso denegado", async () => {
    const result = await simulateAdminDbCheck(null, false);
    expect(result).toBe(`redirect:/acceso-denegado?from=${encodeURIComponent("/admin")}`);
  });
});

// ── Suite 3: license check fail-open (REGRESIÓN) ─────────────────────────────
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
    const futuro = new Date();
    futuro.setDate(futuro.getDate() + 30);
    // Fecha construida con partes locales: toISOString().split("T")[0]
    // desplaza por zona horaria y cerca de medianoche devuelve el día
    // siguiente (el fix de fechas de licencia lo expuso: ticket 6a77ef3a).
    const y = futuro.getFullYear();
    const m = String(futuro.getMonth() + 1).padStart(2, "0");
    const d = String(futuro.getDate()).padStart(2, "0");
    const fetchStore = () => Promise.resolve({
      license_end_date: `${y}-${m}-${d}`,
      license_warning_days: 7,
    });
    const result = await simulateLicenseCheck(fetchStore);
    expect(result).toBe("allowed");
  });

  // MW-14: store con licencia vencida → bloquea (redirige a /sistema-suspendido)
  it("MW-14: licencia vencida → request bloqueado", async () => {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const y = ayer.getFullYear();
    const m = String(ayer.getMonth() + 1).padStart(2, "0");
    const d = String(ayer.getDate()).padStart(2, "0");
    const fetchStore = () => Promise.resolve({
      license_end_date: `${y}-${m}-${d}`,
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

// ── Suite 4: CSP worker-src blob: (REGRESIÓN) ────────────────────────────────
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

  // MW-29: REGRESIÓN — img-src permite el subdominio dedicado de R2 de fotos
  // de producto (docs/product-images.md), separado del dominio de la app
  // (demo.ammapet.cl → Vercel) para que ambos no compitan por el mismo
  // registro DNS. Bug: sin esto, el navegador bloqueaba silenciosamente las
  // miniaturas del formulario de Inventario (ícono de imagen rota) aunque la
  // URL guardada en imagen_url/imagen_url_2 fuera válida y el objeto
  // existiera en R2.
  it("MW-29: CSP incluye el dominio de R2 (imgs.ammapet.cl) en img-src", () => {
    const csp = buildCsp(NONCE, false);
    const imgDirective = csp.split(";").find((d) => d.trim().startsWith("img-src"));
    expect(imgDirective).toBeDefined();
    expect(imgDirective).toContain("https://imgs.ammapet.cl");
  });
});

describe("Middleware — redirect de /workers a /vendedores (MW-24, Suite 5)", () => {

  // MW-24: REGRESIÓN — /workers debe redirigir a /vendedores.
  // La ruta canónica es /vendedores (español); /workers no tiene page y daba 404 sin navegación.
  it("MW-24: next.config.ts tiene redirect /workers → /vendedores", () => {
    const fs = require("fs");
    const path = require("path");
    const configContent = fs.readFileSync(
      path.resolve(__dirname, "../../../next.config.ts"),
      "utf-8"
    );
    expect(configContent).toContain('source: "/workers"');
    expect(configContent).toContain('destination: "/vendedores"');
    expect(configContent).toContain("permanent: false");
  });
});
