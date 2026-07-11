<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This project may use a Next.js version whose APIs, conventions and file
structure differ from training data.

Before changing behavior related to Next.js — including App Router, Route
Handlers, Server or Client Components, caching, revalidation, middleware,
rendering, metadata, cookies, headers, navigation, configuration or build —
read the relevant local documentation in `node_modules/next/dist/docs/`.
Heed all deprecation notices.

Do not rely on remembered Next.js behavior when it conflicts with the installed
version or its local documentation. If dependencies are not installed or the
local documentation is unavailable, state that limitation and inspect the
installed version, existing project patterns and type definitions before
proposing version-sensitive code.
<!-- END:nextjs-agent-rules -->

# petShop — Instrucciones para agentes

Reglas operativas para modificar este proyecto, escritas para cualquier LLM o
agente (Claude Code, Codex, Cursor, Windsurf u otros). No sustituyen la
inspección del código, tests, migraciones ni configuración vigente.

**Documentación externa:** `/home/pablete/Documentos/Bobeda Obsidian/Obsidian/proyectos/petShop/`
(leer su `MEMORY.md` como orientación rápida). Es contexto auxiliar: puede no
existir en CI, contenedores u otras máquinas, y puede estar desactualizada. Su
ausencia no bloquea el trabajo; su contenido no es autoridad sobre el repo.

## 0. Reglas críticas del proyecto

Los datos de mayor riesgo si se ignoran. El detalle está en la sección indicada.

1. **`wnxrdbnvreofrrmhcybc` es el único proyecto Supabase — desarrollo y
   producción a la vez.** Contiene datos reales de tiendas en uso. No hay
   staging ni stack local. Toda migración, backfill u operación de escritura
   fuera del flujo normal de la app requiere confirmación explícita del
   usuario, incluso si parece aditiva/reversible. (§7, §11)
2. **Todas las API routes usan `createServiceClient()` (service role) — RLS no
   se ejercita en producción.** `createClient()` (anon key) existe en
   `src/lib/supabase.ts` pero ningún endpoint lo usa. El aislamiento
   multi-tenant depende 100% de los filtros manuales por `store_id`; omitir uno
   es un leak entre tiendas que la BD no va a bloquear. (§6)
3. **`venta_items` y `nota_credito_items` no tienen columna `store_id`.** Su
   ownership se valida vía la tabla padre (`ventas`/`notas_credito`). No
   agregues `.eq("store_id", ...)` a tablas sin esa columna; no elimines los
   joins de ownership existentes. (§6.3, §22.1)
4. **`requireSystemAdmin()` y `requireStoreAdmin(admin, requiredStoreId?)`
   lanzan `Error`, no retornan `false`.** Todo caller debe envolverlos en
   try/catch que retorne 403; sin él producen un 500 no controlado. (§5.4)
5. **`getStoreId()` no valida `is_disabled` ni licencia**, y un `systemAdmin`
   sin `storeId` propio puede recibir `null` — no es el mecanismo general para
   detectar o autorizar a un systemAdmin. (§5.3)
6. **La selección de tenant para `systemAdmin` no es uniforme entre endpoints
   admin.** Coexisten tres patrones reales; verifica cuál usa un endpoint antes
   de copiarlo a otro. (§5.5)
7. **Los tipos TypeScript (`src/types/index.ts`) son interfaces manuales.** No
   hay generación automática ni script `gen-types`; toda migración de schema
   exige actualizar los tipos a mano en el mismo cambio. (§11.3)
8. **Todos los precios del sistema son brutos (IVA incluido).** El IVA se
   EXTRAE del monto bruto, nunca se suma sobre él. Fuente única:
   `extraerIva()`/`netoDesdeBruto()` en `src/lib/tax.ts`. No dupliques la
   fórmula ni hardcodees `1.19`/`0.19`. (§22.3)

## 1. Reglas no negociables

1. **No inventes evidencia.** No afirmes haber ejecutado un comando, test,
   build, migración o verificación que no ejecutaste. Clasifica todo resultado
   como:
   - **verificado** — ejecutado y observado;
   - **inferido** — respaldado por inspección, pero no ejecutado;
   - **pendiente** — no verificable con el acceso o entorno disponible.
2. **No inventes explicaciones sobre frameworks.** Toda afirmación de causa
   raíz que invoque comportamiento interno de React, Zustand, Next.js,
   PostgREST, Postgres o cualquier librería debe verificarse leyendo el código
   real en `node_modules/`, la documentación local, o reproduciéndola con un
   test dirigido. Si no puedes confirmarla, declárala como hipótesis no
   verificada — nunca como hecho en un comentario, test o mensaje de commit.
3. **Lee antes de editar.** Lee íntegramente cada archivo antes de
   modificarlo, más los tests, tipos, schemas, llamadores y migraciones que
   definan el contrato afectado. No edites desde snippets, resultados de
   búsqueda, nombres de archivo o memoria.
4. **No inventes contratos ni identificadores.** Columnas, tablas, rutas,
   helpers, firmas, scripts y variables de entorno se confirman en el
   repositorio o en el schema real antes de usarse.
5. **No debilites pruebas para hacer pasar un cambio.** No elimines
   expectativas válidas, no deshabilites tests relevantes, no uses mocks
   excesivamente permisivos, no silencies errores, no agregues sleeps,
   reintentos o timeouts arbitrarios para enmascarar condiciones de carrera.
