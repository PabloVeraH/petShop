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
| M-22 | POST mascota con nombre que difiere solo en mayúsculas/minúsculas retorna 409 (case-insensitive) | POST /api/mascotas | integration |
| M-23 | PATCH mascota renombrada a nombre ya existente retorna 409 (case-insensitive) | PATCH /api/mascotas/[id] | integration |
| M-24 | PATCH mascota sin nombre en body no verifica duplicados (cambia solo gramos_porcion/veces_dia) | PATCH /api/mascotas/[id] | integration |

## Ventas — POS (I-34 a I-59)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-34 | POST venta reduce stock de cada producto | POST /api/ventas | integration |
| I-35 | Venta con cliente actualiza fidelización | POST /api/ventas | integration |
| I-36 | Venta sin items retorna 400 | POST /api/ventas | integration |
| I-37 | Venta con producto sin stock retorna 409 | POST /api/ventas | integration |
| I-38 | Anular venta restaura stock | PATCH /api/ventas/[id] | integration |
| I-319 | **RETIRADO** (migración 053) — probaba manejo de error de un `.update()` de JS que ya no existe; cualquier error dentro de `anular_venta_tx` ahora hace ROLLBACK automático y se mapea a 500 genérico (ver I-412). | PATCH /api/ventas/[id] | — |
| I-320 | GET saldo a favor con error real de DB retorna 500 en vez de 0 silencioso | GET /api/saldos-a-favor | integration |
| I-411 | REGRESIÓN: anular venta ya anulada retorna 409 — cubre tanto doble clic secuencial como anulación concurrente (reclamo atómico de `anular_venta_tx`, verificado contra la función real: la segunda llamada para la misma venta falla con "La venta ya está anulada") | PATCH /api/ventas/[id] | integration |
| I-412 | Anular venta ante error inesperado del RPC retorna 500 (rollback automático de la transacción, sin estado parcial) | PATCH /api/ventas/[id] | integration |
| I-45 | Venta granel valida peso en gramos | POST /api/ventas | integration |
| I-46 | Venta granel guarda es_granel=true en venta_item | POST /api/ventas | integration |

## Pagos (I-60 a I-70)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-60 | Pago con NC válida descuenta del monto total | POST /api/pagos | integration |
| I-61 | Pago con NC vencida retorna 410 | POST /api/pagos | integration |
| I-62 | Pago con saldo a favor descuenta correctamente | POST /api/pagos | integration |
| I-317 | Pago con error de DB en pagos query retorna 500 en vez de éxito silencioso | POST /api/pagos | integration |
| I-318 | Pago con error de DB al actualizar venta retorna 500 en vez de éxito silencioso | POST /api/pagos | integration |

## Inventario (I-71 a I-90)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-71 | GET inventario filtra por store_id | GET /api/productos | integration |
| I-72 | POST producto valida precio > 0 | POST /api/productos | integration |
| I-73 | PATCH producto lot-tracked permite PATCH sin cambio de stock | PATCH /api/productos/[id] | integration |
| I-74 | DELETE producto no elimina si tiene ventas | DELETE /api/productos/[id] | integration |
| I-75 | Import masivo limita a 500 filas | POST /api/inventario/import | integration |

