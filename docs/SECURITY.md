# Informe de Seguridad OWASP Top 10
## PetShop - Aplicación Next.js
**Fecha de auditoría:** 2026-03-30
**Alcance:** `/src/app/api/`, `/src/lib/`, `next.config.ts`, `src/middleware.ts`
**Estado de dependencias:** 0 vulnerabilidades conocidas (`npm audit` limpio)

---

## Resumen Ejecutivo

La aplicación tiene una base de autenticación sólida (Clerk + JWT, service-role de Supabase correctamente aislado en rutas API, scope por store en la mayoría de queries). Sin embargo, se encontraron **2 vulnerabilidades críticas**, **5 altas** y **9 de severidad media/baja** que requieren atención antes del siguiente despliegue en producción.

---

## A01:2021 — Control de Acceso Roto

### CRÍTICO: `DELETE /api/vendedores` — Sin verificación de store_id
**Archivo:** `src/app/api/vendedores/route.ts`, línea ~73

```typescript
// VULNERABLE: borra por id sin verificar que pertenece al store del usuario
const { error } = await supabase.from("vendedores").delete().eq("id", id);
```

Cualquier usuario autenticado de cualquier store puede eliminar vendedores de otros stores conociendo su UUID. Todos los demás endpoints mutantes del codebase aplican correctamente el scope `.eq("store_id", store_id)`. Este fue el único omitido.

**Corrección:**
```typescript
const { error } = await supabase
  .from("vendedores")
  .delete()
  .eq("id", id)
  .eq("store_id", store_id); // añadir esta línea
```

---

### MEDIO: `GET /api/consumo-configs` — Sin verificación de propiedad del store
**Archivo:** `src/app/api/consumo-configs/route.ts`, líneas ~5-21

El handler GET acepta un `mascotaId` del query string y devuelve todas las configuraciones de consumo de esa mascota sin verificar que la mascota pertenezca al store del usuario autenticado. Los handlers DELETE y POST sí verifican propiedad; GET no.

**Corrección:** Verificar la cadena mascota → cliente → store antes de devolver datos.

---

### MEDIO: `POST /api/onboarding/complete` — Creación ilimitada de stores
**Archivo:** `src/app/api/onboarding/complete/route.ts`

Cualquier usuario Clerk autenticado puede crear stores ilimitados, obteniendo rol `storeAdmin` en cada uno. No se verifica si el usuario ya tiene un `storeId` en sus metadatos JWT ni en la tabla `clerk_users`.

**Corrección:** Verificar si el usuario ya posee un store antes de crear uno nuevo.

---

## A02:2021 — Fallos Criptográficos

### ALTO: Token de WhatsApp almacenado sin cifrar en base de datos
**Archivos:** `src/app/api/settings/route.ts`, `src/app/api/ventas/route.ts`, `src/app/api/whatsapp/send-alerts/route.ts`

El `whatsapp_access_token` (bearer token de la API Graph de Meta) se almacena en texto plano en la tabla `stores` y se recupera en múltiples rutas. La respuesta del settings GET lo enmascara correctamente (`"••••••••"`), pero el almacenamiento y transmisión interna son sin cifrar.

**Corrección:** Cifrar el token antes de almacenarlo (ej. con AES-GCM usando una clave maestra en variables de entorno), descifrarlo solo en memoria cuando se necesite.

---

### BAJO: Claves públicas de Supabase en el bundle del cliente
**Archivo:** `src/lib/supabase.ts`, líneas 3-4

`NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` son visibles en el JavaScript del cliente. Esto es el patrón estándar de Supabase y aceptable **solo si RLS está correctamente configurado**. Como todas las operaciones server-side usan la service-role key (que omite RLS), cualquier error de acceso en el código de aplicación no tiene respaldo de seguridad en la base de datos.

**Acción recomendada:** Auditar y activar RLS como capa defensiva adicional en las tablas críticas.

---

## A03:2021 — Inyección

### BAJO: Input de usuario interpolado directamente en filtros PostgREST `.or()`
**Archivos:**
- `src/app/api/clientes/route.ts`, línea ~40
- `src/app/api/inventario/route.ts`, línea ~22
- `src/app/api/productos/route.ts`, línea ~21
- `src/app/api/ventas/route.ts`, línea ~26
- `src/app/api/proveedores/route.ts`, línea ~17

```typescript
// VULNERABLE: interpolación directa en el string de filtro PostgREST
query = query.or(`nombre.ilike.%${search}%,rut.ilike.%${search}%`);
```

El parámetro `search` se interpola en el string de filtro sin sanitizar. Un valor malicioso con caracteres especiales de PostgREST (comas, paréntesis, tokens de operador) podría alterar la lógica del filtro.

