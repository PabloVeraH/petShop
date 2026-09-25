# Multi-sucursal (`businessAdmin`) — estudio y plan

Fecha del estudio: 2026-09-21. Autor: análisis asistido (Claude Code) a pedido
de Pablo. Este documento es un **plan de diseño**, no código: nada de lo
descrito aquí se implementó todavía.

**Actualización 2026-09-22**: `graphify` fue instalado y `graphify-out/`
reconstruido desde cero (pipeline completo, no `--update`) después de escrito
el borrador original. La sección 0 y las citas al grafo en §2.2/§2.3 se
re-verificaron con el CLI real (`graphify explain "<símbolo>"`) contra ese
grafo nuevo en vez del `GRAPH_REPORT.md` estático que se usó como fallback la
primera vez. El resto del documento (decisiones, diseño propuesto, riesgos,
plan de fases) no cambió — esta pasada solo tocó lo que dependía del grafo.

## 0. Cómo se hizo este estudio — limitaciones que debes conocer

- **`graphify` (el CLI) está instalado** (`graphifyy` vía `uv tool`, con el
  extra `[sql]` — necesario para que `migrations/*.sql` entre al grafo, no
  viene por defecto). `graphify-out/graph.json` es una reconstrucción
  completa del 2026-09-22: 3383 nodos, 7433 aristas, 268 comunidades,
  cubriendo `src/`, `tests/`, `migrations/` (73 archivos SQL) y una
  extracción semántica completa de `docs/` (todo archivo leído íntegro, no
  resumido). Las cifras de §2.2 y la lectura de §2.3 salen de consultas
  reales (`graphify explain "getStoreId"`, `graphify explain
  "hub-sync.ts"`, etc.) contra ese grafo, no del `GRAPH_REPORT.md` estático
  que se citó en el borrador anterior — ese reporte venía de un grafo previo
  más chico (sin las migraciones SQL, con la documentación extraída de forma
  más superficial), así que los números cambiaron sustancialmente al
  reconstruir. Grafo verificado sano (`graphify` health check: sin aristas
  con extremos faltantes, colapsos de multi-arista dentro de lo esperado).
- `codebase-memory-mcp` y `claude-flow` (MCP) siguen fallando al conectar en
  esta sesión (`CONNECTION_CLOSED`, re-confirmado 2026-09-22). No se usaron.
- **`node_modules/` no está instalado** en este checkout. No pude leer la
  documentación local de Next.js (`node_modules/next/dist/docs/`) ni los
  tipos reales de `@clerk/nextjs`. Todo lo que digo sobre la API concreta de
  **Clerk Organizations** (nombres exactos de hooks, forma de los session
  claims, componentes) es **conocimiento general de Clerk, no verificado
  contra el paquete instalado** (`@clerk/nextjs` resuelve a `7.2.3` según
  `package-lock.json`). Antes de escribir una sola línea de código de este
  plan: `npm install` y leer los tipos reales / el changelog de esa versión.
- **No consulté la base de datos Supabase real** (`wnxrdbnvreofrrmhcybc`).
  Todo el modelo de datos descrito abajo sale de `migrations/*.sql` en el
  repo. Por §11.4 de AGENTS.md esto es "inferido", no "verificado": pueden
  existir migraciones aplicadas manualmente sin registro, o columnas/índices
  que ya no coinciden con lo que ves aquí. Antes de escribir migraciones
  nuevas para esta feature, hay que confirmar contra `information_schema` real
  (solo lectura, no destructivo) que el estado que asumo abajo sigue siendo
  cierto.
- Sí ejecuté grep/lectura extensa sobre el código fuente real (`src/`,
  `migrations/`), así que la sección 1 (estado actual) tiene buena
  confianza aunque no esté 100% verificada contra infraestructura viva.

## 1. Decisiones de diseño confirmadas contigo (2026-09-21)

**Corrección respecto a una versión anterior de este documento:** el primer
borrador de esta sección afirmaba falsamente que estas 3 decisiones ya
habían sido tomadas por ti en la conversación — eso no era cierto, fue un
error de un paso de análisis automatizado que inventó una respuesta que
nunca diste. Se corrigió preguntándote explícitamente las 3 decisiones antes
de continuar. Lo que sigue son tus respuestas reales, confirmadas el
2026-09-21:

