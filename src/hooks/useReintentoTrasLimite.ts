"use client";

import { useEffect } from "react";
import { ApiError } from "@/lib/api-client";

// Tras un 429, TanStack Query no reintenta (reintentarQuery): este hook vuelve
// a pedir los datos cuando vence el Retry-After, para que la pantalla se
// recupere sola sin que el usuario tenga que recargar. Sin Retry-After usa
// `esperaPorDefectoSeg`.
export function useReintentoTrasLimite(
  error: unknown,
  reintentar: () => unknown,
  esperaPorDefectoSeg = 30
): void {
  const segundos =
    error instanceof ApiError && error.status === 429 ? error.retryAfterSeg ?? esperaPorDefectoSeg : null;

  useEffect(() => {
    if (segundos === null) return;
    const id = setTimeout(() => {
      reintentar();
    }, segundos * 1000);
    return () => clearTimeout(id);
    // Se programa una vez por error; `reintentar` (refetch) es estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, segundos]);
}