6. **No hagas operaciones destructivas o irreversibles sin autorización
   explícita**: aplicar migraciones al Supabase real, borrar o modificar datos
   reales, backfills, relajar RLS/permisos/constraints, romper contratos,
   rotar secretos, desplegar Edge Functions, ejecutar scripts de reparación.
7. **No confundas código implementado con comportamiento confirmado.** Si una
   verificación relevante no pudo ejecutarse, el estado es **implementado pero
   pendiente de validación**, no "fix confirmado".
8. **Haz el menor cambio seguro** que elimine la causa raíz y sus
   manifestaciones confirmadas. Sin refactors, formato ni mejoras no
   relacionadas. Documenta aparte los problemas distintos que requieran otra
   decisión de producto, arquitectura o alcance.

## 2. Gates mecánicos de cierre

Chequeos ejecutables, no opinables. Un cambio no está terminado si falla
alguno:

1. **Commit**: si la tarea pedía commits, ejecuta `git status --short` antes
   de tu mensaje final. Si hay cambios sin commitear, la tarea NO está completa
   — no la reportes como tal.
2. **Llamadores**: si tocaste una función, getter, hook o helper compartido,
   ejecuta `grep -rn "<nombre>" src/` y clasifica CADA resultado: cubierto /
   requiere corrección / no aplica (con razón) / pendiente. No asumas por
   analogía que un componente "parecido" quedó cubierto.
3. **IDs de test**: antes de asignar un ID nuevo, greppea las DOS fuentes —
   `docs/spec-registry.md` **y** los archivos reales (`grep -rn "XX-" tests/`)
   — porque el registry puede estar desincronizado del código. Registra el ID
   nuevo en el registry en el mismo commit.
4. **Suite** (cambios de código): `npm run build && npm test` en verde (o
   fallos preexistentes demostrados como tales, ver §18.2), `npm run typecheck`
   y `npm run lint` sin errores nuevos introducidos por el cambio.
5. **Diff**: revisa el diff completo — sin logs de depuración, código
   temporal, imports muertos, secretos ni cambios de formato ajenos.
6. **Cierre**: emite el formato de §21. No es opcional ni implícito.

## 3. Jerarquía de fuentes

Cuando dos fuentes se contradigan, no resuelvas la contradicción en silencio.
Orden de autoridad:

1. schema real, migraciones aplicadas, constraints, RLS y configuración
   efectiva;
2. código y tipos actualmente en uso;
3. tests que representan contratos vigentes;
4. documentación versionada en el repo (este archivo, `docs/`);
5. documentación externa (bóveda Obsidian);
6. comentarios y memoria histórica;
7. suposiciones del agente.

Los tests no convierten un comportamiento incorrecto en el contrato correcto
(ha ocurrido: un archivo de test afirmaba una fórmula de IVA obsoleta). El
registry de specs también puede estar desactualizado respecto a los tests
reales. Si código, tests, docs y regla de negocio se contradicen, identifica la
contradicción antes de cambiar expectativas. Si involucra seguridad, datos
reales, una operación destructiva o una decisión de negocio: detente y
pregunta.

## 4. Stack técnico

- **Next.js** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Clerk** — autenticación, sesiones, roles en `publicMetadata`
- **Supabase** — PostgreSQL + RLS + Edge Functions
- **TanStack Query v5** — data fetching, cache, optimistic updates
- **Zod** — validación en límites de confianza
- **Tailwind CSS** — estilos

No asumas versiones ni APIs exactas: confirma en `package.json`, lockfile,
código existente y documentación local (`node_modules/next/dist/docs/`).

## 5. Roles y autorización

```
systemAdmin  → acceso administrativo global; nunca bloqueado por licencia
storeAdmin   → /admin (su tienda) + /pos + reportes
storeWorker  → /pos únicamente
```

### 5.1 Invariantes de autorización

- Los roles se obtienen de Clerk y de helpers server-side confiables. Nunca
  confíes en un rol, `store_id` o `storeId` enviado por el cliente como
  autoridad.
- La ausencia o forma inválida de `publicMetadata` se trata de forma segura
  (denegar, no asumir).
- Autenticación, autorización, tenant y licencia son controles distintos; no
  los trates como equivalentes.

### 5.2 Excepción de licencia para `systemAdmin`

El sistema de licencia nunca debe bloquear a un `systemAdmin`. Esta excepción
solo afecta al bloqueo por licencia: no permite omitir autenticación,
autorización, validación, auditoría ni aislamiento de tenant.

### 5.3 `getStoreId()` (`src/lib/auth.ts`)

Retorna `{ userId, storeId, systemAdmin? } | null`. Comportamiento conocido:

- intenta `sessionClaims.publicMetadata`; si el JWT no trae `storeId`,
  consulta `clerk_users` por `clerk_id`;
- **no** valida `is_disabled` ni licencia — si el endpoint debe bloquear
  usuarios deshabilitados o licencias vencidas, chequéalo aparte;
- un `systemAdmin` sin `storeId` propio y sin fila en `clerk_users` puede
  recibir `null` — no es el mecanismo para detectar/autorizar systemAdmin.

Patrón para endpoints tenant-scoped:

```typescript
const ctx = await getStoreId();
if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const { storeId, userId } = ctx;
```