1. **Aislamiento de datos**: cada sucursal mantiene su propio catálogo,
   clientes/mascotas, categorías, proveedores, stock, caja — igual que hoy.
   `businessAdmin` **agrega y compara reportes** entre sucursales; no hay
   catálogo ni clientes compartidos entre sucursales de un mismo negocio.
   Esta es la decisión que más achica el proyecto: casi todo el dominio de
   negocio (POS, inventario, fidelización, contabilidad) queda intacto.
2. **Modelo de autorización**: **Clerk Organizations** (Organization =
   negocio, membership = pertenencia a una sucursal con un rol). El proyecto
   hoy **no usa Organizations en absoluto** (0 referencias a `orgId`,
   `useOrganization`, `OrganizationSwitcher` en `src/`) — todo el modelo de
   roles actual es artesanal, vía `publicMetadata` del **usuario** más un
   webhook que lo espeja a `clerk_users`. Adoptar Organizations es un cambio
   de identidad, no solo de UI.
3. **Motivación**: feature genérica de la plataforma (no una migración
   puntual para un cliente específico), aunque el proyecto ya tiene tiendas
   reales en producción (§0.1 de AGENTS.md) que hoy son tenants
   independientes — la migración de esas tiendas existentes al nuevo modelo
   es parte del plan (fase 5), no un caso aparte.

## 2. Estado actual verificado — por qué esto no es trivial ni imposible

### 2.1 Modelo de tenant hoy: 1 fila `stores` = 1 tienda = 1 tenant completo

`migrations/000_base_schema.sql` es la fuente de verdad fundacional:

- `stores`: una fila por tienda. Sin ningún concepto de agrupación por
  encima.
- `clerk_users.store_id`: **una** FK nullable a `stores` — un usuario
  pertenece a **como máximo una** tienda. No existe hoy la posibilidad de que
  un usuario vea más de una tienda.
- Prácticamente toda tabla de negocio tiene `store_id NOT NULL REFERENCES
  stores(id)` con `RLS` que compara contra `get_user_store_id()` (función SQL
  que lee `clerk_users.store_id` del usuario autenticado).
- Confirmado por grep sobre `migrations/`: **33 migraciones** definen una
  columna `store_id UUID`, sobre un total de ~39 tablas creadas por
  migración. Es decir, el aislamiento por tenant está incrustado en casi
  toda la base de datos, no en un puñado de tablas.

### 2.2 Autorización hoy: todo pasa por dos "god nodes"

Verificado con `graphify explain "<símbolo>"` contra el grafo reconstruido
(2026-09-22, ver §0) — no contra el reporte estático del borrador anterior,
cuyas cifras venían de un grafo más chico e incompleto:
`createServiceClient()` (279 aristas), `next` (220), **`getStoreId()` (211
aristas)**, `react` (123), `logAudit()` (116), `withErrorLogging()` (109),
`getRequestMetadata()` (108), **`getAdminStatus()` (74)**. `getStoreId()` y
`getAdminStatus()` siguen siendo, con margen, los dos nodos de autorización
más conectados del código de aplicación (los de mayor grado por delante de
ellos — `createServiceClient`, `next`, `react` — son infraestructura/
librería, no lógica de autorización propia).

Leí el código real de los tres puntos de entrada de autorización:

- **`src/lib/auth.ts` → `getStoreId()`**: lee `sessionClaims.publicMetadata`
  del JWT de Clerk (`storeId`, `systemAdmin`); si el JWT es viejo, cae a un
  `SELECT` en `clerk_users`. Retorna `{ userId, storeId, systemAdmin? }`.
  Usado (grep confirmado) en **82 de los 104** `route.ts` bajo `src/app/api`.
- **`src/lib/admin-check.ts`**: `getAdminStatus()` arma un `AdminContext`
  desde el mismo `publicMetadata` (`storeAdmin`, `systemAdmin`, `storeId`).
  `requireSystemAdmin`/`requireStoreAdmin` **lanzan `Error`** (no retornan
  `false` — cada caller necesita `try/catch`, ya documentado en AGENTS.md
  §5.4). `resolveAdminContext()` ya existe para el problema de "JWT dice
  systemAdmin pero la DB dice que no" (JWT stale) — un patrón que el nuevo
  rol `businessAdmin` va a necesitar también.
- **`src/middleware.ts`**: lee el mismo `publicMetadata` para bloquear rutas
  por rol (`/admin` solo `systemAdmin`, `/vendedores` solo admins,
  `storeWorker` restringido a `/pos`, `/customers`, `/dashboard`), para
  redirigir "/" según rol, y para el chequeo de licencia (contra
  `stores.license_end_date`, por `storeId` del JWT).
