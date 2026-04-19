# FASE 1: Hub de Canales Externos + Adaptador Rappi

**Fecha inicio:** 2026-04-18  
**Última actualización:** 2026-04-19  
**Estado:** ✅ COMPLETADO (100% — Backend, Frontend, Tests)  
**Objetivo:** Implementar adaptador Rappi con webhook, gestión de órdenes, catálogo y liquidaciones.  
**Ramas:** develop

---

## 📋 Checklist de Tareas

### 1. BACKEND — Adaptador Rappi

#### Tipos y Autenticación ✅
- [x] `src/lib/canales/rappi/types.ts` — RappiOrder, RappiWebhookEvent, RappiAuthResponse
- [x] `src/lib/canales/rappi/auth.ts` — getRappiToken, isRappiTokenExpired, clearRappiToken, auto-renewal
- **Commit:** ✅ `ce1d3ab` — feat: Phase 1 — Rappi adapter and webhook handlers

#### Implementación Adaptador ✅
- [x] `src/lib/canales/rappi/adapter.ts` — RappiChannel (implements IExternalChannel)
  - [x] getToken() — token management with auto-renewal
  - [x] isTokenExpired() — check expiry
  - [x] syncCatalog() — upload productos a Rappi
  - [x] setAvailability() — actualizar disponibilidad
  - [x] validateWebhook() — HMAC-SHA256 validation
  - [x] parseWebhookEvent() — parse order, ping, status_change events
  - [x] parseOrder() — convert RappiOrder to CanalOrden
  - [x] confirmOrder() — notify Rappi order accepted
  - [x] rejectOrder() — notify Rappi order rejected
  - [x] updateOrderStatus() — update estado en Rappi
- **Commit:** ✅ `ce1d3ab` — feat: Phase 1 — Rappi adapter and webhook handlers

#### Operaciones de Órdenes ✅
- [x] `src/lib/canales/rappi/orders.ts` — confirmOrder, rejectOrder, updateOrderStatus helpers
- **Commit:** ✅ `ce1d3ab` — feat: Phase 1 — Rappi adapter and webhook handlers

#### Gestión de Catálogo ✅
- [x] `src/lib/canales/rappi/catalog.ts` — syncCatalog helper
- **Commit:** ✅ `77804b2` — feat: Phase 1 COMPLETE — Rappi adapter, orders, catalog, liquidacion, UI

### 2. BACKEND — APIs Hub

#### Webhook ✅
- [x] `src/app/api/canales/webhook/[canal]/route.ts` — POST endpoint
  - [x] HMAC-SHA256 validation
  - [x] Event type parsing (order, ping, status_change, cancellation)
  - [x] Stock reservation on "pending" orders
  - [x] Idempotency tracking
- **Commit:** ✅ `ce1d3ab` — feat: Phase 1 — Rappi adapter and webhook handlers

#### Órdenes CRUD ✅
- [x] `src/app/api/canales/orders/route.ts` — GET/POST
  - [x] GET — list todas las órdenes no aceptadas
  - [x] POST — manual order creation (fallback)
- [x] `src/app/api/canales/orders/[id]/accept/route.ts` — POST
  - [x] Fetch canal order
  - [x] Create venta + venta_items
  - [x] Release stock reservation
  - [x] Confirm order en Rappi
  - [x] Audit logging
- [x] `src/app/api/canales/orders/[id]/reject/route.ts` — POST
  - [x] Release stock reservation
  - [x] Reject order en Rappi
  - [x] Audit logging
- **Commit:** ✅ `77804b2` — feat: Phase 1 COMPLETE

#### Catálogo Sync ✅
- [x] `src/app/api/canales/catalog/route.ts` — POST
  - [x] Get all productos + canal_producto_config
  - [x] Call channel.syncCatalog()
  - [x] Audit logging
- **Commit:** ✅ `77804b2` — feat: Phase 1 COMPLETE

#### Liquidaciones CRUD ✅
- [x] `src/app/api/canales/liquidacion/route.ts` — GET/POST/PATCH
  - [x] GET — list liquidaciones with filters (fecha, estado)
  - [x] POST — create liquidacion from órdenes aceptadas
  - [x] PATCH — update estado (pendiente → pagada)
  - [x] Auto-generate asientos contables por liquidacion
- **Commit:** ✅ `77804b2` — feat: Phase 1 COMPLETE

### 3. BACKEND — Integración

#### Registry ✅
- [x] Register RappiChannel en registry.ts
- **Commit:** ✅ `77804b2` — feat: Phase 1 COMPLETE

### 4. FRONTEND

#### UI — Ordenes Rappi ✅
- [x] `src/app/(app)/canales/rappi/ordenes/page.tsx`
  - [x] List órdenes no aceptadas
  - [x] Accept button + modal de confirmación
  - [x] Reject button + razón de rechazo
  - [x] Real-time stock check
  - [x] Error handling
- **Commit:** ✅ `77804b2` — feat: Phase 1 COMPLETE

#### UI — Catálogo Rappi ✅
- [x] `src/app/(app)/canales/rappi/catalogo/page.tsx`
  - [x] List productos en canal_producto_config
  - [x] Sync button
  - [x] Status indicators
  - [x] Error handling
- **Commit:** ✅ `77804b2` — feat: Phase 1 COMPLETE

### 5. TESTS