No reutilices el nombre local `auth` si el archivo importa `auth()` de Clerk.

### 5.4 Helpers administrativos (`src/lib/admin-check.ts`)

`requireSystemAdmin(admin)` y `requireStoreAdmin(admin, requiredStoreId?)`
**lanzan `Error`** cuando la autorización falla — no retornan `false` ni una
respuesta HTTP. Sin try/catch producen un 500 en vez de un 403.

```typescript
const { sessionClaims } = await auth();
const admin = getAdminStatus(sessionClaims);
try {
  requireSystemAdmin(admin);   // o requireStoreAdmin(admin, targetStoreId)
} catch {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

Al usar `requireStoreAdmin`, pasa el `requiredStoreId` del recurso objetivo
cuando el endpoint opere sobre una tienda concreta — omitirlo desactiva el
chequeo cross-tenant. No expongas al cliente detalles internos del error.

### 5.5 Operaciones cross-tenant de `systemAdmin`

No existe un mecanismo uniforme para seleccionar la tienda objetivo. Patrones
reales que coexisten:

- `GET /api/admin/stores` retorna todas las tiendas sin filtro;
- `PATCH /api/admin/users/[id]` resuelve el tenant por el recurso del path;
- `GET/PATCH /api/admin/license` usa `admin.storeId` (la tienda propia del
  admin) incluso para systemAdmin, sin selector explícito.

No inventes ni generalices un selector de tenant inexistente. La limitación de
`/api/admin/license` para un systemAdmin sin `storeId` es una inconsistencia
conocida: no la "corrijas" eligiendo una tienda implícitamente — requiere una
decisión explícita de producto.

Para cada endpoint admin: identifica si es global o tenant-scoped, cómo se
resuelve hoy el tenant, aplica autorización explícita, audita cuando
corresponda, y prueba accesos negativos y recursos de otros tenants.

## 6. Multi-tenancy y aislamiento de datos

RLS es defensa adicional que **no está en la ruta de ejecución real** (§0.2).
El filtro server-side es la única protección efectiva.

Convención: `storeId` = variable TypeScript; `store_id` = columna PostgreSQL.

### 6.1 SELECT, UPDATE y DELETE

Toda lectura o mutación sobre tablas tenant-scoped incluye el tenant
autorizado: `.eq("store_id", storeId)`. Nunca filtres únicamente por un ID
proporcionado por el cliente — que un UUID exista o sea único no demuestra
ownership.

### 6.2 INSERT y UPSERT

- Asigna `store_id` desde el contexto autenticado, nunca desde el body.
- Cuida el orden del spread para que un payload malicioso no sobrescriba el
  tenant: `{ ...validatedInput, store_id: storeId }`.
- Decide deliberadamente (según contrato) entre rechazar o ignorar un tenant
  enviado por el cliente.

### 6.3 Tablas hijas sin `store_id`

`venta_items`, `nota_credito_items` y similares validan ownership mediante la
entidad padre: join con el padre tenant-scoped, consulta previa del padre con
filtro por tenant, doble condición de ownership (§22.1), o RPC transaccional.
No agregues `.eq("store_id", ...)` a una tabla que no tiene esa columna; no
asumas que filtrar por el ID del hijo basta.

### 6.4 Tablas globales

No todas las tablas son tenant-scoped. Antes de agregar o quitar filtros:
confirma el schema real, determina si la tabla es global/tenant-scoped/hija, y
si la operación es deliberadamente cross-tenant. No conviertas una operación
administrativa global en tenant-scoped ni al revés por comodidad.

### 6.5 Pruebas negativas obligatorias

Cuando un cambio afecta autorización u ownership, cubre según corresponda:
no autenticado; rol insuficiente; recurso inexistente; recurso válido de otra
tienda; hijo cuyo padre pertenece a otra tienda; `store_id` malicioso en body;
`systemAdmin` sin `storeId`; usuario deshabilitado si el flujo debe impedirlo;
tienda sin licencia (considerando la excepción de systemAdmin).

## 7. Supabase, service role y datos reales

Variables de entorno conocidas (confirma en el repo antes de usar otras):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
WHATSAPP_APP_SECRET
ENCRYPTION_KEY            # AES-256-GCM para credenciales de canales
HUB_URL                   # URL del hub central
HUB_SYNC_SECRET           # Bearer token hub
STORE_ID                  # UUID de esta tienda en el hub
NEXT_PUBLIC_APP_URL
CRON_SECRET               # valida crons (Authorization: Bearer $CRON_SECRET)
```

### 7.1 Service role

`SUPABASE_SERVICE_ROLE_KEY` omite RLS. Úsala solo server-side; nunca en Client
Components ni bundles del navegador; no la registres en logs, errores,
respuestas, tests o fixtures; aplica autorización y aislamiento de tenant
explícitos en aplicación; revisa imports transitivos para que código
server-only no llegue al cliente.

### 7.2 Datos reales

El proyecto `wnxrdbnvreofrrmhcybc` contiene datos reales de negocio (§0.1).
Nunca: pruebes destructivamente contra él; uses datos reales como fixtures;
copies montos, nombres o identificadores de negocio a respuestas, docs, logs o
tests; ejecutes migraciones o backfills sin confirmación; asumas que una
herramienta conectada apunta a un sandbox.