**Corrección:**
```typescript
// Usar métodos parametrizados individuales
query = query.ilike("nombre", `%${search}%`);
// O sanitizar el string antes de interpolarlo
const sanitized = search.replace(/[,()]/g, "");
query = query.or(`nombre.ilike.%${sanitized}%,rut.ilike.%${sanitized}%`);
```

---

## A04:2021 — Diseño Inseguro

### ALTO: Mass Assignment en `PATCH /api/settings` — Body completo escrito en tabla `stores`
**Archivo:** `src/app/api/settings/route.ts`, líneas ~38-43

```typescript
const body = await req.json();
// ...
.update({ ...body, updated_at: new Date().toISOString() })
.eq("id", store_id)
```

Todo el body JSON se pasa directamente a `.update()`. Un admin de store puede enviar cualquier nombre de columna y sobreescribir campos controlados por el servidor: `id`, `created_at`, flags internos, etc.

**Corrección:**
```typescript
const { nombre, telefono, direccion, whatsapp_access_token, whatsapp_phone_id } = await req.json();
const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
if (nombre !== undefined) updateData.nombre = nombre;
if (telefono !== undefined) updateData.telefono = telefono;
// ... solo los campos permitidos
```

---

### ALTO: Mass Assignment + sin store_id en `PATCH /api/ordenes-compra/[id]` (ruta fallthrough)
**Archivo:** `src/app/api/ordenes-compra/[id]/route.ts`, líneas ~100-104

```typescript
// VULNERABLE: body completo sin filtrar y sin .eq("store_id", store_id)
const { data, error } = await supabase
  .from("ordenes_compra").update(body).eq("id", id).select().single();
```

La rama que no es `recibir` pasa el body completo sin filtrado de campos y sin verificación de propiedad del store. Un usuario puede modificar cualquier columna de cualquier orden de compra.

**Corrección:** Añadir `.eq("store_id", store_id)` y definir una lista explícita de campos actualizables.

---

### MEDIO: `POST /api/ventas` — Precios y cantidades controlados por el cliente
**Archivo:** `src/app/api/ventas/route.ts`, líneas ~70-119

El endpoint acepta un array `items` del cliente sin validación server-side de:
- Array no vacío (se aceptan ventas de $0)
- `precio_unitario` y `subtotal` — el servidor confía en los valores enviados por el cliente
- `cantidad` como entero positivo
- `descuentoPct` en rango [0, 100]
- `metodoPago` como valor de enum válido

El servidor recalcula el `total` desde los `subtotales` enviados por el cliente, pero no verifica que `subtotal == precio_unitario * cantidad`. Un cliente puede enviar `subtotal: 1` para cualquier producto.

**Corrección:** Recuperar `precio_unitario` de la base de datos para cada producto y calcular `subtotal` server-side.

---

### MEDIO: `PATCH /api/cuentas-pagar` — Campo `estado` sin validación de enum
**Archivo:** `src/app/api/cuentas-pagar/route.ts`, líneas ~33-43

El campo `estado` solo se verifica para ser truthy. Cualquier string arbitrario se escribe en la base de datos.

**Corrección:**
```typescript
const ESTADOS_VALIDOS = ["pendiente", "pagada", "vencida"] as const;
if (!ESTADOS_VALIDOS.includes(estado)) {
  return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
}
```

---

## A05:2021 — Configuración de Seguridad Incorrecta

### ALTO: Sin cabeceras HTTP de seguridad
**Archivo:** `next.config.ts`

La configuración de Next.js no define ninguna cabecera de seguridad. La aplicación carece de:

| Cabecera | Riesgo sin ella |
|----------|----------------|
| `Content-Security-Policy` | XSS e inyección de datos |
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade a HTTP |
| `Referrer-Policy` | Filtración de URLs internas |
| `Permissions-Policy` | Acceso a APIs del navegador |

**Corrección** — añadir a `next.config.ts`:
```typescript
const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // ajustar al endurecer
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://*.supabase.co https://api.clerk.com",
    ].join("; "),
  },
];

export default {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
```

---

### MEDIO: Webhook de WhatsApp no está en `publicRoutes` — bloqueado por Clerk
**Archivo:** `src/middleware.ts`, líneas ~4-8

`publicRoutes` incluye `/api/webhooks/(.*)` (para Clerk) pero no incluye `/api/whatsapp/webhook`. Meta no puede autenticarse con Clerk, por lo que tanto las solicitudes GET de verificación como los POST de entrega de mensajes son bloqueados. La integración de WhatsApp está actualmente no funcional.

