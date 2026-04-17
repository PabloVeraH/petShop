# OWASP Security - Implementation Guide

Soluciones de código ready-to-use para los 4 hallazgos críticos.

---

## 1. Audit Logging (CRÍTICO - 8 horas)

### 1.1 Schema SQL

```sql
-- Tabla de auditoría
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,                    -- Clerk user_id
  action VARCHAR(50) NOT NULL,              -- CREATE, UPDATE, DELETE, LOGIN, EXPORT, etc
  entity_type VARCHAR(50) NOT NULL,         -- 'venta', 'pago', 'cliente', 'inventario', 'settings'
  entity_id UUID,                           -- ID de la entidad modificada
  old_values JSONB,                         -- Snapshot anterior
  new_values JSONB,                         -- Snapshot nuevo
  change_description TEXT,                  -- Human-readable: "Precio cambiado de 100 a 200"
  ip_address INET,
  user_agent TEXT,
  result VARCHAR(20) DEFAULT 'success',    -- 'success', 'failure', 'partial'
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índices críticos
CREATE INDEX idx_audit_store_time ON audit_logs(store_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, created_at DESC);
CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);

-- RLS policy: solo su store_id
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own store audit" ON audit_logs
  FOR SELECT USING (store_id IN (
    SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
  ));
CREATE POLICY "Only service role can insert" ON audit_logs
  FOR INSERT WITH CHECK (true);  -- Solo via backend
```

### 1.2 Función TypeScript - Audit Logger

```typescript
// src/lib/audit.ts
import { createServiceClient } from "./supabase";
import { NextRequest } from "next/server";

export interface AuditLogInput {
  storeId: string;
  userId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "LOGIN_FAILED" | "EXPORT" | "SETTINGS";
  entityType: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changeDescription?: string;
  ipAddress?: string;
  userAgent?: string;
  result?: "success" | "failure" | "partial";
  errorMessage?: string;
}

export async function logAudit(input: AuditLogInput) {
  const supabase = createServiceClient();
  
  const { error } = await supabase.from("audit_logs").insert({
    store_id: input.storeId,
    user_id: input.userId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    old_values: input.oldValues,
    new_values: input.newValues,
    change_description: input.changeDescription,
    ip_address: input.ipAddress,
    user_agent: input.userAgent,
    result: input.result || "success",
    error_message: input.errorMessage,
  });

  if (error) {
    console.error("Failed to log audit:", error);
    // No lanzar error - auditoría no debe bloquear operación
  }
}

// Helper para extraer IP y UA
export function getRequestMetadata(req: NextRequest) {
  return {
    ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
    userAgent: req.headers.get("user-agent"),
  };
}

// Helper para comparar objetos (para old_values vs new_values)
export function getChangedFields(oldObj: any, newObj: any): string {
  const changes: string[] = [];
  for (const key in newObj) {
    if (oldObj[key] !== newObj[key]) {
      changes.push(`${key}: ${oldObj[key]} → ${newObj[key]}`);
    }
  }
  return changes.join(", ");
}
```

### 1.3 Ejemplo de Uso - Endpoint POST Venta

```typescript
// src/app/api/ventas/route.ts
import { getStoreId } from "@/lib/auth";
import { logAudit, getRequestMetadata, getChangedFields } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const { storeId, userId } = ctx;
  const { items, metodoPago } = await req.json();
  const { ipAddress, userAgent } = getRequestMetadata(req);

  const supabase = createServiceClient();

  try {
    // Validar, insertar...
    const { data: venta, error } = await supabase
      .from("ventas")
      .insert({ store_id: storeId, items_json: items, metodo_pago: metodoPago })
      .select()
      .single();

    if (error) throw error;

    // ✅ LOG SUCCESS
    await logAudit({
      storeId,
      userId,
      action: "CREATE",
      entityType: "venta",
      entityId: venta.id,
      newValues: venta,
      changeDescription: `Venta creada por $${venta.total} con ${items.length} items`,
      ipAddress,
      userAgent,
      result: "success",
    });

    return NextResponse.json(venta);
  } catch (error) {
    // ✅ LOG FAILURE
    await logAudit({
      storeId,
      userId,
      action: "CREATE",
      entityType: "venta",
      newValues: { items, metodoPago },
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json({ error: "Error creating sale" }, { status: 500 });
  }
}
```