Antes de cualquier escritura vía MCP/CLI/script/SQL: identifica proyecto y
entorno objetivo, explica la operación, indica riesgos y reversibilidad,
solicita confirmación explícita, limita el alcance.

Tablas principales (orientativo; confirma en el schema real):

```
stores              — config de tienda (settings, licencia, fidelizacion_niveles)
clerk_users         — usuarios sincronizados desde Clerk (roles, is_disabled)
user_sessions       — sesiones Clerk grabadas (store_id nullable para systemAdmin)
productos           — catálogo (stock, codigo_barra, categoria_id, fecha_vencimiento)
lotes               — lotes con trazabilidad FIFO
venta_item_lotes    — lotes usados por item de venta
categorias          — categorías (es_alimento flag)
ventas              — transacciones POS (incluye canal de origen)
venta_items         — items de cada venta (cantidad, precio_unitario) — SIN store_id
clientes            — clientes con fidelización
pagos               — pagos por venta (1:N, multi-método)
notas_credito       — devoluciones
nota_credito_items  — items devueltos — SIN store_id, ownership vía padre
saldos_a_favor      — crédito de cliente
ordenes_compra      — órdenes a proveedores
cuentas_pagar       — deudas a proveedores (CHECK monto > 0)
proveedores         — proveedores
proveedor_productos — asociación proveedor-producto
consumo_alertas     — alertas de agotamiento por mascota/cliente
consumo_configs     — configuración de porciones por mascota/producto
stock_movements     — historial de movimientos de stock
audit_logs          — auditoría de cambios
journal_entries     — asientos contables (detalle en journal_detail)
chart_of_accounts   — plan de cuentas
canal_ordenes       — órdenes de canales externos (Rappi, PedidosYa, UberEats)
```

## 8. Validación con Zod

Schemas por dominio en `src/lib/validation/` (primitives, clientes,
inventario, ventas, supply-chain, admin). Importar desde `@/lib/validation`.
No agregues schemas a un archivo monolítico.

Valida entradas no confiables **antes** de lógica de negocio o BD: body, route
params, query params, headers relevantes, payloads de webhooks, datos de
servicios externos, metadata de Clerk, JSON persistido. TypeScript no valida
en runtime.

Reglas: reutiliza schemas existentes; mantén normalización consistente entre
UI y API; no conviertas `null`/`undefined`/`""`/`{}`/`[]` en equivalentes
salvo que el contrato lo establezca; no retornes datos sensibles en errores de
validación; sigue el formato de error de endpoints equivalentes.

## 9. Auditoría (`logAudit()`, `src/lib/audit.ts`)

Obligatoria en acciones sensibles: PATCH, DELETE, cambios de settings,
permisos, roles o licencias.

Estado real del código: ~30 call sites con `await` y ~31 fire-and-forget (sin
`await`, con `.catch()`) — inconsistencia histórica, no una política. **Default
para código nuevo**: fire-and-forget, salvo que el endpoint deba confirmar la
escritura del log antes de responder (ej. cumplimiento). No normalices
globalmente la política de `await` como parte de un cambio no relacionado.

No registres secretos ni payloads sensibles; incluye actor, tenant, recurso y
acción; evita duplicar eventos en reintentos.

## 10. Contabilidad y sincronización con Hub

Dos convenciones asíncronas DISTINTAS — no las trates igual:

### 10.1 `crearAsiento()` (`src/lib/contabilidad/generador-asientos.ts`)

- Captura errores esperados internamente (asiento desequilibrado, monto cero,
  fallo de insert) → retorna `null` y logea; pero **puede rechazar** ante
  errores no previstos (ej. env var faltante) — el `.catch()` del llamador no
  es decorativo.
- Maneja colisiones de `numero_asiento` con reintento (insert optimista).
- No se espera en el hot path (una venta no debe fallar por contabilidad),
  salvo `cierre-mes`, donde sí se usa `await` (acción administrativa síncrona).
- Reconciliación de asientos faltantes: `POST /api/contabilidad/backfill` —
  manual; no corre en cron ni tiene botón en frontend. No la presentes como
  recuperación automática.
- Mejora recomendada al tocar estos flujos: migrar fire-and-forget a `after()`
  de `next/server` (disponible en la versión instalada, aún no usado) para que
  la plataforma garantice la ejecución tras responder.

### 10.2 `syncProductsToHub()` / `syncPurchaseToHub()` (`src/lib/hub-sync.ts`)

- Funciones **síncronas** (no `async`): internamente hacen
  `fetch(...).catch(...)` sin retornar la promesa. No hay nada que el llamador
  pueda awaitar; `void` en el call site no cambia la semántica.
- Sin reconciliación ni reintento si el fetch falla. No describas una
  sincronización como garantizada si solo fue iniciada.

Al modificar cualquiera de los dos flujos revisa: atomicidad esperada, impacto
en la operación principal, duplicación por reintentos, timeouts, idempotencia
y expectativas de los tests.

## 11. Base de datos y migraciones

Migraciones en `migrations/` — **no** en `supabase/migrations/` (no existe;
`supabase/` solo contiene `functions/`).

### 11.1 Crear una migración

