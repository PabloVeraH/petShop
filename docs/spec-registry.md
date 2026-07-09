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
| M-21 | POST mascota duplicada (cliente_id + nombre) retorna 409 | POST /api/mascotas | integration |

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
| I-109 | POST NC con descuento 10% devuelve monto proporcional (2×1000×0.9=1800) | POST /api/notas-credito | integration |
| I-110 | POST NC con descuento 0% usa precio original completo | POST /api/notas-credito | integration |

## Contabilidad (I-116 a I-140)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-116 | Asiento de venta POS tiene débito en Caja y crédito en Ventas | POST /api/ventas | unit |
| I-117 | Asiento de NC tiene débito en Ventas y crédito en Caja | POST /api/notas-credito | unit |
| I-118 | Todos los montos CLP son pesos enteros (sin centavos) | múltiples | unit |
| I-119 | Cierre de mes genera balance con todas las cuentas | POST /api/contabilidad/cierre | integration |
| I-315 | REGRESIÓN: verificación de duplicados de cierre usa select+array en vez de .single() para evitar que PGRST116 permita un segundo cierre | POST /api/contabilidad/cierre-mes | integration |

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
| I-310 | POST /api/canales/config activo=true con credencial de solo espacios en blanco → 422 | POST /api/canales/config | integration |
| I-311 | POST /api/canales/config sin credenciales reales → credenciales_encriptada se guarda como null (no un blob cifrado vacío) | POST /api/canales/config | integration |
| I-312 | PATCH /api/canales/config activo=true → 422 cuando credenciales_encriptada es null (canal creado sin credenciales reales) | PATCH /api/canales/config | integration |
| I-313 | PATCH /api/canales/config con credenciales={} (formulario sin tocar) no sobrescribe las credenciales ya guardadas | PATCH /api/canales/config | integration |
| I-314 | PATCH /api/canales/config activo=true con credencial de solo espacios y sin credenciales previas → 422 | PATCH /api/canales/config | integration |
| CC-05 | Activar toggle con credencial de solo espacios → muestra error, no envía request | CanalConfigPage | component |

Nota: los tests I-200 a I-208 y CC-01 a CC-04 (fix de activación automática sin
credenciales, commit 7471d24) existen en `tests/integration/api/canales-config.test.ts`
y `tests/components/CanalConfigPage.test.tsx` pero nunca se registraron aquí, y
tienen IDs duplicados entre sí (I-204, I-206, I-207 reutilizados en tests distintos
dentro del mismo archivo). Pendiente de limpieza — no corregido en esta sesión para
no tocar código ya commiteado fuera del alcance de este bug.

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
| I-293 | PATCH workers valida formato RUT (400 si inválido) | PATCH /api/workers | integration |

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
| I-290 | GET stores como storeAdmin retorna solo su propia tienda | GET /api/admin/stores | integration |
| I-291 | GET users como storeAdmin retorna usuarios de su tienda | GET /api/admin/users | integration |
| I-292 | GET stores como storeAdmin sin storeId retorna 403 | GET /api/admin/stores | integration |

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
| IV-01 | Producto sin costo muestra badge 'Sin costo' | InventoryPage | component |
| FP-07 | Crear producto con campos vacíos muestra errores inline | InventoryPage | component |
| FP-08 | Llenar campo requerido remueve su error inline | InventoryPage | component |
| FP-09 | Formulario válido no muestra errores inline | InventoryPage | component |
| FP-10 | onBlur en campo requerido vacío muestra 'Campo obligatorio' | InventoryPage | component |
| FP-11 | Inputs requeridos tienen atributo HTML required | InventoryPage | component |
| FP-12 | Inputs opcionales NO tienen required | InventoryPage | component |
| VT-01 | Ticket muestra "Gracias por su compra" en venta no anulada | SalesTicketPage | component |
| VT-02 | Ticket NO muestra "Gracias por su compra" en venta anulada | SalesTicketPage | component |
| VT-03 | Anular venta invalida queries ["venta", id] y ["ventas"] | SalesTicketPage | component |
| REG-01 | Anular venta refresca listado al volver (invalida ["ventas"]) | SalesTicketPage | regression |

