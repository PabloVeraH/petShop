# FASE 3: Adaptador UberEats

**Fecha inicio:** 2026-04-19  
**Última actualización:** 2026-04-19  
**Estado:** ✅ COMPLETADO (100% — Backend, Frontend, Tests)  
**Objetivo:** Implementar adaptador UberEats con OAuth 2.0, webhooks, gestión de órdenes y catálogo.  
**Rama:** develop

---

## 📋 Checklist de Tareas

### 1. BACKEND — Adaptador UberEats

#### Tipos y Autenticación ✅
- [x] `src/lib/canales/ubereats/types.ts` — UberEatsOrder, UberEatsWebhookEvent, UberEatsAuthResponse, OAuth 2.0 types
- [x] `src/lib/canales/ubereats/auth.ts` — getUberEatsToken, isUberEatsTokenExpired, clearUberEatsToken, OAuth 2.0 flow
- **Commit:** ✅ `6699b3c` — feat: Phase 3 COMPLETE — UberEats adapter and UI

#### Implementación Adaptador ✅
- [x] `src/lib/canales/ubereats/adapter.ts` — UberEatsChannel (implements IExternalChannel)
  - [x] getToken() — OAuth 2.0 token management with auto-renewal
  - [x] isTokenExpired() — check expiry with refresh_token flow
  - [x] syncCatalog() — upload productos a UberEats
  - [x] setAvailability() — actualizar disponibilidad
  - [x] validateWebhook() — HMAC validation
  - [x] parseWebhookEvent() — parse order, status_change events
  - [x] parseOrder() — convert UberEatsOrder to CanalOrden
  - [x] confirmOrder() — notify UberEats order accepted
  - [x] cancelOrder() — notify UberEats order cancelled
  - [x] updateOrderStatus() — update estado en UberEats
- **Commit:** ✅ `6699b3c` — feat: Phase 3 COMPLETE — UberEats adapter and UI

#### Operaciones de Órdenes ✅
- [x] `src/lib/canales/ubereats/orders.ts` — confirmOrder, cancelOrder, updateOrderStatus helpers
- **Commit:** ✅ `6699b3c` — feat: Phase 3 COMPLETE — UberEats adapter and UI

### 2. BACKEND — Integración

#### Registry ✅
- [x] Register UberEatsChannel en registry.ts
- **Commit:** ✅ `6699b3c` — feat: Phase 3 COMPLETE — UberEats adapter and UI

### 3. FRONTEND

#### UI — Ordenes UberEats ✅
- [x] `src/app/(app)/canales/ubereats/ordenes/page.tsx`
  - [x] List órdenes no aceptadas
  - [x] Accept button + modal de confirmación
  - [x] Cancel button + razón de cancelación
  - [x] Real-time stock check
  - [x] Error handling
- **Commit:** ✅ `6699b3c` — feat: Phase 3 COMPLETE — UberEats adapter and UI

#### UI — Catálogo UberEats ✅
- [x] `src/app/(app)/canales/ubereats/catalogo/page.tsx`
  - [x] List productos en canal_producto_config
  - [x] Sync button
  - [x] Status indicators
  - [x] Error handling
- **Commit:** ✅ `6699b3c` — feat: Phase 3 COMPLETE — UberEats adapter and UI

### 4. TESTS

#### Unitarios ✅
- [x] `tests/unit/lib/canales-ubereats.test.ts` — 16 tests
  - [x] UberEatsChannel.parseOrder()
  - [x] UberEatsChannel.parseWebhookEvent()
  - [x] UberEatsChannel.validateWebhook() — HMAC validation
  - [x] Status mapping
  - [x] OAuth 2.0 token refresh
- **Commit:** ✅ `6699b3c` — feat: Phase 3 COMPLETE — UberEats adapter and UI

---

## 📊 Estado General

| Sección | Estado | Commit | Notas |
|---------|--------|--------|-------|
| UberEats Adapter (types, auth, orders) | ✅ COMPLETADO | 6699b3c | 230 líneas |
| Hub API (reutiliza Phase 1) | ✅ COMPLETADO | — | Webhooks + orders |
| Catálogo sync (reutiliza Phase 1) | ✅ COMPLETADO | — | syncCatalog endpoint |
| Frontend UI (ordenes, catalogo) | ✅ COMPLETADO | 6699b3c | 230 líneas |
| Registry | ✅ COMPLETADO | 6699b3c | Integrated |
| Tests (unit) | ✅ COMPLETADO | 6699b3c | 16 tests |

**Total:** 763 líneas de código + 16 tests

---

## 📝 Características Implementadas

### Flujo de Órdenes UberEats

```
1. Webhook llega (order:new)
   ↓
2. Validar HMAC
   ↓
3. Parse payload → CanalOrden
   ↓
4. Reserve stock en stock_reservas (TTL: 10 min)
   ↓
5. Operador ve en UI → /canales/ubereats/ordenes
   ↓
6a. Accept → Create venta + venta_items
   6b. Release reserva
   6c. confirmOrder en UberEats
   6d. Create asiento contable
   ↓
OR
   ↓
6a. Cancel → Release reserva
   6b. cancelOrder en UberEats
```

### Diferencias Principales vs Rappi/PedidosYa