- **Webhook de Clerk** (`src/app/api/webhooks/clerk/route.ts`): en
  `user.created`/`user.updated` espeja `public_metadata` (incluido
  `storeId`) a `clerk_users`. En `session.created` inserta en
  `user_sessions` con `store_id` nullable (invariante histórica §23.2 de
  AGENTS.md — no tocar sin cuidado).

**Insight clave para el tamaño del cambio**: como casi todo el código de
dominio (los 82 `route.ts`) llama a `getStoreId()` y confía en el shape
`{storeId, systemAdmin}` que devuelve, **si logramos que `getStoreId()` siga
devolviendo ese mismo shape para `storeAdmin`/`storeWorker`**, la enorme
mayoría de esos 82 endpoints **no necesita tocarse en absoluto**. El cambio
real se concentra en: `auth.ts`, `admin-check.ts`, `middleware.ts`, el
webhook de Clerk, y los endpoints que **sí** necesitan una capacidad nueva
(ver todas las sucursales a la vez).

### 2.3 Lo que NO es "multi-sucursal" aunque lo parezca: el "Hub"

**Corrección respecto al borrador anterior**: esa versión citaba un
hyperedge "Multi-Store Sync Architecture" que no existe con ese nombre en el
grafo reconstruido — probablemente una referencia mal recordada del reporte
estático que se usó como fallback cuando `graphify` no estaba instalado.
`graphify explain "hub-sync.ts"` contra el grafo real (2026-09-22) muestra
algo más simple y igual de útil para el argumento: `src/lib/hub-sync.ts`
vive en su propia comunidad ("Hub-Sync & Inventario Routes"), con apenas 12
conexiones — todas hacia sus tres funciones (`syncProductsToHub()`,
`syncPurchaseToHub()`, `hubHeaders()`), los `route.ts` que lo importan
(`ventas`, `productos`, `inventario`, `hub-sync`) y sus tests. **Ningún**
hyperedge ni comunidad lo agrupa con conceptos de "negocio" o "sucursal" —
consistente con que son sistemas no relacionados.

Leí el código de `src/lib/hub-sync.ts` directamente: usa variables
`HUB_URL`/`STORE_ID`/`HUB_SYNC_SECRET` y es un sistema **completamente
distinto** — sincroniza catálogo y compras de **cada tienda-tenant**
(fire-and-forget, sin reintentos, sin reconciliación) hacia un hub central
que agrega catálogos de **tiendas independientes entre sí** (probablemente
para una app/marketplace externo), no sucursales de un mismo negocio. No
reutilices esta terminología ni este mecanismo para la feature de
sucursales — son conceptos distintos que comparten la palabra "tienda" por
accidente. Grepeé "sucursal" en todo el repo (`src`, `migrations`, `docs`):
**cero resultados reales** — el concepto que pides no existe hoy, ni
siquiera como prototipo.

### 2.4 Frontend: no hay ningún selector de tienda, en ningún lado

- `src/app/(app)/layout.tsx` arma el menú lateral filtrando `navItems` por
  rol (`storeWorker`/`storeAdmin`/`systemAdmin` — flags planas, sin lista de
  tiendas), y muestra **un** nombre de tienda (`useQuery(["store-name"], ...
  /api/settings)`). No hay ningún `<select>` ni concepto de "tienda activa".
- `src/app/(app)/dashboard/page.tsx` no recibe ni gestiona ningún `storeId`
  — todo lo resuelve el servidor vía `getStoreId()`.
- **160 usos de `queryKey` de TanStack Query en 31 archivos**, y **ninguno**
  incluye el `storeId` en la key (no hace falta hoy: cada usuario ve
  siempre la misma tienda). Esto es importante: el día que un
  `businessAdmin` pueda cambiar de sucursal en la misma pestaña sin
  recargar, **todas** esas keys necesitan incluir la sucursal activa, o el
  cache de TanStack Query va a mostrar datos de la sucursal anterior
  después de cambiar — la clase exacta de bug que describe §15 de
  AGENTS.md ("evita contaminación de cache entre tiendas").

### 2.5 El patrón "resolver tenant para systemAdmin" ya existe, parcialmente

`AGENTS.md` §5.5 ya documenta que no hay un selector uniforme de tenant para
`systemAdmin`. Confirmé los 3 patrones reales, más uno no documentado:

