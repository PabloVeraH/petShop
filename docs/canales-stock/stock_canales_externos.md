# Stock y canales externos — contexto, decisiones y plan de ejecución

> **Documento de traspaso.** Escrito el 2026-09-24 para que cualquier agente
> (Claude, Codex, Cursor u otro LLM) o persona pueda retomar el trabajo sin
> contexto previo. Si se corta la sesión, **empieza aquí**.
>
> Estado global: **Fase 0 completa. Fase 1 (sin granel) IMPLEMENTADA — migraciones 074–076 PENDIENTES DE APLICAR** (requieren confirmación del usuario; luego correr `stock_canales_fase1_verificacion.sql`). Siguiente: aplicar y verificar Fase 1 → Fase 1b (granel).
> Actualiza la sección [§9 Registro de progreso](#9-registro-de-progreso) al
> terminar cada paso.

---

## 0. Cómo usar este documento (leer antes de tocar código)

1. Lee `AGENTS.md` (raíz del repo) completo. Sus reglas **prevalecen** sobre
   este documento. Las críticas para este trabajo:
   - §0.1: `wnxrdbnvreofrrmhcybc` es el **único** Supabase (entorno de demo,
     sin staging; sus datos no deben perderse — AGENTS.md actualizado el
     2026-09-24). **Ninguna migración se aplica sin confirmación explícita
     del usuario.** Crear el archivo SQL sí está permitido.
   - §0.2 / §6: todas las rutas usan service role → el filtro `store_id`
     manual es la única protección multi-tenant.
   - §0.7 / §11.3: `src/types/index.ts` es manual → actualizar tipos en el
     mismo cambio que la migración.
   - §0.8 / §23.3: precios brutos (IVA incluido); usar `extraerIva()` /
     `netoDesdeBruto()` de `src/lib/tax.ts`.
   - §23.5: anular una venta **solo** vía `anular_venta_tx` (RPC).
   - §2 (gates) y §19.1 (tests backend **y** frontend, funcionamiento **y**
     seguridad) y §22 (formato de cierre) son obligatorios por fase.
   - §2.3: antes de asignar IDs de test, greppear `docs/spec-registry.md` **y**
     `tests/`.
2. Antes de cada fase, **re-verifica** los hallazgos de §3 que la fase toca: el
   código pudo cambiar después de escribirse este documento. Los números de
   línea son orientativos.
3. Trabaja en rama propia desde `develop` (ej. `feat/canales-stock-fase-N`).
   Commits solo si el usuario lo pide (regla del harness).
4. Si encuentras una contradicción entre este documento y el código/schema
   real, **el código/schema real manda** (AGENTS.md §3). Anota la discrepancia
   en §9.
5. Las decisiones de §2 son del usuario. No las cambies; si una resulta
   inviable, detente y pregunta.

---

## 1. Contexto del negocio

- petShop es un sistema multi-tienda (Next.js App Router + Supabase + Clerk)
  con POS propio y "canales externos" de delivery: **Rappi, PedidosYa,
  UberEats** (Instagram existe pero es de publicaciones, no de órdenes; queda
  fuera de este plan).
- **A la fecha (2026-09-24) no se reciben órdenes reales de ningún canal
  externo.** El flujo nunca funcionó de punta a punta (ver §3). No hay datos
  históricos de canal que migrar/proteger, salvo lo que exista en
  `canal_config` (verificar).
- Expectativa del usuario: al habilitar un producto para un canal, ese canal
  debe reflejar el stock real y apagarse automáticamente cuando corresponda.

---

## 2. Decisiones del usuario (vinculantes)

| # | Decisión |
|---|----------|
| D1 | **Un solo stock total por producto**, tenga lotes o no. `productos.stock` es la cifra única. 100 unidades en 2 lotes de 50 = stock 100. |
| D2 | **Nunca** se permite una venta (ningún canal, incluido POS) mayor que el stock disponible. Hay que validarlo de forma atómica en BD, no solo en JS. |
| D3 | FIFO por lotes: una venta mayor que el lote más antiguo consume ese lote completo y continúa con el siguiente. (Ya es así en `deducir_stock_fifo`; solo falla si la **suma** de lotes no alcanza — ver §3.1.) |
| D4 | **Cupo de canales externos = `stock − stock_minimo`.** El POS puede vender hasta 0; los canales externos solo hasta `stock_minimo` (que también es el umbral de "hay que reponer"). Con `stock ≤ stock_minimo` el producto se **apaga** en todos los canales externos; al superar el mínimo se **enciende**. |
| D5 | **Aceptación automática** de órdenes. Las plataformas cobran al cliente antes de enviar la orden; al llegar se trata como una venta pagada (igual que un pago en POS): se acepta y se descuenta stock. |
| D6 | **Sin reservas de stock.** Consecuencia de D5 (no hay ventana entre recepción y aceptación). El código de `stock_reservas` se elimina. |
| D7 | **Precio por canal = precio base × (1 + recargo_pct del canal)**, con **override opcional por producto**. |
| D8 | El `storeWorker` **no** acepta/rechaza (es automático); solo **prepara físicamente** la orden y la marca "lista para retiro". Configuración, catálogo y precios: solo `storeAdmin`/`systemAdmin`. |
| D9 | **Todos los canales no-POS funcionan igual**: un pipeline común de negocio; los adaptadores solo traducen. Aplicar buenas prácticas de arquitectura (ver §5). |
| D10 | El usuario quiere obtener acceso de partner a las APIs (ver §7), pero aún no sabe cómo. |
| D11 | **Stock suelto + lote nuevo:** si un producto tiene stock sin lotes (ej. 100) y se registra su primer lote (ej. 50), las 100 existentes se convierten **automáticamente en el primer lote** y las 50 nuevas en el segundo → stock 150 (lote 1 = 100, lote 2 = 50). Invariante resultante: *un producto con al menos un lote tiene TODO su stock en lotes* (`productos.stock = Σ lotes activos`). |
| D12 | Vercel está en plan **Hobby** (cron máx. 1 vez/día) → reintentos y barridos con **Supabase `pg_cron` + `pg_net`** (§7.1). |
| D13 | Precio base para el recargo: `precio_oferta` si `en_oferta`, si no `precio`. |
| D14 | Redondeo del precio con recargo: **hacia arriba a la decena** ($10). |
| D15 | Licencia vencida: **apagar todo** en los canales externos; órdenes ya en curso se procesan. |
| D16 | Carrera de disponibilidad: si llega una orden pagada con stock físico suficiente pero bajo el mínimo, **se acepta** (el mínimo es margen de seguridad) y el producto se apaga de inmediato. Solo se rechaza si no hay stock físico. |
| D17 | Comisiones: se contabilizan **al conciliar la liquidación real** de cada plataforma. |
| D18 | **Granel:** se vende solo en POS (fracción de saco en gramos). Los canales externos venden **solo sacos enteros**. El POS tiene la acción **"Abrí un saco nuevo"** (manual) y además la apertura **forzada** cuando la venta no alcanza. Diseño en §4.6. |
| D19 | Granel — riesgos aprobados (§4.6): apertura forzada por el sistema (G1); devoluciones/anulaciones devuelven gramos al saco abierto (G7); merma con **usuario que la registró guardado en BD** (G6); COGS proporcional (G5); saco abierto sale del lote más antiguo (G4); `peso_gramos` obligatorio (G8); **deshacer apertura solo `storeAdmin`/`systemAdmin`** (G2); un saco abierto por producto. |
| D21 | Primer lote de un producto con stock suelto: la UI **exige** la fecha de vencimiento del stock existente (LOTE-0), prellenada con `productos.fecha_vencimiento`. |
| D22 | Corrección de stock (incluye decimales heredados de S9) mediante **ajuste por conteo físico**, permitido **solo a `storeAdmin` y `systemAdmin`** con validación en el servidor; motivo obligatorio y auditoría. Sin backfill automático. |
| D23 | **Stock vendible = solo lotes vigentes** (POS y cupo de canales). La pantalla puede mostrar el total con aviso "X vencidas". Las unidades vencidas se dan de baja con una acción de **merma por vencimiento** (lote → `activo=false`, `stock_movements.tipo='merma'`, usuario registrado), solo `storeAdmin`/`systemAdmin`. Los lotes vencidos existentes al 2026-09-24 se dan de baja manualmente con `stock_canales_baja_vencidos.sql` (baja, no DELETE, para conservar la trazabilidad de `venta_item_lotes`). Nota: los datos de Supabase son de **demo**; AGENTS.md §0.1 ya lo refleja (commit `ac1f0a2`, 2026-09-24) y mantiene la confirmación explícita antes de escribir (es el único entorno). |
| D20 | **Una venta a granel descuenta del stock la proporción del saco**: `gramos / peso_gramos` (500 g de 15 kg = 0,0333 saco = 3,33 %). Abrir un saco no cambia el stock total (solo lo mueve de cerrado a abierto). |

---

## 3. Estado actual (hallazgos al 2026-09-24)

Clasificación AGENTS.md §1.1: todo lo de esta sección es **inferido** por
lectura de código/migraciones. **No** se verificó contra la BD real.

### 3.1 Stock (afecta a POS y canales)

| ID | Hallazgo | Evidencia |
|----|----------|-----------|
| S1 | `productos.stock` se recalcula como `SUM(cantidad_actual)` de lotes activos por el trigger `sync_stock_on_lote` (AFTER INSERT/UPDATE/DELETE en `lotes_producto`). Cumple D1 **solo** si el producto no tiene stock "suelto" fuera de lotes. | `migrations/026_lotes_producto.sql:86-112` |
| S2 | `crear_venta_tx` (versión vigente en 059): si el producto tiene lotes activos con cantidad > 0 → `deducir_stock_fifo`; si no → `decrement_stock`. | `migrations/059_ventas_idempotency_key.sql:156-176` |
| S3 | `deducir_stock_fifo` **ya** recorre lotes FIFO consumiendo uno y pasando al siguiente (D3 OK). Lanza excepción solo si la **suma** de lotes < cantidad pedida. No excluye lotes vencidos. | `migrations/044_venta_granel.sql:47-104` |
| S4 | **`decrement_stock` hace `SET stock = GREATEST(0, stock - p_cantidad)`**: si no alcanza, deja 0 y la venta pasa. Viola D2. | `migrations/044_venta_granel.sql:35-44` |
| S5 | El POS valida stock en JS antes de la transacción (no atómico → carrera con otra venta concurrente). La API mapea errores de BD con "stock"/"insuficiente" a 422. | `src/app/api/ventas/route.ts:149-160`, `:268` |
| S6 | **Pérdida de stock suelto:** si un producto tiene stock sin lotes (ej. 100) y se crea su primer lote (ej. 50) vía `POST /api/lotes` o recepción de OC con vencimiento, el trigger recalcula `stock = 50` → se pierden 100. Solo `PATCH /api/productos/[id]` crea un "LOTE-0" con el stock existente al activar vencimientos. | `src/app/api/lotes/route.ts:35-70`, `src/app/api/ordenes-compra/[id]/route.ts:150-175`, `src/app/api/productos/[id]/route.ts:132-151` |
| S7 | Ajuste manual de salida sin lotes: pre-check en JS + `Math.max(0, stock + delta)` leído-y-escrito (no atómico). | `src/app/api/inventario/[id]/route.ts:64-66`, `:173-177` |
| S8 | `productos.stock_minimo INTEGER NOT NULL DEFAULT 0`. Ya se usa como umbral de alerta (`stock <= stock_minimo`). | `migrations/000_base_schema.sql:174`, `src/app/api/inventario/route.ts:41` |
| S9 | **Granel descuenta kilos como si fueran sacos.** El POS envía `cantidad = kg` (500 g → 0.5) y `crear_venta_tx` descuenta esa `cantidad` de `productos.stock`, que cuenta **sacos/unidades**. Vender 500 g de un saco de 15 kg descuenta medio saco (7,5 kg). El COGS también se calcula `kg × costo` (costo es por saco). Además el pre-check de stock salta los ítems granel. Desde la migración 044 `productos.stock` es `NUMERIC(10,3)`, así que hoy pueden existir stocks fraccionarios (ej. 9.5). | `src/app/(app)/pos/components/SearchProductos.tsx:70-84`, `src/app/api/ventas/route.ts:149-190`, `migrations/044_venta_granel.sql:12-14` |
| S11 | Ajuste manual de stock existe (Inventario → "Ajustar" entrada/salida → `PATCH /api/inventario/[id]`), pero: (a) el endpoint **no valida rol en el servidor** — el menú oculta Inventario a `storeWorker` (`src/app/(app)/layout.tsx:14`), eso es solo UX; (b) solo acepta cantidades enteras (`InventarioUpdateSchema.cantidad.int()`), así que no puede corregir 9,5 → 9; (c) no existe "fijar al valor contado". Tampoco validan rol `POST /api/lotes` ni `PATCH /api/productos/[id]` (sí lo hace `PATCH/DELETE /api/lotes/[id]`). | `src/app/api/inventario/[id]/route.ts:8-12`, `src/lib/validation/inventario.ts:16-22` |
| S10 | `lotes_producto.fecha_vencimiento` es NOT NULL (según comentario en código); relevante para D11 porque el "lote de stock existente" puede no tener fecha conocida. Verificar en Fase 0. | `src/app/api/inventario/[id]/route.ts:50-60` |

### 3.2 Canales externos

| ID | Hallazgo | Evidencia |
|----|----------|-----------|
| C1 | **El webhook no es ruta pública**: el middleware solo exime `/api/webhooks/(.*)` y `/api/whatsapp/webhook`; `/api/canales/webhook/*` pasa por `auth.protect()` → la plataforma (sin sesión Clerk) es rechazada. | `src/middleware.ts:44-51`, `:81-83` |
| C2 | El webhook solo instancia Rappi (`if canalId === "rappi"`); PedidosYa/UberEats → 400 "Canal no soportado". | `src/app/api/canales/webhook/[canal]/route.ts:50-55` |
| C3 | Se guarda `payload = rawOrder` (evento Rappi con `order_detail.items[].price`), pero `aceptarOrdenExterna` lee `payload.items[].unit_price` → "Orden sin items" siempre. | `src/lib/canales/rappi/adapter.ts:129-144`, `src/lib/canales/hub.ts:302-307` |
| C4 | Todas las llamadas al adaptador pasan `externalStoreId: ""` y `credentials: {}` → Rappi lanza "integrationId no configurado"; PedidosYa/UberEats arman URLs `/stores//...`. | `src/app/api/canales/catalog/route.ts:64-70`, `src/lib/canales/hub.ts:472-478`, `src/app/api/canales/orders/[id]/reject/route.ts:52-58` |
| C5 | Credenciales desalineadas: la config exige para Rappi `api_key, api_secret, store_id, webhook_secret`; `rappi/auth.ts` lee `client_id, client_secret`. | `src/app/api/canales/config/route.ts:8-13`, `src/lib/canales/rappi/auth.ts:36-50` |
| C6 | Catálogo: publica **todos** los productos activos; precio = `canal_producto_config.precio ?? 0`. Nada escribe `canal_producto_config` (no hay UI ni API). No se envía stock. | `src/app/api/canales/catalog/route.ts:37-59` |
| C7 | `setAvailability()` existe en todos los adaptadores y **nadie lo llama**. | grep `setAvailability` |
| C8 | Stock al aceptar: pre-check JS contra `productos.stock` + `crear_venta_tx`. No considera `stock_minimo`. Para productos sin lotes, la BD no protege (S4). | `src/lib/canales/hub.ts:356-365` |
| C9 | `reservarStock`, `liberarReservaYDescontarStock`, `handleCancellation`: código muerto. El cron `stock-reservas-expiry` usa columnas `items`/`estado` que no existen en `stock_reservas` según migraciones, y no está en `vercel.json`. | `src/lib/canales/hub.ts:52-198`, `src/app/api/cron/stock-reservas-expiry/route.ts:19-23`, `migrations/012_canales_hub.sql:74-82` |
| C10 | Cancelación desde la plataforma solo marca `canal_ordenes.estado = 'cancelled'`: la venta sigue activa, stock descontado, asiento contable vigente. | `src/app/api/canales/webhook/[canal]/route.ts:111-122` |
| C11 | Error al confirmar a la plataforma se traga con `console.error`; no hay reintento. | `src/lib/canales/hub.ts:470-482` |
| C12 | Nadie marca órdenes `expired`; aceptar no revisa `aceptar_antes_de`. | `src/lib/canales/hub.ts:297-299` |
| C13 | `POST /api/canales/orders` con `action: "accept"` marca `accepted` **sin crear venta**. No lo usa la UI, pero cualquier usuario autenticado puede llamarlo. | `src/app/api/canales/orders/route.ts:74-86` |
| C14 | `updateOrderStatus` (listo para retiro) nunca se llama; no hay UI para ello. | grep `updateOrderStatus` |
| C15 | Sin control de rol en `/api/canales/**` (solo `getStoreId()`); un `storeWorker` puede cambiar credenciales/activar canales. `getStoreId()` no valida `is_disabled`. | `src/app/api/canales/config/route.ts`, `catalog/route.ts`, `orders/**` |
| C16 | `UNIQUE(canal_id, external_order_id)` es global (no por tienda). El webhook hace SELECT-then-INSERT (carrera → 500). | `migrations/012_canales_hub.sql:70`, webhook `:75-108` |
| C17 | **Drift schema ↔ código (sin verificar)**: el código usa `canal_config.credenciales_encriptada/credenciales_iv/credenciales_auth_tag`, `canal_ordenes.accepted_at/rejected_at/motivo_rechazo/total_externo`; ninguna migración las crea (las migraciones crean `credentials JSONB`, `webhook_secret`, `token`). Pueden existir por aplicación manual. | grep en `migrations/` |
| C18 | Las ventas de canal no llaman `syncProductsToHub` (el POS sí) → Hub central con stock desactualizado. | `src/app/api/ventas/route.ts:315-335` vs `hub.ts` |
| C19 | `RAPPI_API_BASE` por defecto apunta a **dev**. Caché de token con buffer de 24 h sobre tokens que pueden durar 24 h → nunca se usa el caché. | `src/lib/canales/rappi/types.ts:1-2`, `rappi/auth.ts:16` |
| C20 | Los endpoints de PedidosYa (`api.pedidosya.com/v1/stores/...`) y UberEats (`api.uber.com/eats/v2/business/...`) en los adaptadores **no coinciden** con la documentación oficial conocida (ver §7). Tratar esos adaptadores como placeholders. | `src/lib/canales/pedidosya/adapter.ts`, `ubereats/adapter.ts` |
| C21 | UI de órdenes muestra `total_externo`, que el webhook nunca escribe. | `src/app/(app)/canales/rappi/ordenes/page.tsx:135` |

### 3.3b Verificación contra la BD real (Fase 0, 2026-09-24 — resultados Q1–Q3 pegados por el usuario)

| ID | Resultado | Estado |
|----|-----------|--------|
| V1 | `canal_config` tiene **ambos** juegos de columnas: legado (`credentials` jsonb, `webhook_secret`, `token`, `token_expires_at`) y cifradas (`credenciales_encriptada`, `credenciales_iv`, `credenciales_auth_tag`, aplicadas a mano). `external_store_id` existe. → C17 parcialmente resuelto: la config funciona; columnas legado sin uso. | verificado |
| V2 | **`canal_ordenes` NO tiene `accepted_at`, `rejected_at`, `motivo_rechazo`, `total_externo`** (ni `items`). Consecuencia (inferida por código): el `UPDATE` de `aceptarOrdenExterna` (`hub.ts:461-468`) y del reject (`reject/route.ts:292-299`) falla por columna inexistente y **su error no se revisa** → la venta se crearía pero la orden quedaría `pending`; el rechazo se enviaría a la plataforma pero la orden seguiría `pending`. La UI muestra `total_externo` = vacío. | columnas verificadas; efecto inferido |
| V3 | `canal_ordenes`: sin CHECK de `estado`; UNIQUE global `(canal_id, external_order_id)` (C16 confirmado); índice `idx_canal_ordenes_expiry` referencia `'reserved'`. | verificado |
| V4 | `stock_reservas` = columnas de la migración 012 (sin `items`/`estado`) → el cron `stock-reservas-expiry` falla (C9 confirmado). | verificado |
| V5 | `productos.stock` NUMERIC nullable default 0. **`stock_minimo` INTEGER nullable, default 5** (no 0 como dice `000_base_schema.sql`) → toda fórmula debe usar `COALESCE(stock_minimo, 0)`; productos nuevos nacen con mínimo 5. No hay CHECK `stock >= 0`. `peso_gramos` INTEGER nullable. | verificado |
| V6 | `lotes_producto.fecha_vencimiento` **NOT NULL** (S10 confirmado → D21 necesaria). | verificado |
| V7 | **`stock_movements.cantidad` es INTEGER.** Un movimiento granel (0,5) no cabe. Además `crear_venta_tx` en `migrations/059` castea `(v_item->>'cantidad')::INTEGER` (venta_items, FIFO, decrement, movimiento): castear el texto `'0.5'` a INTEGER **lanza error** en Postgres. Si la función real es la de 059 (confirmar con Q5), **las ventas a granel fallan desde la migración 059** en vez de descontar mal (reemplazaría/matizaría S9). Q13 cuantifica ventas granel antes/después. | columna verificada; efecto pendiente Q5/Q13 |
| V8 | `ventas_procedencia_check` incluye `rappi`, `pedidosya`, `ubereats` → migración 073 aplicada. | verificado |
| V9 | `productos` UNIQUE `(store_id, sku)` → el caso "SKU duplicado" de `hub.ts:341-348` no puede ocurrir. | verificado |
| V10 | `ventas_store_idempotency_key_idx` UNIQUE `(store_id, idempotency_key)` parcial → la idempotencia de ventas de canal es por tienda. | verificado |
| V11 | `canal_producto_config`: `precio NOT NULL CHECK (precio > 0)`, UNIQUE `(canal_id, producto_id)`. Fase 4 debe migrar a `precio_override` nullable. | verificado |

| V12 | **`crear_venta_tx` real = versión 059, con `(v_item->>'cantidad')::INTEGER`** en venta_items, FIFO, decrement, movimiento y consumo. Castear el texto `'0.5'` a INTEGER lanza `invalid input syntax for type integer` → **toda venta a granel falla desde que se aplicó 059** (S9 se reformula: hoy no descuenta mal, directamente no se puede vender a granel). Q13 lo confirmará con datos. | definición verificada; efecto por semántica de Postgres (confirmar con Q13) |
| V13 | **Funciones duplicadas por sobrecarga:** `decrement_stock(uuid, integer)` y `decrement_stock(uuid, numeric)`; `deducir_stock_fifo(…, integer, uuid DEFAULT NULL)` y `deducir_stock_fifo(…, numeric, uuid)`. Ambas versiones de `decrement_stock` usan `GREATEST(0, …)` (S4 confirmado). `crear_venta_tx` llama a las versiones INTEGER. Las llamadas vía PostgREST (`supabase.rpc`) pueden resolver a una u otra según el tipo del JSON. Fase 1 debe dejar **una sola** versión de cada función (DROP de la sobrante). | verificado |
| V14 | **`deducir_stock_fifo(integer)` (la que usa la venta) excluye lotes vencidos** (`fecha_vencimiento >= CURRENT_DATE`); la versión NUMERIC no. Pero el trigger `sync_stock_on_lote` suma **todos** los lotes activos, vencidos incluidos. → `productos.stock` puede mostrar unidades que la venta rechaza ("disponible N unidades vigentes"). Para canales: publicar disponibilidad con stock que incluye vencidos generaría órdenes que no se pueden cumplir. Ver P11. | verificado |
| V15 | **`anular_venta_tx` restaura stock con `UPDATE productos SET stock = stock + n` directo, también en productos con lotes**, sin devolver a los lotes ni revertir `venta_item_lotes`. En el próximo cambio de cualquier lote del producto, el trigger recalcula `stock = Σ lotes` y **esas unidades desaparecen**. (`crear_nota_credito_tx` sí usa `devolver_stock_a_lotes` → inconsistencia entre ambos.) Nuevo hallazgo S12; corregir en Fase 1 respetando §23.5. | definición verificada; efecto inferido |
| V16 | `crear_nota_credito_tx` trata `cantidad_devuelta`, `precio_unitario` y `subtotal` como INTEGER; `increment_stock` solo existe con `p_cantidad integer` → devolver granel (gramos) es imposible hoy. Afecta G7. | verificado |
| V17 | Fuera de alcance, anotado: `crear_venta_tx` paso 4 descuenta `saldos_a_favor` con SELECT + UPDATE (sin `FOR UPDATE` ni la RPC atómica de 051) al pagar con NC — posible lost update concurrente (AGENTS.md §23.6). Reportar al usuario como tema aparte. | definición verificada |
| V18 | Q4: únicos triggers relevantes: `sync_stock_on_lote` y `sync_fecha_vencimiento_on_lote` en `lotes_producto`; `productos` y `ventas` solo `updated_at`. No existe aún ningún trigger de disponibilidad. Q6: `canal_config` = 4 filas; `canal_ordenes`, `canal_producto_config`, `stock_reservas`, `canal_liquidaciones` = **0 filas** → no hay datos de canal que migrar; `DROP TABLE stock_reservas` es seguro (con confirmación). | verificado |

| V19 | (2026-09-24, re-verificación pre-Fase 1) **`devolver_stock_a_lotes(venta_item_id)` devuelve a los lotes la cantidad COMPLETA consumida por el ítem** (`venta_item_lotes.cantidad`), ignorando `cantidad_devuelta`. Una NC parcial (devolver 1 de 3) devuelve 3 a los lotes; una segunda NC parcial del mismo ítem devuelve 3 otra vez. **Confirmado con datos:** 1 ítem de venta afectado, **2 unidades de más** en lotes. Nuevo hallazgo **S13**; se corrige en Fase 1 (asignación proporcional determinista). Los datos ya afectados **no** se corrigen automáticamente (D22: conteo físico). | definición y datos verificados |
| V20 | `venta_items` **no** tiene columnas `es_granel` ni `gramos` (§4.6 decía "ya tiene"). La ruta `POST /api/ventas` las envía dentro de `p_items` pero `crear_venta_tx` las ignora. Fase 1b debe **agregarlas**. | verificado |
| V21 | Constraints: `lotes_producto.cantidad_actual >= 0` y `cantidad_inicial > 0` existen; `venta_item_lotes.cantidad` INTEGER `> 0`; `productos` **sin** CHECK de stock. Todas las funciones de stock tienen EXECUTE solo para `postgres`/`service_role` (069 aplicada) → toda función nueva o reemplazada debe repetir el `REVOKE` (patrón 069). | verificado |

Implicaciones para el plan: Fase 2.1 debe **agregar** a `canal_ordenes` `items`, `total_externo`, `accepted_at`, `rejected_at`, `motivo_rechazo`, `ready_at`, `intentos`, `ultimo_error` + CHECK de estados; Fase 1 debe cambiar `stock_movements.cantidad` a NUMERIC (o registrar gramos) y eliminar los `::INTEGER` de cantidades en `crear_venta_tx`/NC/anulación; fórmulas con `COALESCE(stock_minimo, 0)`. Además (V12–V16), Fase 1 debe:
(a) reescribir `crear_venta_tx` sin casts `::INTEGER` de cantidades (granel
en gramos según §4.6); (b) dejar una sola versión de `decrement_stock` y
`deducir_stock_fifo` (DROP de las sobrecargas); (c) definir según P11 si el
stock vendible excluye vencidos y alinear trigger/FIFO/cupo de canales;
(d) corregir `anular_venta_tx` para devolver a los lotes vía
`venta_item_lotes` (S12) sin romper §23.5; (e) permitir cantidades
fraccionarias/gramos en NC para granel (G7).

### 3.3 Tests existentes relacionados (actualizar, no debilitar)

`tests/unit/lib/canales*.test.ts`, `tests/unit/lib/canales-hub.test.ts`,
`tests/integration/api/canales*.test.ts`,
`tests/integration/api/canales-webhook-idempotency.test.ts`,
`tests/components/{Rappi,PedidosYa,UberEats}OrdenesPage.test.tsx`,
`tests/components/CanalConfigPage.test.tsx`. Registro: `docs/spec-registry.md`
§"Canales externos" (I-151..I-180, I-310..530, CO-*, CC-*).
Cuando un test afirme el comportamiento defectuoso descrito en §3 (ej. aceptar
manual, reservas), reemplázalo por el contrato nuevo y dilo explícitamente en
el cierre — no lo borres sin reemplazo.

---

## 4. Modelo objetivo

### 4.1 Reglas de stock (fuente única: BD)

```
stock_total(p)        = productos.stock                 -- único número (D1)
cupo_pos(p)           = stock_total(p)                  -- POS vende hasta 0
cupo_canal_externo(p) = max(0, stock_total(p) - stock_minimo(p))   (D4)
disponible_en_canal(p, c) =
      p.activo
  AND canal_producto_config(p, c).habilitado
  AND canal_config(c).activo
  AND cupo_canal_externo(p) > 0
```

- **Toda** deducción de stock pasa por una función SQL que falla si no alcanza
  (`RAISE EXCEPTION 'Stock insuficiente ...'`), usando
  `UPDATE ... SET stock = stock - n WHERE id = ... AND stock >= n` (reclamo
  atómico) o el equivalente en lotes con `FOR UPDATE`.
- Productos con lotes y stock suelto **no conviven** (D11): al registrar el
  primer lote, el stock suelto existente se convierte en "LOTE-0"
  (`fecha_ingreso` = la más antigua posible, para que FIFO lo consuma
  primero) y luego se inserta el lote nuevo. Así `productos.stock = Σ lotes`
  y el trigger actual sigue siendo correcto. Productos sin lotes usan
  `decrement_stock` estricto.

### 4.2 Recepción de una orden externa (aceptación automática, D5/D6)

```
Plataforma ──webhook──▶ /api/canales/webhook/[canal]
   1. Adaptador: verificar firma (+ anti-replay)             → 401 si falla
   2. Adaptador: parsear a EventoCanal tipado                → PING responde lo que exige la plataforma
   3. OrdenCreada: INSERT canal_ordenes (estado 'pending', items normalizados)
      ON CONFLICT (store_id, canal_id, external_order_id) DO NOTHING
   4. Responder 200 rápido
   5. after(): procesarOrden(ordenId)   ← también lo reintenta el barrido (cron)

procesarOrden(ordenId):   (idempotente, re-ejecutable)
   a. Reclamo atómico: UPDATE estado='processing' WHERE estado='pending'
   b. Mapear SKU → producto (store-scoped). SKU faltante → rechazar (ITEM_NOT_FOUND)
   c. RPC crear_venta_canal_tx / crear_venta_tx con idempotency_key
      'canal:{store}:{canal}:{external_order_id}' y validación de stock
      atómica (cupo según P2). Stock insuficiente → rechazar (ITEM_OUT_OF_STOCK)
   d. estado='accepted', venta_id=…
   e. Encolar en outbox: CONFIRMAR a la plataforma
   f. after(): asientos contables (igual que hoy), sync Hub central
   g. Rechazo → estado='rejected' + outbox RECHAZAR con motivo
```

### 4.3 Máquina de estados de `canal_ordenes`

```
pending ──▶ processing ──▶ accepted ──▶ ready ──▶ picked_up ──▶ delivered
                │               │         │
                ├─▶ rejected    └────┬────┘
                └─▶ failed           ▼
pending ──▶ cancelled           cancelled   (plataforma cancela: anular venta vía anular_venta_tx)
pending ──▶ expired  (solo si quedó atascada y la plataforma ya la canceló)
```

- `failed` = error no de negocio tras N reintentos → requiere atención
  (alerta + visible al admin).
- Toda transición es un `UPDATE ... WHERE estado IN (<orígenes válidos>)`;
  0 filas = transición inválida o carrera perdida → no repetir efectos.
- `reserved` desaparece (D6). Migrar CHECK/valores si existen.

### 4.4 Disponibilidad hacia las plataformas (D4)

- **Trigger** `AFTER UPDATE OF stock, stock_minimo, activo ON productos`
  (y `AFTER INSERT/UPDATE ON canal_producto_config`, `canal_config`): por cada
  canal donde el producto está habilitado, si el estado publicable cambió
  respecto de `canal_producto_config.ultimo_disponible_publicado` (o si el
  canal publica cantidades), encola en `canal_outbox` un trabajo
  `availability` con `dedupe_key = 'avail:{store}:{canal}:{producto}'`
  (coalescente: si ya hay uno pendiente, no se duplica).
- El worker **lee el estado actual al procesar** (level-triggered): no confía
  en el valor encolado. Así un stock que sube y baja 10 veces genera 1 llamada.
- Cubre automáticamente **todas** las fuentes de cambio de stock: POS, canal,
  NC, anulación, OC, lotes, importación, ajuste manual.
- Capacidad por adaptador: `availabilityMode: "toggle" | "quantity"`.
  Rappi (API restaurants) solo on/off; Delivery Hero/PedidosYa (Assortment API)
  admite cantidad → enviar `cupo_canal_externo`.
- Reconciliación diaria completa (republica todo) como red de seguridad.

### 4.5 Precio por canal (D7)

```
precio_canal(p, c) = canal_producto_config.precio_override
                     ?? redondear(precio_base(p) * (1 + canal_config.recargo_pct / 100))
```
Precio bruto (IVA incluido), CLP entero. `precio_base` y la regla de
redondeo: ver decisiones pendientes P3/P4.

La venta registra el precio **que cobró la plataforma** (viene en la orden);
si difiere del `precio_canal` esperado, se acepta igual (el cliente ya pagó) y
se registra la discrepancia (log/auditoría) para revisión.

### 4.6 Granel: descuento proporcional y saco abierto (D18–D20 — aprobado)

**Problema actual (S9):** una venta a granel descuenta kilos del stock que
cuenta sacos (500 g de un saco de 15 kg descuenta 0,5 sacos = 7,5 kg). Hay que
corregirlo en cualquier caso, con o sin canales.

**Regla del usuario (D20):** la venta a granel descuenta del stock la
**proporción** del saco vendida: `gramos / peso_gramos`.
Ejemplo: 500 g de un saco de 15 000 g → `500 / 15000 = 0,0333…` saco (3,33 %).
Con 10 sacos, el stock total queda en 9,9667.

**Modelo aprobado (combina D18 y D20):**

```
peso_saco_g(p)         = productos.peso_gramos                      (obligatorio > 0 para granel)
gramos_saco_abierto(p) = sacos_abiertos.gramos_restantes (activo)   (entero; fuente de verdad)
sacos_cerrados(p)      = Σ lotes activos  |  columna de stock cerrado sin lotes   (entero)
stock_total(p)         = sacos_cerrados(p) + gramos_saco_abierto(p) / peso_saco_g(p)
                         → es el "stock" visible (ej. 9,9667); baja 3,33 % por 500 g vendidos
cupo_pos_unidad(p)     = sacos_cerrados(p)                  (vender saco entero en POS)
cupo_pos_granel(p)     = gramos_saco_abierto(p) + sacos_cerrados(p) × peso_saco_g(p)
cupo_canal(p)          = max(0, sacos_cerrados(p) − stock_minimo(p))   (canales: solo sacos enteros)
```

- **Abrir un saco** (forzado o con el check) **no cambia el stock total**:
  mueve 1 saco de "cerrados" a "abierto" (`gramos_restantes = peso_gramos`).
  Sí baja el cupo de canales en 1 → el trigger de disponibilidad (§4.4) lo
  publica. (Esto reemplaza la idea inicial "abrir saco = stock − 1": con
  descuento proporcional, restar además 1 contaría dos veces el mismo saco.)
- **Venta a granel:** descuenta gramos del saco abierto; el stock total baja
  exactamente la proporción vendida (D20). Si no alcanzan los gramos, el POS
  **obliga** a confirmar la apertura de un saco nuevo y la venta consume el
  resto del saco actual + lo que falte del nuevo, en **una** transacción.
- **Precisión:** los gramos se guardan como **enteros** y `productos.stock` se
  **recalcula** desde ellos (no se acumula restando 0,0333 por venta: con
  `NUMERIC(10,3)` treinta ventas de 500 g darían 0,99 en vez de 1 saco).
  Redondear solo al mostrar (ej. "9 sacos + 14,5 kg").
- **Un solo saco abierto por producto.** Si se usa el check manual con un saco
  abierto que aún tiene gramos, el POS exige registrar primero la **merma**
  del resto (G6) antes de abrir otro.
- `stock_minimo` (alerta de reposición) se compara contra `stock_total`; la
  disponibilidad de canales usa `sacos_cerrados` (`cupo_canal`).

**Riesgos analizados y resolución acordada (2026-09-24):**

| # | Riesgo | Resolución |
|---|--------|------------|
| G1 | Olvidar marcar la apertura | El sistema lleva `gramos_restantes` y **obliga** a confirmar la apertura cuando la venta no alcanza. El check manual se mantiene para casos especiales. |
| G2 | Apertura marcada por error | "Deshacer apertura" **solo `storeAdmin` y `systemAdmin`** (server-side, `requireStoreAdmin` con try/catch → 403); solo si el saco no tiene ventas asociadas; devuelve el saco a cerrados (y a su lote); `logAudit`. |
| G3 | Primera venta granel sin saco abierto | La primera venta fuerza la apertura (G1). |
| G4 | Lotes / vencimiento | Abrir saco descuenta 1 del lote más antiguo (`deducir_stock_fifo(…,1)`) o `decrement_stock(…,1)` estricto si no hay lotes; el saco abierto guarda `lote_id` y hereda su vencimiento. |
| G5 | Contabilidad | Abrir saco = movimiento interno (`stock_movements.tipo='apertura_saco'`, sin asiento). COGS de cada venta granel = `gramos / peso_gramos × costo`. |
| G6 | Merma / resto final | "Cerrar saco / registrar merma": da de baja los gramos restantes y **guarda en BD el usuario que la registró** (`cerrado_por` = clerk user id), fecha, gramos y motivo; `stock_movements.tipo='merma'` con `user_id`; asiento de merma (validar cuenta con contador); `logAudit`. |
| G7 | NC y anulación de venta granel | Los gramos vuelven al saco abierto de origen (si ya se cerró, se registran como ajuste). Ajustar `anular_venta_tx` y `crear_nota_credito_tx` (§23.5 aplica). |
| G8 | Peso del saco desconocido | `peso_gramos > 0` obligatorio para habilitar granel (`precio_venta_kg`). |
| G9 | Dos cajas abren saco a la vez | RPC atómico con `FOR UPDATE` sobre el producto + índice único parcial "un saco abierto activo por producto". |
| G10 | Stocks fraccionarios existentes por S9 | Fase 0 lista productos con `stock` no entero; el usuario corrige tras conteo físico (P10). |
| G11 | Reportes / inventario valorizado | Mostrar "N sacos + X kg"; valorizar con `stock_total × costo`. |

**Estructura de datos:**
- Tabla `sacos_abiertos`: `id`, `store_id`, `producto_id`, `lote_id` NULL,
  `gramos_iniciales INT`, `gramos_restantes INT CHECK (>= 0)`, `abierto_at`,
  `abierto_por` (clerk id), `cerrado_at` NULL, `cerrado_por` NULL (clerk id),
  `motivo_cierre` (`agotado` | `merma` | `deshecho`), `gramos_merma INT` NULL,
  `nota` NULL. Índice único parcial `(producto_id) WHERE cerrado_at IS NULL`.
- `productos.stock` pasa a ser derivado: con lotes = `Σ lotes + gramos_abierto/peso`;
  sin lotes = `stock_cerrado + gramos_abierto/peso` (columna nueva
  `stock_cerrado` o equivalente — definir tras Fase 0). Extender el trigger
  `sync_stock_on_lote` (y crear uno sobre `sacos_abiertos`) para recalcular.
  Revisar TODOS los escritores directos de `productos.stock` (grep
  `stock:` / `increment_stock` / `decrement_stock` en `src/app/api`) para que
  escriban el stock cerrado, no el total.
- `venta_items`: ya tiene `es_granel` y `gramos`; agregar `saco_abierto_id`
  para que NC/anulación sepan a qué saco devolver.

---

## 5. Arquitectura objetivo (D9)

### 5.1 Capas

```
src/lib/canales/
  domain/                 ← NUEVO. Tipos y reglas puras, sin I/O
    types.ts              CanalId, EstadoOrden, OrdenNormalizada, EventoCanal (unión discriminada)
    estados.ts            transiciones válidas (tabla) + helpers
    precio.ts             precioCanal(base, recargoPct, override)
    disponibilidad.ts     cupoCanalExterno(stock, minimo), disponible(...)
  application/            ← NUEVO. Casos de uso (orquestan; usan puertos)
    recibir-evento.ts     webhook → evento → persistencia
    procesar-orden.ts     §4.2 procesarOrden
    cancelar-orden.ts     usa servicio compartido anularVenta()
    marcar-lista.ts       storeWorker marca ready → outbox
    publicar-catalogo.ts
    outbox-worker.ts      claim + dispatch + retry/backoff
  infrastructure/
    context.ts            loadChannelContext(storeId, canalId): descifra + valida creds (Zod por canal)
    repos/*.ts            acceso a canal_ordenes, canal_outbox, canal_producto_config
  adapters/               (mover rappi/, pedidosya/, ubereats/ aquí)
    <canal>/adapter.ts    implementa ChannelAdapter (solo traducción + HTTP)
    <canal>/schemas.ts    Zod del payload externo y de las credenciales
    <canal>/fixtures/     payloads reales/sandbox para tests
  registry.ts             Map<CanalId, ChannelAdapter> (ENABLED_CHANNELS)
```

Reglas:
- `domain/` no importa nada de Supabase/Next/fetch.
- Los route handlers solo: auth → validar → llamar caso de uso → mapear a HTTP.
- Ningún `if (canal === "...")` fuera de `adapters/<canal>/`.
- `hub.ts` actual se vacía hacia estas capas y se elimina al final.

### 5.2 Puerto del adaptador (reemplaza `IExternalChannel`)

```typescript
export interface ChannelAdapter {
  readonly id: CanalExternoId;                    // "rappi" | "pedidosya" | "ubereats"
  readonly capabilities: {
    availabilityMode: "toggle" | "quantity";
    supportsReadyForPickup: boolean;
    acceptanceWindowMin: number;
  };
  readonly credentialsSchema: z.ZodType<Credenciales>;   // fuente única (UI + auth)

  verifyWebhook(req: { headers: Headers; rawBody: string }, ctx: ChannelContext): boolean;
  parseEvent(rawBody: unknown): EventoCanal;              // Zod adentro; lanza si inválido
  pingResponse?(): { status: number; body: unknown };

  confirmOrder(ctx: ChannelContext, externalOrderId: string): Promise<void>;
  rejectOrder(ctx: ChannelContext, externalOrderId: string, motivo: MotivoRechazo): Promise<void>;
  markReady(ctx: ChannelContext, externalOrderId: string): Promise<void>;
  pushCatalog(ctx: ChannelContext, items: ItemCatalogo[]): Promise<void>;
  pushAvailability(ctx: ChannelContext, items: ItemDisponibilidad[]): Promise<void>;
}

type EventoCanal =
  | { tipo: "orden_creada"; orden: OrdenNormalizada }
  | { tipo: "orden_cancelada"; externalOrderId: string; motivo?: string }
  | { tipo: "estado_cambiado"; externalOrderId: string; estadoExterno: string }
  | { tipo: "ping" }
  | { tipo: "menu_aprobado" } | { tipo: "menu_rechazado"; detalle?: string }
  | { tipo: "ignorado"; raw: string };

interface OrdenNormalizada {
  externalOrderId: string;
  items: { sku: string; cantidad: number; precioUnitarioBruto: number }[];
  totalBruto: number;
  cliente?: { nombre?: string; telefono?: string; direccion?: string };
  creadaEn: string;
}

interface ChannelContext {
  storeId: string; canalId: CanalExternoId;
  externalStoreId: string;            // obligatorio, validado
  credentials: Credenciales;          // descifradas + validadas por Zod
  recargoPct: number; comisionPct: number;
}
```

### 5.3 Outbox (`canal_outbox`)

- Toda llamada saliente (confirm, reject, ready, availability, catalog) se
  **encola** y la procesa un worker. Nunca fire-and-forget.
- Worker: RPC `claim_canal_outbox(p_limit)` con `FOR UPDATE SKIP LOCKED`,
  `estado: pending → processing → done | pending(reintento) | dead`, backoff
  exponencial (`next_attempt_at`), `intentos`, `last_error` (sin secretos).
- Disparo: `after()` tras encolar (latencia baja) + barrido periódico (ver
  §7.1 sobre cron).
- `dead` → alerta al admin (email vía el mecanismo existente de
  `/api/cron/email-alerts` o registro visible en UI).

### 5.4 Seguridad

- Webhook: público en middleware, autenticado por firma del adaptador
  (HMAC + timestamp anti-replay). `store_id` en query se valida como UUID y
  debe tener `canal_config` activo.
- Config/catálogo/precios/reintentar `failed`: `requireStoreAdmin(admin, storeId)`
  con try/catch → 403 (AGENTS.md §5.4).
- Órdenes (listar, marcar lista): cualquier usuario de la tienda, no
  deshabilitado.
- Nunca devolver credenciales; nunca loguear payloads con datos de clientes.
- Rate limit del middleware sigue aplicando al webhook: verificar que no
  bloquee ráfagas legítimas de la plataforma.

---

## 6. Plan por fases (paso a paso)

Cada fase termina con: gates AGENTS.md §2 (build, test, typecheck, lint, diff,
tests backend+frontend §19.1, registro de IDs §2.3), `graphify update .`, y
cierre formato §22. **Migraciones: crear el SQL, mostrarlo al usuario, pedir
confirmación, recién entonces aplicar.** Siguiente número de migración al
escribir este documento: `074_` (verificar con `ls migrations | tail`).

### Fase 0 — Verificación y decisiones (sin cambios de comportamiento)

0.1. Resolver las decisiones pendientes de §8 con el usuario.
0.2. **Consultas de solo lectura** a la BD real (pedir permiso aunque sean
     SELECT; usar MCP Supabase en modo `read_only=true` si está conectado, o
     que el usuario las ejecute en el SQL Editor). **Están listas en
     `stock_canales_fase0.sql` (Q1–Q12).** Verificar:
     - columnas reales de `canal_config`, `canal_ordenes`,
       `canal_producto_config`, `stock_reservas`, `canales_externos`
       (`information_schema.columns`) → resolver C17;
     - CHECK de `canal_ordenes.estado` y `ventas.procedencia`;
     - definición vigente de `crear_venta_tx`, `decrement_stock`,
       `deducir_stock_fifo`, trigger `sync_stock_on_lote`
       (`pg_get_functiondef`);
     - conteo de filas en `canal_config`, `canal_ordenes`, `stock_reservas`;
     - **cuántos productos tienen stock suelto + lotes activos**
       (`productos.stock <> SUM(lotes activos)`) → dimensiona S6/P1;
     - cuántos productos tienen stock negativo o `stock_minimo` = 0;
     - productos con `stock` **no entero** (efecto de S9) → lista para P10;
     - productos con `precio_venta_kg` y su `peso_gramos` (G8);
     - nulabilidad real de `lotes_producto.fecha_vencimiento` (S10);
     - si `pg_cron`, `pg_net` y `vault` están disponibles/habilitados
       (`select * from pg_extension`).
0.3. Registrar resultados en §9. Si algo contradice §3, actualizar §3.
0.4. Iniciar trámite de acceso a plataformas (§7.2) — corre en paralelo.

**Criterio de salida:** resultados de Q1–Q12 registrados en §9; schema real documentado.

### Fase 1 — Integridad de stock (POS + todos los canales)

Objetivo: D1, D2, D3 garantizados en BD.

1.1. Migración `NNN_stock_estricto.sql`:
     - `decrement_stock(p_producto_id, p_cantidad)`: reemplazar `GREATEST(0, …)`
       por reclamo atómico
       `UPDATE productos SET stock = stock - p_cantidad WHERE id = … AND stock >= p_cantidad`;
       si `NOT FOUND` → `RAISE EXCEPTION 'Stock insuficiente: producto=%, solicitado=%'`.
       Mantener firma NUMERIC (granel, migración 044).
     - `deducir_stock_fifo`: sin cambio de lógica FIFO (ya cruza lotes, D3);
       agregar `FOR UPDATE` sobre los lotes leídos para serializar ventas
       concurrentes del mismo producto.
     - Idempotente (`CREATE OR REPLACE`), con comentario de motivo.
1.2. Corregir S6 según **D11** con una función SQL única
     `registrar_lote(p_store_id, p_producto_id, p_cantidad, p_fecha_vencimiento,
     p_numero_lote, p_orden_compra_id, p_notas, p_user_id)`, atómica:
     1. `SELECT … FROM productos WHERE id=… AND store_id=… FOR UPDATE`.
     2. Si el producto **no** tiene lotes activos y `stock > 0`: insertar
        "LOTE-0" con `cantidad = stock` actual, `fecha_ingreso` anterior a
        hoy (ej. `created_at` del producto) para que FIFO lo consuma primero,
        `fecha_vencimiento` = `productos.fecha_vencimiento` o la que indique
        el usuario (ver P9), `notas = 'Stock existente convertido a lote'`.
     3. Insertar el lote nuevo.
     4. El trigger deja `stock = Σ lotes` (100 + 50 = 150).
     5. Registrar `stock_movements` de la entrada nueva (no del LOTE-0: no es
        entrada física).
     Usar en `POST /api/lotes`, recepción de OC
     (`src/app/api/ordenes-compra/[id]/route.ts`) y
     `PATCH /api/productos/[id]` (reemplaza su lógica "LOTE-0" actual).
     UI de nuevo lote: si el producto tiene stock sin lote, mostrar aviso
     "Las N unidades existentes se registrarán como lote inicial" y pedir su
     vencimiento (prellenado con `productos.fecha_vencimiento`).
1.3. S7: ajuste manual de salida sin lotes → usar `decrement_stock` (atómico)
     en lugar de leer-y-escribir.
1.4. `src/app/api/ventas/route.ts`: mantener pre-check JS (mensaje amigable),
     confirmar que el 422 por error de BD sigue funcionando.
1.5. **Granel (§4.6, D18–D20) — puede ir como Fase 1b:** migración
     `sacos_abiertos` + stock derivado; RPC `abrir_saco` / `deshacer_apertura`
     (solo admin, validado en el endpoint) / `cerrar_saco_merma` (guarda
     `cerrado_por`); `crear_venta_tx` trata ítems `es_granel` descontando
     **gramos** del saco abierto (el stock total baja `gramos/peso_gramos`),
     abriendo saco en la misma transacción si el POS lo confirmó; el POS
     envía `gramos` (entero) como dato de verdad, no `kg`; ajustar
     `anular_venta_tx` y `crear_nota_credito_tx` (G7); COGS proporcional
     (G5); UI POS: confirmación forzada (G1), check manual, acción de merma,
     indicador "N sacos + X kg"; exigir `peso_gramos` (G8).
1.7. **Ajuste por conteo físico (D22, S11):**
     - Endpoint nuevo `POST /api/inventario/[id]/conteo` (no reutilizar el
       PATCH de entrada/salida): body Zod `{ stock_contado (≥ 0), gramos_saco_abierto?
       (entero ≥ 0, solo granel), lote_id? (si el producto tiene lotes, el
       conteo es por lote), motivo (obligatorio, ≥ 5 chars) }`.
     - Autorización: `getAdminStatus` + `requireStoreAdmin(admin, storeId)` en
       try/catch → 403 para `storeWorker` (AGENTS.md §5.4). Filtro
       `store_id` en toda lectura/escritura; producto de otra tienda → 404.
     - Efecto atómico (RPC `ajustar_stock_conteo`): fija el stock cerrado (o
       `cantidad_actual` del lote) al valor contado y, para granel, los gramos
       del saco abierto; registra `stock_movements` (`tipo='ajuste_conteo'`,
       delta, `user_id`), `logAudit` con valor anterior y nuevo. El trigger de
       disponibilidad publica el cambio a los canales.
     - UI: en Inventario, acción "Conteo físico" visible solo a admin (gate de
       UX; el control real es el servidor). Filtro "stock con decimales" para
       encontrar los productos de Q10. Para granel: "sacos cerrados" + "kg en
       saco abierto".
     - Aprovechar para cerrar S11: agregar `requireStoreAdmin` a
       `PATCH /api/inventario/[id]`, `POST /api/lotes` y
       `PATCH /api/productos/[id]` (confirmar antes con el usuario si el
       `storeWorker` debe poder alguno de estos; por defecto, no).
     - Tests: admin OK; `storeWorker` → 403; sin sesión → 401; producto de
       otra tienda → 404; `store_id` en body ignorado; motivo vacío → 400;
       valor negativo → 400; producto con lotes exige `lote_id`; auditoría y
       `stock_movements` registrados; frontend: botón oculto a worker,
       submit llama URL/método/body correctos, error visible.
1.8. Tests:
     - SQL/integración (mock del RPC) + **verificación real** con transacción
       `BEGIN … ROLLBACK` si el usuario la autoriza (AGENTS.md §11.4): venta
       mayor que stock sin lotes falla; venta que cruza 2 lotes consume ambos;
       venta mayor que Σ lotes (+ suelto) falla; dos ventas concurrentes por
       el último stock → solo una pasa.
     - Regresión S6/D11: producto con 100 sin lote + lote de 50 → stock 150,
       LOTE-0 = 100 (consumido primero por FIFO), lote nuevo = 50; mismo caso
       vía OC y vía `PATCH /api/productos/[id]`; producto sin stock previo no
       crea LOTE-0; producto que ya tiene lotes no crea LOTE-0.
     - Granel: venta de 500 g con saco de 15 000 g → `gramos_restantes`
       baja 500 y `stock` total baja 0,0333 (10 → 9,9667); 30 ventas de 500 g
       dejan exactamente 1 saco menos (sin deriva de redondeo); venta que
       excede lo restante exige abrir saco y consume ambos en una transacción;
       abrir saco **no** cambia el stock total pero baja el cupo de canales
       en 1 (FIFO si tiene lotes); NC/anulación devuelve gramos al saco;
       COGS proporcional; merma guarda `cerrado_por`; deshacer apertura →
       403 para `storeWorker`, OK para admin, rechazado si el saco tiene
       ventas; dos aperturas concurrentes → una sola; frontend del check, la
       confirmación forzada y la merma.
     - POS: 422 con mensaje cuando la BD rechaza.
     - `PROP-*`: propiedad "stock nunca negativo y nunca se vende más que
       stock" en `tests/unit/lib/property-invariants.test.ts` (si aplica a
       lógica pura).