## Settings (I-87 a I-99, I-414 a I-416)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-87 | GET enmascara whatsapp_access_token | GET /api/settings | integration |
| I-88 | PATCH no acepta campos no permitidos (mass assignment) | PATCH /api/settings | integration |
| I-89 | PATCH con placeholder de token no actualiza DB | PATCH /api/settings | integration |
| I-93 | GET incluye fidelizacion_niveles del store | GET /api/settings | integration |
| I-94 | GET devuelve campo direccion con coordenadas | GET /api/settings | integration |
| I-414 | GET incluye license_start_date, license_end_date y license_warning_days | GET /api/settings | integration |
| I-415 | GET retorna null en license fields cuando no hay licencia configurada | GET /api/settings | integration |
| I-416 | GET retorna licencia con fecha vencida | GET /api/settings | integration |
| C-42 | REGRESIÓN: sección WhatsApp — Access Token tiene autoComplete="new-password"; Phone Number ID y Verify Token tienen autoComplete="off" — evita que el navegador ofrezca autocompletar con credenciales guardadas de otro contexto | SettingsPage | component |
| C-43 | Tab Sesiones muestra IP y User-Agent cuando están presentes en datos | AuditoriaCard | component |
| C-44 | REGRESIÓN: inline edit (✏) en UsuariosCard — inputs email y nombre tienen autoComplete="off" — mismo defecto que C-41: el navegador ofrecía autocompletar con credenciales guardadas del admin logueado al editar datos de OTRA persona | UsuariosCard | component |
| C-45 | Sección Licencia visible con fechas y estado Activa | SettingsPage | component |
| C-46 | Sin fechas configuradas muestra "Sin configurar" | SettingsPage | component |
| C-47 | Licencia vencida muestra "VENCIDA" | SettingsPage | component |
| C-48 | systemAdmin ve enlace a /admin para gestionar licencia | SettingsPage | component |
| C-49 | storeAdmin NO ve enlace a /admin | SettingsPage | component |

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
| I-323 | crearAsiento retorna null durante COGS y existe cierre concurrente → 409 | POST /api/contabilidad/cierre-mes | integration |
| I-324 | crearAsiento retorna null durante COGS sin cierre concurrente → 500 | POST /api/contabilidad/cierre-mes | integration |
| I-328 a I-336 | **RETIRADOS** (migración 053) — probaban la lógica de reversión NC-aware (stock/fidelización/saldo) vía mocks de `.from()`; esa lógica se movió a la función transaccional `anular_venta_tx` y dejaron de ejercitar código de la ruta. Verificados directamente contra la función real en Supabase (transacción con ROLLBACK) — ver AGENTS.md §22.5 y el commit de la revisión. **Nota:** I-330 a I-333 NO se reutilizan como IDs nuevos para evitar colisión con este rango retirado — ver I-346 a I-349. | PATCH /api/ventas/[id] | — |
| I-340 | Preview retorna 401 sin autenticación | GET /api/contabilidad/cierre-mes/preview | integration |
| I-341 | Preview retorna 400 con parámetros inválidos (falta mes, falta año, mes fuera de rango) | GET /api/contabilidad/cierre-mes/preview | integration |
| I-342 | Preview retorna datos del período sin crear asientos | GET /api/contabilidad/cierre-mes/preview | integration |
| I-343 | Preview calcula cogs_estimado desde compras del período | GET /api/contabilidad/cierre-mes/preview | integration |
| I-344 | Preview detecta período ya cerrado (ya_tiene_cierre=true) | GET /api/contabilidad/cierre-mes/preview | integration |
| I-345 | Preview no produce efectos secundarios (no INSERT/UPDATE/DELETE) | GET /api/contabilidad/cierre-mes/preview | integration |
| I-346 | POST cierre-mes crea respaldo en cierre_mes_backups antes de ejecutar (renumerado desde I-330 — ver nota en I-328 a I-336) | POST /api/contabilidad/cierre-mes | integration |
| I-347 | POST cierre-mes NO crea respaldo cuando calcular_costo_venta=false (renumerado desde I-331) | POST /api/contabilidad/cierre-mes | integration |
| I-348 | POST cierre-mes NO crea respaldo cuando cogs_estimado=0 (renumerado desde I-332) | POST /api/contabilidad/cierre-mes | integration |
| I-349 | Respaldo incluye snapshot del período y totales antes del cierre (renumerado desde I-333) | POST /api/contabilidad/cierre-mes | integration |
| I-350 | REGRESIÓN: POST cierre-mes retorna 403 cuando el usuario no es storeAdmin ni systemAdmin (Cierre de Mes es irreversible — faltaba requireStoreAdmin) | POST /api/contabilidad/cierre-mes | integration |
| I-351 | REGRESIÓN: preview retorna 403 cuando el usuario no es storeAdmin ni systemAdmin | GET /api/contabilidad/cierre-mes/preview | integration |
| I-352 | Preview detecta período desbalanceado | GET /api/contabilidad/cierre-mes/preview | integration |
| I-353 | Preview reporta cogs_estimado=0 cuando no hay compras en el período | GET /api/contabilidad/cierre-mes/preview | integration |
| I-354 | Preview calcula correctamente febrero bisiesto (2024) | GET /api/contabilidad/cierre-mes/preview | integration |
| I-355 | Preview calcula correctamente febrero no bisiesto (2026) | GET /api/contabilidad/cierre-mes/preview | integration |
| I-356 | REGRESIÓN: si el insert del respaldo falla, POST cierre-mes aborta con 500 ANTES de crear el asiento irreversible (fail-closed, no fail-open) | POST /api/contabilidad/cierre-mes | integration |
| BP-PDF-01 | Balance PDF retorna 401 sin autenticación | GET /api/contabilidad/balance-prueba/pdf | integration |
| BP-PDF-02 | Balance PDF retorna HTML con título y empresa | GET /api/contabilidad/balance-prueba/pdf | integration |
| BP-PDF-03 | Balance PDF incluye cuentas contables en HTML | GET /api/contabilidad/balance-prueba/pdf | integration |
| BP-PDF-04 | Balance PDF Content-Type es text/html | GET /api/contabilidad/balance-prueba/pdf | integration |
| ER-PDF-01 | Estado Resultado PDF retorna 401 sin autenticación | GET /api/contabilidad/estado-resultado/pdf | integration |
| ER-PDF-02 | Estado Resultado PDF retorna HTML con título y empresa | GET /api/contabilidad/estado-resultado/pdf | integration |
| ER-PDF-03 | Estado Resultado PDF incluye ingresos y gastos en HTML | GET /api/contabilidad/estado-resultado/pdf | integration |
| ER-PDF-04 | Estado Resultado PDF Content-Type es text/html | GET /api/contabilidad/estado-resultado/pdf | integration |
| I-400 | Backfill crea asiento de ingreso + COGS para venta sin ningún asiento | POST /api/contabilidad/backfill | integration |
| I-401 | REGRESIÓN: backfill crea asiento de ingreso faltante cuando venta solo tiene COGS (antes saltaba porque COGS y VENTA comparten tipo_movimiento="VENTA") | POST /api/contabilidad/backfill | integration |
| I-402 | Backfill crea COGS faltante cuando venta solo tiene asiento de ingreso | POST /api/contabilidad/backfill | integration |
| I-403 | Backfill salta venta que tiene ambos asientos (ingreso + COGS) | POST /api/contabilidad/backfill | integration |
| I-404 | Backfill no crea COGS si costoTotal=0 | POST /api/contabilidad/backfill | integration |
| I-413 | REGRESIÓN: backfill de ventas excluye estado='anulada' (`.neq("estado","anulada")`) — una venta anulada sin asiento de ingreso original no debe recibir uno nuevo (ingreso fantasma) | POST /api/contabilidad/backfill | integration |
| I-419 | REGRESIÓN: backfill retorna 401 si no hay sesión | POST /api/contabilidad/backfill | integration |
| I-420 | REGRESIÓN: backfill retorna 403 si el usuario no es storeAdmin ni systemAdmin — sin requireStoreAdmin cualquier storeWorker autenticado puede generar asientos | POST /api/contabilidad/backfill | integration |
| I-421 | REGRESIÓN: backfill registra en logAudit action BACKFILL con ipAddress/userAgent extraídos del request (faltaba en el commit que agregó el logAudit) | POST /api/contabilidad/backfill | integration |
| I-422 | REGRESIÓN: OC con subtotal=0 reporta "precio no definido" en detalle_errores (antes solo mostraba el código de OC sin motivo) | POST /api/contabilidad/backfill | integration |
| I-423 | REGRESIÓN: OC con subtotal válido pero crearAsiento falla reporta "error al crear asiento contable" (antes solo mostraba el código de OC) | POST /api/contabilidad/backfill | integration |
| I-424 | REGRESIÓN: la consulta de órdenes de compra para backfill excluye estado='cancelada' (una OC cancelada nunca fue recibida, subtotal/total quedan NULL para siempre — sin este filtro se reportaba como error "precio no definido" en vez de omitirse) | POST /api/contabilidad/backfill | integration |
| I-NCC-01 | lineasNotaCreditoCOGS genera asiento balanceado (débito = crédito = costo) | lib/contabilidad/generador-asientos | unit |
| I-NCC-02 | lineasNotaCreditoCOGS debita INVENTARIO (reincorporación al stock) | lib/contabilidad/generador-asientos | unit |
| I-NCC-03 | lineasNotaCreditoCOGS acredita COGS (reverso del gasto) | lib/contabilidad/generador-asientos | unit |
| I-NCC-04 | lineasNotaCreditoCOGS es el inverso exacto de lineasVentaCOGS | lib/contabilidad/generador-asientos | unit |
| I-NCC-05 | lineasNotaCreditoCOGS con costo cero genera líneas en 0 | lib/contabilidad/generador-asientos | unit |
| I-NCC-INT-01 | REGRESIÓN: devolución con restituirStock=true y costo definido crea también el reverso de COGS (Dr Inventario / Cr COGS por cantidad × costo) | POST /api/notas-credito | integration |
| I-NCC-INT-02 | Devolución con restituirStock=false NO crea reverso de COGS (solo ingreso) — mismo criterio que anular_venta_tx | POST /api/notas-credito | integration |
| I-NCC-INT-03 | Devolución de producto sin costo definido NO crea reverso de COGS | POST /api/notas-credito | integration |
| I-NCC-BF-01 | Backfill NC: sin ningún asiento → crea ingreso + reverso de COGS | POST /api/contabilidad/backfill | integration |
| I-NCC-BF-02 | Backfill NC: con ingreso pero sin COGS → crea solo el reverso de COGS (detecta por descripción "Reverso COGS%") | POST /api/contabilidad/backfill | integration |
| I-NCC-BF-03 | Backfill NC: con ambos asientos → no crea nada (idempotente) | POST /api/contabilidad/backfill | integration |
| I-NCC-BF-04 | Backfill NC: sin ítems con restituir_stock=true → no crea reverso de COGS | POST /api/contabilidad/backfill | integration |

## Balance HTML (BP-01 a BP-12)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| BP-01 | generarHtmlBalancePrueba retorna HTML válido | lib/contabilidad/html-balance-prueba | unit |
| BP-02 | Incluye nombre de empresa y RUT | lib/contabilidad/html-balance-prueba | unit |
| BP-03 | Incluye título "Balance de Comprobación" | lib/contabilidad/html-balance-prueba | unit |
| BP-04 | Incluye período y fecha | lib/contabilidad/html-balance-prueba | unit |
| BP-05 | Incluye todas las cuentas con código, nombre, tipo, montos | lib/contabilidad/html-balance-prueba | unit |
| BP-06 | Montos formateados en CLP ($ xxx.xxx) | lib/contabilidad/html-balance-prueba | unit |
| BP-07 | Mensaje cuando no hay cuentas | lib/contabilidad/html-balance-prueba | unit |
| BP-08 | Botón de impresión y CSS @media print | lib/contabilidad/html-balance-prueba | unit |
| BP-09 | Indicador descuadrado cuando no balancea | lib/contabilidad/html-balance-prueba | unit |
| BP-10 | Indicador balanceado cuando Dr = Cr | lib/contabilidad/html-balance-prueba | unit |
| BP-11 | Empresa sin RUT muestra guión | lib/contabilidad/html-balance-prueba | unit |
| BP-12 | Incluye totales en el pie | lib/contabilidad/html-balance-prueba | unit |