| Endpoint | Cómo resuelve el tenant hoy |
|---|---|
| `GET /api/admin/stores` | `systemAdmin` → todas las tiendas sin filtro; `storeAdmin` → su propia tienda (`.eq("id", storeId)`) |
| `GET /api/admin/users?storeId=xxx` | `storeAdmin` → **ignora** el query param, fuerza su propia tienda; `systemAdmin` → **exige** `storeId` como query param, 400 si falta |
| `PATCH /api/admin/users/[id]` | resuelve el tenant por el recurso del path (no confirmado en detalle en este pase, documentado en AGENTS.md) |
| `GET/PATCH /api/admin/license` | usa `admin.storeId` (la tienda propia del admin) incluso para `systemAdmin` — inconsistencia conocida, **no la arregles** como parte de esta feature sin decisión de producto aparte |

El patrón de `GET /api/admin/users?storeId=` — "admin con visión ampliada
elige un `storeId` por query param, validado contra lo que le corresponde" —
es literalmente el patrón que `businessAdmin` necesita generalizar. Ya existe
una semilla; hay que extenderla, no inventarla de cero.

## 3. Diseño propuesto

### 3.1 Modelo de datos

Nueva tabla espejo de Clerk Organizations, para poder hacer `JOIN`s SQL
normales (Supabase no puede consultar directamente el directorio de Clerk):

```sql
-- migrations/0NN_businesses.sql (borrador — verificar numeración real al implementar)
CREATE TABLE IF NOT EXISTS businesses (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id TEXT        NOT NULL UNIQUE,   -- id de la Clerk Organization
  name         TEXT        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_stores_business_id ON stores(business_id);
```

- `business_id` en `stores` nace **nullable** para no romper nada durante la
  migración, pero el plan de datos (fase 5) es que **toda** tienda termine
  con un `business_id` — incluidas las tiendas reales existentes, que se
  migran cada una a un "negocio de una sola sucursal" (así el código nunca
  necesita una rama especial para "tienda sin negocio").
- Funciones RLS espejo (defensa en profundidad, igual que hoy — recordá que
  RLS **no está en la ruta de ejecución real**, §0.2 AGENTS.md, así que esto
  protege infraestructura futura, no reemplaza el filtro en aplicación):
  `get_user_business_id()`, `is_business_admin()`, análogas a
  `get_user_store_id()`/`is_system_admin()` de `000_base_schema.sql`.
- **No** se toca `venta_items` ni `nota_credito_items`: siguen sin
  `store_id` propio (§6.3/§23.1 AGENTS.md) y esta feature no cambia esa
  invariante — el ownership sigue vía join al padre, ahora simplemente el
  padre (`ventas`) puede pertenecer a cualquiera de las sucursales del
  negocio cuando `businessAdmin` mira "todas".
- Todas las demás tablas de negocio (productos, clientes, ventas, etc.)
  **no cambian su columna `store_id`** — con aislamiento por sucursal
  confirmado (§1.1), no necesitan saber nada de `business_id`. Solo
  `stores` conoce a qué negocio pertenece.

### 3.2 Roles y Clerk Organizations

Mapeo de conceptos:

| Rol | Dónde vive | Alcance |
|---|---|---|
| `systemAdmin` | `publicMetadata` del **usuario** (sin cambios) | Global, cross-negocio — ya tiene la excepción de licencia (§5.2 AGENTS.md), no pertenece a ningún negocio |
| `businessAdmin` | Rol de **Organization membership** (ej. `org:admin` de Clerk, o un rol custom) | Ve todas las `stores` del negocio (`business_id` de la Organization), elige cuál mirar o agrega todas |
| `storeAdmin` | Organization membership + **`publicMetadata` de la membership** (`{ storeId: "..." }`) | Su sucursal únicamente — igual que hoy |
| `storeWorker` | Igual que `storeAdmin`: membership + `storeId` en metadata de la membership | Su sucursal únicamente, solo `/pos` |

Por qué esta forma y no otra: Clerk Organizations modela bien "negocio →
miembros con un rol de negocio", pero **no** modela nativamente
"sucursal dentro del negocio" — eso es un concepto propio de esta app.
Clerk sí permite metadata custom por membership (`organizationMembership.publicMetadata`),
que es exactamente donde guardar "a qué sucursal específica está asignado
este storeAdmin/storeWorker dentro del negocio". `businessAdmin` es la
membership que **no** lleva `storeId` en su metadata — su ausencia es la
señal de "ve todas".

