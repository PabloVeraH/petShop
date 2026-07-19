const CLERK_DEV_PREFIXES = ["pk_test_", "sk_test_"] as const;

export function isClerkDevKey(key: string): boolean {
  return CLERK_DEV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function checkClerkEnv(): { isDev: boolean; warnings: string[] } {
  const warnings: string[] = [];

  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  if (isClerkDevKey(publishableKey)) {
    warnings.push(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY usa clave de DESARROLLO (pk_test_). " +
        "Reemplázala con una clave de producción (pk_live_) desde el dashboard de Clerk."
    );
  }

  const secretKey = process.env.CLERK_SECRET_KEY ?? "";
  if (isClerkDevKey(secretKey)) {
    warnings.push(
      "CLERK_SECRET_KEY usa clave de DESARROLLO (sk_test_). " +
        "Reemplázala con una clave de producción (sk_live_) desde el dashboard de Clerk."
    );
  }

  return { isDev: warnings.length > 0, warnings };
}

const clerkEnvState = checkClerkEnv();

if (clerkEnvState.isDev && process.env.NODE_ENV === "production") {
  console.warn("[clerk-env] ⚠️ Clerk está en MODO DESARROLLO. Las claves de desarrollo tienen límites de uso.");
  for (const w of clerkEnvState.warnings) {
    console.warn("[clerk-env] ⚠️", w);
  }
}

export function getClerkEnvState(): { isDev: boolean; warnings: string[] } {
  return clerkEnvState;
}
