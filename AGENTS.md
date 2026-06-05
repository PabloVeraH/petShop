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

- **Zod** para validar body antes de tocar la BD — schemas en `src/lib/validation.ts`
- **logAudit()** en `src/lib/audit.ts` para acciones sensibles (PATCH, DELETE, SETTINGS)
- **Multi-tenant**: SIEMPRE filtrar queries por `store_id`. Nunca SELECT sin WHERE store_id.
- Endpoints de admin requieren `requireSystemAdmin` o `requireStoreAdmin`
- Asientos contables via `crearAsiento()` en `src/lib/contabilidad/generador-asientos.ts` (fire-and-forget)
- Hub sync via `syncProductsToHub()` en `src/lib/hub-sync.ts` (fire-and-forget, sin await)

## Base de datos (Supabase proyecto wnxrdbnvreofrrmhcybc)

43 migraciones en `/migrations/`. Tablas principales:

```
stores          — config de tienda (settings, licencia, email reminder)
clerk_users     — usuarios sincronizados desde Clerk (roles, is_disabled)
productos       — catálogo (stock, codigo_barra, categoria_id, fecha_vencimiento)
categorias      — categorías (es_alimento flag)
ventas          — transacciones POS (incluye canal de origen)
clientes        — clientes con fidelización
pagos           — pagos por venta (1:N, multi-método)
notas_credito   — devoluciones
saldos_a_favor  — crédito de cliente
ordenes_compra  — órdenes a proveedores
cuentas_pagar   — deudas a proveedores (tipo: pendiente/pagada/custom)
audit_logs      — auditoría de cambios
journal_entries — asientos contables
chart_of_accounts — plan de cuentas (27 cuentas base)
canal_ordenes   — órdenes de canales externos (Rappi, PedidosYa, UberEats)
```

## Módulos implementados

| Módulo | Rutas | Estado |
|--------|-------|--------|
| Auth + Admin panel | `/admin`, `/api/admin/**` | ✅ |
| POS | `/pos`, `/api/ventas`, `/api/pagos` | ✅ |
| Inventario | `/inventory`, `/api/productos`, `/api/inventario` | ✅ |
| Clientes | `/api/clientes` | ✅ |
| Devoluciones | `/api/notas-credito`, `/api/saldos-a-favor` | ✅ |
| Contabilidad | `/contabilidad`, `/api/contabilidad/**` | ✅ |
| Vencimientos | `/api/dashboard/vencimientos`, cron | ✅ |
| Categorías | `/categorias`, `/api/categorias` | ✅ |
| Hub de canales | `/canales`, `/api/canales/**` | ✅ parcial |
| Supply Chain | `/admin?section=supply-chain`, `/api/ordenes-compra`, `/api/cuentas-pagar` | ✅ |
| Email reminder | `/api/cron/check-vencimientos` | ✅ (migración 021) |
| Control de licencia | `/api/admin/license`, `/sistema-suspendido` | 🔧 pendiente (migración 022) |

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

929 tests, 0 fallos. Ejecutar con `npm test`.  
Patrón: TDD London School (mock-first). Ver `tests/` para ejemplos.  
Suite de integración en `tests/integration/api/`.

## Antes de hacer cambios

1. Leer el archivo antes de editarlo (`Read` tool)
2. Si es nueva funcionalidad: crear migración en `migrations/` y ejecutar en Supabase
3. Agregar schema Zod en `src/lib/validation.ts`
4. Agregar `logAudit()` en cambios sensibles
5. Ejecutar `npm run build && npm test` al finalizar