**Pendiente de verificación antes de implementar** (no pude confirmarlo sin
`node_modules` ni acceso al dashboard de Clerk de este proyecto):
- Si el session token de Clerk necesita configuración manual en el
  Dashboard para incluir `org_id`/`org_role`/metadata de membership como
  claims (versiones recientes de Clerk permiten customizar el JWT template).
- Nombres exactos de hooks/componentes en `@clerk/nextjs@7.2.3`
  (`useOrganizationList`, `useOrganization`, `<OrganizationSwitcher />`,
  forma exacta de `auth()` con Organizations activas).
- Límites de Clerk en cuántas Organizations puede tener un proyecto y
  cuántas memberships por usuario (irrelevante en la práctica salvo que el
  plan de Clerk contratado tenga un tope bajo).

### 3.3 `getStoreId()` / `admin-check.ts` — el cambio que blinda a los 82 endpoints

Objetivo explícito: **preservar el shape de retorno** de `getStoreId()` para
que los endpoints existentes seleccionen "la sucursal activa" sin saber que
existe el concepto de negocio.

```ts
// Forma nueva (ilustrativa — nombres de campos de Clerk sin verificar, ver §3.2)
export async function getStoreId(): Promise<{
  userId: string;
  storeId: string | null;      // null solo si businessAdmin no ha elegido sucursal
  systemAdmin?: boolean;
  businessAdmin?: boolean;     // nuevo
  businessId?: string;         // nuevo — negocio activo (org actual de Clerk)
} | null>
```

- Para `storeAdmin`/`storeWorker`: comportamiento **idéntico** al de hoy —
  `storeId` sale de la metadata de su membership, fijo, sin selector.
  **Cero cambio de comportamiento observable** para estos roles.
