# petShop — Session Bootstrap

Lee esto al inicio de cada sesión. Máx 2 minutos de lectura.

## Estado actual (jun 2026)

- **959 tests, 0 fallos** — `npm test` para verificar
- **44 migraciones** en `/migrations/` — última: 033_fidelizacion_niveles.sql
- **Branch activo**: `develop` → merge a `main` cuando esté listo

## Decisiones arquitectónicas recientes

| Decisión | Detalle |
|----------|---------|
| Validation split | `validation.ts` → barrel de `src/lib/validation/{primitives,clientes,inventario,ventas,supply-chain,admin}.ts` |
| Jest multi-proyecto | unit / integration / components con coverage thresholds 70% |
| POST /api/ventas | Usa stored procedure `crear_venta_tx` vía RPC — no manipula stock directamente |
| IDOR en NC | `nota_credito_items` filtra con doble `.eq("venta_item_id",...).eq("notas_credito.venta_id",...)` |
| Sessions webhook | Clerk session.created SIEMPRE inserta en `user_sessions` (store_id nullable para admins) |
| Property tests | `fast-check` en `tests/unit/lib/property-invariants.test.ts` (PROP-01 a PROP-03) |

## Gotchas frecuentes

1. **`nota_credito_items` mock** — necesita cadena thenable para el doble `.eq()` del IDOR fix
2. **mockProductId en tests** — usar UUIDs válidos (`123e4567-e89b-12d3-a456-426614174010`)
3. **CLP sin centavos** — siempre `Math.round()` antes de insertar montos en DB
4. **`z.coerce.number()`** — usar para query params numéricos (`periodo`, `meta_ventas`)
5. **Hub sync** — fire-and-forget, sin await: `syncProductsToHub()` en background
6. **`crearAsiento()`** — también fire-and-forget en todas las transacciones POS/NC

## Patrones de seguridad activos

```typescript
// Auth obligatorio en TODAS las routes
const ctx = await getStoreId();
if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const { storeId: store_id, systemAdmin } = ctx;

// Multi-tenant: SIEMPRE filtrar
.eq("store_id", store_id)  // excepto systemAdmin

// Audit obligatorio en mutaciones
await logAudit({ action: "UPDATE", entity_type: "...", ... });

// Zod en el límite: body y query params
const parsed = MiSchema.safeParse(body);
if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
```

## Módulos y cobertura de tests

| Módulo | Tests | Cobertura |
|--------|-------|-----------|
| Auth / Webhook Clerk | I-240 a I-252 | ✅ |
| POS / Ventas | I-34 a I-59 | ✅ |
| NC / Devoluciones | I-100 a I-103, SEC-01 a SEC-03 | ✅ |
| Inventario / Lotes | I-71 a I-75 | ✅ |
| Workers | I-256 a I-262 | ✅ |
| Cron jobs | I-268 a I-276 | ✅ |
| Analytics / Recompras | I-253 a I-255, I-277 a I-278 | ✅ |
| Property invariants | PROP-01 a PROP-03 | ✅ |

## Checklist antes de hacer PR

```bash
npm run build        # sin errores
npm test             # 959/959 (o más)
npm run typecheck    # 0 errores TS
```

Antes de editar: `Read` el archivo. Antes de nueva ruta: agregar schema Zod + `logAudit` + filtro `store_id`.