## Estado Resultado HTML (ER-01 a ER-11)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| ER-01 | generarHtmlEstadoResultado retorna HTML válido | lib/contabilidad/html-estado-resultado | unit |
| ER-02 | Incluye nombre de empresa y RUT | lib/contabilidad/html-estado-resultado | unit |
| ER-03 | Incluye título "Estado de Resultado" | lib/contabilidad/html-estado-resultado | unit |
| ER-04 | Incluye período | lib/contabilidad/html-estado-resultado | unit |
| ER-05 | Incluye ingresos, gastos y utilidad | lib/contabilidad/html-estado-resultado | unit |
| ER-06 | Montos formateados en CLP | lib/contabilidad/html-estado-resultado | unit |
| ER-07 | Utilidad positiva muestra "UTILIDAD NETA" en verde | lib/contabilidad/html-estado-resultado | unit |
| ER-08 | Pérdida muestra "PÉRDIDA" en rojo | lib/contabilidad/html-estado-resultado | unit |
| ER-09 | No muestra línea de devoluciones si es cero | lib/contabilidad/html-estado-resultado | unit |
| ER-10 | Botón de impresión y CSS @media print | lib/contabilidad/html-estado-resultado | unit |
| ER-11 | Empresa sin RUT muestra guión | lib/contabilidad/html-estado-resultado | unit |

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
| I-321 | POST /api/canales/config activo=true con credenciales parciales (solo 1 de N campos) → 422 | POST /api/canales/config | integration |
| I-322 | PATCH /api/canales/config activo=true con credenciales parciales → 422 | PATCH /api/canales/config | integration |
| I-325 | REGRESIÓN: venta creada al aceptar orden de canal persiste `impuesto` con fórmula de extracción (antes quedaba NULL) | POST /api/canales/orders/[id]/accept | integration |
| I-326 | REGRESIÓN: venta_items de orden de canal usa columna `precio_unitario` (antes usaba `precio`, inexistente — insert fallaba en silencio) | POST /api/canales/orders/[id]/accept | integration |
| I-327 | Aceptar orden de canal responde accepted y vincula venta_id en canal_ordenes | POST /api/canales/orders/[id]/accept | integration |
| CC-05 | Activar toggle con credencial de solo espacios → muestra error, no envía request | CanalConfigPage | component |
| CC-06 | Activar toggle con solo 1 de 4 campos Rappi → muestra error, no envía request | CanalConfigPage | component |
| CC-07 | REGRESIÓN: campos type="password" (API Key, API Secret, Webhook Secret) tienen autoComplete="new-password" — evita que el navegador ofrezca autocompletar con credenciales guardadas de otro contexto | CanalConfigPage | component |
| CC-08 | Campo type="text" (Store ID) tiene autoComplete="off" | CanalConfigPage | component |
| CC-09 | REGRESIÓN: datetime-local input (Programar Publicación) tiene autoComplete="off" — evita autocompletado del navegador en campo de fecha/hora | InstagramEditor | component |
| CC-10 | REGRESIÓN: toggle a inactivo después de error de credenciales → error se limpia sin necesidad de guardar | CanalConfigPage | component |

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
| I-426 | REGRESIÓN: recibir con cantidad_recibida>0 y precio_unitario=0 → 400 (evita OC "recibida" con subtotal/total en $0) | PATCH /api/ordenes-compra/[id] | integration |
| I-427 | Recibir con cantidad_recibida=0 y precio_unitario=0 → 200 (item no recibido en entrega parcial no requiere precio) | PATCH /api/ordenes-compra/[id] | integration |
| I-428 | REGRESIÓN: NC descuenta el monto devuelto de ventasHoy/ventasPorCanal/ventasPorProcedencia en el Dashboard (mismo bug que I-425, en un endpoint distinto) | GET /api/dashboard | integration |
| I-183 | Cuenta a pagar no puede tener monto ≤ 0 | POST /api/cuentas-pagar | integration |

## Workers (I-253 a I-262, I-406 a I-410)

Regresión: "Ventas hoy" mostraba $0 para todos los vendedores. Causa raíz:
ventas creadas sin asignar workerClerkId explícitamente en el modal de cobro
quedaban con worker_clerk_id=null, y GET /api/workers las excluye (no las
atribuye a nadie) al sumar por vendedor. Corregido en dos capas: frontend
(pos/page.tsx auto-asigna el userId de la sesión al montar y al cambiar de
usuario) y backend (POST /api/ventas: workerClerkId ?? ctx.userId como
fallback, ver I-68 en tests/integration/api/ventas.post.test.ts). I-409/I-410
prueban que la suma por vendedor de GET /api/workers funciona con datos
reales (I-257 solo verificaba la forma de la respuesta contra data:[]).

IDs I-260/I-261/I-293 de este archivo (tests/integration/api/workers.test.ts)
colisionaban con IDs ya usados en otros archivos (workers-ventas.test.ts y
ventas.get.test.ts respectivamente, ambos más antiguos) — renombrados a
I-406/I-407/I-408.

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
| I-406 | PATCH workers retorna 401 si no hay sesión (renombrado desde I-260, colisión) | PATCH /api/workers | integration |
| I-407 | PATCH workers retorna 403 si no es admin (renombrado desde I-261, colisión) | PATCH /api/workers | integration |
| I-408 | GET ventas retorna 401 si no autenticado (renombrado desde I-293, colisión — ver también sección Ventas) | GET /api/ventas | integration |
| I-409 | REGRESIÓN: ventas con worker_clerk_id asignado se suman correctamente al total del vendedor correspondiente (no $0) | GET /api/workers | integration |
| I-410 | Venta con worker_clerk_id null no se atribuye a ningún vendedor y no rompe el cálculo de los demás | GET /api/workers | integration |
| I-425 | REGRESIÓN: NC descontada del total del vendedor en ventas_mes/ventas_hoy (venta devuelta no infla meta mensual) | GET /api/workers | integration |
| I-425b | NC no reduce ventas_mes por debajo de 0 (clamped) | GET /api/workers | integration |
| I-425c | GET workers/ventas incluye monto_devuelto por venta (0 si sin NC, >0 si tiene NC) | GET /api/workers/[id]/ventas | integration |

