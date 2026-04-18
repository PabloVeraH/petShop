// src/middleware/rateLimit.ts
import { NextRequest, NextResponse } from "next/server";
import { logSecurityAlert } from "@/lib/security-alerts";

interface RateLimitStore {
  [key: string]: { count: number; resetTime: number };
}

const store: RateLimitStore = {};

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

  return async (req: NextRequest): Promise<NextResponse | null> => {
    const key = finalConfig.keyGenerator!(req);
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
        message: `Rate limit exceeded for IP ${key}: ${store[key].count} requests`,
        metadata: { ip: key, count: store[key].count, limit: finalConfig.maxRequests },
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

// Rate limiters específicos por endpoint
export const apiGeneralLimit = createRateLimit({
  windowMs: 900000,  // 15 min
  maxRequests: 100,
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