**Criterio de salida:** ninguna ruta puede dejar vender más que el stock; el
total se conserva al introducir lotes (D11); granel no descuenta sacos
salvo al abrir uno.

### Fase 2 — Núcleo común de canales (desbloquea el flujo)

2.1. Migración `NNN_canales_nucleo.sql` (según resultado de Fase 0):
     - `canal_config`: asegurar `external_store_id`, columnas de credenciales
       cifradas que usa el código, `recargo_pct NUMERIC(5,2) NOT NULL DEFAULT 0
       CHECK (recargo_pct >= 0)`.
     - `canal_ordenes`: `UNIQUE (store_id, canal_id, external_order_id)`
       (reemplaza la global), columnas `items JSONB NOT NULL` (normalizados),
       `total_externo`, `accepted_at`, `rejected_at`, `motivo_rechazo`,
       `intentos`, `ultimo_error`, `ready_at`, CHECK de estados §4.3.
     - `canal_outbox` (§5.3) con índices `(estado, next_attempt_at)` y
       `UNIQUE (dedupe_key) WHERE estado IN ('pending','processing')`.
     - RLS habilitado en tablas nuevas (defensa adicional; patrón de
       `migrations/062`).
     - Actualizar `src/types/index.ts`.
2.2. `domain/` y puerto `ChannelAdapter` (§5.1–5.2). Tests unitarios puros.
2.3. `infrastructure/context.ts` → `loadChannelContext`; Zod de credenciales
     por canal; `config/route.ts` usa el mismo schema (elimina
     `REQUIRED_CREDENTIAL_FIELDS`). Resuelve C4, C5.