## Infraestructura (I-251 a I-282, I-417, I-418)

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-251 | session.created inserta ip_address y user_agent del evento Clerk | POST /api/webhooks/clerk | integration |
| I-252 | session.created sin clerk_user inserta sesión con store_id null | POST /api/webhooks/clerk | integration |
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
| I-417 | session.ended inserta ip_address null cuando el evento no trae el campo | POST /api/webhooks/clerk | integration |
| I-418 | REGRESIÓN: ip_address/user_agent puestos en `data` (no en event_attributes.http_request) se ignoran | POST /api/webhooks/clerk | integration |
| I-290 | GET stores como storeAdmin retorna solo su propia tienda | GET /api/admin/stores | integration |
| I-291 | GET users como storeAdmin retorna usuarios de su tienda | GET /api/admin/users | integration |
| I-292 | GET stores como storeAdmin sin storeId retorna 403 | GET /api/admin/stores | integration |
| C-41 | REGRESIÓN: CreateUserForm ("+ Crear usuario") — email tiene autoComplete="off" y password tiene autoComplete="new-password" — evita que el navegador ofrezca autocompletar con credenciales guardadas del propio admin logueado al crear la cuenta de otra persona | UsuariosCard | component |

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
| IV-02 | El Motivo completo con acentos se envía íntegro en el body del ajuste de stock (no truncado) | InventoryPage | component |
| IV-03 | REGRESIÓN: cambiar Cantidad mientras el modal de ajuste está abierto no vuelve a robar el foco del input Motivo (ModalOverlay commit 1270b13) | InventoryPage | component |
| IV-04 | REGRESIÓN: Ajuste de stock invalida ["productos"] con refetchType "all" (POS muestra stock actualizado sin recargar) | InventoryPage | component |
| IV-05 | REGRESIÓN: Editar producto invalida ["productos"] con refetchType "all" | InventoryPage | component |
| IV-06 | REGRESIÓN: Desactivar producto invalida ["productos"] con refetchType "all" | InventoryPage | component |
| FP-07 | Crear producto con campos vacíos muestra errores inline | InventoryPage | component |
| FP-08 | Llenar campo requerido remueve su error inline | InventoryPage | component |
| FP-09 | Formulario válido no muestra errores inline | InventoryPage | component |
| FP-10 | onBlur en campo requerido vacío muestra 'Campo obligatorio' | InventoryPage | component |
| FP-11 | Inputs requeridos tienen atributo HTML required | InventoryPage | component |
| FP-12 | Inputs opcionales NO tienen required | InventoryPage | component |
| VT-01 | Ticket muestra "Gracias por su compra" en venta no anulada | SalesTicketPage | component |
| VT-02 | Ticket NO muestra "Gracias por su compra" en venta anulada | SalesTicketPage | component |
| VT-03 | Anular venta invalida queries ["venta", id] y ["ventas"] con refetchType "all" | SalesTicketPage | component |
| VT-05 | Anulación con error del servidor muestra mensaje en banner rojo | SalesTicketPage | component |
| REG-01 | Anular venta refresca listado al volver (invalida ["ventas"]) | SalesTicketPage | regression |
| C-39 | REGRESIÓN: Subtotal muestra el neto (total − impuesto), no el bruto que igualaba a Total | SalesTicketPage | component |
| C-40 | Con descuento, Subtotal + IVA sigue sumando exactamente Total | SalesTicketPage | component |

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
| CT-04 | REGRESIÓN: Editar categoría invalida ["categorias"] con refetchType "all" (lista se actualiza sin recargar) | CategoriasTab | component |
| M-17 | DELETE mascota retorna 401 sin auth | DELETE /api/mascotas/[id] | integration |
| M-18 | DELETE mascota retorna 404 si no existe | DELETE /api/mascotas/[id] | integration |
| M-19 | DELETE mascota retorna 403 si no pertenece al store | DELETE /api/mascotas/[id] | integration |
| M-20 | DELETE mascota elimina correctamente y registra auditoría | DELETE /api/mascotas/[id] | integration |
| MM-01 | Modal muestra advertencia al escribir nombre duplicado (case-insensitive) y deshabilita Guardar | ModalMascotaCreate | component |
| CD-05 | Muestra botón Eliminar por cada mascota | ClienteDetalle | component |
| CD-06 | Click en Eliminar muestra confirmación | ClienteDetalle | component |
| CD-07 | Confirmar eliminación llama a DELETE /api/mascotas/[id] | ClienteDetalle | component |
| CP-13 | Período cerrado deshabilita botón Cierre de Mes y muestra badge ✓ Cerrado | ContabilidadPage | component |
| CP-14 | Botón Cierre de Mes deshabilitado impide abrir modal en período cerrado | ContabilidadPage | component |
| CP-15 | Error 409 concurrente refresca libro-diario y muestra badge "✓ Cerrado" | ContabilidadPage | component |
| CP-16 | REGRESIÓN — botón PDF (y Excel) permanece visible en tab Balance de Comprobación, con href correcto | ContabilidadPage | component |
| CP-17 | REGRESIÓN — botón PDF (y Excel) permanece visible en tab Estado de Resultado, con href correcto | ContabilidadPage | component |
| CP-18 | Al alternar entre tabs solo hay un botón PDF visible a la vez, con el href de la tab activa | ContabilidadPage | component |
| CP-19 | El título (h1) refleja el tab activo (Libro Diario / Balance de Comprobación / Estado de Resultado) | ContabilidadPage | component |
| CP-20 | Al abrir modal de cierre se fetchea vista previa | ContabilidadPage | component |
| CP-21 | Modal muestra datos de la vista previa (asientos, COGS, balance) | ContabilidadPage | component |
| CP-22 | Vista previa en loading no bloquea apertura del modal | ContabilidadPage | component |
| CP-23 | Confirmar cierre funciona aunque preview haya fallado | ContabilidadPage | component |
| CP-24 | REGRESIÓN: muestra advertencia "ya está cerrado" y deshabilita Confirmar cuando preview.ya_tiene_cierre=true, aunque periodoCerrado (derivado de libro-diario, potencialmente stale) sea false | ContabilidadPage | component |
| CP-25 | REGRESIÓN: subtítulo descriptivo del header difiere por tab — "Asientos contables del período" (Libro Diario) / "Saldos acumulados desde el inicio" (Balance) / "Ingresos, costos y utilidad del período" (Estado de Resultado) — evita que el usuario asuma que Balance muestra solo el período igual que los otros | ContabilidadPage | component |
| CP-26 | REGRESIÓN: label de período muestra "Acumulado hasta: <fecha>" en lugar de "Período: <mes>" cuando el tab activo es Balance de Comprobación | ContabilidadPage | component |
| CP-27 | Label de período muestra "Período: <mes>" en Libro Diario y Estado de Resultado (no en Balance) | ContabilidadPage | component |
| CP-28 | REGRESIÓN: nota azul informativa "Saldos acumulados desde el inicio de operaciones hasta la fecha de corte. No representa únicamente los movimientos del período seleccionado." visible solo en tab Balance | ContabilidadPage | component |
| CP-29 | Botón Backfill visible solo para storeAdmin y systemAdmin, oculto para storeWorker | ContabilidadPage | component |
| CP-30 | Click en Backfill abre modal de confirmación con descripción de la operación; Cancelar cierra el modal sin llamar al API | ContabilidadPage | component |
| CP-31 | Backfill exitoso muestra banner con creados/errores y detalle expandible; errores en rojo | ContabilidadPage | component |
| VS-01 | Loading state y luego tabla con datos | SalesPage | component |
| VS-02 | Filtro desde por defecto (90 días atrás) | SalesPage | component |
| VS-03 | Enlace 'Ver ticket' por cada venta | SalesPage | component |
| VS-04 | Paginación oculta cuando total ≤ 50 | SalesPage | component |
| VS-05 | Search input se renderiza con placeholder | SalesPage | component |
| VS-06 | staleTime=0 obliga refetch al remontar el componente SalesPage | SalesPage | component |
| MP-13 | debito/credito muestra label N° transacción con * rojo | ModalPago | component |
| MP-14 | efectivo no muestra el campo N° transacción | ModalPago | component |
| MP-15 | credito con TRX vacío en blur muestra error obligatorio | ModalPago | component |
| MP-16 | skeleton placeholder mientras carga workers, evita layout shift | ModalPago | component |

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
| I-113 | REGRESIÓN: GET /api/cuentas-pagar filtra cuentas con monto ≤ 0 (no sirve cuentas $0 al frontend) | GET /api/cuentas-pagar | integration |
| I-316 | REGRESIÓN: GET /api/proveedores/stats filtra cuentas con monto ≤ 0 en agregación | GET /api/proveedores/stats | integration |
| SP-09 | REGRESIÓN: cuenta con monto $0 excluida de lista pendiente (no aparece con botón Pagar) | SuppliersPage | component |
| KPI-01 | KPIs globales no-cero sin proveedor seleccionado (regresión: enabled guard ocultaba queries) | SuppliersPage | component |
| KPI-02 | Card Vencidas muestra monto específico de vencidas no total pendiente (regresión: usaba totalPendiente) | SuppliersPage | component |
| KPI-03 | Card Próx. a vencer muestra monto de próximos a vencer | SuppliersPage | component |
| KPI-04 | Card OC en Proceso cuenta órdenes pendientes | SuppliersPage | component |
| KPI-05 | Sin proveedor seleccionado la query usa queryKey con "all" (global, no enabled guard) | SuppliersPage | component |
| KPI-06 | REGRESIÓN: invalidar cuentas/ordenes-proveedor sin proveedor seleccionado usa key "all" (no undefined) | SuppliersPage | component |

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
| U-124 | REGRESIÓN: crearAsiento reintenta el ciclo completo (nuevo numero_asiento + insert) cuando journal_detail falla en el 1er intento y tiene éxito en el 2do — causa raíz real confirmada contra producción: venta 20260707-9CE8F125 con asiento COGS pero sin asiento de ingreso, sin colisión de numero_asiento ni venta concurrente | lib/contabilidad | unit |
| U-125 | crearAsiento retorna null y hace rollback (delete) tras agotar los reintentos si journal_detail falla en todos los intentos | lib/contabilidad | unit |
| U-126 | crearAsiento loguea el número de intentos agotados cuando journal_detail falla persistentemente | lib/contabilidad | unit |
| U-127 | isClerkDevKey / checkClerkEnv — detecta claves dev de Clerk (pk_test_/sk_test_) y advierte en producción | lib/clerk-env | unit |
| U-127l | REGRESIÓN: isClerkDevKey también detecta el formato legacy "test_" (sin pk_/sk_) que @clerk/shared todavía reconoce | lib/clerk-env | unit |
| U-127m | isClerkDevKey NO detecta "live_" (formato legacy) como desarrollo | lib/clerk-env | unit |
| U-120 | generateBoletaPDF — sin descuento, Subtotal = neto (total − impuesto); no diferencia el código pre-fix (coincide matemáticamente cuando descuento=0), es cobertura de no-regresión | lib/reports/pdf-generator | unit |
| U-121 | REGRESIÓN: generateBoletaPDF — con descuento, Subtotal + IVA sigue sumando exactamente Total (antes daba neto del bruto pre-descuento, no del total) | lib/reports/pdf-generator | unit |
| U-122 | buildBoletaEmailHTML — sin descuento, Subtotal = neto (total − impuesto); no diferencia el código pre-fix (coincide matemáticamente cuando descuento=0), es cobertura de no-regresión | lib/email | unit |
| U-123 | REGRESIÓN: buildBoletaEmailHTML — con descuento, Subtotal + IVA sigue sumando exactamente Total (antes daba neto del bruto pre-descuento, no del total) | lib/email | unit |
| S-40 | REGRESIÓN: calcularTotalCarrito(items, descuento) coincide con state.total() tras el merge real de rehidratación de Zustand persist | stores/pos | unit |
| S-41 | Múltiples set() síncronos consecutivos (addItem en tanda) no pierden mutaciones — el total final refleja todos los items | stores/pos | unit |
| S-42 | Re-aplicar el merge de rehidratación con el mismo contenido (nueva referencia de objeto) es idempotente — no duplica items ni altera el total | stores/pos | unit |

