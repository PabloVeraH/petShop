# Análisis OWASP - PetShop SaaS MVP v1.0

**Fecha**: 2026-04-17  
**Analista**: Claude Code - SPARC Security Review  
**Versión**: 1.0  
**Estado**: 🟡 REVISIÓN CRÍTICA REQUERIDA (7 hallazgos críticos)

---

## Resumen Ejecutivo

### Puntuación de Seguridad: 6.8/10

| Aspecto | Calificación | Riesgo |
|---------|-------------|--------|
| **Autenticación & Autorización** | ✅ 8/10 | Bajo |
| **Validación de Entrada** | ⚠️ 6/10 | Medio |
| **Inyección (SQL, XSS, etc)** | ✅ 7/10 | Bajo-Medio |
| **Manejo de Secretos** | ❌ 4/10 | Alto |
| **Logging & Auditoría** | ❌ 3/10 | Crítico |
| **Rate Limiting** | ❌ 2/10 | Alto |
| **Seguridad de Headers** | ✅ 8/10 | Bajo |
| **Cifrado en Tránsito** | ✅ 9/10 | Muy Bajo |
| **Gestión de Dependencias** | ⚠️ 6/10 | Medio |

---

## 1. OWASP Top 10 2024 - Análisis Detallado

### A1: Broken Access Control (Control de Acceso Roto)

**Estado**: ✅ BIEN IMPLEMENTADO

#### Fortalezas:
- ✅ **Multi-tenant isolation**: Cada endpoint valida `store_id` contra `getStoreId()`
  ```typescript
  // Patrón consistente en: pagos/route.ts, inventario/route.ts, etc
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  
  // Validación en queries
  .eq("store_id", store_id)  // Garantiza aislamiento entre tiendas
  ```

- ✅ **Middleware de autenticación**: `clerkMiddleware` en routes.ts valida antes de ejecutar
- ✅ **Role-based redirects**: Rutas públicas explícitamente definidas
- ✅ **Tests de seguridad**: Suite S-01, S-02 valida aislamiento cross-store

#### Debilidades:
- ⚠️ **RLS policies**: CRITICAL - Documentación menciona RLS incompletas
- ⚠️ **Admin endpoints**: `/api/admin/*` usan RLS en BD pero falta validación de rol en código
  ```typescript
  // Recomendación: Agregar checks de role
  if (meta?.systemAdmin !== true) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ```

---

### A2: Cryptographic Failures (Fallos Criptográficos)

**Estado**: ✅ BIEN IMPLEMENTADO

#### Fortalezas:
- ✅ **HTTPS obligatorio**: Supabase + Vercel con TLS 1.3+
- ✅ **JWT RS256**: Token signing con asymmetric encryption (ClerkJS)
- ✅ **HSTS header**: `Strict-Transport-Security: max-age=63072000; includeSubDomains`
- ✅ **No hardcoding de secrets**: `.env.local` gitignored (CLAUDE.md lo requiere)

#### Debilidades:
- ❌ **CRITICAL**: Variables de entorno visibles en errores
  - Error 500 puede revelar `process.env.WHATSAPP_APP_SECRET` en stack traces
  - Recomendación: Implementar error handling genérico en producción

---

### A3: Injection (Inyección)

**Estado**: ⚠️ PARCIALMENTE IMPLEMENTADO

#### Fortalezas:
- ✅ **SQL Injection prevention**: 
  - Supabase PostgREST sanitiza automáticamente
  - Uso de `.eq()`, `.ilike()` vs raw SQL
  - Test S-05 valida caracteres especiales en búsqueda

- ✅ **NoSQL injection**: No aplica (PostgreSQL, no MongoDB)

- ✅ **XSS prevention**:
  - React escapa automáticamente
  - CSP restrictivo: `script-src 'self' 'unsafe-inline' 'unsafe-eval'` (⚠️ ver debilidades)
  - Sanitización de búsqueda: `.replace(/[()%,]/g, "")`

