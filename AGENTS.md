<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# petShop — Contexto del Proyecto

**Documentación completa:** `/home/pablete/Documentos/Bobeda Obsidian/Obsidian/proyectos/petShop/`
Leer `MEMORY.md` de ese directorio para orientación rápida.

## Reglas críticas

Estas son las reglas de mayor riesgo si se rompen. El detalle de cada una está en su sección correspondiente más abajo.

- **`wnxrdbnvreofrrmhcybc` es el único proyecto Supabase de petShop — no hay staging separado.** Es simultáneamente desarrollo y producción (contiene datos reales de tiendas en uso). Toda migración o operación destructiva debe confirmarse explícitamente con el usuario antes de aplicarse — nunca asumir que es seguro auto-aplicar por "no ser producción".
- **Todas las API routes usan `createServiceClient()` (service role) — nunca el cliente RLS.** `createClient()` (anon key) existe en `src/lib/supabase.ts` pero no se usa en ningún endpoint. Esto significa que las políticas RLS **no se ejercitan en producción**: el aislamiento multi-tenant depende 100% de los `.eq("store_id", store_id)` manuales en cada query. Omitir uno es un leak de datos entre tiendas, no una violación de RLS que la BD vaya a bloquear.
- **`venta_items` y `nota_credito_items` no tienen columna `store_id` propia.** Su aislamiento se valida vía la tabla padre (`ventas`/`notas_credito`). Ver el patrón de doble `.eq()` en "Patrones de seguridad" — no eliminar ese `eq` bajo ninguna circunstancia.
- **`requireSystemAdmin()` y `requireStoreAdmin()` (`src/lib/admin-check.ts`) lanzan `Error`, no retornan `false`.** Todo caller debe envolverlos en `try { ... } catch { return NextResponse.json(..., { status: 403 }) }`. Un snippet que los llame sin ese try/catch produce un 500 no controlado en vez de un 403.
- **`getStoreId()` no valida `is_disabled` del usuario ni el estado de la licencia.** Solo resuelve `storeId`/`systemAdmin` desde el JWT o `clerk_users`. Si un endpoint necesita bloquear usuarios deshabilitados o licencias vencidas, debe chequearlo aparte explícitamente.
- **La selección del tenant objetivo para `systemAdmin` no es uniforme entre endpoints** — a veces se listan todas las tiendas sin filtro, a veces el recurso del path la determina implícitamente, a veces se usa `admin.storeId` (la tienda propia del admin, no un selector explícito). Antes de copiar un patrón de un endpoint a otro, verifica cuál de los tres aplica.
- **No hay stack local de Supabase** (`supabase/config.toml` no existe) ni script de reset/seed de DB de test. Los tests de integración usan Supabase mockeado (Jest, TDD London School); cualquier verificación contra comportamiento real de Postgres/PostgREST (constraints, RLS, schema cache, concurrencia) debe hacerse contra el proyecto real vía MCP, con cuidado de no mutar datos reales sin necesidad.
- **Los tipos de TypeScript (`src/types/index.ts`) son interfaces escritas a mano, no generadas.** No existe script `gen-types` ni pipeline que los mantenga sincronizados con el schema real — si migras una tabla, actualiza los tipos a mano en el mismo cambio.

## Stack técnico

- **Next.js** (App Router, Turbopack) + React 19 + TypeScript
- **Clerk** — autenticación, sesiones, roles en `publicMetadata`
- **Supabase** — PostgreSQL + RLS + Edge Functions
- **TanStack Query v5** — data fetching, cache, optimistic updates
- **Zod** — validación en API boundaries
- **Tailwind CSS** — estilos

## Roles de usuario

```
systemAdmin  → acceso total; nunca puede ser bloqueado por sistema de licencia
storeAdmin   → /admin (su tienda) + /pos + reportes
storeWorker  → /pos únicamente
```

## Patrones de auth en API routes