### 1.4 Endpoint para Consultar Audit Log (Admin only)

```typescript
// src/app/api/admin/audit-logs/route.ts
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { userId, sessionClaims } = await auth();
  if (!userId) return NextResponse.json({}, { status: 401 });

  const meta = sessionClaims?.publicMetadata as any;
  if (!meta?.systemAdmin && !meta?.storeAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "100"), 1000);
  const action = req.nextUrl.searchParams.get("action");
  const entityType = req.nextUrl.searchParams.get("entityType");

  let query = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (action) query = query.eq("action", action);
  if (entityType) query = query.eq("entity_type", entityType);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Error fetching audit logs" }, { status: 500 });
  }

  return NextResponse.json(data);
}
```

---

## 2. Rate Limiting (CRÍTICO - 6 horas)

### 2.1 Middleware de Rate Limiting

```typescript
// src/middleware/rateLimit.ts
import { NextRequest, NextResponse } from "next/server";

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
    return req.headers.get("x-forwarded-for") || req.ip || "unknown";
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
```

### 2.2 Usar en Endpoints

```typescript
// src/app/api/pagos/route.ts
import { paymentLimit } from "@/middleware/rateLimit";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  // Aplicar rate limit PRIMERO
  const rateLimitResponse = await paymentLimit(req);
  if (rateLimitResponse) return rateLimitResponse;

  // ... resto del código
}
```

### 2.3 Middleware Global (Todos los /api/*)

```typescript
// src/middleware.ts (agregar al existente)
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { apiGeneralLimit } from "@/middleware/rateLimit";

export default clerkMiddleware(async (auth, req) => {
  // Aplicar rate limit a TODOS los endpoints /api
  if (req.nextUrl.pathname.startsWith("/api")) {
    const rateLimitResponse = await apiGeneralLimit(req);
    if (rateLimitResponse) return rateLimitResponse;
  }

  // ... resto del middleware existente
});
```

---

## 3. Fijar CSP (CRÍTICO - 2 horas)

### 3.1 next.config.ts - CSP Sin Unsafe

```typescript
// next.config.ts
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Sin 'unsafe-inline' 'unsafe-eval' !!
      "script-src 'self' https://clerk.accounts.dev https://*.clerk.accounts.dev",
      "style-src 'self'",  // Sin 'unsafe-inline'
      "img-src 'self' data: blob: https://*.clerk.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.clerk.com",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
```

### 3.2 Si necesitas Clerk con Inline Styles (Usar Nonce)

```typescript
// Para Clerk que requiere 'unsafe-inline':
// Opción A: Cambiar script-src a:
// "script-src 'self' https://clerk.accounts.dev"

// Opción B: Si Clerk lo requiere, usar nonce dinamico:
const generateNonce = () => crypto.randomBytes(16).toString('base64');
const nonce = generateNonce();

// En CSP:
`script-src 'self' 'nonce-${nonce}' https://clerk.accounts.dev`

// En componente Clerk:
<Clerk nonce={nonce} />
```

---

## 4. RLS Policies (CRÍTICO - 4 horas)

### 4.1 Completar RLS en BD

```sql
-- Verificar que todas las tablas tienen RLS habilitado
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname='public' AND NOT rowsecurity;

-- Habilitar RLS en tablas faltantes
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mascotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;

