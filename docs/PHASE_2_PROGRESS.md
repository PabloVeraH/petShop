# FASE 2: Adaptador PedidosYa

**Fecha inicio:** 2026-04-19  
**Última actualización:** 2026-04-19  
**Estado:** ✅ COMPLETADO (100% — Backend, Frontend, Tests)  
**Objetivo:** Implementar adaptador PedidosYa con webhooks, gestión de órdenes y catálogo.  
**Rama:** develop

---

## 📋 Checklist de Tareas

### 1. BACKEND — Adaptador PedidosYa

#### Tipos y Autenticación ✅
- [x] `src/lib/canales/pedidosya/types.ts` — PedidosYaOrder, PedidosYaWebhookEvent, PedidosYaAuthResponse
- [x] `src/lib/canales/pedidosya/auth.ts` — getPedidosYaToken, isPedidosYaTokenExpired, clearPedidosYaToken, auto-renewal
- **Commit:** ✅ `7453978` — feat: Phase 2 COMPLETE — PedidosYa adapter and UI

#### Implementación Adaptador ✅
- [x] `src/lib/canales/pedidosya/adapter.ts` — PedidosYaChannel (implements IExternalChannel)
  - [x] getToken() — token management with auto-renewal
  - [x] isTokenExpired() — check expiry
  - [x] syncCatalog() — upload productos a PedidosYa
  - [x] setAvailability() — actualizar disponibilidad
  - [x] validateWebhook() — HMAC validation
  - [x] parseWebhookEvent() — parse order, status_change events
  - [x] parseOrder() — convert PedidosYaOrder to CanalOrden
  - [x] confirmOrder() — notify PedidosYa order accepted
  - [x] rejectOrder() — notify PedidosYa order rejected
  - [x] updateOrderStatus() — update estado en PedidosYa
- **Commit:** ✅ `7453978` — feat: Phase 2 COMPLETE — PedidosYa adapter and UI

#### Operaciones de Órdenes ✅
- [x] `src/lib/canales/pedidosya/orders.ts` — confirmOrder, rejectOrder, updateOrderStatus helpers
- **Commit:** ✅ `7453978` — feat: Phase 2 COMPLETE — PedidosYa adapter and UI

### 2. BACKEND — Integración

#### Registry ✅
- [x] Register PedidosYaChannel en registry.ts
- **Commit:** ✅ `7453978` — feat: Phase 2 COMPLETE — PedidosYa adapter and UI

### 3. FRONTEND

#### UI — Ordenes PedidosYa ✅
- [x] `src/app/(app)/canales/pedidosya/ordenes/page.tsx`
  - [x] List órdenes no aceptadas
  - [x] Accept button + modal de confirmación
  - [x] Reject button + razón de rechazo
  - [x] Real-time stock check
  - [x] Error handling
- **Commit:** ✅ `7453978` — feat: Phase 2 COMPLETE — PedidosYa adapter and UI

#### UI — Catálogo PedidosYa ✅
- [x] `src/app/(app)/canales/pedidosya/catalogo/page.tsx`
  - [x] List productos en canal_producto_config
  - [x] Sync button
  - [x] Status indicators
  - [x] Error handling
- **Commit:** ✅ `7453978` — feat: Phase 2 COMPLETE — PedidosYa adapter and UI

### 4. TESTS

#### Unitarios ✅
- [x] `tests/unit/lib/canales-pedidosya.test.ts` — 18 tests
  - [x] PedidosYaChannel.parseOrder()
  - [x] PedidosYaChannel.parseWebhookEvent()
  - [x] PedidosYaChannel.validateWebhook() — HMAC validation
  - [x] Status mapping
  - [x] Token expiry check
- **Commit:** ✅ `7453978` — feat: Phase 2 COMPLETE — PedidosYa adapter and UI

---

## 📊 Estado General