**Corrección:** Añadir `"/api/whatsapp/webhook"` a `publicRoutes`.

---

## A06:2021 — Componentes Vulnerables y Desactualizados

**Estado: LIMPIO**

`npm audit` reporta 0 vulnerabilidades. Las dependencias son modernas:
- `next@16.2.1`, `react@19.2.4`, `@clerk/nextjs@^7.0.7`, `@supabase/supabase-js@^2.100.1`, `zod@^4.3.6`

**Acción recomendada:** Ejecutar `npm audit` periódicamente y mantener dependencias actualizadas.

---

## A07:2021 — Fallos de Identificación y Autenticación

### INFORMACIONAL: Autenticación correctamente implementada

Clerk gestiona toda la autenticación. El helper `getStoreId()` (`src/lib/auth.ts`) lee la asociación de store desde el JWT firmado criptográficamente (`sessionClaims.publicMetadata`). Las rutas admin verifican correctamente `meta?.systemAdmin` del JWT.

### MEDIO: Sin rate limiting en ningún endpoint

No existe limitación de frecuencia de peticiones. Endpoints críticos sin protección:
- `POST /api/onboarding/complete` (creación de stores)
- `POST /api/ventas` (transacciones financieras)
- `POST /api/whatsapp/send-alerts` (llamadas a API externa)

**Corrección:** Implementar rate limiting con middleware (ej. `@upstash/ratelimit` + Redis, o el rate limiting nativo de Vercel/Cloudflare si se despliega en esas plataformas).

---

## A08:2021 — Fallos de Integridad de Software y Datos

### CRÍTICO: Webhook POST de WhatsApp sin verificación de firma HMAC
**Archivo:** `src/app/api/whatsapp/webhook/route.ts`, líneas ~27-33

```typescript
export async function POST(req: NextRequest) {
  const body = await req.json();
  console.log("WhatsApp webhook:", JSON.stringify(body));  // sin verificación
  return NextResponse.json({ ok: true });
}
```

Cualquier tercero puede enviar payloads arbitrarios a este endpoint. Meta incluye el header `X-Hub-Signature-256` (HMAC-SHA256) en cada entrega; debe verificarse antes de procesar. El webhook de Clerk (`src/app/api/webhooks/clerk/route.ts`) implementa correctamente verificación de firma con Svix y puede usarse como referencia.

**Corrección:**
```typescript
import { createHmac } from "crypto";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const appSecret = process.env.WHATSAPP_APP_SECRET!;

  const expected = "sha256=" + createHmac("sha256", appSecret)
    .update(rawBody).digest("hex");

  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const body = JSON.parse(rawBody);
  // procesar...
}
```

---

## A09:2021 — Fallos en el Registro y Monitoreo de Seguridad

### ALTO: Datos personales (PII) de mensajes WhatsApp registrados en consola
**Archivo:** `src/app/api/whatsapp/webhook/route.ts`, línea ~31

```typescript
console.log("WhatsApp webhook:", JSON.stringify(body));
```

Los mensajes entrantes de WhatsApp contienen PII de clientes (nombres, números de teléfono, contenido de mensajes). Registrar el payload completo en logs es una exposición de datos relevante para GDPR/Ley 19.628.

**Corrección:** Eliminar el `console.log` o sustituirlo por un log estructurado que solo registre metadatos no sensibles (ej. tipo de evento, timestamp, ID de mensaje anonimizado).

---

### MEDIO: Sin registro de auditoría para operaciones financieras y de administración

No existe trazabilidad de:
- Cancelaciones de ventas (`PATCH /api/ventas/[id]` con `action: "anular"`)
- Cambios en configuración del store (`PATCH /api/settings`)
- Asignación de roles de usuario (`POST /api/admin/users`)

**Corrección:** Implementar una tabla `audit_log` con: `user_id`, `action`, `entity_type`, `entity_id`, `old_values`, `new_values`, `timestamp`, `ip_address`.

---

### BAJO: Mensajes de error de base de datos devueltos al cliente
**Patrón encontrado en:** Prácticamente todas las rutas API

```typescript
if (error) return NextResponse.json({ error: error.message }, { status: 500 });
```

Los mensajes de error crudos de Supabase/PostgreSQL (nombres de constraints, columnas, estructura de tablas) son devueltos directamente al cliente, exponiendo información del esquema.

**Corrección:**
```typescript
if (error) {
  console.error("DB error:", error); // log interno
  return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
}
```

---

## A10:2021 — Server-Side Request Forgery (SSRF)