2.3b. **Precaución de despliegue (Q7):** Rappi y PedidosYa están
     `activo=true` en `canal_config` de una tienda. Al hacer público el
     webhook, órdenes reales podrían entrar antes de que existan Fases 3–4.
     Desplegar Fase 2 con esos canales fuera de `ENABLED_CHANNELS` (o
     `canales_externos.habilitado=false`, previa confirmación) hasta Fase 6.
2.4. Middleware: agregar `/api/canales/webhook/(.*)` a `publicRoutes` **y** a
     `skipLicenseCheck`? (Decidir: una tienda con licencia vencida ¿debe
     recibir órdenes? Por defecto: sí recibir y registrar, pero no publicar
     disponibilidad — anotar en §8 si el usuario opina distinto). Resuelve C1.
2.5. Webhook genérico vía registry (C2), `INSERT … ON CONFLICT DO NOTHING`
     (C16), guarda orden normalizada (C3), responde PING según adaptador.
2.6. Migrar adaptador **Rappi** a `ChannelAdapter` con Zod del payload real
     (fixtures de dev-portal.rappi.com). Corregir C19 (base URL por env sin
     default a dev en producción; caché de token coherente con `expires_in`).
2.7. PedidosYa/UberEats: marcar como no disponibles en registry/UI hasta
     tener documentación y credenciales reales (C20). No borrar pantallas;
     mostrar "Integración pendiente".