#### Unitarios ✅
- [x] `tests/unit/lib/canales-rappi.test.ts` — 20 tests
  - [x] RappiChannel.parseOrder()
  - [x] RappiChannel.parseWebhookEvent()
  - [x] RappiChannel.validateWebhook() — HMAC validation
  - [x] Status mapping
  - [x] Token expiry check
- **Commit:** ✅ `ce1d3ab` — feat: Phase 1 — Rappi adapter and webhook handlers

#### Integración ✅
- [x] `tests/integration/api/canales-webhook-idempotency.test.ts` — 6 tests
  - [x] Webhook idempotency — same order twice
  - [x] Stock reservation + release
  - [x] Order status transitions
  - [x] Error cases
- **Commit:** ✅ `77804b2` — feat: Phase 1 COMPLETE

---

## 📊 Estado General

| Sección | Estado | Commit | Notas |
|---------|--------|--------|-------|
| Rappi Adapter (types, auth, orders) | ✅ COMPLETADO | ce1d3ab | 377 líneas |
| Webhook + validación HMAC | ✅ COMPLETADO | ce1d3ab | 116 líneas |
| Hub API (orders, catalog, liquidacion) | ✅ COMPLETADO | 77804b2 | 413 líneas |
| Catálogo sync | ✅ COMPLETADO | 77804b2 | 76 líneas |
| Frontend UI (ordenes, catalogo) | ✅ COMPLETADO | 77804b2 | 287 líneas |
| Registry | ✅ COMPLETADO | 77804b2 | Integrated |
| Tests (unit + integration) | ✅ COMPLETADO | ce1d3ab + 77804b2 | 26 tests |

**Total:** 1771 líneas de código + 26 tests

---

## 📝 Características Implementadas

### Flujo de Órdenes Rappi

```
1. Webhook llega (order:new)
   ↓
2. Validar HMAC-SHA256
   ↓
3. Parse payload → CanalOrden
   ↓
4. Reserve stock en stock_reservas (TTL: 10 min)
   ↓
5. Operador ve en UI → /canales/rappi/ordenes
   ↓
6a. Accept → Create venta + venta_items
   6b. Release reserva
   6c. confirmOrder en Rappi
   6d. Create asiento contable
   ↓
OR
   ↓
6a. Reject → Release reserva
   6b. rejectOrder en Rappi
```

### Gestión de Catálogo

```
1. Click "Sincronizar Catálogo" en UI
   ↓
2. GET /api/canales/catalog
   ↓
3. Fetch productos + precios de canal_producto_config
   ↓
4. Call channel.syncCatalog() → Upload a Rappi API
   ↓
5. Log audit trail
```

### Liquidaciones

```
1. Listar órdenes aceptadas no liquidadas
   ↓
2. Agrupar por período (diario/semanal/custom)
   ↓
3. Calcular total + comisiones
   ↓
4. Create liquidacion (estado: pendiente)
   ↓
5. Auto-generate asientos contables:
   - Débito: CXC por Rappi (110401)
   - Crédito: Comisión (510101)
   ↓
6. Mark como pagada cuando Rappi confirma pago
```

---

## 🔧 Configuración Requerida

### Environment Variables

```bash
RAPPI_API_KEY=<api-key>
RAPPI_API_SECRET=<api-secret>
RAPPI_WEBHOOK_SECRET=<webhook-secret>
```

### Base de Datos

Usa las tablas creadas en Fase 0:
- `canal_ordenes`
- `stock_reservas`
- `canal_liquidaciones`
- `journal_entries` (contabilidad)

### Webhook Setup

1. Configurar en Rappi Dashboard:
   ```
   Webhook URL: https://tudominio.com/api/canales/webhook/rappi
   Secret: RAPPI_WEBHOOK_SECRET
   ```

2. Eventos a suscribirse:
   - `order:new`
   - `order:status_changed`
   - `order:cancelled`

---

## ✅ Build Status

```bash
npm run build    # ✅ PASS (6.0s)
npm run lint     # ✅ PASS
npm test         # ✅ PASS (26 tests)
```

---

## 🔗 Documentos Relacionados

- **Propuesta:** `/home/pablete/Documentos/Bobeda Obsidian/Obsidian/proyectos/petShop/rappi-integration-proposal.md` (Fase 1 COMPLETA 100%)
- **Fase 0:** `PHASE_0_PROGRESS.md` (✅ COMPLETADO)
- **Arquitectura:** `arquitectura.md` — Flujos, DB schema, security

---

## 📌 Notas de Ejecución

### Decisiones Clave

1. **Webhook Idempotency:** Usando `external_order_id` como deduplicador en `canal_ordenes`
2. **Stock Reservation TTL:** 10 minutos (configurable en RESERVATION_TTL_MINUTES)
3. **Status Mapping:** Rappi → Internal estados normalizados
4. **Audit Trail:** Todos los accept/reject loguean en audit_logs
5. **Liquidaciones Manual:** Operador crea liquidación cuando Rappi paga (no automático)

### Próximos Pasos

- **Fase 2:** Adaptador PedidosYa (mismo patrón que Rappi)
- **Fase 3:** Adaptador UberEats (OAuth 2.0)
- **Fase 4:** Dashboard multi-canal + reportes

---

**Última actualización:** 2026-04-19 - Fase 1 COMPLETA (100%)
