import { PlataformaError, type ChannelContext } from "../port";

// Cliente HTTP de la API de integraciones de Rappi (restaurantes). Recibe las
// credenciales ya descifradas del ChannelContext (C4: el adaptador anterior
// pasaba externalStoreId "" y credentials {}). Endpoints tomados del
// adaptador anterior y de dev-portal.rappi.com/en/api-reference/orders
// (take/reject/ready-for-pickup verificados 2026-09-25); el endpoint de token
// NO se verificó contra la documentación: confirmarlo en el sandbox (Fase 6).

const PATH_BASE = "/api/v2/restaurants-integrations-public-api";
const PATH_TOKEN = "/restaurants/auth/v1/token/login/integrations";

// C19: en producción NO hay default (antes apuntaba a dev siempre que faltara
// la variable). Solo en desarrollo/test se usa el ambiente dev de Rappi.
function baseUrl(variable: "RAPPI_API_BASE" | "RAPPI_AUTH_BASE", defaultDev: string): string {
  const valor = process.env[variable];
  if (valor) return valor.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new PlataformaError(`${variable} no configurada: requerida en producción`);
  }
  return defaultDev;
}

export function rappiApiBase(): string {
  return baseUrl("RAPPI_API_BASE", "https://microservices.dev.rappi.com");
}

export function rappiAuthBase(): string {
  return baseUrl("RAPPI_AUTH_BASE", "https://api.dev.rappi.com");
}

interface TokenCacheado {
  token: string;
  expiraMs: number;
}

const cacheTokens = new Map<string, TokenCacheado>();

// C19: el buffer de renovación era 24 h sobre tokens de 24 h → el caché
// nunca se usaba. Ahora: 10 % de la vida del token, máximo 5 minutos.
export function margenRenovacionMs(expiresInSeg: number): number {
  return Math.min(5 * 60 * 1000, expiresInSeg * 1000 * 0.1);
}

export function limpiarCacheTokens(): void {
  cacheTokens.clear();
}

function claveToken(ctx: ChannelContext): string {
  return `${ctx.storeId}:${ctx.credentials.client_id}`;
}

async function obtenerToken(ctx: ChannelContext): Promise<string> {
  const clave = claveToken(ctx);
  const cacheado = cacheTokens.get(clave);
  if (cacheado && Date.now() < cacheado.expiraMs) return cacheado.token;

  const res = await fetch(`${rappiAuthBase()}${PATH_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: ctx.credentials.client_id,
      client_secret: ctx.credentials.client_secret,
    }),
  });
  if (!res.ok) {
    // No se incluye el cuerpo: podría reflejar credenciales.
    throw new PlataformaError(`Rappi: autenticación rechazada (${res.status})`, res.status);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new PlataformaError("Rappi: respuesta de token sin access_token");
  const expiresIn = Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600;
  cacheTokens.set(clave, {
    token: data.access_token,
    expiraMs: Date.now() + expiresIn * 1000 - margenRenovacionMs(expiresIn),
  });
  return data.access_token;
}

export async function rappiFetch(
  ctx: ChannelContext,
  metodo: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown
): Promise<Response> {
  const token = await obtenerToken(ctx);
  const res = await fetch(`${rappiApiBase()}${PATH_BASE}${path}`, {
    method: metodo,
    headers: {
      "x-authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    // Fase 5 (5.3, token expirado/revocado): sin esto el token cacheado
    // seguiría usándose en cada reintento hasta su expiración local.
    if (res.status === 401) cacheTokens.delete(claveToken(ctx));
    throw new PlataformaError(`Rappi: ${metodo} ${path.split("?")[0]} respondió ${res.status}`, res.status);
  }
  return res;
}
