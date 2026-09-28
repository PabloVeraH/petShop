// src/middleware/rateLimit.ts
import { NextRequest, NextResponse } from "next/server";
import { logSecurityAlert } from "@/lib/security-alerts";

interface RateLimitStore {
  [key: string]: { count: number; resetTime: number };
}

export interface RateLimitConfig {
  windowMs: number;      // 900000 = 15 min
  maxRequests: number;   // 100 requests
  keyGenerator?: (req: NextRequest) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

const defaultConfig: RateLimitConfig = {
  windowMs: 900000,      // 15 minutes
  maxRequests: 100,
  keyGenerator: (req) => {
    return req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
  },
};

export function createRateLimit(config: Partial<RateLimitConfig> = {}) {
  const finalConfig = { ...defaultConfig, ...config };
  // Contadores propios de cada limitador. Con un diccionario compartido, la
  // misma IP sumaba en una sola entrada para todos los limitadores: el tráfico
  // del navegador agotaba el cupo del webhook de canales y la ventana la fijaba
  // el primero que creaba la entrada.
  const store: RateLimitStore = {};

  // clave: opcional; si no se pasa, se usa keyGenerator (IP).
  return async (req: NextRequest, clave?: string): Promise<NextResponse | null> => {
    const key = clave ?? finalConfig.keyGenerator!(req);
    const now = Date.now();

    // Limpiar entrada expirada
    if (store[key] && store[key].resetTime < now) {
      delete store[key];
    }

    // Crear entrada si no existe
    if (!store[key]) {
      store[key] = { count: 0, resetTime: now + finalConfig.windowMs };
    }

    store[key].count++;

    // Excedió límite
    if (store[key].count > finalConfig.maxRequests) {
      logSecurityAlert({
        type: "rate_limit_exceeded",
        severity: "MEDIUM",
        message: `Rate limit exceeded for ${key}: ${store[key].count} requests`,
        metadata: { clave: key, count: store[key].count, limit: finalConfig.maxRequests },
      });

      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((store[key].resetTime - now) / 1000)),
            "X-RateLimit-Limit": String(finalConfig.maxRequests),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    return null; // Permitir
  };
}

// Límite leído de una variable de entorno: entero positivo o, si falta o es
// inválido, el valor por defecto (un typo no debe desactivar el límite).
export function maxRequestsDesdeEnv(valor: string | undefined, porDefecto: number): number {
  if (!valor || !/^\d+$/.test(valor.trim())) return porDefecto;
  const n = Number(valor.trim());
  return n > 0 ? n : porDefecto;
}

// Rate limiters específicos por endpoint
// Sin sesión: por IP. RATE_LIMIT_API_MAX permite subirlo en local: sin
// x-forwarded-for todas las requests caen en la clave "unknown".
export const apiGeneralLimit = createRateLimit({
  windowMs: 900000,  // 15 min
  maxRequests: maxRequestsDesdeEnv(process.env.RATE_LIMIT_API_MAX, 100),
});

// Con sesión de Clerk: por usuario. Por IP, toda una tienda (varias cajas
// detrás de la misma IP pública) compartía 100 req / 15 min, y solo el polling
// de pedidos de canales de un POS consume 45–90 en esa ventana.
export const apiUsuarioLimit = createRateLimit({
  windowMs: 300000,  // 5 min
  maxRequests: maxRequestsDesdeEnv(process.env.RATE_LIMIT_USER_MAX, 600),
});

export const authLimit = createRateLimit({
  windowMs: 900000,  // 15 min
  maxRequests: 10,   // Más restrictivo para auth
});

export const paymentLimit = createRateLimit({
  windowMs: 60000,   // 1 min
  maxRequests: 5,    // Max 5 transacciones por minuto
});

export const webhookLimit = createRateLimit({
  windowMs: 60000,
  maxRequests: 50,
});

// Elige el limitador de una request a /api: el webhook de canales tiene el
// suyo (por IP, lo llama la plataforma sin sesión); con usuario de Clerk, por
// usuario; sin sesión, por IP.
export async function aplicarRateLimit(req: NextRequest, userId: string | null | undefined): Promise<NextResponse | null> {
  if (req.nextUrl.pathname.startsWith("/api/canales/webhook/")) return webhookLimit(req);
  if (userId) return apiUsuarioLimit(req, `user:${userId}`);
  return apiGeneralLimit(req);
}