| Sección | Estado | Commit | Notas |
|---------|--------|--------|-------|
| PedidosYa Adapter (types, auth, orders) | ✅ COMPLETADO | 7453978 | 225 líneas |
| Hub API (reutiliza Phase 1) | ✅ COMPLETADO | — | Webhooks + orders |
| Catálogo sync (reutiliza Phase 1) | ✅ COMPLETADO | — | syncCatalog endpoint |
| Frontend UI (ordenes, catalogo) | ✅ COMPLETADO | 7453978 | 230 líneas |
| Registry | ✅ COMPLETADO | 7453978 | Integrated |
| Tests (unit) | ✅ COMPLETADO | 7453978 | 18 tests |

**Total:** 768 líneas de código + 18 tests

---

## 📝 Características Implementadas

### Flujo de Órdenes PedidosYa (Identical to Rappi)

```
1. Webhook llega (order:new)
   ↓
2. Validar HMAC
   ↓
3. Parse payload → CanalOrden
   ↓
4. Reserve stock en stock_reservas (TTL: 10 min)
   ↓
5. Operador ve en UI → /canales/pedidosya/ordenes
   ↓
6a. Accept → Create venta + venta_items
   6b. Release reserva
   6c. confirmOrder en PedidosYa
   6d. Create asiento contable
   ↓
OR
   ↓
6a. Reject → Release reserva
   6b. rejectOrder en PedidosYa
```

### Diferencias con Rappi

| Aspecto | Rappi | PedidosYa |
|---------|-------|-----------|
| **Auth** | Token Bearer | API Key header |
| **Status válidos** | accepted, in_progress, ready | confirmed, preparing, ready |
| **Webhook header** | X-HMAC-SHA256 | X-Signature |
| **Desempadronamiento** | Implementado | Implementado |
| **Ubicación física** | Repartidor | Logística PedidosYa |

---

## 🔧 Configuración Requerida

### Environment Variables

```bash
PEDIDOSYA_API_KEY=<api-key>
PEDIDOSYA_WEBHOOK_SECRET=<webhook-secret>
```

### Webhook Setup

1. Configurar en PedidosYa Dashboard:
   ```
   Webhook URL: https://tudominio.com/api/canales/webhook/pedidosya
   Secret: PEDIDOSYA_WEBHOOK_SECRET
   ```

2. Eventos a suscribirse:
   - `order:new`
   - `order:status_changed`
   - `order:cancelled`

---

## ✅ Build Status

```bash
npm run build    # ✅ PASS (6.5s)
npm run lint     # ✅ PASS
npm test         # ✅ PASS (18 tests)
```

---

## 🔗 Documentos Relacionados

- **Propuesta:** `rappi-integration-proposal.md` (Fase 2 COMPLETA 100%)
- **Fase 0:** `PHASE_0_PROGRESS.md` (✅ COMPLETADO)
- **Fase 1:** `PHASE_1_PROGRESS.md` (✅ COMPLETADO — Rappi)
- **Arquitectura:** `arquitectura.md` — Flujos, DB schema, security

---

## 📌 Notas de Ejecución

### Reutilización de Código Fase 1

Phase 2 reutiliza la mayoría de la infraestructura de Phase 1:
- Webhooks genéricos en `/api/canales/webhook/[canal]/route.ts`
- Órdenes CRUD en `/api/canales/orders/`
- Catálogo sync en `/api/canales/catalog/route.ts`
- Liquidaciones en `/api/canales/liquidacion/route.ts`

Solo necesita:
1. Implementar adapter específico para PedidosYa
2. Crear UI similar a Rappi (reutilizar componentes base)
3. Tests del adapter

### Decisiones Clave

1. **Status Mapping:** PedidosYa usa 3 estados vs 9 internos — mappeo a estados válidos
2. **API Key vs Token:** PedidosYa usa API Key simple en header vs Bearer token de Rappi
3. **Webhook Validation:** HMAC igual que Rappi pero con header diferente
4. **Catálogo:** Usa mismo endpoint `/api/canales/catalog` con canal_id en query

### Próximos Pasos

- **Fase 3:** Adaptador UberEats (OAuth 2.0, más complejo)
- **Fase 4:** Dashboard multi-canal + reportes consolidados

---

**Última actualización:** 2026-04-19 - Fase 2 COMPLETA (100%)
