# Spec Registry — petShop

Mapa de IDs de test → requisito de negocio. Cada test debe poder trazarse a exactamente un requisito.

---

## Clientes (I-01 a I-15)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-01 | Crear cliente requiere RUT válido | POST /api/clientes | integration |
| I-02 | Crear cliente con RUT duplicado retorna 409 | POST /api/clientes | integration |
| I-03 | GET clientes filtra por store_id (multi-tenant) | GET /api/clientes | integration |
| I-04 | GET cliente por ID retorna 404 si no existe | GET /api/clientes/[id] | integration |
| I-05 | PATCH cliente no modifica campos no enviados | PATCH /api/clientes/[id] | integration |

## Mascotas (I-06 a I-10)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-06 | Crear mascota asocia al cliente correcto | POST /api/mascotas | integration |
| I-07 | GET mascotas filtra por store_id | GET /api/mascotas | integration |
| I-08 | PATCH mascota actualiza peso y alimento habitual | PATCH /api/mascotas/[id] | integration |

## Ventas — POS (I-34 a I-59)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-34 | POST venta reduce stock de cada producto | POST /api/ventas | integration |
| I-35 | Venta con cliente actualiza fidelización | POST /api/ventas | integration |
| I-36 | Venta sin items retorna 400 | POST /api/ventas | integration |
| I-37 | Venta con producto sin stock retorna 409 | POST /api/ventas | integration |
| I-38 | Anular venta restaura stock | PATCH /api/ventas/[id] | integration |
| I-45 | Venta granel valida peso en gramos | POST /api/ventas | integration |
| I-46 | Venta granel guarda es_granel=true en venta_item | POST /api/ventas | integration |

## Pagos (I-60 a I-70)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-60 | Pago con NC válida descuenta del monto total | POST /api/pagos | integration |
| I-61 | Pago con NC vencida retorna 410 | POST /api/pagos | integration |
| I-62 | Pago con saldo a favor descuenta correctamente | POST /api/pagos | integration |

## Inventario (I-71 a I-90)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-71 | GET inventario filtra por store_id | GET /api/productos | integration |
| I-72 | POST producto valida precio > 0 | POST /api/productos | integration |
| I-73 | PATCH producto lot-tracked permite PATCH sin cambio de stock | PATCH /api/productos/[id] | integration |
| I-74 | DELETE producto no elimina si tiene ventas | DELETE /api/productos/[id] | integration |
| I-75 | Import masivo limita a 500 filas | POST /api/inventario/import | integration |

## Settings (I-87 a I-99)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-87 | GET enmascara whatsapp_access_token | GET /api/settings | integration |
| I-88 | PATCH no acepta campos no permitidos (mass assignment) | PATCH /api/settings | integration |
| I-89 | PATCH con placeholder de token no actualiza DB | PATCH /api/settings | integration |
| I-93 | GET incluye fidelizacion_niveles del store | GET /api/settings | integration |
| I-94 | GET devuelve campo direccion con coordenadas | GET /api/settings | integration |

## Notas de Crédito (I-100 a I-115)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-100 | POST NC valida que item pertenezca a la venta | POST /api/notas-credito | integration |
| I-101 | POST NC no permite devolver más unidades que las vendidas | POST /api/notas-credito | integration |
| I-102 | POST NC con saldo_a_favor actualiza tabla saldos_a_favor | POST /api/notas-credito | integration |
| I-103 | POST NC con restituir_stock=true incrementa stock del producto | POST /api/notas-credito | integration |

## Contabilidad (I-116 a I-140)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-116 | Asiento de venta POS tiene débito en Caja y crédito en Ventas | POST /api/ventas | unit |
| I-117 | Asiento de NC tiene débito en Ventas y crédito en Caja | POST /api/notas-credito | unit |
| I-118 | Todos los montos CLP son pesos enteros (sin centavos) | múltiples | unit |
| I-119 | Cierre de mes genera balance con todas las cuentas | POST /api/contabilidad/cierre | integration |

## Fidelización (I-141 a I-150)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-141 | GET fidelizacion verifica que cliente pertenezca a la tienda | GET /api/fidelizacion | integration |
| I-142 | GET fidelizacion retorna niveles configurados del store | GET /api/fidelizacion | integration |

## Canales externos (I-151 a I-180)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-151 | Webhook Rappi verifica firma HMAC | POST /api/webhooks/rappi | integration |
| I-152 | Orden de canal con producto duplicado es idempotente | POST /api/canales/webhook | integration |
| I-153 | Hub sync exporta solo productos activos con precio ≥ 1000 | GET /api/hub-sync | integration |

## Supply Chain (I-181 a I-210)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-181 | POST orden de compra valida que proveedor pertenezca al store | POST /api/ordenes-compra | integration |
| I-182 | Recibir OC incrementa stock del producto | POST /api/ordenes-compra/[id] | integration |
| I-183 | Cuenta a pagar no puede tener monto ≤ 0 | POST /api/cuentas-pagar | integration |

