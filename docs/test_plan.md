# Plan de Pruebas — PetShop App

**Versión:** 1.0
**Fecha:** 2026-03-31
**Rama base:** develop

---

## 1. Alcance

Este plan cubre las pruebas de todos los endpoints de la API, utilidades de librería y flujos de integración del sistema PetShop. El frontend (componentes React) queda fuera del alcance de este plan y se cubre con pruebas E2E separadas (Playwright).

---

## 2. Stack de pruebas recomendado

| Capa | Herramienta |
|------|-------------|
| Unit tests (lib/) | Jest + ts-jest |
| Integration tests (API routes) | Jest + `next/test-utils` o `supertest` con servidor local |
| E2E (flujos completos UI) | Playwright |
| Fixtures de DB | Supabase local (`supabase start`) o DB de test aislada |
| Coverage | Jest `--coverage` (objetivo mínimo: 80 %) |

---

## 3. Convenciones

- Archivos de test en `tests/` siguiendo el espejo de `src/`
- Nombre: `<módulo>.test.ts`
- Un `describe` por módulo, un `it` por caso
- Mocks de Supabase con `jest.mock` (London School TDD)
- Variables de entorno de test en `.env.test`

---

## 4. Pruebas de utilidades (Unit)

### 4.1 `lib/validation.ts`

| # | Caso | Resultado esperado | Estado |
|---|------|--------------------|--------|
| U-01 | `validateRUT("11.111.111-1")` | `true` | ✅ |
| U-02 | `validateRUT("12.345.678-9")` | `false` (DV incorrecto) | ✅ |
| U-03 | `validateRUT("")` | `false` | ✅ |
| U-04 | `validateRUT("1-9")` | `false` (muy corto) | ✅ |
| U-05 | `formatRUT("11111111-1")` | `"11.111.111-1"` | ✅ |
| U-06 | `formatRUT("11.111.111-1")` | `"11.111.111-1"` (idempotente) | ✅ |
| U-07 | Schema `ClienteCreateSchema` acepta datos válidos | parse exitoso | ✅ |
| U-08 | Schema `ClienteCreateSchema` rechaza RUT inválido | ZodError | ✅ |
| U-09 | Schema `MascotaCreateSchema` acepta datos mínimos | parse exitoso | ✅ |

### 4.2 `lib/whatsapp.ts`

| # | Caso | Resultado esperado | Estado |
|---|------|--------------------|--------|
| U-10 | `normalizeChileanPhone("9 1234 5678")` | `"56912345678"` | ✅ |
| U-11 | `normalizeChileanPhone("+56912345678")` | `"56912345678"` | ✅ |
| U-12 | `normalizeChileanPhone("12345")` | `null` (formato inválido) | ✅ |
| U-13 | `buildReceiptMessage(...)` contiene número de comprobante | string incluye comprobante | ✅ |
| U-14 | `buildConsumoAlertMessage(...)` contiene nombre producto | string incluye producto | ✅ |

### 4.3 `lib/hub-sync.ts`

| # | Caso | Resultado esperado | Estado |
|---|------|--------------------|--------|
| U-15 | Sin `HUB_URL` configurado → `syncProductsToHub` no hace fetch | `fetch` no llamado | ✅ |
| U-16 | Con `HUB_URL` → `syncProductsToHub` hace POST a `/api/sync/catalog` | fetch llamado con URL correcta | ✅ |
| U-17 | Error de red en fetch → no lanza excepción (fire-and-forget) | no throw | ✅ |
| U-18 | `syncPurchaseToHub` envía RUT y monto correctos en body | body JSON correcto | ✅ |

---

## 5. Pruebas de API (Integration)

> Cada prueba mockeará `getStoreId()` devolviendo `{ storeId: "store-uuid-test" }` y el cliente Supabase.

### 5.1 `GET /api/health`

| # | Caso | Status | Body |
|---|------|--------|------|
| I-01 | Request sin auth | 200 | `{ status: "ok" }` |

### 5.2 Clientes — `GET /api/clientes`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-02 | Sin autenticación | 401 | — |
| I-03 | Lista paginada (sin search) | 200 | Array + count |
| I-04 | `?search=juan` filtra por nombre | 200 | Solo coincidencias |
| I-05 | `?rut=11111111-1` devuelve único | 200 | Single object |
| I-06 | `?rut=` de otro store | 200 | `null` (aislamiento) |