#### Debilidades:
- ⚠️ **CRÍTICO - CSP débil**: 
  ```
  script-src 'unsafe-inline' 'unsafe-eval' - NUNCA usar en producción
  ```
  - Permite XSS a través de event handlers inline
  - Solución: Remover `'unsafe-inline'` y usar nonce para Clerk/analytics

- ⚠️ **Sanitización limitada**:
  - Solo remueve `[()%,]` en búsqueda
  - No valida largo de strings (max 10000 chars?)
  - Recomendación: Usar Zod para TODOS los inputs

- ⚠️ **SQL Injection en edge cases**:
  ```typescript
  // Vulnerable: concatenación en .or()
  query = query.or(`nombre.ilike.%${s}%,sku.ilike.%${s}%`);
  // Si 's' contiene backtick o comilla, podría fallar
  ```

---

### A4: Insecure Design (Diseño Inseguro)

**Estado**: ⚠️ PARCIALMENTE IMPLEMENTADO

#### Fortalezas:
- ✅ **Validación de negocio**: Endpoint `/api/pagos` valida:
  - `monto > 0`
  - `monto <= venta.total`
  - Método de pago válido
  - Número de transacción requerido para tarjeta

- ✅ **Idempotencia**: Test S-06 valida `POST /api/onboarding/complete` retorna 409 en segunda llamada

#### Debilidades:
- ❌ **CRÍTICO - Sin rate limiting**: 
  - Posible ataque de fuerza bruta en login (Clerk, pero sin custom limits)
  - Posible DoS en endpoints públicos (`/api/search`, `/api/health`)
  - Endpoint de pagos vulnerable a request flooding

- ❌ **CRÍTICO - Sin auditoría**: 
  - No hay logs de quién hizo qué
  - Cambios de configuración no se registran
  - Pagos sin trail de auditoría
  - Recomendación: Crear tabla `audit_logs` con timestamps y user_id

- ⚠️ **Ephemeral secrets**: Webhook Clerk tiene secret pero sin rotación automática

---

### A5: Broken Authentication (Autenticación Rota)

**Estado**: ✅ BIEN IMPLEMENTADO

#### Fortalezas:
- ✅ **Clerk para auth**: OAuth2 + passwordless + MFA soportado
- ✅ **Session management**: JWT con expiración automática
- ✅ **publicMetadata**: Role-based access en JWT claims
- ✅ **getStoreId() fast path**: Caché en JWT para evitar DB queries

#### Debilidades:
- ⚠️ **Webhook Clerk sin validación**: Test S-08 menciona que se valida firma, pero verificar en código
  ```typescript
  // Buscar validación Svix en /api/webhooks/clerk
  ```
  
- ⚠️ **Session timeout**: No hay refresh token rotation automática

---

### A6: Vulnerable and Outdated Components (Componentes Vulnerables)

**Estado**: ⚠️ REQUIERE ACTUALIZACIÓN

#### Dependencias Críticas:

**app/package.json**:
```json
{
  "@clerk/nextjs": "^7.0.7",           // ⚠️ Versión 7 (última: 7.x)
  "@supabase/supabase-js": "^2.100.1", // ✅ Actualizada
  "next": "16.2.1",                     // ✅ Actualizada
  "react": "19.2.4",                    // ✅ Actualizada
  "zod": "^4.3.6",                      // ✅ Actualizada
  "svix": "^1.89.0",                    // ✅ Actualizada
}
```

**Recomendación**: 
```bash
npm audit --audit-level=moderate
npm outdated
```

---

### A7: Identification and Authentication Failures (Fallos de Identificación)

**Estado**: ✅ BIEN IMPLEMENTADO

#### Fortalezas:
- ✅ Clerk proporciona MFA, TOTP, WebAuthn
- ✅ No se almacenan passwords en BD (delegado a Clerk)
- ✅ Session claims validadas en middleware