2.8. Suite de **contrato** parametrizada `tests/unit/lib/canales-contrato.test.ts`
     que corre sobre cada adaptador registrado: firma válida/inválida/replay,
     parseo de cada tipo de evento desde fixtures, payload inválido → error,
     credenciales inválidas → error.
2.9. Tests de integración del webhook: 401 firma, 404 canal no configurado,
     orden nueva 201, duplicada 200 sin duplicar, concurrente (dos inserts) →
     una fila, `store_id` inválido → 400.

**Criterio de salida:** una orden de fixture Rappi firmada entra y queda
`pending` con items normalizados.

### Fase 3 — Aceptación automática y ciclo de vida

3.1. Extraer de `PATCH /api/ventas/[id]` un servicio compartido
     `anularVenta(storeId, ventaId, actor)` (RPC `anular_venta_tx` + contra-
     asiento). La ruta pasa a usarlo sin cambiar su contrato (§23.5).
3.2. `procesarOrden` (§4.2) con reclamo atómico; stock según D4/P2 atómico en
     BD — preferible un RPC `crear_venta_canal_tx` que envuelva
     `crear_venta_tx` validando el cupo dentro de la misma transacción, o
     agregar parámetro `p_respetar_minimo` a `crear_venta_tx`.
     idempotency_key: `canal:{store}:{canal}:{external_order_id}`.