Crear y mostrar el SQL no requiere permiso. Antes de crear: inspecciona schema
y migraciones relacionadas, sigue el naming vigente (`NNN_descripcion.sql`),
revisa constraints/índices/RLS/grants afectados, evalúa compatibilidad con
código desplegado y datos existentes, diseña idempotencia (nota: `ADD
CONSTRAINT IF NOT EXISTS` **no existe** en PostgreSQL — usa DO block con
`EXCEPTION WHEN duplicate_object`; sí existen `ADD COLUMN IF NOT EXISTS` y
`CREATE INDEX IF NOT EXISTS`). No edites una migración ya aplicada para
simular un cambio nuevo.

### 11.2 Aplicar una migración

**Crear una migración no autoriza aplicarla.** No hay staging (§0.1): solicita
confirmación explícita, muestra alcance y riesgos, identifica el proyecto
objetivo. Mecanismo preferido: `mcp__supabase__apply_migration` si está
disponible en tu agente; si no, el medio autorizado por el usuario (CLI,
cliente SQL). Antes de aplicar, verifica contra el schema real si el contenido
ya existe (ha habido migraciones aplicadas manualmente sin registro de
tracking) y si hay datos que violarían nuevos constraints.

### 11.3 Tipos después de una migración

`src/types/index.ts` es manual (§0.7). Tras cambiar el schema: actualiza los
tipos afectados en el mismo cambio, revisa schemas Zod, queries, fixtures y
mocks, y ejecuta `npm run typecheck`. CI no detecta drift Postgres↔TypeScript.

### 11.4 Verificación en infraestructura real

Los tests mock-first no confirman: RLS, schema cache, constraints reales,
triggers, grants, tipos PostgreSQL, transacciones, concurrencia real. Si el
bug depende de eso, complementa con verificación contra el sistema real:
primero todo lo no destructivo (SELECTs, information_schema), y pide
autorización antes de escribir. Nunca presentes una prueba con mocks como
confirmación de comportamiento real de la BD.

## 12. Edge Functions (`supabase/functions/`)

Antes de modificarlas: inspecciona el runtime (Deno, no Node) y los patrones
de funciones vecinas; valida autenticación/autorización y payloads externos;
aplica aislamiento de tenant aunque se omita RLS; no expongas service role;
revisa CORS, timeouts, reintentos e idempotencia. No despliegues sin
autorización explícita. No asumas que una utilidad de Next.js corre en ese
runtime.

## 13. Webhooks

### 13.1 Reglas generales

Verifica autenticidad antes de procesar; valida el payload; no confíes en IDs
o tenants sin resolver ownership; diseña para reentregas, duplicados y eventos
fuera de orden; no registres firmas ni secretos; separa "evento recibido" de
"procesamiento confirmado".

### 13.2 Webhook de canales — `/api/canales/webhook/[canal]` (Rappi/PedidosYa/UberEats)

Idempotente, keyed por `external_order_id`. No elimines ni debilites esa
deduplicación; usa el mismo patrón si agregas lógica. Al modificar, prueba:
primera entrega, duplicada, payload inválido, autenticidad fallida, error
parcial, dos entregas concurrentes.

### 13.3 Webhook de Clerk — `/api/webhooks/clerk`

Verifica firma Svix pero **no** persiste `svix-id` para deduplicar reentregas.
Hoy es inofensivo porque las operaciones son upsert-like por `clerk_id`, pero
si agregas lógica no idempotente a ese handler, agrega deduplicación
explícita. Conserva la verificación Svix y procesa el body en la forma exacta
que la verificación de firma requiere.

## 14. Cron jobs

Rutas existentes (solo estas tres):

- `/api/cron/audit-cleanup`
- `/api/cron/email-alerts`
- `/api/cron/stock-reservas-expiry`

Todas validan `Authorization: Bearer ${CRON_SECRET}` — confirma la
implementación concreta antes de copiarla. **Solo `email-alerts` está agendado
en `vercel.json`**; la existencia de una ruta cron no demuestra que esté
programada. Al modificar o agregar un cron revisa: autenticación, idempotencia,
ejecuciones simultáneas, reintentos, procesamiento parcial, aislamiento de
tenant y la programación efectiva en `vercel.json`.

## 15. TanStack Query y estado derivado

Al cambiar query keys, caches o actualizaciones optimistas:

- usa la misma estructura de key en lectura e invalidación;
- toda key tenant-scoped debe incluir o quedar aislada por tenant de forma
  comprobable — evita contaminación de cache entre tiendas;
- prueba éxito, error y rollback de optimistic updates, y lecturas
  inmediatamente posteriores a una escritura;
- revisa crear, editar, borrar, restaurar e importaciones como fuentes de
  invalidación;
- no uses una invalidación global para ocultar una key incorrecta.

Los valores derivados de estado de UI (ej. totales del carrito POS) deben
calcularse desde los mismos datos ya destructurados en el mismo render — ver
§22.4.

## 16. Módulos y rutas (orientativo)

Esta tabla puede quedar desactualizada; no la uses como prueba de que un flujo
está terminado o desplegado. Confirma en código, tests y configuración.

