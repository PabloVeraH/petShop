// Fetch JSON para el cliente que NO confunde una respuesta de error con datos.
// Antes, varios queryFn hacían `fetch(...).then(r => r.json())` sin revisar
// res.ok: un 429 del rate limit o un 500 llegaba como "datos" ({ error }) y la
// UI mostraba "Sin productos", "Venta no encontrada" o el nombre por defecto.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeg: number | null = null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Mensaje para el usuario según el status. `mensajeApi` es el `error` que
// devolvió la API (se usa para 4xx de negocio; en 5xx no se muestra).
export function mensajeErrorApi(status: number, mensajeApi?: string | null, retryAfterSeg?: number | null): string {
  if (status === 429) {
    return retryAfterSeg && retryAfterSeg > 0
      ? `Demasiadas solicitudes. Reintenta en ${retryAfterSeg} s.`
      : "Demasiadas solicitudes. Reintenta en unos segundos.";
  }
  if (status >= 500) return "Error del servidor. Intenta de nuevo en unos momentos.";
  return mensajeApi || `Error ${status}`;
}

function leerRetryAfter(res: Response): number | null {
  const valor = res.headers?.get?.("Retry-After");
  if (!valor) return null;
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const retryAfter = res.status === 429 ? leerRetryAfter(res) : null;
    const mensajeApi = body && typeof body.error === "string" ? body.error : null;
    throw new ApiError(mensajeErrorApi(res.status, mensajeApi, retryAfter), res.status, retryAfter);
  }
  return body as T;
}

// Política de reintentos de TanStack Query: un 429 no se reintenta (solo
// agrava el límite) ni un 4xx de negocio; el resto, una vez (como antes).
export function reintentarQuery(intentos: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return intentos < 1;
}