3.3. Webhook `orden_creada` → persiste y dispara `after(procesarOrden)`.
3.4. Outbox worker + endpoint cron `POST /api/cron/canales-outbox` (Bearer
     `CRON_SECRET`, acepta POST porque lo llama `pg_net`) + barrido de órdenes
     `pending` atascadas > 1 min. Endpoint `POST /api/cron/canales-reconciliar`
     (disponibilidad completa, diario). Programación con **pg_cron** (D12):
     crear la migración de §7.1 **solo después** de que ambos endpoints estén
     desplegados en producción; no agregarlos a `vercel.json` (Hobby rechaza
     frecuencias > diaria en el deploy).
3.5. Cancelación de plataforma: `pending/processing` → `cancelled` sin venta;
     `accepted/ready` → `anularVenta()` + `cancelled`. Resuelve C10.
3.6. Rechazo automático (SKU inexistente / sin stock) → outbox `reject` con
     motivo mapeado por adaptador (`ITEM_NOT_FOUND`, `ITEM_OUT_OF_STOCK`).
     Además encolar `availability` del producto afectado (se desincronizó).
3.7. Eliminar: `reservarStock`, `liberarReserva*`, `handleCancellation`,
     `/api/cron/stock-reservas-expiry`, `POST /api/canales/orders` (C13),
     `POST /api/canales/orders/[id]/accept|reject` manuales (D5/D8) — o dejar
     solo "reintentar orden `failed`" para admin. Tabla `stock_reservas`:
     `DROP` en migración separada (confirmar con usuario; está vacía según
     Fase 0).