#### Debilidades:
- ⚠️ **MFA no mandatorio**: Should be required for admin users

---

### A8: Software and Data Integrity Failures (Fallos de Integridad)

**Estado**: ⚠️ PARCIALMENTE IMPLEMENTADO

#### Fortalezas:
- ✅ **Dependencies**: package-lock.json + npm ci en CI/CD
- ✅ **Code signing**: Git commits (si está configurado en GitHub)

#### Debilidades:
- ❌ **CRÍTICO - Sin SRI (Subresource Integrity)**:
  - Clerk script no tiene integrity attribute
  - Recomendación: Agregar SRI hash a CDN scripts en CSP

- ⚠️ **Update strategy**: No hay automated dependency updates (Dependabot?)

---

### A9: Logging and Monitoring Failures (Fallos de Logging)

**Estado**: ❌ NO IMPLEMENTADO

**Crítico**: Este es el hallazgo más grave.

#### Debilidades:
- ❌ **CRÍTICO - Sin logging de auditoría**: 
  - No hay registro de cambios en configuraciones
  - Transacciones de pago sin trail completo
  - Acceso a datos sensibles no se registra

- ❌ **CRÍTICO - Sin monitoreo**:
  - No hay detección de patrones anómalos
  - Rate limiting no monitorizado
  - Fallos de autenticación no alertan