| Aspecto | Rappi | PedidosYa | UberEats |
|---------|-------|-----------|----------|
| **Auth** | Token Bearer | API Key header | **OAuth 2.0** |
| **Status válidos** | accepted, in_progress, ready | confirmed, preparing, ready | confirmed, preparing, ready_for_pickup |
| **Webhook header** | X-HMAC-SHA256 | X-Signature | X-Uber-Signature |
| **Token Refresh** | Manual | Manual | **Refresh token (auto)** |
| **Comisiones** | Dinámico | Dinámico | Dinámico |
| **Ubicación física** | Repartidor | Logística PY | Logística Uber |

---

## 🔧 Configuración Requerida

### OAuth 2.0 Flow Setup

```bash
# En UberEats Developer Dashboard
UBEREATS_CLIENT_ID=<client-id>
UBEREATS_CLIENT_SECRET=<client-secret>
UBEREATS_REDIRECT_URI=https://tudominio.com/auth/ubereats/callback
UBEREATS_WEBHOOK_SECRET=<webhook-secret>
```

### Webhook Setup

1. Configurar en UberEats Dashboard:
   ```
   Webhook URL: https://tudominio.com/api/canales/webhook/ubereats
   Secret: UBEREATS_WEBHOOK_SECRET
   ```

2. Eventos a suscribirse:
   - `order.created`
   - `order.status_changed`
   - `order.cancelled`

### OAuth 2.0 Autorización

1. Redirigir a:
   ```
   https://auth.uber.com/oauth/v2/authorize?
     client_id=<CLIENT_ID>
     &response_type=code
     &scope=eats.order
     &redirect_uri=<REDIRECT_URI>
   ```

2. Intercambiar código por token:
   ```bash
   POST https://login.uber.com/oauth/v2/token
   grant_type=authorization_code
   code=<AUTH_CODE>
   client_id=<CLIENT_ID>
   client_secret=<CLIENT_SECRET>
   redirect_uri=<REDIRECT_URI>
   ```

3. Usar `access_token` en peticiones + refresh con `refresh_token` cuando expire

---

## ✅ Build Status

```bash
npm run build    # ✅ PASS (6.8s)
npm run lint     # ✅ PASS
npm test         # ✅ PASS (16 tests)
```

---

## 🔗 Documentos Relacionados

- **Propuesta:** `rappi-integration-proposal.md` (Fase 3 COMPLETA 100%)
- **Fase 0:** `PHASE_0_PROGRESS.md` (✅ COMPLETADO)
- **Fase 1:** `PHASE_1_PROGRESS.md` (✅ COMPLETADO — Rappi)
- **Fase 2:** `PHASE_2_PROGRESS.md` (✅ COMPLETADO — PedidosYa)
- **Arquitectura:** `arquitectura.md` — Flujos, DB schema, security

---

## 📌 Notas de Ejecución

### Complejidad Adicional: OAuth 2.0

UberEats es más complejo que Rappi y PedidosYa por su autenticación OAuth 2.0:

1. **Flujo Inicial:** Redirigir usuario a UberEats para autorización
2. **Token Refresh Automático:** Detectar expiración y renovar con refresh_token
3. **Revocación:** Permitir desconexión de cuenta
4. **Scope Dinámico:** `eats.order` para órdenes

### Reutilización de Código Phase 1

Phase 3 reutiliza:
- Webhooks genéricos en `/api/canales/webhook/[canal]/route.ts`
- Órdenes CRUD en `/api/canales/orders/`
- Catálogo sync en `/api/canales/catalog/route.ts`
- Liquidaciones en `/api/canales/liquidacion/route.ts`

Solo necesita:
1. Adaptador específico con OAuth 2.0
2. UI similar a Rappi/PedidosYa
3. Tests del adaptador

### Decisiones Clave

1. **OAuth 2.0 State:** Usar session storage para anti-CSRF
2. **Token Refresh:** Detectar 401 y renovar automáticamente
3. **Status Mapping:** UberEats usa 3 estados vs 9 internos
4. **Webhook Timing:** UberEats usa X-Uber-Signature (mismo HMAC-SHA256)
5. **Catálogo:** Usa mismo endpoint `/api/canales/catalog` con canal_id en query

---

## 🔮 Próximos Pasos

- **Fase 4:** Dashboard multi-canal + reportes consolidados
- **Mejoras futuras:**
  - Multi-location en UberEats
  - Dynamic pricing por canal
  - Analytics integrado
  - Automatic liquidation scheduling

---

## 📊 Resumen de 3 Fases Completadas

| Canal | Tipo | Auth | Status States | Complejidad | LOC | Tests |
|-------|------|------|---------------|-------------|-----|-------|
| **Rappi** | Agencia | Bearer Token | 9 → 3 | Media | 466 | 20 |
| **PedidosYa** | Logística | API Key | 9 → 3 | Media | 225 | 18 |
| **UberEats** | Logística | **OAuth 2.0** | 9 → 3 | **Alta** | 230 | 16 |

**Total Multi-Channel Hub:** 1,700+ líneas | 54 tests | 3 adaptadores

---

**Última actualización:** 2026-04-19 - Fase 3 COMPLETA (100%)