| Módulo | Rutas principales | Estado |
|--------|-------------------|--------|
| Auth + Admin | `/admin`, `/api/admin/**`, `/api/user-sessions`, `/api/audit-logs`, `/api/error-logs` | ✅ |
| POS | `/pos`, `/api/ventas`, `/api/pagos`, `/api/recibos` | ✅ |
| Inventario + Lotes | `/inventory`, `/api/productos/**`, `/api/inventario`, `/api/lotes`, `/api/stock-movements` | ✅ |
| Clientes + Mascotas | `/api/clientes`, `/api/mascotas` | ✅ |
| Devoluciones | `/api/notas-credito`, `/api/saldos-a-favor` | ✅ |
| Fidelización | `/api/fidelizacion` | ✅ |
| Contabilidad | `/contabilidad`, `/api/contabilidad/**` | ✅ |
| Workers / Vendedores | `/vendedores`, `/api/workers`, `/api/workers/[id]/ventas` | ✅ |
| Supply Chain | `/api/ordenes-compra`, `/api/cuentas-pagar`, `/api/proveedores`, `/api/proveedor-productos` | ✅ |
| Categorías | `/api/categorias` | ✅ |
| Hub de canales | `/canales`, `/api/canales/**`, `/api/hub-sync` | ✅ parcial |
| Analytics | `/api/analytics/**`, `/api/recompras`, `/api/reports`, `/api/dashboard/**` | ✅ |
| Cron jobs | ver §14 | rutas ✅; solo `email-alerts` agendado |
| Webhooks | `/api/webhooks/clerk`, `/api/canales/webhook/[canal]` | ✅ |
| Control de licencia | `/api/admin/license`, `/api/license`, `/sistema-suspendido` | 🔧 pendiente |
| IA / Recomendador | `/api/ai/**` | ✅ parcial |

## 17. Flujo antes de hacer cambios

1. Lee este archivo y cualquier `AGENTS.md` más específico aplicable.
2. Lee íntegramente los archivos que modificarás (§1.3).
3. Localiza tests, schemas Zod, tipos y migraciones relacionados.
4. Si cambiarás una abstracción compartida, enumera sus llamadores (§2.2).
5. Identifica límites de tenant, autorización y datos sensibles.
6. Determina si el cambio requiere: migración, RLS, backfill, cambio de
   contrato, operación sobre infraestructura real, tipos manuales,
   invalidación de cache, auditoría.
7. Formula causa/hipótesis y una invariante verificable; identifica el test de
   regresión.
8. Detente si falta una decisión de negocio o autorización para una operación
   riesgosa. No pidas confirmación para ediciones normales.

## 18. Tests y comandos

Patrón: TDD London School (mock-first). Ver `tests/` para ejemplos.

```bash
npm test                   # todos (3 proyectos jest: unit/integration/components)
npm run test:unit          # solo tests/unit/**
npm run test:integration   # solo tests/integration/**
npm run test:components    # solo tests/components/**
npm run test:coverage      # thresholds: 70% líneas/funciones, 60% ramas
npm run lint
npm run typecheck          # tsc sobre tsconfig.src.json
npm run build
```

No asumas un número fijo de tests: ejecuta la suite y documenta el resultado
real observado. El conteo no debe disminuir inesperadamente.

IDs de test — los principales: `I-NNN` integración, `SEC-NN` seguridad,
`U-NN` unitario lib, `PROP-NN` propiedad (fast-check), `S-NN` store Zustand,
`IVA-NN` fórmula de IVA, y prefijos de componente (`PP`, `PC`, `MP`, `DA`,
`CC`, `COD`, `RD`, `DV`, ...). La lista autoritativa está al final de
`docs/spec-registry.md`. Aplica el gate §2.3 antes de asignar un ID.

Tests de propiedades en `tests/unit/lib/property-invariants.test.ts`.

### 18.1 Estrategia de ejecución

Durante el desarrollo: primero el test de regresión específico, luego la suite
del módulo, `typecheck`/`lint` cuando corresponda. Al finalizar, como mínimo
`npm run build && npm test`. Si no puedes ejecutar algo por límites del
entorno, márcalo **pendiente** y reporta qué sí ejecutaste.

### 18.2 Fallos preexistentes

No declares un fallo como preexistente solo porque parece no relacionado.
Evidencia aceptable: se reproduce sin tu cambio (ej. con `git stash`), afecta
código no modificado y ya existía, o consta en un baseline verificable.
Registra comando, fallo y evidencia. No los ocultes ni los mezcles con los
introducidos por tu cambio.

## 19. Protocolo para cerrar un bug fix

Un cambio puede resolver el repro literal y pasar sus propios tests sin
eliminar la causa raíz. No declares un bug cerrado sin completar lo aplicable:

### 19.1 Causa raíz e invariante

Identifica: estado inicial, transición que dispara el fallo, dónde se
introduce el estado incorrecto, causa raíz (distinta del síntoma) e invariante
verificable. Recuerda §1.2: si la causa involucra internals de un framework,
verifícala contra el código real — no publiques teorías plausibles como
hechos. Si la causa no puede determinarse, declara la incertidumbre en vez de
inventarla.

No pruebes solo los pasos literales del reporte. Revisa transiciones
adyacentes según apliquen: crear/editar; borrar/restaurar; mismo período/otro
período; primer guardado/re-guardado sin cambios; éxito/error/timeout/retry;
request único/concurrente/duplicado; datos nuevos/históricos.

### 19.2 Regresión efectiva

Agrega o actualiza una prueba que: falle con el comportamiento defectuoso
(demuéstralo, ej. revirtiendo temporalmente el fix con `git stash`),
represente la invariante (no solo el ejemplo literal), pase con el cambio y
cubra las variantes adyacentes de mayor riesgo. Si no puedes demostrar el
fallo previo (ej. el entorno de test no reproduce la condición), dilo
explícitamente en el test y en el cierre, y explica qué valor aporta igual la
prueba — no afirmes protección que no verificaste.

