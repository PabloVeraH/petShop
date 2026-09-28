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

// ApiError de una respuesta no-ok (status, Retry-After y mensaje para el
// usuario). `body` es el JSON ya leído, o null si no había.
export function errorDeRespuesta(res: Response, body: unknown): ApiError {
  const retryAfter = res.status === 429 ? leerRetryAfter(res) : null;
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
  const mensajeApi = typeof error === "string" ? error : null;
  return new ApiError(mensajeErrorApi(res.status, mensajeApi, retryAfter), res.status, retryAfter);
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw errorDeRespuesta(res, body);
  return body as T;
}

// Política de reintentos de TanStack Query: un 429 no se reintenta (solo
// agrava el límite) ni un 4xx de negocio; el resto, una vez (como antes).
export function reintentarQuery(intentos: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return intentos < 1;
}