-- Crear policies base (ejemplo para productos)
DROP POLICY IF EXISTS "Users see own store products" ON productos;
CREATE POLICY "Users see own store products" ON productos
  FOR SELECT USING (
    store_id IN (
      SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users modify own store products" ON productos;
CREATE POLICY "Users modify own store products" ON productos
  FOR UPDATE USING (
    store_id IN (
      SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users delete own store products" ON productos;
CREATE POLICY "Users delete own store products" ON productos
  FOR DELETE USING (
    store_id IN (
      SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role bypass" ON productos;
CREATE POLICY "Service role bypass" ON productos
  USING (auth.role() = 'service_role');

-- Repetir para: clientes, mascotas, inventario, ventas, pagos, saldos_favor, cuentas_pagar
```

### 4.2 Verificar RLS en Test

```typescript
// src/app/tests/integration/security/rls.test.ts
describe("RLS Policies - Multi-tenant Isolation", () => {
  it("User A cannot read User B products", async () => {
    // Simular que User A queremos leer producto de User B
    const supabaseA = createServiceClient({ userId: "user-a" });
    const { data, error } = await supabaseA
      .from("productos")
      .select("*")
      .eq("store_id", "store-b");

    // Debería estar vacío debido a RLS
    expect(data).toEqual([]);
  });

  it("Service role bypass works", async () => {
    // Service role debe poder ver TODO
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("productos")
      .select("*");

    expect(Array.isArray(data)).toBe(true);
  });
});
```

---

## 5. Admin Role Validation (CRÍTICO - 4 horas)

### 5.1 Helper Function

```typescript
// src/lib/admin-check.ts
import { SessionClaims } from "@clerk/types";

export interface AdminContext {
  userId: string;
  storeId: string;
  isStoreAdmin: boolean;
  isSystemAdmin: boolean;
}

export function getAdminStatus(sessionClaims: SessionClaims | undefined): AdminContext | null {
  if (!sessionClaims?.publicMetadata) return null;

  const meta = sessionClaims.publicMetadata as any;

  return {
    userId: sessionClaims.sub || "",
    storeId: meta.storeId,
    isStoreAdmin: !!meta.storeAdmin,
    isSystemAdmin: !!meta.systemAdmin,
  };
}

export function requireSystemAdmin(admin: AdminContext | null) {
  if (!admin?.isSystemAdmin) {
    throw new Error("System admin required");
  }
}

export function requireStoreAdmin(admin: AdminContext | null, requiredStoreId?: string) {
  if (!admin?.isStoreAdmin) {
    throw new Error("Store admin required");
  }
  if (requiredStoreId && admin.storeId !== requiredStoreId) {
    throw new Error("Unauthorized store");
  }
}
```

### 5.2 Usar en Endpoint Admin

```typescript
// src/app/api/admin/stores/[id]/route.ts
import { auth } from "@clerk/nextjs/server";
import { getAdminStatus, requireSystemAdmin } from "@/lib/admin-check";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { sessionClaims } = await auth();

  // ✅ Validar rol en código (antes de acceder a BD)
  const admin = getAdminStatus(sessionClaims);
  try {
    requireSystemAdmin(admin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ... resto de la lógica
}
```

---

## Checklist de Implementación

### Audit Logging
- [ ] Schema SQL creado
- [ ] RLS policies en audit_logs
- [ ] `logAudit()` función implementada
- [ ] Llamadas en endpoints críticos (POST, PATCH, DELETE)
- [ ] Endpoint de lectura `/api/admin/audit-logs`
- [ ] Pruebas básicas

### Rate Limiting
- [ ] Middleware `rateLimit.ts` creado
- [ ] Configuraciones específicas por endpoint
- [ ] Aplicado en middleware global
- [ ] Tests de rate limit
- [ ] Documentación de límites

### CSP Fix
- [ ] Remover `'unsafe-inline'` de script-src
- [ ] Remover `'unsafe-eval'`
- [ ] Probar que Clerk siga funcionando
- [ ] Probar que estilos carguen correctamente

### RLS
- [ ] Verificar todas tablas con RLS enabled
- [ ] Policies en todas tablas críticas
- [ ] Tests de aislamiento multi-tenant
- [ ] Verificación de service role bypass

### Admin Checks
- [ ] `admin-check.ts` helpers implementados
- [ ] Validaciones en `/api/admin/*` endpoints
- [ ] Logs de acceso admin
- [ ] Documentación de roles

---

## Testing de Implementación

```bash
# 1. Verificar audit logs
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/admin/audit-logs

# 2. Verificar rate limiting
for i in {1..150}; do
  curl http://localhost:3000/api/health &
done
# Expected: ~100 success, ~50 status 429

# 3. Verificar CSP
curl -I http://localhost:3000
# Expected: Content-Security-Policy header sin unsafe-inline

# 4. Verificar RLS (con test user)
curl -H "Authorization: Bearer $USER_A_TOKEN" \
  http://localhost:3000/api/productos?store_id=store-b
# Expected: vacío o 403
```

---

**Tiempo Total Estimado**: ~32 horas  
**Equipo**: 2 developers, 1 QA  
**Plazo**: 1 semana