3.8. UI órdenes (una página genérica por canal, reemplaza las 3 copias):
     lista con items, estado, tiempo; botón **"Marcar lista"** (storeWorker)
     → `POST /api/canales/orders/[id]/ready` → outbox `ready`; alerta de
     orden nueva (sonido/visual); sección `failed` solo admin.
3.9. Ventas de canal → `syncProductsToHub` (C18).
3.10. Tests backend: aceptación feliz, duplicado (idempotencia), concurrente
      (dos procesos) → una venta, sin stock → rechazo + outbox, SKU inexistente,
      cupo con mínimo (P2), cancelación antes/después de aceptar (verifica
      anulación y stock restaurado), IDOR en `/ready` (otra tienda → 404),
      storeWorker no puede reintentar `failed` (403), outbox retry/backoff/dead.
      Tests frontend: render vacío/carga/error, "Marcar lista" llama URL/método
      correctos, error de API visible, gate de rol documentado como UX.

**Criterio de salida:** orden de fixture → venta creada, stock descontado,
confirmación encolada y enviada (mock), cancelación revierte todo.

### Fase 4 — Catálogo, precios y disponibilidad

4.1. Migración: `canal_producto_config.precio_override NUMERIC NULL CHECK
     (precio_override > 0)` (reemplaza `precio NOT NULL`; migrar datos si
     existen), `habilitado`, `ultimo_disponible_publicado BOOLEAN`,
     `ultima_cantidad_publicada NUMERIC`, `publicado_at`.