## IVA — extracción canónica (IVA-01 a IVA-10)

Archivo: `tests/unit/lib/iva-calculo.test.ts`. Testean los helpers reales
`extraerIva()`/`netoDesdeBruto()` de `src/lib/tax.ts` (fuente única de la regla
"precios brutos, IVA extraído"). Reemplaza la versión anterior del archivo, que
afirmaba la fórmula aditiva obsoleta contra una réplica local.

| ID | Requisito | Lib | Tipo |
|----|-----------|-----|------|
| IVA-01 | REGRESIÓN: $15.458 bruto → IVA $2.468 (extracción), no $2.937 (aditiva) — caso real Whiskas | lib/tax | unit |
| IVA-02 | REGRESIÓN: $23.458 bruto → IVA $3.745, no $4.457 — caso real Whiskas+Bravery 20260622-0E91ECC3 | lib/tax | unit |
| IVA-03 | $119.000 bruto → IVA $19.000, neto $100.000 (valores exactos) | lib/tax | unit |
| IVA-04 | $0 → IVA $0, neto $0 | lib/tax | unit |
| IVA-05 | $1 → IVA $0, neto $1 (fracción descartada, neto absorbe) | lib/tax | unit |
| IVA-06 | IVA y neto enteros para cualquier bruto entero | lib/tax | unit |
| IVA-07 | PROPIEDAD (fast-check): extraerIva(t) + netoDesdeBruto(t) === t ∀ t entero ≥ 0 | lib/tax | property |
| IVA-08 | PROPIEDAD (fast-check): IVA extraído = 19% del neto ±1 peso ∀ t entero ≥ 0 | lib/tax | property |
| IVA-09 | IVA se extrae del total post-descuento ($10.000 −10% → IVA $1.437) | lib/tax | unit |
| IVA-10 | REGRESIÓN: $45.208 → IVA $7.218 siempre, nunca $8.590 (consistencia mayo vs junio) | lib/tax | unit |

## IVA — cobertura en otras capas (S-20 a S-27, I-405, I-REC-10 a I-REC-12)

Mismo bug de IVA-01/02 (fórmula aditiva vs. extracción), cubierto además en las
capas que consumen `extraerIva()`/`netoDesdeBruto()` en vez de recalcular:
carrito POS, persistencia de la venta y HTML del recibo. IDs ya existían en el
código desde los commits 779a68f/866c60a pero no estaban registrados aquí.

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| S-20 | impuesto() extrae IVA del subtotal (precio ya incluye IVA) | stores/pos | unit |
| S-21 | impuesto() extrae IVA del total con descuento | stores/pos | unit |
| S-23 | impuesto() coincide con la fórmula del ModalPago (sub − desc) × (0.19/1.19) | stores/pos | unit |
| S-27 | REGRESIÓN: Whiskas 1kg $15.458 con IVA incluido → IVA extraído = $2.468, no $2.937 (aditiva) | stores/pos | unit |
| I-405 | REGRESIÓN: producto $15.458 con IVA incluido → p_impuesto persistido = $2.468, no $2.937 (aditiva) | POST /api/ventas | integration |
| I-REC-10 | Descuento 10% sobre $44.800 muestra "(10%)" y "-$4.480" en el HTML del recibo, no "-$10" | GET /api/recibos/[ventaId] | integration |
| I-REC-11 | Sin descuento el recibo muestra "Neto (sin IVA)" correcto y no duplica TOTAL como Subtotal | GET /api/recibos/[ventaId] | integration |
| I-REC-12 | Con descuento el recibo muestra subtotal c/IVA, descuento, neto y total coherentes | GET /api/recibos/[ventaId] | integration |

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
| I-93 | REGRESIÓN: con >10 productos bajo mínimo, el campo `total` refleja el conteo real (11), no el largo de `items` recortado a 10 — evita que el dashboard subestime el conteo frente a Inventario | GET /api/dashboard/stock-alertas | integration |