## Middleware / Routing (MW-XX)

| ID | Requisito | Componente | Tipo |
|----|-----------|-----------|------|
| MW-24 | /workers redirige a /vendedores | next.config.ts | unit |

## Button — Base UI + Tailwind (BTN-XX)

| ID | Requisito | Componente | Tipo |
|----|-----------|-----------|------|
| BTN-01 | disabled=true renderiza con data-disabled | Button | component |
| BTN-02 | disabled=true bloquea onClick | Button | component |
| BTN-03 | disabled=false NO tiene data-disabled | Button | component |
| BTN-04 | disabled=false permite onClick | Button | component |

## 404 (NF-XX)

| ID | Requisito | Componente | Tipo |
|----|-----------|-----------|------|
| NF-01 | 404 muestra título y mensaje | not-found.tsx | component |
| NF-02 | 404 tiene link "Volver al inicio" a /dashboard | not-found.tsx | component |
| NF-03 | Root 404 muestra título y mensaje | app/not-found.tsx | component |
| NF-04 | Root 404 tiene link a /dashboard | app/not-found.tsx | component |
| SP-01 | Click Pagar abre modal con selector de método de pago | SuppliersPage | component |
| SP-02 | Cambiar método de pago en el selector | SuppliersPage | component |
| SP-03 | Confirmar pago envía metodo_pago en PATCH | SuppliersPage | component |
| SP-04 | Cancelar cierra modal sin pagar | SuppliersPage | component |
| SP-05 | Payment falla → muestra mensaje de error en el modal | SuppliersPage | component |
| SP-06 | Cada proveedor muestra sus propias stats en la lista (no las del seleccionado) | SuppliersPage | component |
| SP-07 | Stats no cambian al seleccionar otro proveedor (provienen del endpoint agregado) | SuppliersPage | component |
| SP-08 | Pagar cuenta y recibir/cancelar OC invalidan proveedores-stats (evita sidebar desactualizado) | SuppliersPage | component |
| DV-11 | Con descuento 10%, monto a devolver es proporcional (18.000 en vez de 20.000) | DevolucionModal | component |
| DV-12 | Con descuento 0%, monto a devolver usa precio original | DevolucionModal | component |
| DV-13 | Con descuento, precio unitario se muestra tachado + nuevo precio | DevolucionModal | component |
| V-08 | RUT input muestra el RUT del trabajador cuando existe | VendedoresPage | component |
| V-09 | Guardar cambios envía RUT en body de PATCH y cierra modal | VendedoresPage | component |
| POS-01 | SearchProductos renderiza y desmonta sin error de timer | SearchProductos | component |
| POS-02 | RecomendacionesIA renderiza sin cliente y desmonta sin error de fetch | RecomendacionesIA | component |
| CT-01 | Click Eliminar en categoría abre modal de confirmación | CategoriasTab | component |
| CT-02 | Click Cancelar en modal cierra sin eliminar | CategoriasTab | component |
| CT-03 | Click Eliminar en modal llama DELETE /api/categorias/[id] | CategoriasTab | component |
| M-17 | DELETE mascota retorna 401 sin auth | DELETE /api/mascotas/[id] | integration |
| M-18 | DELETE mascota retorna 404 si no existe | DELETE /api/mascotas/[id] | integration |
| M-19 | DELETE mascota retorna 403 si no pertenece al store | DELETE /api/mascotas/[id] | integration |
| M-20 | DELETE mascota elimina correctamente y registra auditoría | DELETE /api/mascotas/[id] | integration |
| CD-05 | Muestra botón Eliminar por cada mascota | ClienteDetalle | component |
| CD-06 | Click en Eliminar muestra confirmación | ClienteDetalle | component |
| CD-07 | Confirmar eliminación llama a DELETE /api/mascotas/[id] | ClienteDetalle | component |
| CP-13 | Período cerrado deshabilita botón Cierre de Mes y muestra badge ✓ Cerrado | ContabilidadPage | component |
| CP-14 | Botón Cierre de Mes deshabilitado impide abrir modal en período cerrado | ContabilidadPage | component |
| VS-01 | Loading state y luego tabla con datos | SalesPage | component |
| VS-02 | Filtro desde por defecto (90 días atrás) | SalesPage | component |
| VS-03 | Enlace 'Ver ticket' por cada venta | SalesPage | component |
| VS-04 | Paginación oculta cuando total ≤ 50 | SalesPage | component |
| VS-05 | Search input se renderiza con placeholder | SalesPage | component |
| VS-06 | staleTime=0 obliga refetch al remontar el componente SalesPage | SalesPage | component |
| MP-13 | debito/credito muestra label N° transacción con * rojo | ModalPago | component |
| MP-14 | efectivo no muestra el campo N° transacción | ModalPago | component |
| MP-15 | credito con TRX vacío en blur muestra error obligatorio | ModalPago | component |