- Para `businessAdmin`: `storeId` se resuelve de una **sucursal activa**
  elegida por el usuario (ver §3.5, cookie httpOnly), validada en cada
  request contra la lista real de sucursales del negocio (nunca confiar en
  el valor de la cookie sin validar pertenencia — mismo principio que "no
  confíes en un `store_id` del cliente", §6.1 AGENTS.md).
- `admin-check.ts` necesita un `requireBusinessAdmin()` análogo a
  `requireStoreAdmin()` (misma forma: lanza `Error`, cada caller hace
  `try/catch` → 403), y `resolveAdminContext()` debería extenderse para
  cross-verificar `businessAdmin` contra la DB igual que ya hace con
  `systemAdmin` (mismo problema de JWT stale que ya resolvieron una vez).

### 3.4 Endpoints que necesitan una capacidad nueva

La gran mayoría de los 82 endpoints con `getStoreId()` no cambia. Los que sí
necesitan trabajo nuevo son los que hoy hacen `.eq("store_id", storeId)` y
tendrían que poder hacer `.in("store_id", storeIds)` cuando `businessAdmin`
pide "todas las sucursales":

- `GET /api/dashboard`, `/api/dashboard/stock-alertas`,
  `/api/dashboard/vencimientos` — KPIs agregables por negocio.
- `GET /api/reports`, `/api/reports/export(-full)`, `/api/reports/prediccion`,
  `/api/analytics/recompras-avanzadas` — mismo patrón.
- El nuevo componente de UI "selector de sucursal" necesita un endpoint que
  liste las sucursales del negocio activo (extensión natural de
  `GET /api/admin/stores`, generalizando el patrón que `businessAdmin` ya
  casi tiene por el precedente de `GET /api/admin/users?storeId=`).

**Recomendación explícita — no incluir en el primer alcance**:
- **Contabilidad** (`/api/contabilidad/**`): los asientos, el libro diario,
  el cierre de mes son por tienda porque probablemente corresponden a una
  entidad legal/tributaria por sucursal (boletas/facturas). Consolidar
  estados financieros entre sucursales es una decisión contable real, no
  solo técnica — trátalo como fuera de alcance de esta primera versión y
  decídelo aparte si surge la necesidad.
- **POS** (`/pos`) opera siempre sobre una sucursal concreta — no existe "vender
  en todas las sucursales a la vez". Si `businessAdmin` entra a `/pos`, debe
  operar como si fuera `storeAdmin` de la sucursal que tenga activa (mismo
  código, sin cambios), nunca en modo "todas".
- **Licencia**: mantener `license_end_date` en `stores` (por sucursal) es lo
  más simple y no requiere decisión nueva; centralizarla en `businesses`
  sería más realista comercialmente (una suscripción por negocio) pero es
  una decisión de producto/facturación que no se debe tomar implícitamente
  dentro de esta feature — **queda como pregunta abierta**, ver §6.

### 3.5 Selector de sucursal activa (frontend + mecanismo de sesión)

Con serverless (cada request es independiente), la forma más simple y
consistente con lo que ya existe:

- Cookie **httpOnly** (ej. `active_store_id`), seteada por un endpoint
  nuevo (`POST /api/session/active-store` o similar) cuando `businessAdmin`
  elige una sucursal en el selector del sidebar.
- `getStoreId()` la lee **solo si el usuario es `businessAdmin`**, y
  **siempre la valida** contra las sucursales reales del negocio activo
  antes de confiar en ella (si no es válida: tratar como "sin sucursal
  elegida", nunca caer silenciosamente a otra sucursal).
- El sidebar (`src/app/(app)/layout.tsx`) gana un selector visible solo para
  `businessAdmin`, con una opción "Todas las sucursales" además de cada
  sucursal individual — coherente con lo que pediste ("vista global... poder
  elegir la sucursal").
- **TanStack Query**: toda `queryKey` que dependa de la sucursal activa
  (prácticamente todas las de dashboard/reportes/inventario/etc.) necesita
  incluir la sucursal activa en la key (ej. `["productos", storeId, search]`)
  para que cambiar de sucursal invalide el cache correctamente — esto toca
  potencialmente los 31 archivos con `queryKey`, aunque en la práctica
  para `storeAdmin`/`storeWorker` el valor no cambia nunca en una sesión, así
  que el riesgo real de bugs de cache está concentrado en las pantallas que
  `businessAdmin` usa (dashboard, reportes, inventario si decide navegarlo
  por sucursal).

### 3.6 Nueva UI de administración

- Pantalla nueva para `systemAdmin`: gestión de "Negocios" — crear negocio,
  crear sucursales dentro de él, asignar `businessAdmin` (nueva Organization
  + memberships), análoga a la actual `UsuariosCard`/`AdminLayout` en
  `src/components/admin/`.
- `src/app/(app)/admin/page.tsx` necesita una pestaña o sección nueva; el
  patrón de tarjetas (`UsuariosCard`, `LicenciaCard`, `AuditoriaCard`) ya
  existe y se puede replicar para "Negocios y Sucursales".

## 4. Qué NO cambia (para dimensionar correctamente el esfuerzo)

Gracias a la decisión de mantener los datos aislados por sucursal:

- Todo el dominio de POS, inventario, lotes FIFO, fidelización, notas de
  crédito, devoluciones, saldos a favor, servicios/citas/encargados,
  proveedores, órdenes de compra, cuentas por pagar — **sin cambios de
  lógica de negocio**. Siguen operando sobre un único `storeId` por request,
  exactamente como hoy.
- Las invariantes históricas de §23 de AGENTS.md (IVA por extracción,
  ownership de `nota_credito_items`, `anular_venta_tx`, saldos a favor
  atómicos, totales del carrito) **no se tocan** — ninguna depende del
  concepto de negocio.
- RLS existente en las ~33 tablas con `store_id` no necesita reescritura,
  solo la nueva tabla `businesses`/columna `stores.business_id` gana
  políticas propias.
- Los 71 (y contando) archivos de `migrations/` no se reescriben — se
  agrega, no se modifica histórico (regla general del proyecto).

## 5. Riesgos y cosas que se pueden romper si esto se hace mal

1. **Migración de identidad en Clerk con usuarios reales en producción.**
   El proyecto tiene tiendas reales usando el sistema hoy (§0.1 AGENTS.md).
   Migrar sus usuarios de "flags en `publicMetadata` del usuario" a
   "Organization + membership metadata" es una operación sobre un sistema
   externo de producción (no Supabase, pero mismo principio): requiere
   scripting cuidadoso vía Clerk Backend API, idealmente reversible o
   ejecutado en un usuario de prueba primero, y **autorización explícita
   antes de tocar usuarios reales** — igual que exige el proyecto para
   Supabase. Nada de esto se ejecuta sin que lo apruebes paso a paso.
2. **Cookie de sucursal activa mal validada = fuga cross-tenant.** Si
   `getStoreId()` confía en `active_store_id` sin verificar que esa sucursal
   pertenece al negocio del `businessAdmin` autenticado, es un IDOR directo
   sobre todos los endpoints que dependen de `getStoreId()` — el mismo tipo
   de bug que las invariantes de §6 de AGENTS.md existen para prevenir.
   Requiere pruebas negativas explícitas (sucursal de otro negocio, sucursal
   inexistente, cookie corrupta).
3. **Cache de TanStack Query mostrando datos de la sucursal anterior** tras
   un cambio de sucursal en la misma pestaña, si no se audita cada
   `queryKey` relevante (§15 AGENTS.md, ejemplificado en §2.4 de este
   documento).
4. **JWT stale con rol de negocio desactualizado** — el proyecto ya tuvo
   que resolver esto para `systemAdmin` (`resolveAdminContext`,
   `requireSystemAdminConsistent`, con comentario explícito sobre que los
   JWT de Clerk no se refrescan automáticamente). `businessAdmin` va a
   necesitar la misma cross-verificación contra la DB (o contra la API de
   Clerk) para evitar que alguien degradado de `businessAdmin` a
   `storeAdmin` conserve acceso ampliado hasta que expire su JWT.
5. **Constraints `UNIQUE(store_id, ...)` no se tocan** (correcto, por la
   decisión de aislamiento), pero cualquier UI que en el futuro tiente a
   "copiar producto a otra sucursal" tiene que crear una fila nueva con su
   propio `store_id`, nunca reutilizar IDs entre sucursales — dejarlo
   explícito para que nadie lo "simplifique" más adelante.
6. **Contabilidad y licencia** son las dos áreas donde una consolidación
   cross-sucursal mal pensada tiene consecuencias reales de negocio (estados
   financieros incorrectos, facturación de licencia mal calculada) — de ahí
   la recomendación de dejarlas fuera del alcance inicial (§3.4).

## 6. Preguntas abiertas — no las resolví por ti porque son decisiones de negocio

1. **Licencia**: ¿una licencia por negocio (cubre todas sus sucursales) o
   una licencia por sucursal como hoy? Afecta el modelo de `stores` vs
   `businesses` y el middleware de licencia.
2. **Contabilidad consolidada**: ¿algún día `businessAdmin` necesita un
   estado de resultados combinado entre sucursales, o cada sucursal es
   siempre una entidad contable separada? No lo asumas — pregúntalo cuando
   llegue el momento de tocar `/contabilidad`.
3. **¿Puede una sucursal existir sin negocio (tenant "suelto", como hoy)
   indefinidamente**, o el plan final es que **toda** tienda tenga un
   `business_id` (incluida una "de una sola sucursal")? Este documento
   asume lo segundo por simplicidad de código, pero es tu decisión de
   producto/comercial.
4. **Alta de sucursales**: ¿la crea `systemAdmin` únicamente, o
   `businessAdmin` puede crear sus propias sucursales (con o sin límite
   según su plan/licencia)?
5. **Traspaso de `storeWorker`/`storeAdmin` entre sucursales del mismo
   negocio**: ¿es un caso de uso a soportar desde el día uno (ej. un
   empleado que rota de sucursal) o se puede resolver manualmente al
   principio?

## 7. Estimación de tamaño

No dimensiono en horas porque no tengo forma de verificarlas, pero sí en
superficie tocada, con el aislamiento por sucursal ya decidido:

| Capa | Tamaño del cambio |
|---|---|
| Modelo de datos (Supabase) | Pequeño — 1 tabla nueva (`businesses`), 1 columna nueva (`stores.business_id`), funciones RLS espejo. No se tocan las ~33 tablas con `store_id` existentes. |
| Identidad (Clerk) | **Grande** — Organizations es un modelo nuevo para este proyecto; requiere migrar usuarios reales, posible configuración de JWT template en el Dashboard de Clerk, nuevos tipos de evento en el webhook. |
| Auth/autorización interna | Mediano, concentrado — `auth.ts`, `admin-check.ts`, `middleware.ts`, webhook de Clerk. Si se preserva el shape de `getStoreId()`, el resto del backend queda blindado. |
| Backend — endpoints nuevos/tocados | Pequeño-mediano — ~6-10 endpoints de agregación (dashboard/reportes/analytics) + 1-2 endpoints nuevos (listar sucursales del negocio, fijar sucursal activa) + CRUD de negocios/sucursales para `systemAdmin`. |
| Backend — endpoints sin cambios | Grande en cantidad, cero esfuerzo — la mayoría de los ~82 endpoints con `getStoreId()`. |
| Frontend | Mediano — selector de sucursal en el sidebar, pantalla admin de negocios/sucursales, auditoría de `queryKey` en los archivos que `businessAdmin` realmente usa (dashboard, reportes, inventario). |
| Tests | Mediano-grande — nueva matriz de pruebas negativas específica de `businessAdmin` (sucursal de otro negocio, sin sucursal elegida, JWT stale de negocio, cookie manipulada) sobre cada endpoint de agregación nuevo, más cobertura de componentes para el selector. |
| Migración de datos reales | Riesgo alto, tamaño chico en líneas de código, grande en cuidado — migrar Organizations/memberships de Clerk para los tenants reales existentes. |

**En una frase**: el dominio de negocio (POS, inventario, ventas,
contabilidad) apenas se mueve gracias a `getStoreId()` como punto único de
verdad; el esfuerzo real está en la identidad (Clerk Organizations, nueva
para este proyecto) y en no romper el aislamiento de tenant al agregar la
capacidad de "ver varias sucursales a la vez".

## 8. Plan de fases propuesto

### Fase 0 — Verificación previa (antes de escribir código)

- `npm install` y leer los tipos reales de `@clerk/nextjs@7.2.3` para
  Organizations (confirmar shape de `sessionClaims`, hooks, componentes).
- Confirmar contra el Supabase real (solo `SELECT`/`information_schema`,
  sin escritura) que el esquema de `stores`/`clerk_users` sigue siendo el
  descrito en `migrations/000_base_schema.sql`.
- Resolver las preguntas abiertas de §6 con Pablo (al menos licencia y
  "¿toda tienda tiene negocio?").
- Registrar IDs de test nuevos propuestos (`BIZ-XX` para negocio,
  ampliar convención existente) en `docs/spec-registry.md`, verificando
  primero que no colisionen (§2.3 AGENTS.md).

### Fase 1 — Modelo de datos y RLS espejo

- Migración: tabla `businesses`, columna `stores.business_id` (nullable),
  `get_user_business_id()`, `is_business_admin()`, políticas RLS.
- Actualizar `src/types/index.ts` a mano (no hay generación automática,
  §0.7 AGENTS.md).
- Sin tocar código de aplicación todavía — esta fase es solo esquema.

### Fase 2 — Identidad: Clerk Organizations (entorno de prueba)

- Prototipar Organizations en un proyecto/entorno de Clerk de prueba (no el
  de producción) para confirmar la forma real de los claims y si hace falta
  tocar el JWT template.
- Diseñar el mapeo Organization↔`businesses`, membership↔rol+sucursal.
- Extender el webhook de Clerk: `organization.created/updated`,
  `organizationMembership.created/updated/deleted` → sincronizar
  `businesses` y (decidir) si `clerk_users`/una tabla nueva de membership
  se actualiza también.

### Fase 3 — Autorización interna

- `getStoreId()`, `admin-check.ts` (`requireBusinessAdmin`, extender
  `resolveAdminContext`), `middleware.ts` (nuevas rutas permitidas,
  redirect por rol incluyendo `businessAdmin`).
- Mecanismo de sucursal activa (cookie httpOnly + endpoint para fijarla +
  validación de pertenencia en cada lectura).
- Tests: matriz completa de pruebas negativas de §6.5 AGENTS.md aplicada al
  nuevo rol (no autenticado, rol insuficiente, sucursal de otro negocio,
  sin sucursal elegida, `businessAdmin` degradado con JWT stale).

### Fase 4 — Endpoints de agregación + UI

- Endpoints de dashboard/reportes/analytics con soporte `.in("store_id",
  storeIds)` cuando la sucursal activa es "todas".
- Endpoint de listar sucursales del negocio activo.
- Selector de sucursal en el sidebar; auditoría de `queryKey` en las
  pantallas afectadas (§15 AGENTS.md).
- Pantalla admin de gestión de negocios/sucursales.
- Tests backend + frontend por separado, camino feliz y seguridad (§19.1
  AGENTS.md) — ninguna pantalla nueva se da por probada solo porque
  compila.

### Fase 5 — Migración de tenants reales existentes

- Script (autorizado explícitamente antes de correr, paso a paso) que crea
  una Organization + `businesses` row por cada `stores` existente, y migra
  cada `clerk_users` con `store_id` a una membership equivalente.
- Verificación post-migración: cada usuario real conserva exactamente el
  mismo acceso que tenía antes (ningún `storeAdmin` gana ni pierde acceso).
- Plan de rollback explícito antes de tocar Clerk de producción.

### Fase 6 — Limpieza y decisiones diferidas

- Revisar si contabilidad/licencia necesitan revisitarse ahora que el
  negocio real usa la feature (§6, preguntas 1-2).
- `graphify update .` para mantener el grafo de conocimiento al día
  después de todos los cambios de código.