### BAJO: Números de teléfono de clientes usados para contactar API externa sin validación
**Archivos:** `src/lib/whatsapp.ts`, líneas ~14-16; `src/app/api/ventas/route.ts`, líneas ~213-238

```typescript
const phone = to.replace(/\D/g, "");
const intl = phone.startsWith("56") ? phone : `56${phone}`;
```

El número de teléfono almacenado en la tabla `clientes` se usa directamente para enviar mensajes via WhatsApp sin validar que sea un número móvil chileno válido. Un número malicioso en la base de datos podría dirigir mensajes a destinatarios no deseados.

La URL de la API (`graph.facebook.com`) está hardcodeada, por lo que SSRF completo no aplica. El riesgo es de entrega de mensajes a destinatarios incorrectos.

**Corrección:** Validar que el número sea un móvil chileno válido antes de enviar (ej. `^569\d{8}$`).

---

## Tabla de Prioridades de Remediación

| Prioridad | Severidad | Descripción | Archivo |
|-----------|-----------|-------------|---------|
| 1 | CRÍTICO | DELETE vendedores sin scope de store | `api/vendedores/route.ts:~73` |
| 2 | CRÍTICO | Webhook WhatsApp POST sin verificación HMAC | `api/whatsapp/webhook/route.ts:~27` |
| 3 | ALTO | Mass assignment en settings PATCH | `api/settings/route.ts:~41` |
| 4 | ALTO | Mass assignment + sin store_id en ordenes-compra PATCH | `api/ordenes-compra/[id]/route.ts:~102` |
| 5 | ALTO | Sin cabeceras HTTP de seguridad | `next.config.ts` |
| 6 | ALTO | Token WhatsApp sin cifrar en BD | `api/settings/route.ts`, `api/ventas/route.ts` |
| 7 | ALTO | PII de clientes registrada en consola | `api/whatsapp/webhook/route.ts:~31` |
| 8 | MEDIO | Webhook WhatsApp no en publicRoutes (bloqueado por Clerk) | `src/middleware.ts` |
| 9 | MEDIO | Precios de ventas controlados por el cliente | `api/ventas/route.ts:~70-119` |
| 10 | MEDIO | consumo-configs GET sin verificación de store | `api/consumo-configs/route.ts:~14-20` |
| 11 | MEDIO | Creación ilimitada de stores en onboarding | `api/onboarding/complete/route.ts` |
| 12 | MEDIO | `estado` de cuentas-pagar sin validación de enum | `api/cuentas-pagar/route.ts:~34` |
| 13 | MEDIO | Sin rate limiting en ningún endpoint | Global |
| 14 | MEDIO | Sin registro de auditoría para operaciones financieras | Global |
| 15 | BAJO | Input interpolado en filtros PostgREST `.or()` | Múltiples rutas |
| 16 | BAJO | Mensajes de error de BD devueltos al cliente | Todas las rutas |
| 17 | BAJO | Números de teléfono sin validación antes de envío | `lib/whatsapp.ts` |

---

## Plan de Remediación

### Fase 1 — Antes del próximo despliegue (crítico)

1. `api/vendedores/route.ts` — añadir `.eq("store_id", store_id)` al DELETE
2. `api/ordenes-compra/[id]/route.ts` — reemplazar `update(body)` con campos permitidos explícitos y añadir `.eq("store_id", store_id)`
3. `api/settings/route.ts` — reemplazar `{ ...body }` con allowlist de campos actualizables
4. `api/whatsapp/webhook/route.ts` — implementar verificación HMAC-SHA256 y eliminar el `console.log` con PII
5. `src/middleware.ts` — añadir `/api/whatsapp/webhook` a `publicRoutes`

### Fase 2 — Próximo sprint

6. `next.config.ts` — añadir cabeceras de seguridad HTTP
7. `api/ventas/route.ts` — validar `items` server-side, calcular precios desde BD
8. `api/consumo-configs/route.ts` — verificar propiedad de store en GET
9. `api/onboarding/complete/route.ts` — prevenir creación múltiple de stores por usuario
10. Reemplazar mensajes de error de BD crudos con mensajes genéricos en todos los endpoints

### Fase 3 — Mejoras continuas

11. Implementar rate limiting con `@upstash/ratelimit` o similar
12. Implementar tabla de auditoría para operaciones financieras y de administración
13. Cifrar tokens de WhatsApp antes de almacenar en BD
14. Activar RLS en Supabase como capa defensiva secundaria
15. Validar formato de números de teléfono antes de envíos via WhatsApp
16. Reemplazar interpolación en `.or()` de PostgREST con métodos parametrizados

---

*Generado mediante análisis OWASP Top 10:2021 — auditoría estática de código fuente*