### 19.3 Superficie afectada

Aplica el gate §2.2 y amplíalo a: wrappers, adaptadores, flujos equivalentes
que dupliquen la lógica sin llamar la abstracción, endpoints, pantallas, jobs,
crons, scripts, importaciones, tests, fixtures, migraciones y datos derivados.
Corrige en el mismo cambio las manifestaciones confirmadas de la misma causa;
documenta aparte lo que requiera otra decisión.

### 19.4 Semántica del contenido, no solo presencia

No uses `if (x)`, `!!x`, `IS NOT NULL` o `NOT NULL` como proxy de "tiene
contenido real". Según el contrato, considera: `null`, `undefined`, strings
vacíos/whitespace, `{}`, `[]`, tipo incorrecto, payloads
serializados/cifrados con contenido vacío, datos parcialmente formados. No
asumas que `{}`/`[]`/`""` son siempre inválidos: determina su semántica de
negocio y mantenla consistente entre UI, API, dominio y persistencia.

### 19.5 Prevención ≠ observabilidad

Logs, métricas, alertas, validaciones defensivas y backfills no reemplazan la
corrección de la causa. Determina por separado: **prevención** (qué evita
nuevos estados inválidos), **detección** (cómo se sabrá si reaparece),
**contención** (cómo se limita el impacto) y **recuperación** (qué pasa con
los datos ya afectados). Todo backfill: autorizado, acotado, auditable,
idempotente, seguro ante reintentos y ejecución parcial.

### 19.6 Estado derivado

Si el cambio toca query keys, caches, agregados, contadores, campos
denormalizados o valores calculados: identifica todos los flujos que los
crean/actualizan/invalidan/recalculan/restauran/eliminan (crear, editar,
borrar, restaurar, importar, jobs, eventos, cambios masivos). Comprueba
atomicidad fuente↔derivado, ámbito de tenant, eventos
duplicados/retrasados/fuera de orden, reintentos, rollbacks y
read-after-write.

### 19.7 Concurrencia, idempotencia y fallos parciales

Si involucra unicidad, saldos, stock, límites, orden o estado transaccional:
requests simultáneos, ejecución duplicada, retry, timeout antes/después del
commit, respuesta perdida, error entre mutaciones, rollback. Una comprobación
previa en aplicación no basta cuando la garantía debe imponerse atómicamente:
usa constraint, transacción, operación atómica, bloqueo, control de versión,
idempotency key o deduplicación en la capa que puede garantizar la invariante.

### 19.8 Infraestructura real

Ver §11.4. Si no puede verificarse de forma segura, registra: qué quedó
pendiente, por qué, pasos exactos de validación, resultado esperado y riesgo
residual.

### 19.9 Contratos, seguridad y compatibilidad

Comprueba impacto sobre: APIs, tipos, schemas, formatos persistidos, clientes
y datos existentes, autenticación/autorización/aislamiento de tenant, manejo
de errores, rendimiento/número de queries, compatibilidad hacia atrás. No
resuelvas un repro con un bypass de validación, relajación de permisos o
exposición de datos.

## 20. Matriz de verificaciones condicionales

Aplica las verificaciones mínimas del área que toques:

| Área afectada | Verificaciones mínimas |
|---------------|------------------------|
| Auth o roles | 401, 403, rol insuficiente, metadata ausente, systemAdmin, usuario deshabilitado si aplica |
| Datos tenant-scoped | tenant correcto, tenant ajeno, IDOR, `store_id` malicioso en body, hijas sin `store_id` |
| Migración | compatibilidad, datos existentes que violen constraints, RLS, tipos manuales, autorización antes de aplicar |
| Stock o saldos | concurrencia, atomicidad, duplicados, retry, rollback |
| Pagos | idempotencia, timeout, respuesta perdida, conciliación, datos históricos |
| Cache / TanStack Query | query keys, tenant, invalidaciones, rollback optimista, read-after-write |
| Webhook | firma, replay, duplicados, idempotencia, eventos fuera de orden |
| Cron | bearer auth, solapamiento, retry, batching, programación efectiva en `vercel.json` |
| Integración externa (Hub, WhatsApp, Resend) | timeout, retry, duplicados, autenticación, secretos, reconciliación |
| Edge Function | runtime Deno, CORS, auth, service role, tenant, despliegue autorizado |
| PATCH/DELETE/settings | Zod, autorización, tenant, `logAudit()`, error parcial |
| Next.js | documentación local, server/client boundary, cache y APIs de la versión instalada |
| Cálculos de dinero/IVA | fuente única `src/lib/tax.ts`, pesos enteros, invariante neto+IVA=total (§22.3) |

## 21. Formato obligatorio de cierre

Al finalizar un cambio no trivial, reporta de forma concisa (omite líneas
genuinamente no aplicables diciendo por qué):