## Dashboard Alerts Component (DA-01 a DA-06)

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| DA-01 | Sin alertas → widget muestra "Todo el stock sobre mínimo" | AnaliticaTab | component |
| DA-02 | Con alertas → lista productos y contador | AnaliticaTab | component |
| DA-03 | stock === stock_minimo se considera alerta (regresión) | AnaliticaTab | component |
| DA-04 | stock=0, mínimo=0 se considera alerta | AnaliticaTab | component |
| DA-05 | fetch de stock-alertas falla → widget vacío sin error | AnaliticaTab | component |
| DA-06 | REGRESIÓN: con >10 alertas, el contador del badge usa `total` (conteo real) y no `items.length` (lista recortada a 10) | AnaliticaTab | component |

## POS Page Cache y auto-asignación de vendedor (PP-05 a PP-11)

PP-07 a PP-11: regresión "Ventas hoy $0" — el useEffect de pos/page.tsx que
auto-asigna workerClerkId al userId de la sesión (ver también I-68, I-409,
I-410). Archivo: tests/components/pos-worker-auto-assign.test.tsx.
Renombrados desde PC-01..05: ese prefijo está reservado para tests de
Carrito (ver sección siguiente) y colisionaba con PC-05 ya registrado ahí.

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| PP-05 | Completar venta invalida ["productos"] y ["ventas"] con refetchType "all" | POSPage | component |
| PP-06 | REGRESIÓN: el botón Cobrar computa el total con calcularTotalCarrito(items, descuento) del mismo render, coincide con la suma de subtotales menos descuento | POSPage | component |
| PP-07 | useEffect asigna workerClerkId al userId cuando el componente monta | POSPage | component |
| PP-08 | useEffect no asigna worker cuando userId es null (Clerk loading) | POSPage | component |
| PP-09 | useEffect asigna worker cuando userId cambia de null a un valor (Clerk carga después) | POSPage | component |
| PP-10 | useEffect no sobreescribe workerClerkId si ya se inicializó para el mismo userId (preserva selección manual) | POSPage | component |
| PP-11 | REGRESIÓN: useEffect resetea worker cuando un usuario diferente se loguea (cambio de turno) | POSPage | component |
| PP-12 | El stock en la grilla de productos (SearchProductos real, no mockeado) se actualiza automáticamente tras una venta exitosa, sin recargar la página — investigado como reporte de bug, no reprodujo contra el código actual; test agregado como regresión permanente | POSPage | component |
| PP-13 | clearCart se llama tras venta exitosa y botón Cobrar cambia a Carrito vacío (regresión: carrito no se limpiaba tras venta) | POSPage | component |

## POS Carrito — footer tras rehidratación (PC-05 a PC-15)

Regresión: el footer del carrito (Subtotal/Descuento/IVA/Total) mostraba "$0"
tras recargar /pos con un carrito persistido en localStorage, porque
Carrito.tsx llamaba a los getters `subtotal()`/`impuesto()`/`total()` del store
(que leen `get()` en el momento de la invocación) en vez de derivarlos de los
`items`/`descuento` ya destructurados en el mismo render — ver la invariante
documentada en `src/stores/pos.ts`. PC-13 usa el mecanismo real de rehidratación
de Zustand persist en vez de simular el estado con `setState()` — verificado que
`hydrate()` es SÍNCRONO para `localStorage` (no asíncrono, corrección sobre la
suposición original — ver comentario en el archivo). PC-14/PC-15 reproducen,
con `renderToString` + `hydrateRoot` + `act` reales, el mecanismo que sí puede
desincronizar servidor y cliente: `useSyncExternalStore`'s `getServerSnapshot`
fijado al estado pre-hidratación de `persist`.

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| PC-05 | Muestra subtotal neto (sin IVA) cuando hay items en el carrito | Carrito | component |
| PC-06 | Subtotal neto se actualiza al agregar múltiples items | Carrito | component |
| PC-07 | Subtotal neto con descuento muestra neto correcto | Carrito | component |
| PC-08 | Footer correcto en el primer render con el carrito ya rehidratado (simulado), sin interacción del usuario | Carrito | component |
| PC-09 | Escenario adyacente "crear": tras rehidratar, addItem recalcula el total con el item nuevo incluido | Carrito | component |
| PC-10 | Escenario adyacente "editar": tras rehidratar, updateQuantity recalcula el total del item persistido | Carrito | component |
| PC-11 | Escenario adyacente "requests concurrentes": múltiples addItem síncronos tras rehidratar no pierden ninguna mutación | Carrito | component |
| PC-12 | Escenario adyacente "re-guardado sin cambios": re-aplicar la misma rehidratación (nueva referencia, mismos datos) mantiene el total correcto | Carrito | component |
| PC-13 | REGRESIÓN (rehidratación REAL de Zustand persist, no simulada): con carrito persistido en localStorage, el footer converge al total real tras la rehidratación real de persist | Carrito | component |
| PC-14 | REGRESIÓN (SSR + hydrateRoot reales): servidor sin localStorage (carrito vacío) + hidratación con carrito persistido converge al total real ($15.458) sin waitFor | Carrito | component |
| PC-15 | Sin carrito persistido, SSR + hydrateRoot reales mantienen el estado vacío coherente (no inventa contenido) | Carrito | component |

## Devolución Modal Cache (DV-14)

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| DV-14 | Confirmar devolución invalida ["venta", id], ["ventas"], ["notas-credito", id] y ["saldo", clienteId] con refetchType "all" | DevolucionModal | component |

## Devolución Modal Motivo (DV-15 a DV-17)

Regresión: el ModalOverlay llamaba `focus()` en el overlay en cada re-render porque `onClose`
cambiaba de referencia, robando el foco del input de motivo. El fix estabilizó la dependencia
del efecto a solo `[open]`, usando una ref para `onClose` (commit 1270b13; ver también MO-01 a
MO-06 en ModalOverlay.test.tsx e IV-02/IV-03 para la misma regresión en InventoryPage).
DV-15/DV-16 verifican el valor final con un solo `fireEvent.change` (todo el texto de una vez),
lo que no ejercita el mecanismo real (re-render por cada keystroke). DV-17 cierra ese gap
verificando directamente que `ModalOverlay` (real, no mockeado en este archivo) no vuelve a
llamar `focus()` tras un cambio de estado — el mecanismo exacto del bug.

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| DV-15 | REGRESIÓN: motivo completo con acentos se envía en el body del fetch | DevolucionModal | component |
| DV-16 | REGRESIÓN: motivo vacío se envía como null en el body | DevolucionModal | component |
| DV-17 | REGRESIÓN: escribir en Motivo no vuelve a robar el foco del ModalOverlay real | DevolucionModal | component |

## LotesPanel — formulario de Lote, Notas (LP-01 a LP-03)