| I-107 | PATCH con metodo_pago inválido → 400 | PATCH /api/cuentas-pagar | integration |
| I-108 | PATCH con metodo_pago=efectivo → 200 + metodo_pago en DB | PATCH /api/cuentas-pagar | integration |
| I-111 | PATCH mark-pagada → genera asiento contable de pago (crearAsiento + lineasPagoProveedor) | PATCH /api/cuentas-pagar | integration |
| I-112 | PATCH con estado=pendiente (sin pagar) → NO genera asiento contable | PATCH /api/cuentas-pagar | integration |
| I-293 | GET /api/ventas retorna 401 sin auth | GET /api/ventas | integration |
| I-294 | GET /api/ventas retorna ventas paginadas con count | GET /api/ventas | integration |
| I-295 | GET /api/ventas filtra por metodo_pago y estado | GET /api/ventas | integration |
| I-296 | GET /api/ventas filtra por rango de fechas | GET /api/ventas | integration |
| I-297 | GET /api/ventas busca por nombre de cliente | GET /api/ventas | integration |
| I-298 | GET /api/ventas busca por numero_comprobante si search contiene - | GET /api/ventas | integration |
| I-299 | GET /api/ventas retorna vacío si no hay clientes matching | GET /api/ventas | integration |
| I-300 | POST ventas con debito sin numeroTransaccion → 400 | POST /api/ventas | integration |
| I-301 | POST ventas con credito sin numeroTransaccion → 400 | POST /api/ventas | integration |
| I-302 | POST ventas con transferencia sin numeroTransaccion → 400 | POST /api/ventas | integration |
| I-303 | POST ventas con debito y numeroTransaccion valido → 200 | POST /api/ventas | integration |
| I-304 | POST ventas con credito y numeroTransaccion valido → 200 | POST /api/ventas | integration |
| I-305 | REGRESIÓN: contra-asiento de anulación usa fecha ORIGINAL de la venta, no fecha de hoy (evita ingreso/resultado fantasma en Estado de Resultado cuando la anulación ocurre en un mes distinto) | PATCH /api/ventas/[id] | integration |
| I-306 | GET /api/proveedores/stats retorna stats agregadas por proveedor (ordenes pendientes + cuentas por pagar) | GET /api/proveedores/stats | integration |
| I-307 | GET /api/proveedores/stats retorna 401 si no autenticado | GET /api/proveedores/stats | integration |
| I-308 | GET /api/proveedores/stats retorna objetos vacios si no hay datos | GET /api/proveedores/stats | integration |
| I-309 | GET /api/proveedores/stats filtra ordenes_compra y cuentas_pagar por store_id (multi-tenant) | GET /api/proveedores/stats | integration |

## Tests unitarios (U-XX)