### 5.3 Clientes — `POST /api/clientes`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-07 | RUT inválido | 400 | `{ error: "RUT inválido" }` |
| I-08 | Nombre < 3 chars | 400 | — |
| I-09 | RUT duplicado en mismo store | 409 | — |
| I-10 | Datos válidos | 201 | Devuelve cliente creado |
| I-11 | POST válido crea registro en `fidelizacion` | 201 | fidelizacion.insert llamado |

### 5.4 Clientes — `GET /api/clientes/[id]`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-12 | ID de otro store | 404 | Aislamiento multi-tenant |
| I-13 | ID válido | 200 | Incluye mascotas y últimas ventas |

### 5.5 Clientes — `PATCH /api/clientes/[id]`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-14 | Actualizar email válido | 200 | Campo actualizado |
| I-15 | ID de otro store | 404 | Aislamiento |

### 5.6 Productos — `GET /api/productos`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-16 | Lista productos activos con stock | 200 | Solo activo=true, stock>0 |
| I-17 | `?search=royal` filtra | 200 | — |

### 5.7 Productos — `POST /api/productos`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-18 | Nombre faltante | 400 | — |
| I-19 | SKU duplicado | 409 | — |
| I-20 | Precio ≤ 0 | 400 | — |
| I-21 | Datos válidos | 201 | SKU en mayúsculas |
| I-22 | POST válido llama `syncProductsToHub` | 201 | hub-sync invocado |

### 5.8 Productos — `PATCH /api/productos/[id]`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-23 | Nombre vacío | 400 | — |
| I-24 | Producto de otro store | 404/0 rows | Aislamiento |
| I-25 | Precio válido actualizado | 200 | Llama hub-sync |

### 5.9 Productos — `DELETE /api/productos/[id]`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-26 | Soft delete → activo=false | 204 | No elimina fila |
| I-27 | Producto de otro store → no afecta | 204 | stock_movements intacto |
| I-28 | Llama `syncProductsToHub` con activo=false | 204 | Hub actualizado |

### 5.10 Mascotas — `GET /api/mascotas`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-29 | Sin `clienteId` | 400 | — |
| I-30 | Cliente de otro store | 404 | Aislamiento |
| I-31 | Cliente válido | 200 | Lista mascotas |

### 5.11 Mascotas — `POST /api/mascotas`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-32 | clienteId de otro store | 403/404 | Aislamiento |
| I-33 | Datos válidos mínimos | 201 | — |

### 5.12 Ventas — `POST /api/ventas`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-34 | Sin items | 400 | — |
| I-35 | metodoPago inválido | 400 | — |
| I-36 | descuentoPct fuera de [0,100] | 400 | — |
| I-37 | cantidad no entero positivo | 400 | — |
| I-38 | Producto de otro store en items | 400 | Validación ownership |
| I-39 | Precio tomado de DB (no del body) | 201 | precioMap correcto |
| I-40 | Venta exitosa decrementa stock | 201 | `decrement_stock` RPC llamado |
| I-41 | Venta exitosa crea `venta_items` | 201 | Filas en venta_items |
| I-42 | Venta con cliente actualiza fidelización | 201 | fidelizacion.upsert llamado |
| I-43 | Venta con cliente + RUT llama `syncPurchaseToHub` | 201 | hub-sync invocado |
| I-44 | WhatsApp deshabilitado → no envía mensaje | 201 | sendWhatsAppText no llamado |
| I-45 | WhatsApp habilitado + teléfono válido → envía | 201 | sendWhatsAppText llamado |
| I-46 | Mascota con consumo_config → crea consumo_alerta | 201 | consumo_alertas.upsert llamado |

### 5.13 Ventas — `PATCH /api/ventas/[id]` (anulación)

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-47 | action != "anular" | 400 | — |
| I-48 | Venta de otro store | 404 | Aislamiento |
| I-49 | Anulación exitosa revierte stock | 200 | stock_movements con tipo=entrada |

### 5.14 Inventario — `PATCH /api/inventario/[id]`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-50 | tipo inválido | 400 | Solo "entrada"/"salida" |
| I-51 | cantidad no entero positivo | 400 | — |
| I-52 | Producto de otro store | 404 | Aislamiento |
| I-53 | Entrada aumenta stock correctamente | 200 | nuevoStock = actual + cantidad |
| I-54 | Salida no baja de 0 (Math.max) | 200 | stock >= 0 |
| I-55 | Ajuste crea `stock_movements` | 200 | insert llamado |
| I-56 | Ajuste llama `syncProductsToHub` | 200 | hub-sync invocado |

