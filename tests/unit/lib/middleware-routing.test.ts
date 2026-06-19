/**
 * Tests MW-01 a MW-08: lógica de routing por rol (extraída del middleware)
 * Verifica que storeWorker solo accede a /pos y que admins no son bloqueados.
 */

// Replica la lógica de routing del middleware sin depender de Clerk ni Next.js
function buildMeta(role: "systemAdmin" | "storeAdmin" | "storeWorker" | "none") {
  if (role === "systemAdmin") return { systemAdmin: true };
  if (role === "storeAdmin")  return { storeAdmin: true };
  if (role === "storeWorker") return { storeWorker: true };
  return {};
}

function simulateRouting(meta: Record<string, unknown>, pathname: string): "allow" | "redirect:/pos" | "redirect:/dashboard" | "redirect:/admin" {
  const isSystemAdmin = Boolean(meta.systemAdmin);
  const isStoreWorker = Boolean(meta.storeWorker) && !Boolean(meta.storeAdmin) && !isSystemAdmin;

  // Rutas admin-only (vendedores)
  if (pathname.startsWith("/vendedores") && !isSystemAdmin && !meta.storeAdmin) {
    return "redirect:/pos";
  }

  // storeWorker solo puede usar /pos y /api
  if (isStoreWorker && !pathname.startsWith("/pos") && !pathname.startsWith("/api")) {
    return "redirect:/pos";
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

  // MW-01: storeWorker es redirigido al intentar acceder a /dashboard
  it("MW-01: storeWorker redirigido de /dashboard a /pos", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/dashboard")).toBe("redirect:/pos");
  });

  // MW-02: storeWorker es redirigido al intentar acceder a /inventory
  it("MW-02: storeWorker redirigido de /inventory a /pos", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/inventory")).toBe("redirect:/pos");
  });

  // MW-03: storeWorker es redirigido al intentar acceder a /contabilidad
  it("MW-03: storeWorker redirigido de /contabilidad a /pos", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/contabilidad")).toBe("redirect:/pos");
  });

  // MW-04: storeWorker es redirigido de /customers
  it("MW-04: storeWorker redirigido de /customers a /pos", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/customers")).toBe("redirect:/pos");
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

  // MW-10: storeWorker redirigido de /vendedores (regla legacy + nueva regla)
  it("MW-10: storeWorker redirigido de /vendedores a /pos", () => {
    expect(simulateRouting(buildMeta("storeWorker"), "/vendedores")).toBe("redirect:/pos");
  });
});