4.2. Trigger de disponibilidad (§4.4) → `canal_outbox`.
4.3. API admin `GET/PUT /api/canales/[canal]/productos` (habilitar producto,
     override de precio) y `PATCH` de `recargo_pct` en config. Zod +
     `requireStoreAdmin` + `logAudit`.
4.4. UI catálogo por canal: lista de productos con toggle "vender en este
     canal", precio calculado, override, estado publicado, stock y cupo;
     botón "Publicar catálogo".
4.5. `publicar-catalogo`: solo productos habilitados; precio §4.5; encola
     `catalog` y luego `availability` completa.
4.6. Reconciliación diaria: republicar disponibilidad de todos los productos
     habilitados.
4.7. Tests: precio con recargo/override/redondeo (unit), trigger encola al
     cruzar el mínimo en ambos sentidos y **no** encola si no cambia (real con
     ROLLBACK si se autoriza), coalescencia, worker lee estado actual, modo
     `quantity` envía `stock − mínimo`, producto deshabilitado → apagado;
     frontend del catálogo (toggle y override llaman a la API, errores
     visibles, 403 para worker).

**Criterio de salida:** una venta en POS que deja un producto en su mínimo
genera exactamente una llamada de "apagar" al canal (mock); una recepción de
OC lo vuelve a encender.

### Fase 5 — Seguridad, contabilidad y operación

5.1. Roles en todo `/api/canales/**` (C15) + chequeo `is_disabled` donde
     corresponda + tests negativos §6.5 de AGENTS.md.
5.2. Comisión: registrar comisión por venta de canal o vía
     `canal_liquidaciones` (revisar `src/app/api/canales/liquidacion/route.ts`);
     decidir con el usuario/contador.
5.3. Alertas: menú rechazado, outbox `dead`, órdenes `failed`, token expirado.
5.4. Auditoría (`logAudit`) de config, precios, catálogo, anulaciones de canal.

### Fase 6 — Salida a producción por canal

6.1. Rappi: pruebas E2E en su entorno de desarrollo con credenciales de
     sandbox (webhook público: usar URL de preview de Vercel).
6.2. Checklist go-live: revisar `stock_minimo` de cada producto habilitado
     en canales (Fase 0: 9 de 14 productos activos tenían 0 → se apagarían
     recién sin stock); env vars (`RAPPI_API_BASE` prod, `ENABLED_CHANNELS`,
     `ENCRYPTION_KEY`), `canales_externos.habilitado`, webhook registrado en la
     plataforma con `?store_id=`, catálogo aprobado (Rappi revisa el menú
     24–72 h), prueba de orden real de bajo monto, monitoreo de outbox.
6.3. Repetir 2.6 / 6.1 / 6.2 para PedidosYa y UberEats cuando haya acceso.

---

## 7. Investigación externa (hecha el 2026-09-24)

### 7.1 Vercel Cron (pregunta 6 del usuario)

Fuente: https://vercel.com/docs/cron-jobs/usage-and-pricing

| Plan | Frecuencia mínima | Precisión |
|------|-------------------|-----------|
| Hobby | 1 vez al día (expresiones más frecuentes **fallan en el deploy**) | ±59 min |
| Pro / Enterprise | 1 vez por minuto | por minuto |

- **Confirmado por el usuario: plan Hobby** (D12). `vercel.json` solo tiene
  `/api/cron/email-alerts` diario; no agregar crons más frecuentes ahí.
- El diseño no depende del cron para el camino feliz (usa `after()`); el cron
  solo cubre reintentos, atascos y reconciliación.
- **Por qué no procesar la cola dentro de Postgres:** las llamadas a Rappi/etc.
  necesitan credenciales descifradas con `ENCRYPTION_KEY`, que solo tiene la
  app. Por eso pg_cron **solo despierta** a la app vía HTTP (`pg_net`).

#### Opción A — Instrucciones manuales (Supabase Dashboard → SQL Editor)

Ejecutar **después** de desplegar `POST /api/cron/canales-outbox` y
`POST /api/cron/canales-reconciliar` (Fase 3). Proyecto:
`wnxrdbnvreofrrmhcybc` (producción).

1. Dashboard → Database → Extensions → habilitar **pg_cron** y **pg_net**
   (o paso 2 por SQL).
2. Extensiones por SQL (idempotente):
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   ```
3. Guardar secretos en **Vault** (NUNCA en un archivo de migración versionado).
   Reemplazar los valores; `CRON_SECRET` es el mismo de las env vars de Vercel:
   ```sql
   select vault.create_secret('https://<dominio-produccion-app>', 'petshop_app_url');
   select vault.create_secret('<valor de CRON_SECRET>', 'petshop_cron_secret');
   ```
4. Programar los jobs (migración de la Opción B, o pegar su contenido).
5. Verificar:
   ```sql
   select jobid, jobname, schedule, active from cron.job;
   select status, return_message, start_time
     from cron.job_run_details
    where jobid = (select jobid from cron.job where jobname = 'petshop-canales-outbox')
    order by start_time desc limit 10;
   -- respuesta HTTP de pg_net (tabla se purga sola):
   select id, status_code, error_msg, created from net._http_response order by created desc limit 10;
   ```
6. Desactivar si algo falla: `select cron.unschedule('petshop-canales-outbox');`

#### Opción B — Migración versionada (crear en Fase 3, número siguiente)

`migrations/NNN_pg_cron_canales.sql` (sin secretos; lee de Vault; idempotente
porque `cron.schedule` con el mismo nombre reemplaza el job):

```sql
-- Requiere: secretos 'petshop_app_url' y 'petshop_cron_secret' creados en Vault
-- (ver stock_canales_externos.md §7.1 paso 3). Vercel Hobby no permite crons
-- de más de 1 vez/día, por eso los programa Postgres.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Cada minuto: procesa la outbox de canales y barre órdenes atascadas.
select cron.schedule(
  'petshop-canales-outbox',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'petshop_app_url')
               || '/api/cron/canales-outbox',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'petshop_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Diario 04:00 UTC: reconciliación completa de disponibilidad.