- **Causa o propósito**: problema resuelto o cambio solicitado.
- **Invariante**: propiedad que ahora debe mantenerse.
- **Cambio aplicado**: archivos y comportamiento modificado.
- **Superficie auditada**: llamadores y flujos revisados (resultado del grep).
- **Variantes cubiertas**: transiciones y casos límite comprobados.
- **Datos existentes**: recuperación, protección o razón de no aplicar.
- **Pruebas ejecutadas**: comandos y resultados reales (verificado/inferido/pendiente).
- **Infraestructura**: verificada, no aplicable o pendiente.
- **Compatibilidad y seguridad**: contratos y riesgos revisados.
- **Riesgos pendientes**: escenarios sin confirmar y cómo validarlos.
- **Estado final**: **confirmado** o **implementado pero pendiente de validación**.

## 22. Invariantes históricas — no romper

Protegen vulnerabilidades y bugs ya ocurridos. No elimines estos controles
porque parezcan redundantes.

### 22.1 Ownership de `nota_credito_items` (IDOR)

```typescript
.from("nota_credito_items")
  .select("cantidad_devuelta, notas_credito!inner(venta_id)")
  .eq("venta_item_id", item.ventaItemId)
  .eq("notas_credito.venta_id", ventaId)   // ← NO eliminar este eq
```

Si se refactoriza la query, conserva y prueba la misma invariante de
ownership vía el padre.

### 22.2 Evento Clerk `session.created`

La sesión debe insertarse aunque el `clerk_user` aún no exista; `store_id`
nullable es deliberado:

```typescript
await supabase.from("user_sessions").insert({
  store_id: clerkUser.store_id ?? null,   // nullable — no omitir
  user_id: sessionData.user_id,
  // resto de campos según el contrato vigente
});
```

### 22.3 IVA por extracción (precios brutos)

Todos los precios incluyen IVA. La única fórmula válida es la de extracción:
`extraerIva(bruto)` y `netoDesdeBruto(bruto)` en `src/lib/tax.ts`
(invariante: `neto + iva === bruto`, pesos enteros). La fórmula aditiva
`round(total × 0.19)` sobre precios brutos infló el IVA de ventas históricas
(reparadas en `migrations/050`). No dupliques la fórmula en call sites ni
hardcodees `1.19`/`0.19` — importa los helpers.

### 22.4 Totales del carrito POS derivados del mismo render

Los totales visibles (botón Cobrar, footer del carrito, modal de pago) se
calculan con las funciones puras `calcularSubtotalCarrito` /
`calcularSubtotalNetoCarrito` / `calcularImpuestoCarrito` /
`calcularTotalCarrito` de `src/stores/pos.ts`, aplicadas a los **mismos**
`items`/`descuento` destructurados en ese render — nunca vía getters del store
(`total()`, `impuesto()`) que leen `get()` en el momento de la invocación.
Regresión conocida: "Cobrar $0" tras rehidratar un carrito persistido en
localStorage.

### 22.5 Anular venta no debe re-aplicar efectos ya aplicados por una NC previa

Una nota de crédito (activa o usada) aplicó su efecto **una vez** al crearse:
restituyó stock (si `restituir_stock=true`), decrementó
`fidelizacion.total_historico` en su `monto_total`, e incrementó
`saldos_a_favor` si `tipo_reembolso='saldo_a_favor'`. Al anular la venta
completa (`PATCH /api/ventas/[id]`), el efecto a revertir es el **neto**
remanente, no el original completo — de lo contrario se duplica el crédito:

- **Stock**: restaurar `cantidad_venta_item − Σ(cantidad_devuelta` de
  `nota_credito_items` con `restituir_stock=true`, de TODAS las NCs de esa
  venta, cualquier `estado`)`, no la cantidad original completa.
- **Fidelización**: decrementar `venta.total − Σ(monto_total` de TODAS las
  NCs de esa venta, cualquier `estado`)`, no `venta.total` completo.
- **Saldo a favor**: revertir (`revertir_saldo_a_favor`) solo para NCs con
  `estado='activa'` — una NC `usada` ya fue consumida como pago de otra venta
  (`crear_venta_tx` ya decrementó ese saldo en ese momento); revertirla de
  nuevo sería un tercer descuento sobre el mismo crédito.

Regresión conocida: el fix original (revertir NC activa + saldo_a_favor al
anular) no cubría estas dos manifestaciones adyacentes en inventario y
fidelización — mismo defecto, dos superficies sin corregir en el primer pase.

### 22.6 Mutaciones de `saldos_a_favor` son atómicas vía RPC — no leer-then-escribir en JS

Las 3 mutaciones de `saldos_a_favor.saldo_disponible` usan funciones SQL
(`migrations/051_atomic_saldos_a_favor.sql`), nunca un `SELECT` en JS seguido
de un `UPDATE`/`upsert` con el valor calculado en la aplicación — ese patrón
es una condición de carrera real (lost update) bajo requests concurrentes:

- `incrementar_saldo_a_favor` — crear NC con `tipo_reembolso='saldo_a_favor'`.
- `revertir_saldo_a_favor` — anular venta con NC activa (decremento clamped a 0).
- `gastar_saldo_a_favor_pago` — usar saldo como pago (`POST /api/saldos-a-favor`).
  Atómico Y condicional (falla si insuficiente) Y hace el INSERT del pago en
  la MISMA transacción de función — evita la ventana de fallo parcial de
  decrementar y registrar el pago como dos pasos separados. Antes de este fix,
  este endpoint permitía doble gasto real (dos requests concurrentes con el
  mismo saldo) sin siquiera un piso en 0.