```typescript
// Cualquier usuario autenticado — getStoreId() retorna
// { userId, storeId, systemAdmin? } | null. NO valida is_disabled ni licencia.
const ctx = await getStoreId();  // src/lib/auth.ts
if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
const { storeId, userId } = ctx;

// Solo admins — requireSystemAdmin()/requireStoreAdmin() LANZAN Error,
// no retornan boolean. Siempre envolver en try/catch:
const { sessionClaims } = await auth();
const admin = getAdminStatus(sessionClaims);  // src/lib/admin-check.ts
try {
  requireSystemAdmin(admin);   // o requireStoreAdmin(admin, targetStoreId)
} catch {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

## Convenciones críticas

- **Zod** para validar body antes de tocar la BD — schemas en `src/lib/validation/` (dominio: primitives, clientes, inventario, ventas, supply-chain, admin); importar desde `@/lib/validation`
- **logAudit()** en `src/lib/audit.ts` para acciones sensibles (PATCH, DELETE, SETTINGS). En el código actual se usa awaited en ~30 call sites y fire-and-forget (sin `await`, con `.catch()`) en ~31 — es inconsistente, no una regla deliberada. Para código nuevo: usa fire-and-forget salvo que el endpoint necesite confirmar que el log se escribió antes de responder (ej. para cumplimiento).
- **Multi-tenant**: SIEMPRE filtrar queries por `store_id`. Nunca SELECT sin WHERE store_id. Esto es especialmente crítico porque RLS no está en la ruta de ejecución real (ver "Reglas críticas") — el filtro manual es la única protección.
- Endpoints de admin requieren `requireSystemAdmin` o `requireStoreAdmin` — ambos lanzan, envolver en try/catch (ver "Patrones de auth").
- Asientos contables via `crearAsiento()` en `src/lib/contabilidad/generador-asientos.ts`. Captura sus errores esperados internamente (asiento desequilibrado, monto cero, fallo de insert → retorna `null` y logea) pero puede rechazar (throw) ante errores no previstos (ej. env var faltante) — el `.catch()` del llamador no es decorativo. No se espera deliberadamente en el hot path (la venta/pago no debe fallar por un problema contable), salvo en `cierre-mes` donde sí se usa `await` porque es una acción administrativa síncrona. Existe reconciliación (`POST /api/contabilidad/backfill`) para asientos faltantes, pero no corre en cron ni tiene botón en el frontend — solo se invoca manualmente. Considera migrar estos fire-and-forget a `after()` de `next/server` (disponible en esta versión de Next.js, no usado aún en el proyecto) para que la plataforma garantice su ejecución tras la respuesta.
- Hub sync via `syncProductsToHub()`/`syncPurchaseToHub()` en `src/lib/hub-sync.ts`: son funciones síncronas (no `async`) que internamente hacen `fetch(...).catch(...)` sin retornar la promesa — no hay nada que el llamador pueda awaitar aunque quisiera, y `void` en el call site no cambia nada semánticamente. No tienen reconciliación ni reintento si el fetch falla.

## Base de datos (Supabase proyecto wnxrdbnvreofrrmhcybc)

Este es el **único** proyecto Supabase de petShop — cumple simultáneamente el rol de desarrollo y de producción (no existe un proyecto de staging separado). Trátalo siempre como productivo: cualquier migración, backfill o script de reparación debe confirmarse explícitamente con el usuario antes de aplicarse, incluso si parece aditivo/reversible.

Las migraciones se encuentran en `/migrations/` (no en `supabase/migrations/` — esa carpeta no existe; `supabase/` solo contiene `functions/` de Edge Functions). El mecanismo preferido para aplicarlas es `mcp__supabase__apply_migration` cuando esté disponible en el agente que estés usando; si no lo está, aplica el SQL por el medio equivalente que tengas (CLI de Supabase, cliente SQL directo), siempre con la misma confirmación previa. No hay stack local de Supabase ni script de reset de DB de test — no existe un entorno no productivo donde probar RLS o migraciones de forma segura antes de aplicarlas al proyecto real.

Tablas principales:

```
stores              — config de tienda (settings, licencia, fidelizacion_niveles)
clerk_users         — usuarios sincronizados desde Clerk (roles, is_disabled)
user_sessions       — sesiones Clerk grabadas (store_id nullable para systemAdmin)
productos           — catálogo (stock, codigo_barra, categoria_id, fecha_vencimiento)
lotes               — lotes de productos con trazabilidad FIFO
venta_item_lotes    — qué lotes se usaron en cada item de venta
categorias          — categorías (es_alimento flag)
ventas              — transacciones POS (incluye canal de origen)
venta_items         — items de cada venta (cantidad, precio_unitario)
clientes            — clientes con fidelización
pagos               — pagos por venta (1:N, multi-método)
notas_credito       — devoluciones
nota_credito_items  — items devueltos (IDOR-protected: doble eq por store_id)
saldos_a_favor      — crédito de cliente
ordenes_compra      — órdenes a proveedores
cuentas_pagar       — deudas a proveedores (tipo: pendiente/pagada/custom)
proveedores         — proveedores
proveedor_productos — asociación proveedor-producto (costo, tiempo_entrega_dias)
consumo_alertas     — alertas de agotamiento estimado por mascota/cliente
stock_movements     — historial de movimientos de stock
audit_logs          — auditoría de cambios
journal_entries     — asientos contables
chart_of_accounts   — plan de cuentas (27 cuentas base)
canal_ordenes       — órdenes de canales externos (Rappi, PedidosYa, UberEats)
```

## Módulos implementados

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
| Cron jobs | `/api/cron/audit-cleanup`, `/api/cron/email-alerts`, `/api/cron/stock-reservas-expiry` | ✅ (solo `email-alerts` agendado en `vercel.json`; los otros dos existen como ruta pero sin cron registrado) |
| Webhooks | `/api/webhooks/clerk`, `/api/canales/webhook/[canal]` (Rappi/PedidosYa/UberEats) | ✅ |
| Control de licencia | `/api/admin/license`, `/api/license`, `/sistema-suspendido` | 🔧 pendiente |
| IA / Recomendador | `/api/ai/**` | ✅ parcial |

## Variables de entorno requeridas

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
CRON_SECRET               # Bearer token que valida los cron jobs (Authorization: Bearer $CRON_SECRET)
```

## Tests

Ejecutar `npm test` para el conteo y resultado vigente — no asumas un número fijo de tests, cambia con cada cambio; documenta el resultado real observado, no uno recordado.
Patrón: TDD London School (mock-first). Ver `tests/` para ejemplos.

```bash
npm test                   # todos (3 proyectos: unit/integration/components)
npm run test:unit          # solo tests/unit/**
npm run test:integration   # solo tests/integration/**
npm run test:components    # solo tests/components/**
npm run test:coverage      # con thresholds: 70% líneas/funciones, 60% ramas
```

IDs de test: `I-NNN` integración, `SEC-NN` seguridad, `U-NN` unitario, `PROP-NN` propiedad.
Registro completo en `docs/spec-registry.md`.
Tests de propiedades (fast-check) en `tests/unit/lib/property-invariants.test.ts`.

## Antes de hacer cambios

1. **Lee íntegramente el archivo antes de modificarlo usando la herramienta de lectura disponible**: No edites basándote solo en fragmentos, resultados de búsqueda o memoria.
2. **Nueva migración**: crear el archivo en `migrations/`. Antes de aplicarla (con `mcp__supabase__apply_migration` u otro medio equivalente), **confirma explícitamente con el usuario** — `wnxrdbnvreofrrmhcybc` es el único entorno (dev + prod a la vez), no hay staging donde probar sin riesgo. Puedes crear y mostrar el SQL sin pedir permiso; no lo apliques sin confirmación.
3. **Nuevo schema Zod**: agregar al módulo de dominio correcto en `src/lib/validation/` (no en `validation.ts` directamente)
4. **logAudit()**: obligatorio en PATCH, DELETE y cambios de settings
5. **store_id**: todo SELECT/INSERT/UPDATE de datos de tienda debe llevar `.eq("store_id", store_id)` — recuerda que RLS no protege esto en producción (ver "Reglas críticas")
6. **Cambio de schema**: si la migración agrega/renombra columnas usadas en TypeScript, actualiza a mano `src/types/index.ts` (no hay generación automática de tipos) en el mismo cambio.
7. **Al terminar**: `npm run build && npm test` — debe pasar la suite completa vigente; debe investigarse cualquier test omitido, deshabilitado o eliminado; el resultado real debe documentarse al cierre.

## Al cerrar un bug fix

Estas reglas existen porque un cambio puede resolver el repro literal y pasar sus propios tests sin eliminar la causa raíz, cubrir variantes relevantes ni mantener la consistencia del sistema. No declares un bug como cerrado hasta completar las
verificaciones aplicables y documentar su evidencia.

### 1. Define la causa raíz y la invariante

Antes de modificar código, identifica:

- el estado inicial relevante;
- la operación o transición que dispara el fallo;
- dónde se introduce el estado incorrecto;
- la causa raíz, diferenciándola de sus síntomas; y
- la invariante que el sistema debe mantener.

Expresa la invariante como una condición verificable. No pruebes únicamente los pasos literales del reporte. Revisa las transiciones adyacentes que correspondan, por ejemplo:

- crear y editar;
- borrar y restaurar;
- mismo período y período distinto;
- primer guardado y re-guardado sin cambios;
- éxito, error, timeout y reintento;
- request único, requests concurrentes y ejecución duplicada;
- datos nuevos y datos históricos.

Si la causa raíz o la regla de negocio no puede determinarse con la evidencia disponible, no inventes una. Declara la incertidumbre y solicita o identifica la información necesaria antes de aplicar un cambio especulativo.

### 2. Agrega una prueba de regresión que realmente reproduzca el defecto

Cuando sea viable, agrega o actualiza una prueba que:

1. falle con el comportamiento defectuoso;
2. represente la invariante, no solo el ejemplo literal;
3. pase después del cambio; y
4. cubra al menos las variantes adyacentes con mayor riesgo.

No debilites la suite para hacer pasar el fix. No elimines expectativas válidas, no ocultes errores, no uses mocks excesivamente permisivos y no agregues sleeps, reintentos o timeouts arbitrarios para enmascarar condiciones de carrera.

Si no es posible demostrar que la prueba falla antes del cambio, explica por qué y proporciona otra evidencia de que el test cubre el defecto.

### 3. Audita toda la superficie afectada

Si la causa está en una función, helper, query builder, hook, validador, middleware, repositorio, cliente, componente o abstracción compartida, busca:

- todos sus llamadores directos;
- wrappers, adaptadores y capas intermedias;
- flujos equivalentes que implementen la misma lógica sin llamar directamente
  a la abstracción;
- endpoints, pantallas, jobs, workers, scripts, importaciones y procesos masivos;
- tests, fixtures, migraciones y datos derivados relacionados.

Para cada uso relevante, clasifícalo como:

- cubierto por el cambio;
- requiere una corrección adicional;
- no aplicable, indicando la razón; o
- pendiente por falta de acceso o información.

Corrige en el mismo cambio las manifestaciones confirmadas de la misma causa raíz cuando hacerlo sea seguro y coherente. No mezcles automáticamente problemas distintos ni refactors no necesarios: documéntalos por separado si requieren una decisión de producto, arquitectura o un cambio de mayor alcance.

### 4. Valida contenido según su semántica, no solo su presencia

La existencia técnica de un valor no demuestra que contenga información válida.
No uses por sí solos `if (x)`, `!!x`, `IS NOT NULL` o una columna `NOT NULL` como proxy de “tiene contenido real”.

Cuando la regla de negocio lo requiera, considera y prueba explícitamente:

- `null` y `undefined`;
- strings vacíos o compuestos solo por whitespace;
- objetos vacíos;
- arrays vacíos;
- valores con tipo incorrecto;
- payloads serializados, comprimidos o cifrados cuyo contenido efectivo sea
  vacío o inválido;
- valores parcialmente formados o con campos obligatorios ausentes.

Normaliza y valida con el mecanismo apropiado: `.trim()`, longitud, conteo de keys, parseo seguro, validación por esquema o una comprobación equivalente.

No asumas que `{}`, `[]` o `""` son siempre inválidos: determina su significado según el contrato y la regla de negocio. Mantén esa interpretación consistente entre UI, API, lógica de dominio, persistencia y base de datos.

### 5. Corrige la causa; no confundas prevención con observabilidad

Logs, métricas, alertas, validaciones defensivas, feature flags y backfills pueden ser necesarios, pero no reemplazan la corrección de la causa raíz.

Antes de cerrar, determina por separado:

- **Prevención:** qué cambio evita nuevos estados inválidos.
- **Detección:** cómo se sabrá si el problema reaparece.
- **Contención:** cómo se limita el impacto durante el despliegue.
- **Recuperación:** cómo se corrigen o protegen los datos ya afectados.

Si se requiere un backfill o script de reparación, debe ser acotado, auditable, idempotente y seguro ante reintentos o ejecuciones parciales. No ejecutes cambios destructivos ni operaciones en producción sin autorización explícita.

### 6. Mantén consistente todo estado derivado

Si agregas o modificas una query key, cache, agregado, contador, índice de búsqueda, campo denormalizado, vista materializada, resumen o valor calculado, identifica todas las operaciones que pueden:

- crearlo;
- actualizarlo;
- invalidarlo;
- recalcularlo;
- restaurarlo; o
- eliminarlo.

Revisa al menos los flujos aplicables de crear, editar, borrar, restaurar, importar, ejecutar jobs, procesar eventos y realizar cambios masivos. Incluye cambios indirectos en entidades relacionadas.

Comprueba también:

- atomicidad entre el dato fuente y el derivado;
- invalidación por usuario, tenant o ámbito correcto;
- TTL y versionado de keys;
- eventos duplicados, retrasados o fuera de orden;
- reintentos y rollbacks; y
- lecturas inmediatamente posteriores a una escritura.

La corrección no debe depender únicamente del punto de lectura ni asumir que una sola mutación es la única fuente de cambios.

### 7. Verifica concurrencia, idempotencia y fallos parciales

Si el bug involucra unicidad, saldos, stock, límites, orden, idempotencia, estados transaccionales o datos compartidos, verifica explícitamente:

- requests simultáneos;
- ejecuciones duplicadas;
- reintentos automáticos;
- timeouts antes o después de confirmar una escritura;
- respuestas perdidas;
- errores entre mutaciones;
- rollbacks; y
- consumidores o eventos concurrentes.

Una comprobación previa en la aplicación no es suficiente cuando la garantía debe imponerse de forma atómica. Usa, según corresponda, constraints, transacciones, operaciones atómicas, bloqueos, control de versión, claves de idempotencia o deduplicación en la capa capaz de garantizar la invariante.

### 8. Verifica en infraestructura real cuando el comportamiento dependa de ella

Los mocks no reproducen con fiabilidad:

- cache de schema;
- drift de migraciones;
- constraints, índices, tipos y triggers reales;
- políticas RLS y permisos;
- aislamiento y comportamiento transaccional;
- condiciones de carrera;
- caches, colas y workers;
- servicios externos e integraciones.

Si el bug depende de base de datos, Supabase/PostgREST, migraciones, permisos, concurrencia, caches, colas o integraciones, complementa los tests con una verificación en un entorno real o suficientemente equivalente.

Nunca afirmes haber realizado una verificación que no ejecutaste. Si no tienes acceso al entorno necesario:

- indica exactamente qué quedó sin verificar;
- proporciona los pasos o comandos de validación;
- especifica el resultado esperado; y
- registra el riesgo pendiente.

No uses producción ni ejecutes operaciones destructivas sin autorización explícita.

### 9. Revisa contratos, seguridad y compatibilidad

Antes de cerrar, comprueba si el cambio afecta:

- APIs públicas o internas;
- tipos y esquemas;
- formatos persistidos;
- clientes o datos existentes;
- migraciones progresivas y rollbacks;
- autenticación, autorización, RLS o aislamiento entre tenants;
- manejo de errores;
- rendimiento o número de queries; y
- compatibilidad hacia atrás.

No soluciones el repro introduciendo un bypass de validación, una relajación de permisos, una exposición de datos o una ruptura silenciosa de contrato.

### 10. Revisa el diff completo

Antes de presentar el fix:

- revisa todos los archivos modificados;
- elimina logs de depuración y código temporal;
- elimina imports, variables y ramas muertas introducidas por el cambio;
- evita cambios de formato o refactors no relacionados;
- confirma que no se incluyeron secretos, credenciales ni datos sensibles;
- verifica que migraciones, tipos, documentación y tests estén sincronizados; y
- confirma que el cambio es el menor cambio seguro que elimina la causa raíz y
  sus manifestaciones confirmadas.

### 11. Ejecuta las verificaciones aplicables

Ejecuta, según estén disponibles y sean relevantes:

- tests de regresión específicos;
- suite del módulo o paquete afectado;
- type checking;
- linting;
- build;
- tests de integración;
- tests de concurrencia o idempotencia;
- validación de migraciones; y
- verificación en infraestructura equivalente.

No afirmes que una prueba pasó si no fue ejecutada. Distingue siempre entre:

- **verificado:** ejecutado y observado;
- **inferido:** respaldado por inspección, pero no ejecutado;
- **pendiente:** no verificable con el acceso o entorno disponible.

No ocultes fallos preexistentes. Si una verificación falla por una causa no introducida por el cambio, registra el comando, el fallo y la evidencia que permite considerarlo preexistente.

### 12. Cierra con evidencia estructurada

No declares el bug como cerrado basándote en intuición. Al finalizar, entrega un resumen con este formato:

- **Causa raíz:** dónde y por qué se producía el fallo.
- **Invariante:** propiedad que ahora debe mantenerse.
- **Cambio aplicado:** cómo el cambio elimina la causa.
- **Superficie auditada:** llamadores y flujos revisados.
- **Variantes cubiertas:** transiciones y casos límite comprobados.
- **Datos existentes:** recuperación, protección o razón por la que no aplica.
- **Pruebas ejecutadas:** comandos y resultados reales.
- **Verificación de infraestructura:** realizada, no aplicable o pendiente.
- **Compatibilidad y seguridad:** contratos o riesgos revisados.
- **Riesgos pendientes:** escenarios no comprobados y pasos para validarlos.

Un fix solo puede describirse como **confirmado** cuando existe evidencia suficiente. Si falta una verificación relevante, descríbelo como **implementado pero pendiente de validación**, sin ocultar ni minimizar el riesgo.

## Patrones de seguridad — no romper

```typescript
// IDOR en nota_credito_items — doble eq para validar ownership
.from("nota_credito_items")
  .select("cantidad_devuelta, notas_credito!inner(venta_id)")
  .eq("venta_item_id", item.ventaItemId)
  .eq("notas_credito.venta_id", ventaId)   // ← NO eliminar este eq

// Clerk session.created — siempre insertar aunque clerk_user no exista
await supabase.from("user_sessions").insert({
  store_id: clerkUser.store_id ?? null,    // nullable — no omitir
  user_id: sessionData.user_id,
  ...
})
```

- **Webhook de Clerk** (`/api/webhooks/clerk`) verifica la firma Svix (autenticidad) pero no persiste `svix-id` para deduplicar reentregas. Si Svix reenvía el mismo evento, se reprocesa — hoy es inofensivo porque las operaciones son upsert-like por `clerk_id`, pero si agregas lógica no idempotente a ese handler, agrega deduplicación explícita.
- **Webhook de canales** (`/api/canales/webhook/[canal]`) sí es idempotente, keyed por `external_order_id` — usa ese mismo patrón si agregas más lógica ahí.
- **Selección de tenant para `systemAdmin`**: no copies el patrón de un endpoint de admin a otro sin verificar cuál usa. Ejemplos reales en el código: `GET /api/admin/stores` retorna todas las tiendas sin filtro para systemAdmin; `PATCH /api/admin/users/[id]` resuelve el tenant implícitamente por el recurso del path; `GET/PATCH /api/admin/license` usa `admin.storeId` (la tienda propia del admin) incluso para systemAdmin, sin selector explícito de tienda objetivo.

## Checklist antes de cerrar cualquier cambio

- [ ] `npm run build && npm test` ejecutados y en verde (o fallos preexistentes documentados como tales)
- [ ] `npm run typecheck` y `npm run lint` sin errores nuevos introducidos por el cambio
- [ ] Si tocaste una tabla: `store_id` filtrado en todo query nuevo, y `src/types/index.ts` actualizado si cambiaron columnas
- [ ] Si agregaste una migración: confirmada explícitamente con el usuario antes de aplicarla (no hay staging)
- [ ] Si agregaste una acción sensible (PATCH/DELETE/settings): `logAudit()` presente
- [ ] Si usaste `requireSystemAdmin`/`requireStoreAdmin`: envuelto en try/catch
- [ ] Si el cambio afecta un flujo con `crearAsiento()`/`syncProductsToHub()`: verificado que la operación principal no depende de que el fire-and-forget tenga éxito
- [ ] Tests de regresión agregados que fallan sin el fix y pasan con él (ver "Al cerrar un bug fix")
- [ ] IDs de test nuevos registrados en `docs/spec-registry.md`
- [ ] Diff revisado completo: sin logs de depuración, imports muertos, ni secretos