### 5.15 Consumo-Configs

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-57 | GET sin mascotaId | 400 | — |
| I-58 | GET mascota de otro store | 403 | Verificación ownership chain |
| I-59 | POST válido hace upsert | 200/201 | — |
| I-60 | DELETE sin id | 400 | — |
| I-61 | DELETE config de otro store | 403 | Ownership verificado |

### 5.16 Proveedores

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-62 | GET lista con search | 200 | — |
| I-63 | POST sin nombre | 400 | — |
| I-64 | DELETE sin id | 400 | — |
| I-65 | DELETE de otro store | 404 | Aislamiento |

### 5.17 Órdenes de Compra — `POST /api/ordenes-compra`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-66 | Sin items | 400 | — |
| I-67 | Proveedor de otro store | 400 | — |
| I-68 | Datos válidos | 201 | Número OC generado |
| I-69 | Subtotal/impuesto/total calculados server-side | 201 | No confiar en cliente |

### 5.18 Órdenes de Compra — `PATCH /api/ordenes-compra/[id]`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-70 | estado inválido | 400 | Enum validado |
| I-71 | OC de otro store | 404 | Aislamiento |
| I-72 | action="recibir" incrementa stock productos | 200 | stock_movements creado |
| I-73 | action="recibir" crea cuenta_pagar | 200 | cuentas_pagar.insert llamado |

### 5.19 Vendedores

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-74 | GET incluye ventas_mes del mes actual | 200 | — |
| I-75 | POST con RUT inválido | 400 | — |
| I-76 | DELETE de otro store | 404 | Aislamiento |

### 5.20 Dashboard

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-77 | GET devuelve KPIs del store autenticado | 200 | ventasHoy, ticketPromedio, etc. |
| I-78 | `GET /api/dashboard/stock-alertas` devuelve top 10 | 200 | Solo stock <= stock_minimo |

### 5.21 Reports

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-79 | GET sin params usa últimos 30 días | 200 | — |
| I-80 | `?periodo=7` filtra correctamente | 200 | — |
| I-81 | `GET /api/reports/export?tipo=ventas` devuelve CSV | 200 | Content-Type: text/csv |
| I-82 | CSV no contiene datos de otro store | 200 | Aislamiento |
| I-83 | Campos CSV con comas escapados con comillas | 200 | RFC 4180 |

### 5.22 Cuentas-Pagar — `PATCH /api/cuentas-pagar`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-84 | estado inválido | 400 | Enum validado |
| I-85 | Cuenta de otro store | 404 | Aislamiento |
| I-86 | Estado válido actualizado | 200 | — |

### 5.23 Settings

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-87 | GET enmascara `whatsapp_access_token` | 200 | Token no visible en respuesta |
| I-88 | PATCH con campo no permitido ignorado | 200 | Mass assignment prevenido |
| I-89 | PATCH placeholder de token no actualiza DB | 200 | Token anterior preservado |

### 5.24 Onboarding — `POST /api/onboarding/complete`

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-90 | Usuario ya tiene store → error | 400 | Previene múltiples stores |
| I-91 | Primera vez → crea store y actualiza Clerk | 200 | — |

### 5.25 Admin

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-92 | `GET /api/admin/stores` sin rol systemAdmin | 403 | — |
| I-93 | `GET /api/admin/stores` con systemAdmin | 200 | Lista todas las stores |
| I-94 | `POST /api/admin/users` con rol inválido | 400 | Solo storeAdmin/storeWorker |
| I-95 | `POST /api/admin/users` asigna correctamente | 200 | Clerk metadata actualizado |

### 5.26 WhatsApp Webhook

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-96 | GET con `hub.verify_token` correcto | 200 | Devuelve hub.challenge |
| I-97 | GET con token incorrecto | 403 | — |
| I-98 | POST sin firma HMAC | 401 | — |
| I-99 | POST con firma HMAC válida | 200 | Siempre 200 (no bloquear Meta) |
| I-100 | POST no loguea datos del usuario | — | Verificar ausencia de console.log con PII |

### 5.27 WhatsApp send-alerts

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-101 | Alertas pendientes → envía y marca enviado=true | 200 | — |
| I-102 | Sin alertas pendientes | 200 | `{ enviados: 0 }` |
| I-103 | Teléfono inválido → no envía pero continúa | 200 | No rompe el loop |

### 5.28 Clerk Webhook