## Workers (I-253 a I-262)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-256 | GET workers retorna 401 si no autenticado | GET /api/workers | integration |
| I-257 | GET workers incluye totales de ventas del mes y del día | GET /api/workers | integration |
| I-258 | PATCH workers retorna 400 si clerk_id falta | PATCH /api/workers | integration |
| I-259 | PATCH workers actualiza meta_ventas correctamente | PATCH /api/workers | integration |
| I-260 | GET workers/ventas retorna 401 si no autenticado | GET /api/workers/[id]/ventas | integration |
| I-261 | GET workers/ventas retorna ventas del worker | GET /api/workers/[id]/ventas | integration |
| I-262 | GET workers/ventas filtra por rango de fechas | GET /api/workers/[id]/ventas | integration |

## Infraestructura (I-263 a I-278)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-253 | GET /health retorna status:ok con timestamp ISO | GET /api/health | integration |
| I-254 | GET recompras retorna lista vacía si no hay alertas | GET /api/recompras | integration |
| I-255 | GET recompras filtra sugerencias a ≤ 14 días | GET /api/recompras | integration |
| I-263 | POST proveedor-productos retorna 401 si no autenticado | POST /api/proveedor-productos | integration |
| I-265 | POST proveedor-productos crea asociación correctamente | POST /api/proveedor-productos | integration |
| I-266 | DELETE proveedor-productos retorna 400 sin id | DELETE /api/proveedor-productos | integration |
| I-268 | POST cron/audit-cleanup retorna 401 sin token | POST /api/cron/audit-cleanup | integration |
| I-270 | POST cron/audit-cleanup limpia logs con token válido | POST /api/cron/audit-cleanup | integration |
| I-271 | GET cron/email-alerts retorna 401 sin token | GET /api/cron/email-alerts | integration |
| I-273 | GET cron/email-alerts procesa cada tienda habilitada | GET /api/cron/email-alerts | integration |
| I-274 | POST cron/stock-reservas-expiry retorna 401 sin token | POST /api/cron/stock-reservas-expiry | integration |
| I-276 | POST cron/stock-reservas-expiry marca reservas expiradas | POST /api/cron/stock-reservas-expiry | integration |
| I-277 | GET analytics/recompras-avanzadas retorna 401 sin auth | GET /api/analytics/recompras-avanzadas | integration |
| I-278 | GET analytics/recompras-avanzadas delega a getReorderSuggestions | GET /api/analytics/recompras-avanzadas | integration |
| I-279 | Venta incluye asiento COGS (Dr COGS, Cr Inventario) con costoTotal = cantidad × producto.costo | POST /api/ventas | integration |
| I-280 | Descripcion del asiento contable incluye metodo de pago y nombre del cliente (sin UUID) | POST /api/ventas | integration |

## Seguridad (SEC-01 a SEC-10)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| SEC-01 | venta_item debe pertenecer a la venta validada (IDOR) | POST /api/notas-credito | integration |
| SEC-02 | devoluciones previas deben estar dentro de la misma venta | POST /api/notas-credito | integration |
| SEC-03 | cantidad a devolver no puede superar cantidad original | POST /api/notas-credito | integration |
| SEC-04 | GET settings enmascara whatsapp_webhook_verify_token | GET /api/settings | integration |
| SEC-05 | PATCH con placeholder no actualiza webhook_verify_token | PATCH /api/settings | integration |
| SEC-06 | GET settings enmascara ambos tokens simultáneamente | GET /api/settings | integration |

## Órdenes de Compra — Componentes (COD-01 a COD-06)

| ID | Requisito | Componente | Tipo |
|----|-----------|-----------|------|
| COD-01 | Diálogo Nueva OC renderiza campos requeridos | CreateOrderDialog | component |
| COD-02 | Permite agregar productos existentes a la OC | CreateOrderDialog | component |
| COD-03 | Permite agregar productos nuevos (nombre libre) | CreateOrderDialog | component |
| COD-04 | Botón Crear OC deshabilitado sin items | CreateOrderDialog | component |
| COD-05 | Envía POST con items + fecha_estimada + notas | CreateOrderDialog | component |
| COD-06 | Formulario se limpia al cerrar y reabrir | CreateOrderDialog | component |

## Tests unitarios (U-XX)

| ID | Requisito | Lib | Tipo |
|----|-----------|-----|------|
| U-01 | validateRUT acepta RUT con dígito verificador correcto | lib/validation | unit |
| U-02 | validateRUT rechaza RUT con dígito verificador incorrecto | lib/validation | unit |
| U-03 | formatRUT formatea correctamente con puntos y guión | lib/validation | unit |
| U-04 | Montaje CLP siempre retorna entero (invariante de propiedad) | lib/validation | unit |
| U-05 | Cálculo IVA 19% siempre suma hasta total original | lib/contabilidad | unit |

---

## Convención de IDs

- `I-NNN` — test de integración de ruta API
- `SEC-NN` — test de seguridad
- `U-NN` — test unitario de lib
- `PROP-NN` — test de propiedad (fast-check)
- `COD-NN` — test de componente de orden de compra

Al agregar un test nuevo, asignar el próximo ID disponible en la categoría correspondiente y registrarlo aquí antes de hacer commit.
