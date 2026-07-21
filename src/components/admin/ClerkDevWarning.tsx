"use client";

import { isClerkDevKey } from "@/lib/clerk-env";

interface ClerkDevWarningProps {
  publishableKey?: string;
}

/**
 * Muestra un banner de advertencia si NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
 * es una clave de desarrollo (pk_test_...). Desaparece automáticamente
 * cuando se reemplaza por una clave de producción (pk_live_...).
 * Acepta publishableKey como prop para testabilidad; por defecto lee
 * process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.
 */
export function ClerkDevWarning({ publishableKey }: ClerkDevWarningProps) {
  const key = publishableKey ?? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const isDev = isClerkDevKey(key);

  if (!isDev) return null;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-6">
      <div className="flex items-start gap-3">
        <span className="text-amber-600 text-lg shrink-0 mt-0.5" aria-hidden="true">⚠️</span>
        <div>
          <p className="text-sm font-semibold text-amber-800">
            Clerk está en modo desarrollo
          </p>
          <p className="text-sm text-amber-700 mt-1">
            La autenticación usa claves de desarrollo (<code className="text-xs bg-amber-100 px-1 rounded">pk_test_</code>).
            En producción, reemplázalas por claves de producción (<code className="text-xs bg-amber-100 px-1 rounded">pk_live_</code>)
            desde el{" "}
            <a
              href="https://dashboard.clerk.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium hover:text-amber-900"
            >
              dashboard de Clerk
            </a>.
          </p>
          <p className="text-xs text-amber-600 mt-1">
            El badge &ldquo;Development mode&rdquo; en el panel de usuario desaparecerá automáticamente.
          </p>
        </div>
      </div>
    </div>
  );
}