| ID | Requisito | Lib | Tipo |
|----|-----------|-----|------|
| U-01 | validateRUT acepta RUT con dígito verificador correcto | lib/validation | unit |
| U-02 | validateRUT rechaza RUT con dígito verificador incorrecto | lib/validation | unit |
| U-03 | formatRUT formatea correctamente con puntos y guión | lib/validation | unit |
| U-04 | Montaje CLP siempre retorna entero (invariante de propiedad) | lib/validation | unit |
| U-05 | Cálculo IVA 19% siempre suma hasta total original | lib/contabilidad | unit |
| U-114 | lineasPagoProveedor con metodoPago=efectivo → credita CAJA | lib/contabilidad | unit |
| U-115 | lineasPagoProveedor con metodoPago=transferencia → credita BANCO | lib/contabilidad | unit |
| U-116 | crearAsiento reintenta con numero_asiento recalculado ante colisión UNIQUE (23505) y tiene éxito en el 2do intento | lib/contabilidad | unit |
| U-117 | crearAsiento retorna null tras agotar reintentos si el conflicto de numero_asiento persiste | lib/contabilidad | unit |
| U-118 | crearAsiento NO reintenta ante errores que no sean de colisión de unicidad | lib/contabilidad | unit |
| U-119 | REGRESIÓN: dos crearAsiento() concurrentes para la misma tienda (venta + COGS) no pierden ningún asiento por colisión de numero_asiento — causa raíz confirmada del bug "venta sin asiento de ingreso, solo aparece COGS" | lib/contabilidad | unit |

---

## Redirects (RD-01 a RD-16)

| ID | Requisito |
|----|-----------|
| RD-01 | /inventario redirige a /inventory (308) |
| RD-02 | /inventario/:path* redirige a /inventory/:path* (308) |
| RD-03 | /clientes redirige a /customers (308) |
| RD-04 | /clientes/:path* redirige a /customers/:path* (308) |
| RD-05 | /ventas redirige a /sales (308) |
| RD-06 | /ventas/:path* redirige a /sales/:path* (308) |
| RD-07 | /proveedores redirige a /suppliers (308) |
| RD-08 | /proveedores/:path* redirige a /suppliers/:path* (308) |
| RD-09 | /compras redirige a /purchases (308) |
| RD-10 | /configuracion redirige a /settings (308) |
| RD-11 | /ajustes redirige a /settings (308) |
| RD-12 | /cuentas-pagar redirige a /payables (308) |
| RD-13 | /cuentas-por-pagar redirige a /payables (308) |
| RD-14 | /reportes redirige a /reports (308) |
| RD-15 | /reportes/prediccion NO debe redirigirse (existe como ruta real) |
| RD-16 | /workers redirige a /vendedores (307, redirect preexistente) |

## Dashboard / Stock Alertas (I-90 a I-93)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-91 | stock === stock_minimo se considera alerta (regresión operador < vs <=) | GET /api/dashboard/stock-alertas | integration |
| I-92 | stock=0, mínimo=0 se considera alerta | GET /api/dashboard/stock-alertas | integration |

## Dashboard Alerts Component (DA-01 a DA-05)

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| DA-01 | Sin alertas → widget muestra "Todo el stock sobre mínimo" | AnaliticaTab | component |
| DA-02 | Con alertas → lista productos y contador | AnaliticaTab | component |
| DA-03 | stock === stock_minimo se considera alerta (regresión) | AnaliticaTab | component |
| DA-04 | stock=0, mínimo=0 se considera alerta | AnaliticaTab | component |
| DA-05 | fetch de stock-alertas falla → widget vacío sin error | AnaliticaTab | component |

## POS Page Cache (PP-05)

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| PP-05 | Completar venta invalida ["ventas"] con refetchType "all" | POSPage | component |

## Devolución Modal Cache (DV-14)

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| DV-14 | Confirmar devolución invalida ["ventas"] con refetchType "all" | DevolucionModal | component |

## Convención de IDs

- `I-NNN` — test de integración de ruta API
- `SEC-NN` — test de seguridad
- `U-NN` — test unitario de lib
- `PROP-NN` — test de propiedad (fast-check)
- `COD-NN` — test de componente de orden de compra
- `VS-NN` — test de componente de historial de ventas
- `RD-NN` — test de redirección de ruta
- `DA-NN` — test de componente de dashboard / alertas (AnaliticaTab)
- `PP-NN` — test de componente de POSPage
- `DV-NN` — test de componente de DevolucionModal

Al agregar un test nuevo, asignar el próximo ID disponible en la categoría correspondiente y registrarlo aquí antes de hacer commit.