Tercera superficie con el mismo bug de raíz (ModalOverlay, commit 1270b13):
`onClose={() => { setShowForm(false); setEditando(null); }}` es una función
inline con referencia nueva en cada render, igual que DevolucionModal e
InventoryPage. LotesPanel nunca tuvo test de componente propio — este
archivo (`tests/components/LotesPanel.test.tsx`) es nuevo. LP-01 usa el
mismo mecanismo de verificación que DV-17 (conteo de llamadas a `focus()`
del ModalOverlay real); LP-02/LP-03 son el equivalente a DV-15/DV-16 para el
campo Notas del formulario de Agregar/Editar Lote.

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| LP-01 | REGRESIÓN: escribir en Notas no vuelve a robar el foco del ModalOverlay real | LotesPanel | component |
| LP-02 | REGRESIÓN: el texto completo de Notas se envía en el body del POST /api/lotes, no truncado | LotesPanel | component |
| LP-03 | Notas vacío se envía como null en el body del POST | LotesPanel | component |
| LP-04 | REGRESIÓN: crear lote invalida ["productos"] con refetchType "all" (POS refleja stock recalculado desde lotes sin recargar) | LotesPanel | component |

## ModalOverlay — foco y cierre (MO-01 a MO-06)

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| MO-01 | Renderiza children cuando open=true | ModalOverlay | component |
| MO-02 | No renderiza cuando open=false | ModalOverlay | component |
| MO-03 | Llama onClose al hacer click fuera | ModalOverlay | component |
| MO-04 | NO llama onClose al hacer click dentro | ModalOverlay | component |
| MO-05 | Llama onClose al presionar Escape | ModalOverlay | component |
| MO-06 | Solo enfoca el overlay cuando se abre, no en re-renders con onClose distinto | ModalOverlay | component |

## ModalCliente — fidelización descuento automático (MC-27 a MC-31)

Regresión: al confirmar un cliente existente en el POS, el descuento de fidelización
no se aplicaba automáticamente porque `handleConfirm` leía `fidelizacion?.descuento_actual`
de una TanStack Query que podía no haber completado, pasando `0` en vez del valor real.
Se corrigió usando `await refetchFid()` dentro de `handleConfirm`. A nivel de store,
`setCliente()` guardaba `fidelizacionDescuento` pero nunca escribía `descuento` (el
campo que consume `calcularTotalCarrito`) — corregido en `stores/pos.ts` (ver S-28 a
S-31 en `tests/unit/lib/pos-store.test.ts`). MC-27 a MC-30 prueban la capa de
ModalCliente con `@/stores/pos` mockeado (verifican los argumentos pasados a
`setCliente`); MC-31 cierra el último eslabón: store real (sin mock) + ModalCliente
real + Carrito real, verificando que el total mostrado en pantalla queda descontado
sin ninguna acción manual del vendedor.

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| MC-27 | REGRESIÓN: confirmar cliente con descuento_actual=10 aplica 10 como fidelizacionDescuento | ModalCliente | component |
| MC-28 | REGRESIÓN: confirmar cliente sin fidelización pasa descuento 0 | ModalCliente | component |
| MC-29 | REGRESIÓN: confirmar cuando fidelización retorna null aplica descuento 0 | ModalCliente | component |
| MC-30 | REGRESIÓN: confirmar con mascota seleccionada y descuento 10% | ModalCliente | component |
| MC-31 | REGRESIÓN (punta a punta, store real): confirmar cliente con 10% de fidelización descuenta el total mostrado en Carrito sin clic manual | ModalCliente + Carrito | component |

## Optimizador IA de Vencimientos — integración (I-AI-01 a I-AI-18)

Regresión verificada contra datos reales de producción (26-05-2026): una
recomendación cacheada referenciaba "Alimento Perro Pro Plan 3kg"
(`activo=false` en el catálogo actual) — I-AI-09 cubre exactamente ese caso
(producto inactivo/eliminado). I-AI-13 cubre una variante adyacente
descubierta al revisar la completitud del fix: un producto **activo** cuyo
`fecha_vencimiento` se limpió (seguimiento de vencimiento desactivado) tras
el análisis cacheado — sin este fix, `dias_hasta_vencer` quedaba con el
valor cacheado obsoleto en vez de marcarse como obsoleto igual que un
producto inactivo.

I-AI-14 a I-AI-18 cubren un defecto distinto reportado en Inventario >
Optimizador de Vencimientos: GET refresca Días/Stock contra el catálogo
actual, pero razon/mensaje_whatsapp/urgencia/estrategia/descuento del LLM
no se regeneran — quedan del análisis original. Sin señal por fila, la
misma fila mostraba texto "vence en 1 día, 90 unidades" junto a columnas
Días=105/Stock=101 sin ninguna advertencia visible (el badge global "Puede
estar desactualizado" solo depende de la antigüedad de `created_at`, no de
si esa fila específica cambió). El fix persiste `fecha_vencimiento` junto a
cada recomendación al analizar (I-AI-18) y en GET compara stock/
fecha_vencimiento cacheados contra el catálogo actual para marcar
`datos_desactualizados` por fila (I-AI-14, I-AI-15), sin falsos positivos en
el caso feliz (I-AI-16) ni en análisis cacheados antes de este fix que no
tienen `fecha_vencimiento` persistida (I-AI-17).

| ID | Requisito | Route | Tipo |
|----|-----------|-------|------|
| I-AI-01 | POST rechaza no autenticado con 401 | POST /api/ai/vencimientos/optimizar | integration |
| I-AI-02 | POST rechaza storeWorker con 403 | POST /api/ai/vencimientos/optimizar | integration |
| I-AI-03 | POST retorna 503 si OPENROUTER_API_KEY no configurada | POST /api/ai/vencimientos/optimizar | integration |
| I-AI-04 | POST retorna recomendaciones vacías si no hay productos próximos a vencer | POST /api/ai/vencimientos/optimizar | integration |
| I-AI-05 | POST llama a analizarVencimientosConIA y retorna recomendaciones | POST /api/ai/vencimientos/optimizar | integration |
| I-AI-06 | POST incluye unidades_vendidas_30d en datos al LLM | POST /api/ai/vencimientos/optimizar | integration |
| I-AI-07 | POST retorna 502 si el LLM lanza error | POST /api/ai/vencimientos/optimizar | integration |
| I-AI-08 | POST filtra producto_id que LLM alucinó (no existe en input) | POST /api/ai/vencimientos/optimizar | integration |
| I-AI-09 | GET filtra recomendaciones cacheadas de inactivos y reporta productos_obsoletos | GET /api/ai/vencimientos/optimizar | integration |
| I-AI-10 | Reintenta una vez cuando el primer intento hace timeout y el segundo responde | POST /api/ai/vencimientos/optimizar | integration |
| I-AI-11 | Retorna 502 si ambos intentos (original + reintento) hacen timeout | POST /api/ai/vencimientos/optimizar | integration |
| I-AI-12 | No reintenta cuando el error no es de timeout (ej. API key inválida) | POST /api/ai/vencimientos/optimizar | integration |
| I-AI-13 | REGRESIÓN: GET trata como obsoleta una recomendación de un producto activo sin fecha_vencimiento (seguimiento de vencimiento desactivado) | GET /api/ai/vencimientos/optimizar | integration |
| I-AI-14 | REGRESIÓN: GET marca datos_desactualizados=true cuando el stock cambió desde el análisis | GET /api/ai/vencimientos/optimizar | integration |
| I-AI-15 | REGRESIÓN: GET marca datos_desactualizados=true cuando fecha_vencimiento cambió desde el análisis (nuevo lote) | GET /api/ai/vencimientos/optimizar | integration |
| I-AI-16 | GET no marca datos_desactualizados cuando stock y fecha_vencimiento coinciden con el análisis cacheado | GET /api/ai/vencimientos/optimizar | integration |
| I-AI-17 | Análisis cacheado sin fecha_vencimiento persistida (previo al fix) no genera falso positivo por fecha | GET /api/ai/vencimientos/optimizar | integration |
| I-AI-18 | POST persiste fecha_vencimiento del producto en cada recomendación guardada | POST /api/ai/vencimientos/optimizar | integration |

