<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# petShop — Contexto del Proyecto

**Documentación completa:** `/home/pablete/Documentos/Bobeda Obsidian/Obsidian/proyectos/petShop/`  
Leer `MEMORY.md` de ese directorio para orientación rápida.

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
// Cualquier usuario autenticado:
const auth = await getStoreId();  // src/lib/auth.ts
if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
const { storeId, userId } = auth;

// Solo admins:
const { sessionClaims } = await auth();
const admin = getAdminStatus(sessionClaims);  // src/lib/admin-check.ts
requireSystemAdmin(admin);   // o requireStoreAdmin(admin)
```

## Convenciones críticas

- **Zod** para validar body antes de tocar la BD — schemas en `src/lib/validation/` (dominio: primitives, clientes, inventario, ventas, supply-chain, admin); importar desde `@/lib/validation`
- **logAudit()** en `src/lib/audit.ts` para acciones sensibles (PATCH, DELETE, SETTINGS)
- **Multi-tenant**: SIEMPRE filtrar queries por `store_id`. Nunca SELECT sin WHERE store_id.
- Endpoints de admin requieren `requireSystemAdmin` o `requireStoreAdmin`
- Asientos contables via `crearAsiento()` en `src/lib/contabilidad/generador-asientos.ts` (fire-and-forget)
- Hub sync via `syncProductsToHub()` en `src/lib/hub-sync.ts` (fire-and-forget, sin await)

## Base de datos (Supabase proyecto wnxrdbnvreofrrmhcybc)

44 migraciones en `/migrations/`. Tablas principales:

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
| Cron jobs | `/api/cron/check-vencimientos`, `/api/cron/audit-cleanup`, `/api/cron/email-alerts`, `/api/cron/stock-reservas-expiry` | ✅ |
| Webhooks | `/api/webhooks/clerk`, `/api/webhooks/rappi` | ✅ |
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
```

## Tests

**959 tests, 0 fallos.** Ejecutar con `npm test`.  
Patrón: TDD London School (mock-first). Ver `tests/` para ejemplos.

```bash
npm test                   # todos (99 suites en 3 proyectos: unit/integration/components)
npm run test:unit          # solo tests/unit/**
npm run test:integration   # solo tests/integration/**
npm run test:components    # solo tests/components/**
npm run test:coverage      # con thresholds: 70% líneas/funciones, 60% ramas
```

IDs de test: `I-NNN` integración, `SEC-NN` seguridad, `U-NN` unitario, `PROP-NN` propiedad.  
Registro completo en `docs/spec-registry.md`.  
Tests de propiedades (fast-check) en `tests/unit/lib/property-invariants.test.ts`.

## Antes de hacer cambios

1. **Leer el archivo antes de editarlo** (`Read` tool — siempre)
2. **Nueva migración**: crear en `migrations/` → aplicar con `mcp__supabase__apply_migration`
3. **Nuevo schema Zod**: agregar al módulo de dominio correcto en `src/lib/validation/` (no en `validation.ts` directamente)
4. **logAudit()**: obligatorio en PATCH, DELETE y cambios de settings
5. **store_id**: todo SELECT/INSERT/UPDATE de datos de tienda debe llevar `.eq("store_id", store_id)`
6. **Al terminar**: `npm run build && npm test` — deben pasar los 959 tests

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