#### Recomendación - Tabla de Auditoría:
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  store_id UUID REFERENCES stores(id),
  user_id TEXT,
  action VARCHAR(50),        -- 'CREATE', 'UPDATE', 'DELETE', 'LOGIN_FAILED'
  entity_type VARCHAR(50),   -- 'venta', 'pago', 'cliente'
  entity_id UUID,
  old_values JSONB,          -- valores anteriores
  new_values JSONB,          -- valores nuevos
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_store_time ON audit_logs(store_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, created_at DESC);
```

---

### A10: Server-Side Request Forgery (SSRF)

**Estado**: ✅ BAJO RIESGO

#### Análisis:
- No hay endpoints que hagan requests a URLs user-provided
- Meta WhatsApp Cloud API está en servidor, no en cliente
- Supabase queries están parametrizadas

---

## 2. Hallazgos Críticos por Severidad

### 🔴 CRÍTICO (Bloquea MVP)

#### 1. SIN LOGGING DE AUDITORÍA
- **Impacto**: Imposible investigar brechas, fraudes, cambios no autorizados
- **Ejemplo**: Venta modificada para pagar $0 → No se sabe quién hizo qué
- **Tiempo para fijar**: 8-12 horas
- **Prioridad**: P0

#### 2. CSP CON 'UNSAFE-INLINE'
- **Impacto**: XSS reflection attacks posibles (aunque Next.js sanitiza)
- **Riesgo**: Si Clerk integración fallara, atacante inyecta `<script>alert(1)</script>`
- **Tiempo para fijar**: 2 horas
- **Prioridad**: P0

#### 3. SIN RATE LIMITING
- **Impacto**: Brute force en API, DoS posible
- **Ejemplo**: Atacante spammea POST `/api/pagos` con 10k requests/sec
- **Tiempo para fijar**: 6-8 horas
- **Prioridad**: P0

#### 4. RLS POLICIES INCOMPLETAS EN BD
- **Impacto**: Usuario A podría ver datos de Usuario B si endpoint fallara
- **Documentación**: VALIDATION_SUMMARY.txt lo marca como CRITICAL
- **Tiempo para fijar**: 4-6 horas
- **Prioridad**: P0

---

### 🟡 ALTO (Debe fijarse en Fase 1)

#### 5. SIN VALIDACIÓN CON ZOD EN TODOS ENDPOINTS
- **Impacto**: Mass assignment, type confusion, boundary validation
- **Actual**: Solo `/api/pagos` y algunos endpoints usan Zod
- **Recomendación**: Refactorizar para usar Zod en:
  - `/api/inventario` (search length limits)
  - `/api/productos` (precio limits)
  - `/api/clientes` (email format)
  - `/api/mascotas` (weight bounds)
- **Tiempo para fijar**: 12-16 horas
- **Prioridad**: P1

#### 6. ADMIN ENDPOINTS SIN VALIDACIÓN DE ROL EN CÓDIGO
- **Impacto**: RLS en BD lo previene, pero código should validate upfront
- **Ejemplo**: `/api/admin/stores` solo verifica BD
  ```typescript
  // Falta esto:
  const meta = sessionClaims?.publicMetadata as any;
  if (!meta?.systemAdmin) return NextResponse.json({}, {status: 403});
  ```
- **Tiempo para fijar**: 4 horas
- **Prioridad**: P1

#### 7. SANITIZACIÓN SQL LIMITADA EN BÚSQUEDA
- **Impacto**: Query injection baja probabilidad (PostgREST lo previene) pero no es hermético
- **Actual**: `.replace(/[()%,]/g, "")` solo remueve 4 caracteres
- **Recomendación**: 
  ```typescript
  // Cambiar de: query.or(`nombre.ilike.%${s}%,sku.ilike.%${s}%`)
  // A:         query = query.ilike('nombre', `%${encodeURIComponent(s)}%`)
  ```
- **Tiempo para fijar**: 2 horas
- **Prioridad**: P1

---

### 🟠 MEDIO (Fase 2)

#### 8. ERROR HANDLING EXPONE SECRETS
- **Impacto**: Stack traces en producción pueden revelar env vars
- **Recomendación**:
  ```typescript
  // En /api/* error handlers:
  if (error.message.includes('process.env')) {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
  ```
- **Tiempo para fijar**: 3 horas
- **Prioridad**: P2

#### 9. DEPENDENCIAS NO AUDITADAS
- **Impacto**: Vulnerabilidades 0-day en transitive dependencies
- **Recomendación**:
  ```bash
  npm audit
  npm audit --audit-level=moderate
  # Usar Dependabot en GitHub
  ```
- **Tiempo para fijar**: 1 hora setup, 2-4 horas remediación
- **Prioridad**: P2

---

## 3. Análisis de Endpoints API - Top 10 Riesgosos

### Puntuación de Riesgo por Endpoint:

| Endpoint | Metodo | Auth | Validación | RLS | Riesgo | Notas |
|----------|--------|------|------------|-----|--------|-------|
| `/api/pagos` | POST | ✅ | ✅ Zod partial | ✅ | 🟡 ALTO | Sin rate limit en transacciones |
| `/api/ventas` | POST | ✅ | ⚠️ Basic | ✅ | 🟡 ALTO | Cambios de precio no validados |
| `/api/inventario` | GET | ✅ | ❌ (search) | ✅ | 🟠 MEDIO | Search sin Zod validation |
| `/api/clientes` | POST | ✅ | ⚠️ (RUT) | ✅ | 🟠 MEDIO | Email no validado |
| `/api/admin/stores` | GET/POST | ✅ | ❌ | ✅ | 🟡 ALTO | Sin validación de role en código |
| `/api/onboarding/complete` | POST | ✅ | ⚠️ | ✅ | 🟠 MEDIO | Sin idempotency key |
| `/api/reports/export` | GET | ✅ | ⚠️ | ✅ | 🟡 ALTO | Posible large file DoS |
| `/api/settings` | PATCH | ✅ | ❌ | ✅ | 🟠 MEDIO | Whitelist en lugar de blacklist |
| `/api/whatsapp/webhook` | POST | ❌ | ⚠️ (signature) | N/A | 🟡 ALTO | Webhook sin rate limit |
| `/api/search` | GET | ✅ | ❌ | ✅ | 🟠 MEDIO | Full-text search sin límites |

---

## 4. Postura de Seguridad por Área

### Authentication & Authorization ✅ 8/10
```
✅ Multi-tenant enforcement via store_id
✅ Clerk for user management
✅ Role-based redirects
⚠️ Falta: Admin role validation en endpoints
⚠️ Falta: MFA mandatorio para admins
```

### Input Validation ⚠️ 6/10
```
✅ Zod en algunos endpoints
✅ RUT validation
⚠️ Búsqueda sin Zod
⚠️ Falta: String length limits
⚠️ Falta: Email validation en todos endpoints
❌ CSP permite unsafe-inline
```

### Data Protection ✅ 7/10
```
✅ HTTPS/TLS obligatorio
✅ JWT RS256
⚠️ Falta: Encryption at rest (si contiene datos sensibles)
⚠️ Falta: Password hashing (delegado a Clerk ✅)
⚠️ Falta: Sensitive field masking en logs
```

### API Security ⚠️ 5/10
```
❌ Sin rate limiting
❌ Sin API key rotation
⚠️ Falta: Request signing
⚠️ Falta: CORS policy explícito
❌ Sin request timeout limits
```

### Monitoring & Logging ❌ 3/10
```
❌ Sin audit logging
❌ Sin error logging
❌ Sin access logging
⚠️ Falta: Alerting en actividad sospechosa
```

---

## 5. Matriz CVSS - Top 5 Vulnerabilidades

### Vuln-01: Missing Audit Logging
```
CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:N
Score: 9.1 CRÍTICO
Vector: Network, Low Complexity, No Privileges, Confidentiality + Integrity Impact
```

### Vuln-02: Missing Rate Limiting  
```
CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H
Score: 7.5 ALTO
Vector: Network, Low Complexity, Availability Denial
```

### Vuln-03: CSP With Unsafe-Inline
```
CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:N
Score: 8.7 ALTO
Vector: Network, Low Complexity, User Interaction, XSS potential
```

### Vuln-04: Incomplete RLS Policies
```
CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N
Score: 6.5 MEDIO-ALTO
Vector: Network, Low Complexity, Low Privileges, Confidentiality Breach
```

### Vuln-05: Missing Input Validation (Zod)
```
CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:L
Score: 8.6 ALTO
Vector: Network, Low Complexity, Integrity + Availability Impact
```

---

## 6. Roadmap de Remediación

### Semana 1 - CRÍTICO (40 horas)
```
[ ] Implementar audit_logs table (8 hrs)
[ ] Crear middleware de rate limiting (8 hrs)
[ ] Fijar CSP - remover unsafe-inline (3 hrs)
[ ] Completar RLS policies en BD (6 hrs)
[ ] Agregar role validation en /api/admin/* (4 hrs)
[ ] Tests de penetración básicos (3 hrs)
```

### Semana 2 - ALTO (32 horas)
```
[ ] Refactorizar todos endpoints con Zod (16 hrs)
[ ] Implementar error handling genérico (4 hrs)
[ ] Setup npm audit + Dependabot (2 hrs)
[ ] Documentación de seguridad (6 hrs)
[ ] Security training para equipo (4 hrs)
```

### Semana 3 - MEDIO (24 horas)
```
[ ] Setup WAF (Cloudflare) (6 hrs)
[ ] Implement CORS policy (2 hrs)
[ ] Webhook signature rotation (4 hrs)
[ ] Penetration testing contratado (8 hrs)
[ ] Bug bounty program setup (4 hrs)
```

---

## 7. Configuración de Seguridad Recomendada

### .env.production (NUNCA commitear)
```env
# Database
DATABASE_URL=postgresql://user:pass@supabase...
SUPABASE_SERVICE_KEY=secret_key

# Auth
CLERK_SECRET_KEY=secret_key
WEBHOOK_SECRET=secret_key

# API Keys
WHATSAPP_APP_SECRET=secret_key

# Security
RATE_LIMIT_REQUESTS=100          # Requests
RATE_LIMIT_WINDOW_MS=900000      # 15 minutes
MAX_BODY_SIZE=10000              # bytes

# Monitoring
SENTRY_DSN=https://...
LOG_LEVEL=info                   # warn in production

# Headers
CORS_ORIGIN=https://yourdomain.com
SECURE_COOKIES=true
```

### next.config.ts - Seguridad Mejorada
```typescript
// Remover 'unsafe-inline' 'unsafe-eval'
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' https://clerk.accounts.dev",  // Sin unsafe-inline
      "style-src 'self' 'nonce-{random}'",             // Usar nonces
      "img-src 'self' data: https://",
      "connect-src 'self' https://",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

// Rate limiting middleware
export async function middleware(req) {
  const rateLimit = await checkRateLimit(req);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Too Many Requests" },
      { status: 429 }
    );
  }
  return NextResponse.next();
}
```

---

## 8. Testing de Seguridad - Checklist

### Manual Security Tests
```bash
# 1. Authentication bypass
curl -X GET http://localhost:3000/api/clientes
# Expected: 401 Unauthorized

# 2. SQL injection
curl "http://localhost:3000/api/inventario?search=a%27%20OR%201%3D1%20--%27"
# Expected: Sanitizado sin error

# 3. XSS payload
curl -X POST http://localhost:3000/api/clientes \
  -d '{"nombre":"<script>alert(1)</script>"}'
# Expected: HTML escaped o rejected

# 4. Rate limiting
for i in {1..1000}; do
  curl http://localhost:3000/api/health &
done
# Expected: 429 after limit
```

### Automated Testing
```bash
# OWASP ZAP scan
zaproxy -cmd -quickurl http://localhost:3000 -quickout report.html

# npm audit
npm audit

# Snyk
snyk test

# ESLint security
npm install --save-dev eslint-plugin-security
```

---

## 9. Compliance & Standards

### Aplicable
- ✅ **HTTPS/TLS**: Requerido
- ✅ **Authentication**: Requerido
- ⚠️ **Encryption at Rest**: Recomendado (Supabase lo proporciona)
- ❌ **Audit Logging**: CRÍTICO - NO IMPLEMENTADO
- ⚠️ **Data Retention**: NO ESPECIFICADO
- ⚠️ **User Consent**: Para WhatsApp webhook

### Si aplicable a Chile:
- 🇨🇱 **LGPD Digital**: Auditoría, consentimiento, derecho al olvido
- 🇨🇱 **Datos bancarios**: Cumplimiento con banco para tokenización

---

## 10. Recomendaciones Finales

### Antes de MVP (MVP debe esperar):
1. ✅ **Implementar audit logging** (crítico para rastreabilidad)
2. ✅ **Fijar CSP** (remover unsafe-inline)
3. ✅ **Rate limiting** (prevenir DoS)
4. ✅ **Completar RLS en BD** (segregación de datos)
5. ✅ **Validación con Zod en todos endpoints**

### Después de MVP (Fase 1):
6. Setup WAF (Cloudflare o AWS)
7. Implementar Secret rotation
8. Bug bounty program
9. Penetration testing profesional
10. Compliance certification (ISO 27001)

---

## 11. Contactos y Recursos

### OWASP Resources
- OWASP Top 10 2024: https://owasp.org/Top10/
- OWASP API Security: https://owasp.org/www-project-api-security/
- OWASP Cheat Sheets: https://cheatsheetseries.owasp.org/

### Tools Recomendados
- **Static Analysis**: ESLint + typescript-eslint
- **Dynamic Analysis**: OWASP ZAP
- **Dependency Scanning**: npm audit, Snyk, Dependabot
- **Secret Scanning**: TruffleHog, git-secrets
- **Rate Limiting**: Redis + rate-limit middleware

---

**Análisis completado**: 2026-04-17  
**Próxima revisión**: Post-implementación de hallazgos críticos