## OpenRouter — analizarVencimientosConIA (U-OR-01 a U-OR-07)

| ID | Requisito | Lib | Tipo |
|----|-----------|-----|------|
| U-OR-01 | LLamada a OpenRouter incluye Authorization y HTTP-Referer | lib/openrouter | unit |
| U-OR-02 | LLM responde JSON válido → array de recomendaciones | lib/openrouter | unit |
| U-OR-03 | Respuesta envuelta en ```json ... ``` se limpia correctamente | lib/openrouter | unit |
| U-OR-04 | HTTP 401 → error con mensaje "API key inválida" | lib/openrouter | unit |
| U-OR-05 | LLM devuelve texto no parseable → error "no parseable" | lib/openrouter | unit |
| U-OR-06 | Entrada con urgencia inválida se descarta, válidas se conservan | lib/openrouter | unit |
| U-OR-07 | Timeout 20s en fetch a OpenRouter → error "no respondió a tiempo" | lib/openrouter | unit |

## OpenRouter — recomendarProductosEnPOS (U-REC-01 a U-REC-07)

| ID | Requisito | Lib | Tipo |
|----|-----------|-----|------|
| U-REC-01 | LLamada a OpenRouter incluye cabeceras correctas | lib/openrouter | unit |
| U-REC-02 | Retorna exactamente N recomendaciones (máx 3) | lib/openrouter | unit |
| U-REC-03 | Entrada con urgencia inválida se descarta | lib/openrouter | unit |
| U-REC-04 | LLM devuelve texto no parseable → error | lib/openrouter | unit |
| U-REC-05 | Bloques markdown ```json se limpian | lib/openrouter | unit |
| U-REC-06 | Limita a 3 recomendaciones aunque LLM devuelva más | lib/openrouter | unit |
| U-REC-07 | Timeout 20s en fetch a OpenRouter → error "no respondió a tiempo" | lib/openrouter | unit |

## OptimizadorVencimientosTab (C-OPT-01 a C-OPT-15)

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| C-OPT-01 | Botón 'Analizar con IA' e input de días se renderizan | OptimizadorVencimientosTab | component |
| C-OPT-02 | Spinner visible mientras analiza | OptimizadorVencimientosTab | component |
| C-OPT-03 | Tabla con recomendaciones después del análisis | OptimizadorVencimientosTab | component |
| C-OPT-04 | Badge de urgencia 'alta' tiene clase rojo | OptimizadorVencimientosTab | component |
| C-OPT-05 | Botón 'Aplicar descuento' llama PATCH y muestra ✓ Aplicado | OptimizadorVencimientosTab | component |
| C-OPT-06 | Botón WhatsApp copia mensaje al portapapeles | OptimizadorVencimientosTab | component |
| C-OPT-07 | Estado vacío cuando no hay productos próximos a vencer | OptimizadorVencimientosTab | component |
| C-OPT-08 | Servidor retorna HTML en vez de JSON → error amigable (no Unexpected token '<') | OptimizadorVencimientosTab | component |
| C-OPT-09 | Muestra advertencia cuando productos_obsoletos > 0 (recomendaciones filtradas por catálogo obsoleto) | OptimizadorVencimientosTab | component |
| C-OPT-10 | Timeout defensivo del cliente (55s) ante backend que no responde → mensaje amigable | OptimizadorVencimientosTab | component |
| C-OPT-11 | REGRESIÓN: fila muestra aviso "Texto desactualizado" cuando datos_desactualizados=true (texto de análisis viejo junto a columnas Días/Stock en vivo) | OptimizadorVencimientosTab | component |
| C-OPT-12 | Fila NO muestra aviso cuando datos_desactualizados es false/ausente | OptimizadorVencimientosTab | component |
| C-OPT-13 | REGRESIÓN: botón "Aplicar descuento" deshabilitado cuando datos_desactualizados=true (no debe permitir aplicar precio obsoleto) | OptimizadorVencimientosTab | component |
| C-OPT-14 | REGRESIÓN: handleAplicarDescuento no ejecuta PATCH cuando datos_desactualizados=true (muestra error en vez de mutar producto) | OptimizadorVencimientosTab | component |
| C-OPT-15 | REGRESIÓN: botón "Aplicar descuento" en diálogo de detalle deshabilitado cuando datos_desactualizados=true | OptimizadorVencimientosTab | component |

## RecomendacionesIA (C-REC-01 a C-REC-11)

| ID | Requisito | Componente | Tipo |
|----|-----------|------------|------|
| C-REC-01 | No renderiza cuando clienteId es undefined | RecomendacionesIA | component |
| C-REC-02 | Muestra 'Buscando sugerencias' mientras carga | RecomendacionesIA | component |
| C-REC-03 | Muestra nombre, razón y precio de cada recomendación | RecomendacionesIA | component |
| C-REC-04 | Botón + llama a addItem del store | RecomendacionesIA | component |
| C-REC-05 | API retorna error → muestra 'Sin sugerencias disponibles' | RecomendacionesIA | component |
| C-REC-06 | Badges de urgencia con colores correctos | RecomendacionesIA | component |
| C-REC-07 | Botón cambia a ✓ después de agregar producto | RecomendacionesIA | component |
| C-REC-08 | No recarga cuando items cambian (solo clienteId/mascotaId) | RecomendacionesIA | component |
| C-REC-09 | Servidor retorna HTML en vez de JSON → 'Sin sugerencias disponibles' (previene Unexpected token '<') | RecomendacionesIA | component |
| C-REC-10 | REGRESIÓN: muestra 'Buscando sugerencias' inmediatamente al seleccionar cliente, antes del debounce de 800ms — evita layout shift que empuja el botón "Cobrar" en pos/page.tsx | RecomendacionesIA | component |
| C-REC-11 | REGRESIÓN: sin recomendaciones tras cargar → muestra mensaje neutral en vez de desmontarse (evita el salto inverso del layout) | RecomendacionesIA | component |

## Convención de IDs

- `I-NNN` — test de integración de ruta API
- `SEC-NN` — test de seguridad
- `U-NN` — test unitario de lib
- `PROP-NN` — test de propiedad (fast-check)
- `COD-NN` — test de componente de orden de compra
- `VS-NN` — test de componente de historial de ventas
- `RD-NN` — test de redirección de ruta
- `DA-NN` — test de componente de dashboard / alertas (AnaliticaTab)
- `IVA-NN` — test de la fórmula canónica de IVA (lib/tax)
- `PP-NN` — test de componente de POSPage
- `PC-NN` — test de componente de Carrito (POS)
- `IV-NN` — test de componente de InventoryPage
- `MC-NN` — test de componente de ModalCliente
- `DV-NN` — test de componente de DevolucionModal
- `S-NN` — test de store (Zustand)
- `I-REC-NN` — test de integración de GET /api/recibos/[ventaId]
- `LP-NN` — test de componente de LotesPanel
- `I-NCC-NN` — test unitario de lineasNotaCreditoCOGS (lib/contabilidad/generador-asientos)
- `I-NCC-INT-NN` — test de integración del reverso de COGS en POST /api/notas-credito
- `I-NCC-BF-NN` — test de integración del reverso de COGS en el backfill de NC

Al agregar un test nuevo, asignar el próximo ID disponible en la categoría correspondiente y registrarlo aquí antes de hacer commit.