select cron.schedule(
  'petshop-canales-reconciliar',
  '0 4 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'petshop_app_url')
               || '/api/cron/canales-reconciliar',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'petshop_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
```

Notas:
- `pg_net` es asíncrono: el job "termina" al encolar el request; el resultado
  real se ve en `net._http_response`.
- El endpoint debe ser idempotente y tolerar solapamiento (dos invocaciones
  concurrentes): el claim con `FOR UPDATE SKIP LOCKED` lo garantiza.
- El endpoint debe terminar dentro del límite de duración de funciones de
  Vercel Hobby: procesar lotes acotados (`p_limit`) por invocación.
- Si la Deployment Protection de Vercel está activa en producción, el request
  de `pg_net` sería bloqueado: verificar que el dominio de producción sea
  público.
- Fuentes: https://supabase.com/docs/guides/cron/quickstart ,
  https://supabase.com/docs/guides/functions/schedule-functions

### 7.2 Acceso de partner (pregunta 7 del usuario — cómo obtenerlo)

**Rappi** — https://dev-portal.rappi.com/es/
- El acceso **no es self-serve**: lo aprueba un contacto comercial de Rappi;
  luego entregan credenciales de desarrollo y una ruta a producción. El portal
  tiene sección "Self-Onboarding" (`/es/self-onboarding/`).
- Pasos: (1) tener la tienda dada de alta como aliado Rappi; (2) pedir al
  ejecutivo/contacto de Rappi acceso a la **API de integraciones**; (3)
  **preguntar explícitamente si una tienda de mascotas va por la API de
  restaurantes** (la que usa hoy el código: `restaurants-integrations-public-api`)
  **o por la integración de retail/tiendas** — cambia endpoints y el modelo de
  inventario; (4) recibir `client_id`/`client_secret` de dev, registrar webhook.
- La API documentada gestiona disponibilidad on/off de ítems (no cantidades).

**PedidosYa (Delivery Hero)** — https://developer.pedidosya.com/ ,
https://integrar.pedidosya.com/es/documentation/ ,
https://developers.deliveryhero.com/documentation/qc-API-integration.html
- Para tiendas (no restaurantes) aplica probablemente la **Q-Commerce Partner
  API**: Order Transmission (POS API) + **Assortment API** (precio, barcode,
  estado **y cantidad**). LATAM: `https://partners-pedidosya.deliveryhero.io/redoc/`.
- Credenciales: en el **Vendor Portal** → "Shops Integration" → "Token
  Management" → "Generate New Token" (un token para ambas APIs), o vía tu
  contacto de PedidosYa. Soporte: partners@deliveryhero.com.
- Pasos: (1) cuenta de vendedor PedidosYa activa; (2) confirmar con PedidosYa
  si corresponde Q-Commerce Partner API o Restaurant Integration (POS plugin);
  (3) generar token en staging; (4) reescribir el adaptador contra el redoc
  oficial.

**Uber Eats** — https://developer.uber.com/docs/eats/guides/getting-started
- Requiere **NDA + acuerdo de licencia de API** y hablar con el partner
  manager de Uber Eats; luego un "Tech Support Request" para recibir
  credenciales de desarrollador y tiendas de prueba. Los scopes de producción
  requieren aprobación/whitelist. OAuth 2.0 client credentials.
- Pasos: (1) cuenta de comercio Uber Eats; (2) pedir al partner manager acceso
  a Marketplace APIs; (3) firmar NDA/licencia; (4) solicitar credenciales de
  test; (5) reescribir el adaptador contra la documentación oficial.

---

## 8. Decisiones pendientes (preguntar al usuario antes de la fase indicada)

Resueltas el 2026-09-24 (ver §2): P1→D11, P2→D16, P3→D13 + D18, P8→D19/D20, P4→D14,
P5→D15, P6→D12, P7→D17.

| # | Fase | Pregunta | Recomendación |
|---|------|----------|---------------|
| # | Fase | Pregunta | Recomendación |
|---|------|----------|---------------|
| P11 | 1 | **Resuelta → D23.** | — |

P9 (resuelta 2026-09-24): la fecha de vencimiento del LOTE-0 se pide
**obligatoriamente** en la UI al crear el primer lote, prellenada con
`productos.fecha_vencimiento` si existe (D21).

P10 (resuelta 2026-09-24): los stocks con decimales se corrigen por **conteo
físico** con una pantalla nueva "Ajuste por conteo físico", **solo
`storeAdmin`/`systemAdmin`** validado en el servidor (D22, paso 1.7).

---

## 9. Registro de progreso

Actualizar al terminar cada paso: fecha, paso, resultado (verificado /
inferido / pendiente), commit, notas/discrepancias.

| Fecha | Paso | Resultado | Commit | Notas |
|-------|------|-----------|--------|-------|
| 2026-09-24 | Análisis inicial y plan | Documento creado | — | Hallazgos §3 inferidos por lectura; BD real no consultada. |
| 2026-09-24 | Ajuste del plan | D11–D18 agregadas; P1–P7 resueltas; S9 (granel descuenta kg como sacos) y S10 detectados; §4.6 granel; §7.1 pg_cron (SQL + instrucciones) | — | Pendientes P8–P10. Fase 0 aún no iniciada. |
| 2026-09-24 | Ajuste granel | D19–D20: descuento proporcional `gramos/peso_gramos`, saco abierto en gramos enteros, apertura forzada, merma con usuario, deshacer solo admin; P8 resuelta | — | Pendientes P9–P10. |
| 2026-09-24 | P9/P10 resueltas | D21 (vencimiento LOTE-0 obligatorio en UI), D22 (conteo físico solo admin, paso 1.7); S11 (endpoints de stock sin rol en servidor); consultas Fase 0 en `stock_canales_fase0.sql` | — | Esperando que el usuario ejecute Q1–Q12 o conecte MCP Supabase (read_only). |
| 2026-09-24 | Fase 0: Q1–Q3 | Verificados V1–V11 (§3.3b). Hallazgos nuevos: V2 (faltan columnas en `canal_ordenes`, updates fallarían en silencio), V5 (`stock_minimo` default 5 y nullable), V7 (`stock_movements.cantidad` INTEGER y casts `::INTEGER` en `crear_venta_tx` → granel podría estar fallando). Q13 agregada. | — | Faltan Q4–Q13. |
| 2026-09-24 | Fase 0: Q4–Q6 | V12–V18 (§3.3b): granel falla por casts `::INTEGER` en `crear_venta_tx` real; sobrecargas duplicadas de `decrement_stock`/`deducir_stock_fifo`; FIFO excluye vencidos pero el stock los cuenta; `anular_venta_tx` no devuelve a lotes (S12); canales sin datos (0 órdenes). Nueva pregunta P11. | — | Faltan Q7–Q13. |
| 2026-09-24 | Fase 0: Q7–Q9 | Q7: `canal_config` activo en rappi, pedidosya, instagram (1 tienda); ubereats inactivo. Hoy "activo" no tiene efecto real (flujo roto), pero al desplegar Fase 2 (webhook público) Rappi empezaría a recibir órdenes → desplegar Fase 2 con los canales en `activo=false` o con `ENABLED_CHANNELS` sin ellos hasta Fase 6. Q8: 1 de 3 productos con lotes tiene `stock ≠ Σ lotes` (causa candidata: S6, S12 o V14; Q14/Q15 agregadas para diagnosticar). Q9: 14 productos activos; 1 con decimales (P10 → conteo físico); 0 negativos; **9 de 14 con `stock_minimo = 0`** → con D4 se apagarían recién en 0: revisar mínimos antes del go-live (agregar al checklist 6.2). | — | Faltan Q11–Q15. |
| 2026-09-24 | Fase 0: Q11–Q14 | Q11: 2 productos granel, ambos con `peso_gramos` (G8 OK). Q12: `pg_cron` 1.6.4 y `pg_net` 0.20.0 **disponibles, no instalados**; `supabase_vault` 0.3.1 instalado → §7.1 viable. Q13: ventas granel solo en **2026-06** (9 ítems / 8 ventas); granel se agregó el 2026-06-05 (commit a474b81) y la migración 059 se commiteó el 2026-07-23 (20fb206) → consistente con V12 (granel falla tras 059) y con S9 (las ventas de junio descontaron kg como sacos → origen probable del producto con decimales), pero no lo prueba (fecha de commit ≠ fecha de aplicación; puede ser bajo volumen). Q14: 1 producto con `stock` 119 vs Σ lotes activos 118 (**+1**, patrón de S12: anulación que suma a `productos.stock` sin devolver al lote) y **solo 33 de 118 unidades vigentes → 85 vencidas contadas como stock** (V14 con impacto real). Q15 pendiente (se ejecutó con el placeholder `<ID>`). | — | Pendiente Q15 y respuesta P11. |
| 2026-09-24 | Fase 0: Q15 + P11 | Q15 **confirma S12 con datos**: el producto recibió 2 "Anulación" (+1 c/u, 2026-08-08 y 2026-08-19). La del 08-08 se "perdió" al recalcular el trigger con la recepción de OC del 08-09; la del 08-19 persiste como la diferencia +1 (no hubo cambio de lote después). Las NC ("Devolución") sí vuelven al lote correctamente. También hubo un ajuste "Prueba QA" +5 (2026-08-09) sobre producto con lotes, luego pisado por el trigger. P11 → D23. SQL de baja de vencidos entregado al usuario (`stock_canales_baja_vencidos.sql`), pendiente de que él lo ejecute. | — | Fase 0 completa salvo ejecución de la baja. |
| 2026-09-24 | Baja de vencidos ejecutada por el usuario | **Verificado** (resultados pegados por el usuario): PASO 1 = 2 productos de la tienda `18d5dab7…` (85 y 76,3 unidades vencidas); PASO 2 ejecutado una vez; PASO 3: `lotes_activos_vencidos_restantes = 0`, `desalineados = 0`, `productos_con_lotes = 2` (el producto `34b5e144…` quedó sin lotes activos, stock 0). **Fase 0 cerrada.** | — | Siguiente: Fase 1 (integridad de stock). |
| 2026-09-24 | Fase 1 — paso previo 1: MCP Supabase | **Verificado**: conectado con `supabase_read_only_user`, `transaction_read_only = on`. `apply_migration` no está disponible en modo read-only → las migraciones de Fase 1 las aplica el usuario (SQL Editor) o se cambia el MCP a escritura con su autorización. | — | — |
| 2026-09-24 | Fase 1 — paso previo 2: re-verificación §0.2 | **Verificado** contra `pg_get_functiondef` real y código actual (sin commits nuevos desde el plan): S4, S5, S6, S7, S11, V12–V16 siguen vigentes tal como están descritos. Nuevo: **V19/S13** (NC parcial devuelve el ítem completo a los lotes; 1 ítem, +2 u, confirmado con datos), **V20** (`venta_items` sin `es_granel`/`gramos` → Fase 1b debe crearlas), **V21** (constraints y grants). Además: la recepción de OC **sin** vencimiento de un producto **con** lotes hace `increment_stock` → el trigger lo borra en el siguiente cambio de lote (misma familia que S6; se cubre en Fase 1). | — | Ver §3.3b V19–V21. |
| 2026-09-24 | Fase 1 — backend (1.1, 1.2, 1.3, 1.4, 1.7 API, D23 API) | **Implementado; tests con mocks verificados** (no aplicado en BD). Migraciones `074_stock_estricto.sql` (decrement/increment/FIFO estrictos y únicos, `devolver_*` proporcional, CHECK stock ≥ 0, cantidades NUMERIC, `crear_venta_tx` "tiene lotes" = lote activo), `075_devoluciones_a_lotes.sql` (S12 + S13 en `anular_venta_tx` / `crear_nota_credito_tx`, §23.5 intacto), `076_lotes_conteo_merma.sql` (`registrar_lote`, `convertir_stock_suelto_a_lote`, `ajustar_stock_conteo`, `merma_lote_vencido`). Rutas: `POST /api/lotes`, `PATCH /api/inventario/[id]`, `PATCH /api/productos/[id]`, recepción de OC, nuevas `POST /api/inventario/[id]/conteo` y `POST /api/lotes/[id]/merma`; `src/lib/stock-errors.ts`. Hallazgo extra: la recepción de OC no validaba que `producto_id` fuera de la tienda (IDOR) → cerrado. | — | Migraciones **pendientes de aplicar** (requieren confirmación). |
| 2026-09-24 | Fase 1 — frontend + gates | **Verificado (local)**: UI `LotesPanel` (aviso y vencimiento obligatorio del LOTE-0, D21; "Dar de baja (merma)" para lotes vencidos, D23), `ConteoFisicoModal` + acción "Conteo" y filtro "Con decimales" en Inventario (D22), ajuste +/− visible solo a admin (UX; el control es el servidor). Gates: `npm test` 198/198 suites, 2235/2235 tests; `typecheck` limpio; `lint` sin errores nuevos (comparado contra HEAD por archivo); `npm run build` OK; cobertura de archivos tocados 82–100 % líneas; sintaxis SQL + PL/pgSQL de 074–076 validada con `libpg-query`. IDs I-531..I-571, U-159..U-162, CF-01..07, LP-07..12, IV-15..18 registrados en `docs/spec-registry.md`. | — | **Pendiente**: aplicar 074→075→076 (confirmación) y correr `stock_canales_fase1_verificacion.sql` (BEGIN…ROLLBACK); prueba de concurrencia manual (2 sesiones). Fase 1b (granel) no iniciada. |