| # | Caso | Status | Notas |
|---|------|--------|-------|
| I-104 | Firma Svix inválida | 400 | — |
| I-105 | `user.created` → upsert en clerk_users | 200 | — |
| I-106 | `user.deleted` → elimina de clerk_users | 200 | — |

---

## 6. Pruebas de seguridad

| # | Caso | Resultado esperado |
|---|------|--------------------|
| S-01 | Cualquier endpoint autenticado sin token → 401 | Bloqueado |
| S-02 | Token de store A accediendo datos de store B | 404 o array vacío |
| S-03 | `PATCH /api/settings` con `{ "store_id": "otro-id" }` | Campo ignorado |
| S-04 | `POST /api/ventas` con precio en body | Precio de DB usado, body ignorado |
| S-05 | `GET /api/clientes?search=a%25b` (SQLi attempt) | Sanitizado, no error 500 |
| S-06 | `POST /api/onboarding/complete` dos veces mismo user | Segunda llamada rechazada |
| S-07 | `GET /api/reports/export` sin autenticación | 401 |
| S-08 | `POST /api/whatsapp/webhook` con cuerpo manipulado | 401 por firma inválida |

---

## 7. Pruebas de integración hub-sync

| # | Caso | Resultado esperado |
|---|------|--------------------|
| H-01 | `POST /api/productos` → hub recibe producto en catalog | catalog_index del hub actualizado |
| H-02 | `PATCH /api/inventario/[id]` → hub refleja nuevo stock | stock en hub actualizado |
| H-03 | `DELETE /api/productos/[id]` → hub marca activo=false | producto inactivo en hub |
| H-04 | `POST /api/ventas` con cliente con RUT → hub registra compra | customer_store_history incrementado |
| H-05 | Hub inaccesible (HUB_URL caído) → venta igual se crea | No falla la venta, solo log de error |

---

## 8. Pruebas E2E (Playwright)

| # | Flujo | Pasos clave |
|---|-------|-------------|
| E-01 | Onboarding completo | Registro → completar onboarding → redirige a /dashboard |
| E-02 | POS: venta simple | Buscar producto → agregar al carrito → pagar → comprobante generado |
| E-03 | POS: venta con cliente | Buscar cliente por RUT → venta → fidelización actualizada |
| E-04 | Crear cliente + mascota | Formulario cliente → agregar mascota → configurar consumo |
| E-05 | Crear orden de compra | Seleccionar proveedor → agregar ítems → confirmar → OC generada |
| E-06 | Recibir orden de compra | OC pendiente → marcar recibida → stock incrementado en inventario |
| E-07 | Ajuste manual de stock | Inventario → entrada de stock → verificar nuevo total |
| E-08 | Exportar CSV ventas | Reports → exportar → archivo descargado con datos correctos |
| E-09 | Configurar WhatsApp | Settings → activar WhatsApp → guardar → estado persistido |
| E-10 | Admin asigna usuario | Admin panel → buscar email → asignar a store → rol aplicado |

---

## 9. Priorización

| Prioridad | Tests |
|-----------|-------|
| **P0 — Crítico** | I-34 a I-46 (ventas), S-01 a S-08 (seguridad), I-07 a I-11 (clientes) |
| **P1 — Alto** | I-50 a I-56 (inventario), H-01 a H-05 (hub-sync), E-01 a E-03 (E2E core) |
| **P2 — Medio** | I-62 a I-73 (proveedores/OC), I-96 a I-103 (WhatsApp), U-01 a U-18 (unit) |
| **P3 — Bajo** | I-77 a I-83 (dashboard/reports), E-04 a E-10 (E2E secundarios) |

---

## 10. Configuración del entorno de pruebas

```bash
# Instalar dependencias de test
npm install -D jest ts-jest @types/jest jest-environment-node

# Levantar Supabase local (opcional, para integration tests reales)
npx supabase start

# Correr unit tests
npm test

# Correr con coverage
npm test -- --coverage

# Correr solo integration
npm test -- --testPathPattern=tests/integration
```

**`.env.test` mínimo:**
```env
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=test-service-role-key
JWT_SECRET=test-secret-32-chars-minimum-here
HUB_URL=http://localhost:3001
HUB_SYNC_SECRET=test-sync-secret
```

---

## 11. Métricas de éxito

| Métrica | Objetivo |
|---------|----------|
| Coverage total | ≥ 80 % |
| Coverage `lib/` | ≥ 95 % |
| Coverage rutas P0 | 100 % |
| Tests fallando en CI | 0 |
| Tiempo suite completa | < 3 min |
