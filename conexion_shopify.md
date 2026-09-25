# Conexión Shopify como canal de venta online — estudio y plan

Fecha del estudio: 2026-09-22. Autor: análisis asistido (Claude Code) a pedido
de Pablo. Este documento es un **plan de diseño**, no código: nada de lo
descrito aquí se implementó todavía.

## 0. Cómo se hizo este estudio — limitaciones que debes conocer

- `graphify` está instalado y el grafo (`graphify-out/graph.json`, reconstruido
  2026-09-22) se usó para orientar la exploración inicial
  (`graphify query "cómo funciona el sistema de canales externos..."`), pero
  la mayor parte de este estudio se apoya en **lectura directa del código
  real** de `src/lib/canales/`, sus migraciones y sus tests — el grafo da
  buena orientación de alto nivel pero varios de los hallazgos más
  importantes de este documento (§2.2 a §2.6) solo aparecen leyendo el código
  línea por línea, no en un resumen de grafo.
- `codebase-memory-mcp` y `claude-flow` (MCP) siguen fallando al conectar en
  esta sesión (`CONNECTION_CLOSED`). No se usaron.
- **`node_modules/` no está instalado.** No pude confirmar contra tipos reales
  ninguna librería de integración con Shopify (si se usa un SDK oficial como
  `@shopify/shopify-api` o llamadas HTTP directas a la Admin API, es una
  decisión de implementación, no algo que este estudio fije).
- **No consulté la base de datos Supabase real** (`wnxrdbnvreofrrmhcybc`). El
  modelo de datos de canales descrito abajo sale de `migrations/012_canales_hub.sql`,
  `013/014/015_multi_channel_phase0_step*.sql` y `073_ventas_procedencia_canales_conectados.sql`.
  Por §11.4 de AGENTS.md esto es "inferido", no "verificado" — antes de migrar,
  confirmar contra `information_schema` real que el estado asumido sigue vigente.
- **Todo lo que afirmo sobre la Admin API de Shopify, sus webhooks, límites de
  tasa y comportamiento de checkout viene de búsquedas web hechas en esta
  sesión (2026-09-22), no de documentación oficial leída íntegra ni de una
  cuenta Shopify real de prueba.** Cito las fuentes al final del documento.
  Antes de escribir una sola línea de código de este plan: crear una tienda
  Shopify de desarrollo (developer store, gratuita) y validar cada afirmación
  marcada **[verificar contra Shopify real]** en este documento contra el
  Admin real y su documentación completa en `shopify.dev`.
- Sí ejecuté grep/lectura extensa sobre el código fuente real de
  `src/lib/canales/`, sus migraciones, su webhook y sus tests — la sección 2
  (estado actual) tiene alta confianza aunque no esté verificada contra
  infraestructura viva.

## 1. Decisiones confirmadas contigo (2026-09-22)

1. **Modelo de aceptación de orden**: **auto-aceptar + mantener la
   disponibilidad empujada a Shopify lo más fresca posible**. Al llegar el
   webhook de una orden pagada, la venta se crea automáticamente en petShop
   (sin revisión manual de un operador) — a diferencia de Rappi/PedidosYa/
   UberEats, que quedan en `canal_ordenes.estado='pending'` hasta que alguien
   hace clic en "Aceptar" en `/canales`. Ver §4.4 para una precisión
   importante: Shopify **ya tiene su propio mecanismo de reserva en el
   checkout** (§3.3) — lo que petShop controla no es una reserva dentro de
   Shopify (no es técnicamente posible desde afuera), sino qué tan reciente
   es el número de stock que Shopify usa para decidir si mostrar "disponible".
2. **Origen del stock (qué tienda respalda el catálogo de Shopify)**: **queda
   como pregunta abierta** (ver §8.1) — se documentan ambas rutas (una sola
   tienda designada vs. depender de la propuesta multi-sucursal de
   `storeBranch.md`, aún no implementada) con sus implicancias, sin decidir
   todavía.
3. **Alcance del catálogo**: **subconjunto curado**, igual patrón que ya
   existe para Rappi/PedidosYa/UberEats vía `canal_producto_config` — el
   operador decide qué productos están activos/visibles en Shopify, con su
   propio precio por canal si aplica.
4. **Alcance contable**: **se incluye** la conciliación contable completa
   (cuenta por cobrar, comisión/fees, liquidaciones, asientos vía
   `crearAsiento`), con la salvedad de que el modelo de costos de Shopify es
   estructuralmente distinto al de un marketplace (§4.8) — no se puede copiar
   literal el patrón de `CUENTAS_COMISION` de Rappi.

## 2. Estado actual verificado — el sistema de canales que ya existe

### 2.1 Arquitectura: un Hub genérico con adaptadores por canal

`src/lib/canales/types.ts` define una interfaz común (`IExternalChannel`) que
implementan todos los adaptadores (`rappi/`, `pedidosya/`, `ubereats/`,
`instagram/`, `pos/`). El tipo `CanalId` (línea 6) es una **unión cerrada**:

```ts
export type CanalId = "pos" | "rappi" | "pedidosya" | "ubereats" | "instagram";
```

Conectar Shopify significa agregar `"shopify"` a esta unión, lo que en
TypeScript obliga (por diseño, es la ventaja de una unión cerrada) a tocar
**todos** los `Record<CanalId, ...>` que dependen de ella — ya identificados
por grep:

- `VENTANA_ACEPTACION` (`types.ts:137`) — ventana de aceptación en minutos
  por canal (pos:0, rappi:5, pedidosya:5, ubereats:8). Para Shopify, al ser
  auto-aceptado (§1.1), este valor es conceptualmente 0, pero su semántica es
  distinta a la de POS: no es "inmediato porque lo cobra el cajero", es
  "inmediato porque ya viene pagado" — vale la pena no reusar el mismo `0`
  sin dejar el comentario explícito de por qué.
- `CUENTAS_POR_COBRAR` (`types.ts:146`) — cuenta contable de activo por
  canal. Shopify necesita la suya (§4.8).
- `CUENTAS_COMISION` (`types.ts:154`) — cuenta de gasto por canal. Mismo
  comentario: el modelo de costos de Shopify no es una comisión por venta
  (§4.8).
- `ALL_ADAPTERS` en `registry.ts:15` — instanciar el nuevo `ShopifyChannel`.
- El `CHECK` constraint de `ventas.procedencia` en
  `migrations/073_ventas_procedencia_canales_conectados.sql` — **el propio
  comentario de esa migración ya dice explícitamente**: "IMPORTANTE para
  quien agregue un canal nuevo con conexión real (ej. Shopify): agregar su
  CanalId aquí también — de lo contrario `aceptarOrdenExterna()` fallará con
  check_violation (código Postgres 23514)". El código ya anticipó este
  estudio.
- `canales_externos` (tabla) — insertar la fila `('shopify', 'Shopify', true, false)`.

### 2.2 El pipeline canónico de venta: `aceptarOrdenExterna()` (`src/lib/canales/hub.ts:279-539`)

Este es el corazón del sistema y el punto de integración más importante para
Shopify. Resumen del flujo real (leído completo, no el docstring):

1. Busca la orden en `canal_ordenes` por `id` + `store_id`, exige
   `estado IN ('pending', 'reserved')`.
2. Lee `orden.payload.items` (JSON crudo guardado por el webhook de intake) —
   cada item trae `id` (**SKU externo**), `quantity`, `unit_price` (bruto,
   IVA incluido, misma regla que POS).
3. **Resuelve SKU → producto interno vía `productos.sku`** — no vía un ID
   externo mapeado en una tabla aparte. Si un SKU no existe en el catálogo
   de la tienda, aborta toda la aceptación (comportamiento explícitamente
   más estricto que "una versión anterior" que sí dejaba crear ventas con
   items faltantes — ver el comentario en el código y §2.2 de este
   documento más abajo sobre el archivo perdido `docs/revision_claude_shopify.md`).
4. Verifica stock disponible por SKU **contra `productos.stock` directamente**
   (no contra `stock_reservas` — ver §2.3, la reserva y esta verificación
   viven en universos separados hoy).
5. Llama a `crear_venta_tx` — el **mismo RPC que usa el POS** — con
   `p_metodo_pago: "plataforma"`, `p_canal: canalId`, `p_procedencia: canalId`,
   e `p_idempotency_key: "canal:{canalId}:{external_order_id}"`. Esto le da a
   la venta de canal las mismas garantías que una venta de POS: descuento
   FIFO por lotes, `stock_movements`, atomicidad transaccional, e
   **idempotencia real** (un reintento del mismo `external_order_id` no
   duplica la venta — devuelve la venta ya creada).
6. Si la venta se creó (no fue un reintento): libera cualquier reserva
   temporal (no-op hoy, ver §2.3), marca `canal_ordenes.estado='accepted'`,
   intenta `channel.confirmOrder()` contra la API del canal (best-effort,
   solo loguea si falla), audita, y genera dos asientos contables
   (ingreso + COGS) vía `after()` de `next/server` — post-respuesta, para no
   bloquear el request.

**Esta función ya está escrita para aceptar un canal nuevo sin cambios
estructurales** — el propio código lo dice en su docstring: "Acepta una
orden de un canal externo (Rappi/PedidosYa/UberEats/futuros canales como
Shopify)". El trabajo real para Shopify no es reescribir `aceptarOrdenExterna()`,
es (a) que el webhook de intake la llame automáticamente en vez de esperar
un clic de operador (§4.3), y (b) resolver el mapeo SKU↔producto de forma
confiable (§4.3.1, porque en Shopify el "SKU" es un campo opcional de texto
libre por variante, no un identificador garantizado).

### 2.3 La reserva de stock (`stock_reservas`) existe en código pero **no está conectada**

`hub.ts` define `reservarStock()`, `liberarReservaYDescontarStock()` y
`liberarReservaSinDescontar()` — un mecanismo completo para reservar stock
entre la recepción de una orden y su aceptación, con expiración a 10 minutos.
**Pero el propio código lo dice explícitamente** (`hub.ts:455-458`, comentario
dentro de `aceptarOrdenExterna()`):

> "La reserva temporal (si existía) ya cumplió su función [...] Liberarla es
> un no-op seguro si nunca se creó (**los canales actuales aún no llaman
> `reservarStock` en el webhook de intake**)."

Es decir: **hoy, para Rappi (el único canal con intake funcional, ver §2.4),
no existe ninguna reserva de stock entre que llega el pedido y que un
operador lo acepta.** Si dos operadores aceptan casi simultáneamente dos
órdenes que compiten por el mismo último producto, o si una venta de POS
descuenta el stock entre la llegada de la orden y su aceptación, la
verificación del paso 4 de §2.2 puede pasar con datos ya obsoletos — la
única protección real contra la sobreventa hoy es que `crear_venta_tx` vuelve
a validar stock dentro de la transacción SQL antes de descontar (por eso el
error `isStockError` en `hub.ts:423-425` existe), así que el peor caso es un
`422` al aceptar, no una venta con stock negativo. **Esto es relevante para
Shopify** porque §1.1 decidió auto-aceptar: sin operador de por medio,
`crear_venta_tx` fallando con stock insuficiente en un pedido **ya pagado**
por el cliente en Shopify es un problema de servicio al cliente real (no un
simple "rechazar la orden"), no solo un detalle técnico. Ver §4.4/§5.7/§6.2.

### 2.4 El webhook de intake solo funciona para Rappi — PedidosYa y UberEats están incompletos

`src/app/api/canales/webhook/[canal]/route.ts:48-55`:

```ts
if (canalId === "rappi") {
  const { RappiChannel } = await import("@/lib/canales/rappi/adapter");
  handler = new RappiChannel();
} else {
  return NextResponse.json({ error: "Canal no soportado" }, { status: 400 });
}
```

**Hallazgo no relacionado directamente con Shopify pero que el estudio debe
reportar** (pedido explícito del usuario: "partes no cubiertas hasta ahora
que se podrían llegar a afectar"): PedidosYa y UberEats tienen adaptadores
completos (`auth.ts`, `orders.ts`, `types.ts`, `adapter.ts` con
`confirmOrder`/`rejectOrder`/`parseWebhookEvent`/`setAvailability`, páginas
de UI en `/canales/pedidosya/ordenes` y `/canales/ubereats/ordenes`), pero
**su webhook de intake retorna 400 "Canal no soportado" siempre** — no hay
forma de que una orden de PedidosYa o UberEats entre nunca a `canal_ordenes`
por esta vía. Tampoco hay polling (grep confirmado: cero referencias a
"poll"/"cron" en sus `orders.ts`). Es decir: **dos de los tres canales
"conectados" que aparecen en la UI no reciben órdenes reales hoy.**

Esto importa para Shopify de dos formas:
1. Si se sigue el patrón actual literal (agregar un `if (canalId === "shopify")`
   más a esa cadena), Shopify funcionaría — pero se estaría perpetuando el
   mismo problema de escalar mal a N canales.
2. Este estudio recomienda (§4.3, no obligatorio, discutir con Pablo)
   generalizar la ruta a `handler = getChannel(canalId as CanalId)` (usando
   el registry que ya existe y ya resuelve dinámicamente por `CanalId`), lo
   cual **arreglaría PedidosYa/UberEats gratis** al mismo tiempo que se
   conecta Shopify — mismo esfuerzo, alcance más amplio. Esta es una
   decisión de producto/alcance para Pablo, no algo que se decida aquí.

### 2.5 El push de catálogo/disponibilidad hacia los canales es manual, nunca automático

`IExternalChannel.syncCatalog()` y `.setAvailability()` están definidos en la
interfaz e implementados en cada adaptador, pero **grep confirma un solo call
site en todo el repo**: `src/app/api/canales/catalog/route.ts:71`, un
endpoint que un operador dispara manualmente desde la UI. **Ningún flujo que
modifica `productos.stock` hoy (venta POS, venta de canal, nota de crédito,
anulación de venta, recepción de orden de compra, ajuste manual de stock,
gestión de lotes) dispara automáticamente un push hacia ningún canal
externo.** Esto es aceptable para Rappi/PedidosYa/UberEats (son apps tipo
marketplace donde el operador gestiona disponibilidad manualmente y el
`stock_reservas`/reintento en `crear_venta_tx` amortigua el desfase), pero
**es la brecha arquitectónica central para Shopify** — ver §3 y §4.2. Un
storefront propio con checkout de autoservicio necesita que el número que ve
el cliente esté fresco, no que un operador lo actualice cuando se acuerde.

### 2.6 Inconsistencias de repo encontradas durante este estudio (no bloqueantes, pero hay que saberlas)

- **Dos migraciones numeradas `012`**: `012_canales_hub.sql` (166 líneas) y
  `012_multi_channel_phase0_step1.sql` (106 líneas) — ambas crean
  prácticamente las mismas 6 tablas (`canales_externos`, `canal_config`,
  `canal_producto_config`, `canal_ordenes`, `stock_reservas`,
  `canal_liquidaciones`), ambas con `CREATE TABLE IF NOT EXISTS` así que no
  chocan entre sí si ambas se aplicaron, pero es una violación de la
  convención de numeración del proyecto (§11.1 AGENTS.md) y una señal de que
  puede haber más de una "versión de la verdad" del historial de migraciones
  de canales. **No se investigó cuál se aplicó realmente en producción** —
  antes de escribir la migración de Shopify (que tocará estas mismas tablas
  con `ALTER TABLE`), confirmar contra `information_schema` real cuál de las
  dos (o ambas) está efectivamente en el schema vivo.
- **Referencia rota a `docs/revision_claude_shopify.md`**: tanto
  `docs/spec-registry.md:320` como el comentario de cabecera de
  `tests/integration/api/canales-accept.test.ts:6` citan ese archivo como la
  fuente de "cuatro problemas verificados" que motivaron reescribir
  `aceptarOrdenExterna()` (no pasaba por `crear_venta_tx`, no generaba
  asiento contable, etc. — los mismos problemas que §2.2 de este documento
  confirma que ya están resueltos). **Ese archivo no existe en el repo ni en
  el historial de git** (`git log --all` no lo encuentra). Es decir: hubo un
  estudio previo, con este mismo nombre de convención (`revision_claude_*` /
  este documento se llama `conexion_shopify.md`), que evaluó código
  relacionado con Shopify y nunca se commiteó o se perdió. No se pudo
  recuperar su contenido — este estudio no puede confirmar si llegó a cubrir
  las mismas preguntas que este documento, así que no debe asumirse
  continuidad con él.

## 3. Por qué Shopify no es "un Rappi más" — diferencias que cambian el diseño

Basado en búsquedas web hechas en esta sesión (fuentes al final; marcar cada
uno como **[verificar contra Shopify real]** antes de implementar):

1. **El pago ya está cobrado cuando llega el webhook.** El webhook
   `orders/create` de Shopify "fires only when payment is complete" — a
   diferencia de Rappi, donde `aceptar` es una decisión de negocio del
   operador *antes* de comprometerse. Rechazar una orden de Shopify después
   de recibida no es "no aceptar", es un reembolso. Esto es la base de la
   decisión §1.1 (auto-aceptar).
2. **Shopify ya reserva stock en su propio checkout — petShop no puede
   reservar "dentro" de Shopify.** Según la documentación consultada:
   agregar algo al carrito **no** reserva inventario; Shopify reserva recién
   cuando el comprador **envía el pago**, por unos minutos, y lo libera si el
   pago falla o expira. Esto significa que la "reserva previa al pago" de la
   decisión §1.1 no es una funcionalidad que petShop implemente *en*
   Shopify — es algo que Shopify **ya hace nativamente**. Lo único que
   petShop controla es qué tan actualizado está el número de "disponible"
   que Shopify usa para decidir si dejar avanzar al checkout en primer
   lugar. Ver §4.2/§4.4.
3. **Shopify tiene un ajuste "Continue selling when out of stock" por
   variante** — si está activo (no es el default), Shopify deja vender con
   stock en negativo. Para que la protección de Shopify contra sobreventa
   funcione, ese ajuste debe estar **desactivado** en cada producto
   sincronizado desde petShop — un prerequisito de configuración, no de
   código, que hay que documentar en el runbook de conexión.
4. **Multi-location nativo.** Shopify tiene el concepto de "Location" con
   inventario independiente por SKU en cada una — encaja naturalmente con
   una futura sucursal de `storeBranch.md` (una `stores` row de petShop ↔
   una `Location` de Shopify), pero **no depende de que esa feature exista**:
   funciona igual con una sola Location. Esto reduce el riesgo de la
   pregunta abierta §8.1 — no hace falta esperar a multi-sucursal para
   empezar.
5. **API GraphQL, no REST.** Desde abril 2025 las apps públicas nuevas deben
   usar la Admin API GraphQL exclusivamente; los endpoints REST de
   inventario siguen funcionando para apps custom pero están en modo
   mantenimiento (sin nuevas funcionalidades). La versión estable actual es
   `2026-04`. Recomendación: construir el adaptador de Shopify sobre GraphQL
   desde el día uno, no sobre REST (evita una migración forzada después).
6. **Límites de tasa distintos a los de Rappi/PedidosYa/UberEats.** GraphQL
   Admin API usa un bucket de costo (~1000 puntos, restauración ~50 pts/seg
   en plan Standard); cada mutación de inventario cuesta ~10 puntos → ~5
   actualizaciones/seg sostenidas. Para sincronizar el catálogo completo (no
   solo deltas puntuales) existe la Bulk Operations API, que evita el límite
   por puntos — recomendado para el sync inicial de catálogo, no para los
   pushes incrementales de stock.
7. **Firma de webhook distinta.** Shopify usa un único header
   `X-Shopify-Hmac-Sha256` = `base64(HMAC-SHA256(raw_body, shared_secret))`.
   Esto es estructuralmente distinto al de Rappi (`rappi-signature: t=...,sign=...`,
   leído en `rappi/adapter.ts:73-93`, con ventana anti-replay de 5 minutos
   basada en el timestamp del header). La interfaz `validateWebhook(headers,
   rawBody, secret)` ya está diseñada para que cada adaptador implemente su
   propio esquema — no hace falta tocar la interfaz, solo escribir la
   implementación de Shopify.
8. **Deduplicación de reintentos vía `X-Shopify-Webhook-Id`.** Shopify
   entrega con garantía "at-least-once", no "exactly-once" — el mismo evento
   puede llegar más de una vez, y ese header identifica reintentos. El patrón
   actual de la ruta de webhook (dedup por `external_order_id` antes de
   insertar en `canal_ordenes`, `webhook/[canal]/route.ts:74-84`) ya cubre el
   caso de **órdenes** duplicadas, pero eventos que no crean una orden nueva
   (`inventory_levels/update`, `refunds/create` sobre una orden ya conocida)
   necesitan su propia dedup por `X-Shopify-Webhook-Id`, con un TTL — la
   fuente consultada sugiere 48 horas como ventana segura de re-entrega.
9. **Autenticación de apps custom cambió en 2026.** Según lo consultado, las
   apps custom nuevas ya no generan un token simple desde el admin — ahora
   requieren flujo OAuth vía el dashboard de partners/developers, igual que
   una app pública. Esto afecta cómo se provisionan las credenciales que hoy
   se guardan en `canal_config.credentials`/`webhook_secret`/`token` (mismo
   patrón de encriptación que Rappi, vía `src/lib/canales/encryption.ts` —
   reutilizable sin cambios), pero el *flujo de obtención* del token inicial
   es distinto y requiere un paso de configuración manual documentado en el
   runbook, no algo automatizable desde petShop.

## 4. Diseño propuesto

### 4.1 Modelo de datos

Reutiliza las tablas existentes de canales (§2.1-2.2) sin cambiar su forma —
Shopify es "un canal más" para `canal_config`/`canal_producto_config`/
`canal_ordenes`/`canal_liquidaciones`. Cambios necesarios:

```sql
-- migrations/074_shopify_channel.sql (borrador — verificar numeración real
-- al implementar, y verificar primero si 012 duplicada (§2.6) ya está
-- resuelta en producción antes de tocar estas tablas)

INSERT INTO canales_externos (id, nombre, es_externo, habilitado)
VALUES ('shopify', 'Shopify', true, false)
ON CONFLICT (id) DO NOTHING;

-- Ampliar el CHECK de procedencia (ver §2.1 — el propio migrations/073 ya
-- avisa que esto hace falta)
DO $$
DECLARE v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'ventas'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%procedencia%';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ventas DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE ventas ADD CONSTRAINT ventas_procedencia_check
  CHECK (procedencia IN (
    'presencial', 'instagram', 'whatsapp', 'facebook', 'tiktok', 'telefonico',
    'rappi', 'pedidosya', 'ubereats', 'shopify'
  ));

-- Mapeo SKU/variante Shopify ↔ producto petShop (ver §4.3.1 — no se puede
-- confiar en igualdad textual de canal_producto_config.external_product_id
-- porque Shopify identifica variantes por variant_id/inventory_item_id
-- numéricos, no por el SKU que puede estar vacío o duplicado)
ALTER TABLE canal_producto_config
  ADD COLUMN IF NOT EXISTS external_variant_id TEXT,
  ADD COLUMN IF NOT EXISTS external_inventory_item_id TEXT;

-- Cuentas contables (ver §4.8 — distintas de las de un marketplace)
INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, subtipo, activo)
SELECT id, '110405', 'Cuentas por cobrar Shopify Payments', 'ACTIVO', 'CIRCULANTE', true FROM stores
ON CONFLICT (store_id, codigo) DO NOTHING;

INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, subtipo, activo)
SELECT id, '510105', 'Comisión procesamiento de pago Shopify', 'GASTO', 'OPERACIONAL', true FROM stores
ON CONFLICT (store_id, codigo) DO NOTHING;

INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, subtipo, activo)
SELECT id, '520201', 'Suscripción Shopify (plan mensual)', 'GASTO', 'ADMINISTRATIVO', true FROM stores
ON CONFLICT (store_id, codigo) DO NOTHING;
```

No se toca `venta_items`/`nota_credito_items` (§6.3/§23.1 AGENTS.md) — el
ownership de una venta de Shopify sigue vía `ventas.store_id`, exactamente
igual que una venta de Rappi hoy.

### 4.2 Flujo saliente: petShop → Shopify (empujar stock fresco)

Este es el trabajo nuevo real, porque §2.5 confirmó que **hoy no existe
ningún push automático**. Puntos de entrada que hoy modifican
`productos.stock` y que necesitarían disparar una sincronización (verificado
por grep de qué migraciones tocan `productos.stock` o llaman
`deducir_stock_fifo`/`devolver_stock_a_lotes`):

| Origen del cambio de stock | Dónde vive hoy |
|---|---|
| Venta POS o de canal (`crear_venta_tx`) | `migrations/037/044/059` |
| Anulación de venta (`anular_venta_tx`) | `migrations/053/057` |
| Nota de crédito con restitución (`crear_nota_credito_tx`) | `migrations/061/070/071` |
| CRUD manual de lotes (`crearLote`/`actualizarLote`/`desactivarLote`) | `LotesPanel.tsx` → `/api/lotes` |
| Ajuste manual de stock | `PATCH /api/inventario/[id]` |
| Recepción de orden de compra | `PATCH /api/ordenes-compra/[id]` (`increment_stock`) |

**Ninguno de estos seis puntos está centralizado** — son seis superficies de
código distintas. Dos estrategias posibles (a decidir en implementación, no
en este estudio):

- **(a) Trigger de Postgres en `productos.stock`** (`AFTER UPDATE`) que
  encola un evento de sincronización (ej. en una tabla `canal_sync_queue` o
  vía `pg_notify`) — centraliza la detección en la base de datos, no depende
  de que cada uno de los seis call sites recuerde llamar algo. Más robusto,
  pero es lógica nueva en PL/pgSQL con su propio riesgo (§20.7 AGENTS.md:
  concurrencia, at-least-once, no debe bloquear la transacción de venta).
- **(b) Hook explícito en cada uno de los seis call sites** (similar al
  patrón `after()` que ya usa `aceptarOrdenExterna()` para los asientos
  contables) — más código repetido, pero más fácil de auditar/testear
  aisladamente y no añade lógica a las funciones transaccionales críticas.

En ambos casos: **no empujar a Shopify de forma síncrona dentro de la
transacción de venta.** El patrón que ya usa el proyecto para todo lo que "no
debe bloquear una venta si falla" (`crearAsiento()`, `syncProductsToHub()`)
es fire-and-forget con `after()`/logging, nunca `await` bloqueante — igual
principio aquí: si Shopify está caído, una venta de POS no debe fallar por
eso, pero la desincronización resultante debe quedar registrada para
reconciliación (ver §4.2.1).

Además del push incremental por evento, el propio patrón de Bulk Operations
de Shopify (§3.6) sugiere una **reconciliación periódica completa** (ej. cron
diario, similar en espíritu a `/api/cron/stock-reservas-expiry` que ya
existe) que resincroniza todo el catálogo activo en Shopify contra
`productos.stock` real — una red de seguridad para cualquier evento que se
haya perdido por el mecanismo incremental (igual principio que "prevención
≠ observabilidad", §20.5 AGENTS.md).

**Ojo con el loop de sincronización**: el webhook `inventory_levels/update`
de Shopify se dispara con **cualquier** cambio de inventario en Shopify,
incluyendo los que el propio push de petShop acaba de escribir. Sin una
forma de distinguir "esto lo escribí yo" de "esto lo cambiaron en el admin
de Shopify", cualquier sync bidireccional (§4.2.1) entraría en un loop
infinito de escritura. Mitigación estándar: ignorar temporalmente el eco del
propio escritor (ventana corta) o, mejor, usar el `X-Shopify-Webhook-Id`
para nunca reaccionar a un delta que coincide exactamente con el que
acabamos de enviar.

#### 4.2.1 ¿Hace falta sync inverso (Shopify → petShop) de inventario, más allá de las órdenes?

Un ajuste manual de stock hecho directamente en el admin de Shopify (no vía
una orden) dispararía `inventory_levels/update`. **Pregunta abierta para
Pablo** (§8.3): ¿se permite que alguien ajuste stock manualmente desde el
admin de Shopify, o el admin de Shopify queda de solo lectura para inventario
y todo ajuste se hace siempre desde petShop? Si se permite lo primero, ese
webhook necesita su propio handler que decremente/incremente
`productos.stock` en petShop — un séptimo punto de entrada de escritura de
stock, esta vez originado *fuera* de petShop, con su propia necesidad de
idempotencia y de no pisar una venta concurrente.

### 4.3 Flujo entrante: Shopify → petShop (orden pagada → venta)

1. Nueva ruta de webhook o generalización de la existente (§2.4 — discutir
   con Pablo si se aprovecha para arreglar PedidosYa/UberEats de paso).
2. Verificar HMAC (`X-Shopify-Hmac-Sha256`, §3.7) — nueva implementación de
   `validateWebhook()` en `ShopifyChannel`, no reutilizable de Rappi.
3. Dedup por `X-Shopify-Webhook-Id` (§3.8) antes de procesar, además de la
   dedup existente por `external_order_id` al insertar en `canal_ordenes`.
4. `event.type === "order"` (equivalente a `orders/create`/`orders/paid`) →
   en vez de dejar la orden en `pending` esperando un clic de operador,
   **llamar `aceptarOrdenExterna()` inmediatamente** (auto-aceptar, §1.1) —
   la función ya soporta esto sin cambios, solo cambia quién/qué la invoca.
5. Responder 2xx dentro de 5 segundos (§3.10 recomendación de la fuente
   consultada) — el trabajo pesado (asientos contables) ya usa `after()`
   dentro de `aceptarOrdenExterna()`, así que esto ya está resuelto por el
   código existente; verificar que el resto del handler (verificación HMAC +
   lookup + insert + llamada a `aceptarOrdenExterna`) sea razonablemente
   rápido en la práctica.

#### 4.3.1 El problema del mapeo SKU ↔ producto es más frágil en Shopify que en Rappi

`aceptarOrdenExterna()` resuelve productos por `productos.sku` (§2.2, paso
3). En Shopify, el campo "SKU" de una variante:
- es **opcional** — un producto puede no tener SKU asignado;
- no tiene garantía de unicidad **[verificar contra Shopify real]** — nada
  impide que un comerciante repita un SKU entre dos variantes por error;
- es texto libre editable en cualquier momento desde el admin de Shopify,
  sin que petShop se entere si no hay una sincronización activa vigilándolo.

El identificador realmente estable en Shopify es el `variant_id` (o el
`inventory_item_id` para operaciones de inventario) — numérico, inmutable,
asignado por Shopify al crear la variante. **Recomendación**: no reusar la
resolución por SKU de `aceptarOrdenExterna()` tal cual para Shopify; guardar
`external_variant_id`/`external_inventory_item_id` en
`canal_producto_config` (§4.1) en el momento del `syncCatalog()` inicial, y
resolver por ese ID en el webhook de orden entrante, con el SKU como
fallback/validación cruzada, no como llave primaria de mapeo. Esto es una
extensión del comportamiento de `aceptarOrdenExterna()` específica para
canales cuyo "external_product_id" es más confiable que su SKU — no rompe
el comportamiento actual de Rappi/PedidosYa/UberEats.

### 4.4 Prevención de sobreventa — qué controla petShop y qué no

Como estableció §3.2: petShop **no puede** insertar una reserva dentro del
checkout de Shopify — eso ya lo hace Shopify nativamente al momento del
pago. Lo que sí está bajo control de petShop:

1. **Frescura del número empujado** (§4.2) — cuanto menor la latencia entre
   "algo cambió el stock en petShop" y "Shopify tiene el número nuevo", menor
   la ventana de sobreventa. Con los límites de tasa de GraphQL (§3.6, ~5
   updates/seg sostenidas), esto es holgado para el volumen de una tienda de
   barrio, pero hay que dimensionarlo si el catálogo activo en Shopify crece.
2. **`crear_venta_tx` sigue siendo la última línea de defensa** — si por
   latencia de sync Shopify deja pasar un pedido para algo que ya no hay
   stock, el RPC (§2.2, mismo mecanismo que ya protege POS/Rappi/PedidosYa/
   UberEats hoy) rechaza la venta con error de stock insuficiente **después**
   de que el cliente ya pagó en Shopify. Este es el caso que §1.1 marcó como
   "problema de servicio al cliente real" — no hay forma de evitarlo al
   100% con ningún diseño (ni Shopify mismo lo evita al 100%, por diseño:
   "Oversell protection [...] works only when the underlying inventory state
   [...] is accurate"), solo minimizarlo. El manejo de este caso (reembolso
   automático vía Shopify Refund API + notificación al cliente + alerta al
   operador) es trabajo nuevo que no existe hoy en ningún canal — Rappi/
   PedidosYa/UberEats nunca llegan a este caso porque el operador rechaza
   *antes* de cobrar. Ver §5.7 y §6.2.
3. **Apagar "Continue selling when out of stock"** (§3.3) en cada variante
   sincronizada — configuración, no código, pero debe quedar en el runbook
   de puesta en marcha porque si queda prendido (el estado que trae un
   producto nuevo en algunos flujos de creación) invalida todo lo anterior.

### 4.5 Devoluciones y reembolsos

Dos direcciones:

- **Devolución de una venta canal=shopify gestionada desde petShop** (ej. el
  cliente vuelve a la tienda física): sigue el flujo normal de
  `crear_nota_credito_tx` (§23.1 AGENTS.md, sin cambios) — pero **si el pago
  original fue procesado por Shopify Payments (no por caja física)**, el
  dinero no está en la caja de la tienda para devolverlo directamente; la
  devolución real de plata tiene que iniciarse en Shopify (Refund API), y
  petShop solo refleja el ajuste de stock/contable. Este es un caso que las
  notas de crédito actuales no contemplan (todas asumen que el reembolso, si
  es `reembolso_directo`, sale de la caja de la tienda — ver
  `docs/devoluciones.md`).
- **Reembolso iniciado en Shopify** (`refunds/create` webhook) — necesita un
  handler nuevo que cree la nota de crédito correspondiente en petShop
  automáticamente (o al menos la deje pre-cargada para que un operador la
  confirme) y restituya stock si corresponde. Sin este handler, una
  devolución hecha por el cliente directamente en Shopify (sin pasar por la
  tienda física) dejaría el stock de petShop desincronizado indefinidamente
  — otro punto donde §23.5 AGENTS.md (anular venta no debe re-aplicar
  efectos ya aplicados) aplica: hay que diseñar la idempotencia de este
  handler con el mismo cuidado que ya tiene `anular_venta_tx`.

### 4.6 Ruta de webhook (decisión de alcance, ver §2.4)

Dos caminos, a decidir con Pablo, no bloqueante para el resto del diseño:

- **(a) Alcance mínimo**: agregar `else if (canalId === "shopify") { handler = new ShopifyChannel(); }`
  a la cadena existente en `webhook/[canal]/route.ts` — funciona, perpetúa
  el problema de escalar mal.
- **(b) Alcance ampliado (recomendado)**: generalizar la ruta a
  `handler = getChannel(canalId as CanalId)`, usando el `registry.ts` que ya
  resuelve dinámicamente — arregla PedidosYa/UberEats de paso (§2.4). Mismo
  esfuerzo de implementación, mayor alcance de la migración a revisar en
  tests/QA porque toca una ruta compartida por más canales.

### 4.7 Autenticación y credenciales

Reutiliza `canal_config` y `src/lib/canales/encryption.ts` sin cambios de
forma. Lo que sí cambia (§3.9): el flujo de **obtención** del token inicial
requiere OAuth vía el dashboard de partners de Shopify en vez de un token
estático generado desde el admin — un paso manual documentado en el runbook
de conexión, no automatizable desde dentro de petShop. Si el token puede
expirar/rotar (a confirmar — apps custom con OAuth suelen tener tokens de
larga duración, pero no está verificado), `canal_config.token_expires_at`
(columna que ya existe, usada hoy para Rappi/PedidosYa/UberEats) es
reutilizable tal cual.

### 4.8 Contabilidad — por qué no se puede copiar el patrón de comisión de Rappi

`CUENTAS_COMISION` (§2.1) modela "un % de comisión que la plataforma retiene
de cada venta" — el modelo real de un marketplace tipo Rappi. **El modelo de
costos de Shopify es distinto en su naturaleza**, no solo en el número:

1. **Suscripción mensual** — un costo fijo periódico, no ligado a ninguna
   venta individual. No debe generar un asiento por cada venta (`crearAsiento`
   vía `lineasVentaCanal`, como hace Rappi) — es un gasto operacional
   recurrente, más parecido conceptualmente a un arriendo que a una comisión
   de venta. Cuenta propuesta: `520201` (§4.1), reconocido mensualmente, no
   por transacción.
2. **Comisión de procesamiento de pago** (Shopify Payments u otro gateway) —
   esta sí es por transacción (típicamente un % + monto fijo), y esta sí
   encaja en el patrón existente de `crearAsiento`/`lineasVentaCanal` — pero
   es una cuenta de gasto de "procesamiento de pago", no de "comisión de
   plataforma" (semánticamente distinta para quien lea el Libro Diario
   después). Cuenta propuesta: `510105`.
3. **Sin comisión por venta en sí** (a diferencia de Rappi/PedidosYa/UberEats,
   que sí retienen un % por ser marketplace) — por lo que `CUENTAS_POR_COBRAR`
   para Shopify (`110405`, "Cuentas por cobrar Shopify Payments") representa
   el dinero que Shopify Payments liquida a la cuenta bancaria de la tienda
   (con su propio rezago de días, típico de cualquier procesador de pagos),
   no una cuenta por cobrar a un marketplace por productos ya entregados.

`canal_liquidaciones` (tabla existente) sigue siendo el lugar correcto para
registrar las liquidaciones periódicas de Shopify Payments — su forma
(`periodo_desde/hasta`, `monto_bruto`, `comision`, `monto_neto`,
`journal_entry_id`) ya encaja con "lote de transacciones liquidadas menos
fees de procesamiento", que es exactamente lo que Shopify Payments reporta.

## 5. Repercusiones en funcionalidades existentes

| Módulo | Repercusión |
|---|---|
| **POS / Carrito** | Ninguna — Shopify no toca el flujo de venta presencial. `calcularSubtotalCarrito`/etc. (§23.4 AGENTS.md) no cambian. |
| **Inventario / Lotes FIFO** | Alto impacto indirecto: los seis puntos de cambio de stock (§4.2) necesitan un hook de sincronización nuevo cada uno (o un trigger centralizado). `deducir_stock_fifo()` en sí no cambia — sigue siendo FIFO por lote, Shopify no sabe ni necesita saber de lotes, solo del `stock` agregado del producto. |
| **Notas de crédito / Devoluciones** | Necesita un caso nuevo no contemplado hoy: reembolso cuyo dinero no está en caja física (§4.5) — puede requerir un nuevo `tipo_reembolso` o un tratamiento especial cuando `venta.canal='shopify'`. |
| **Fidelización** | Sin cambios de lógica — una venta con `canal='shopify'` acumula fidelización igual que una de Rappi hoy (no hay exclusión por canal en el código de fidelización revisado). Confirmar que esto es lo deseado (¿un cliente anónimo de Shopify sin `cliente_id` puede acumular fidelización? — hoy `aceptarOrdenExterna()` pasa `p_cliente_id: null` siempre, igual que Rappi). |
| **Contabilidad** | Impacto medio-alto — nuevas cuentas (§4.8), nueva lógica de reconocimiento de gasto no ligado a venta (suscripción), ajuste al reporte de "Ventas por canal" (`VentasPorCanal.tsx`) para incluir Shopify. |
| **Reportes / Analytics** | `CANAL_LABELS`/`CANALES` (varios componentes: `ReportesTab.tsx`, `canales/page.tsx`) son constantes que listan los canales conocidos — necesitan la entrada de Shopify. Los reportes de recompras/predicción de demanda (`demand-forecasting.ts`) no distinguen canal hoy — confirmar si una venta de Shopify debe entrar al mismo pool de datos históricos o requiere segmentación aparte (compra impulsiva presencial ≠ compra planificada online, estadísticamente distintas). |
| **TanStack Query / Cache** | Bajo impacto directo — las queries de canales ya están parametrizadas por `storeId` (§15 AGENTS.md); agregar Shopify no introduce un nuevo patrón de cache, solo más datos bajo las keys existentes de `/canales`. |
| **Auditoría (`logAudit`)** | Sin cambios estructurales — `aceptarOrdenExterna()` ya audita cada venta creada (`hub.ts:484-494`), Shopify hereda esto gratis al pasar por la misma función. |
| **Tests** | Superficie grande: nueva suite de adaptador Shopify (auth/webhook/parseOrder — mismo patrón que `tests/integration/api/canales-accept.test.ts` para Rappi), tests del mapeo SKU/variant_id (§4.3.1), tests de idempotencia del webhook `refunds/create`, tests negativos de HMAC inválido, y — si se generaliza la ruta de webhook (§4.6 opción b) — regresión completa de los tests existentes de Rappi para confirmar que no se rompe nada al cambiar de `if/else` a `getChannel()`. |

## 6. Partes no cubiertas hasta ahora que esta nueva vía puede afectar

Esta sección responde directamente al pedido de Pablo de identificar huecos
existentes que la aparición de Shopify puede agravar, más allá del diseño
nuevo en sí:

1. **El webhook de intake hardcodeado a Rappi (§2.4)** es un bloqueante
   directo si se quiere seguir el patrón actual sin generalizar — hay que
   decidir §4.6 antes de escribir el adaptador de Shopify, no después.
2. **`stock_reservas` nunca conectado (§2.3)** — hoy es un riesgo latente de
   baja probabilidad para Rappi (ventana corta, operador humano de por
   medio). Con Shopify auto-aceptando (§1.1), la misma falta de reserva dejó
   de ser "baja probabilidad" y pasa a ser el mecanismo central de defensa
   contra sobreventa (junto con la validación dentro de `crear_venta_tx`) —
   este estudio no puede dimensionar el riesgo real sin saber el volumen
   esperado de ventas concurrentes online, pero el diseño de §4.2/§4.4 debe
   tratarlo como prioritario, no como mejora futura.
3. **Push de catálogo 100% manual (§2.5)** — deja de ser aceptable el día que
   Shopify esté conectado; hoy es una decisión operativa razonable para
   Rappi/PedidosYa/UberEats, con Shopify es una brecha que genera sobreventa
   activa si no se resuelve antes del lanzamiento, no después.
4. **Migraciones `012` duplicadas (§2.6)** — verificar contra el schema real
   antes de que la migración de Shopify agregue columnas a
   `canal_producto_config`, para no depender de una versión de la tabla que
   no sea la que realmente está en producción.
5. **`docs/revision_claude_shopify.md` referenciado pero inexistente (§2.6)**
   — vale la pena preguntarle a quien lo haya escrito (si se puede
   identificar por `git blame` de los commits que tocaron `spec-registry.md`
   línea 320) si tiene una copia fuera del repo, antes de asumir que este
   estudio es el primero en evaluar esto.
6. **Ausencia total de manejo de "venta ya pagada pero sin stock" (§4.4.2)**
   — ningún canal actual necesita este caso (todos rechazan antes de cobrar).
   Es una capacidad completamente nueva para el sistema, no una extensión de
   algo existente.

## 7. Riesgos

1. **Sobreventa con dinero ya cobrado** (§4.4, §6.2) — el riesgo más serio y
   más distinto a todo lo que el sistema maneja hoy. Requiere decisión de
   producto explícita sobre el flujo de reembolso automático antes de
   lanzar, no se puede improvisar en producción.
2. **Loop de sincronización** (§4.2, el eco de `inventory_levels/update`) si
   se implementa sync bidireccional sin protección contra el propio eco.
3. **Rate limiting de Shopify** (§3.6) si el volumen de cambios de stock por
   segundo supera lo sostenible por el bucket de puntos — mitigable con
   batching/debounce, pero hay que diseñarlo desde el principio, no
   parchearlo después de un incidente.
4. **Mapeo SKU/variant_id frágil** (§4.3.1) — un SKU vacío o duplicado en
   Shopify puede crear un mapeo incorrecto silencioso si no se valida contra
   `external_variant_id` como llave primaria real.
5. **Credenciales OAuth con flujo distinto** (§3.9, §4.7) — riesgo bajo en
   impacto pero alto en fricción operativa si no se documenta bien el
   runbook de conexión inicial (un paso manual mal hecho bloquea todo lo
   demás).
6. **Deuda técnica heredada** (§6: webhook hardcodeado, reservas no
   conectadas, sync manual) — construir Shopify sobre esta base sin resolver
   al menos la reserva de stock (§6.2) sería construir la funcionalidad más
   sensible a sobreventa del proyecto sobre su mecanismo de prevención de
   sobreventa menos maduro.

## 8. Preguntas abiertas — no las resolví por ti porque son decisiones de negocio/producto

### 8.1 Origen del stock (dejada explícitamente abierta en §1.2)

- **Opción A — una tienda designada**: se elige una `stores` row como "la
  tienda online", su `productos.stock` es el que se sincroniza a la única
  Location de Shopify. Funciona hoy, sin depender de ninguna feature nueva.
  Limitación: si esa tienda se queda sin stock de un producto que otra
  sucursal sí tiene, Shopify lo muestra agotado igual.
- **Opción B — depende de multi-sucursal (`storeBranch.md`)**: cada sucursal
  física mapea a una Location de Shopify (encaje natural, §3.4), permitiendo
  fulfillment desde la sucursal con stock disponible más cercana al cliente,
  o consolidar visibilidad de stock entre sucursales. Más completo, pero
  bloqueado hasta que esa feature (aún sin implementar, ver `storeBranch.md`)
  exista.
- **Recomendación no vinculante para cuando se decida**: empezar por la
  Opción A no cierra la puerta a la B — el modelo de Locations de Shopify ya
  soporta agregar más Locations después sin rediseñar la integración desde
  cero, solo agrega complejidad operativa (routing de fulfillment) el día
  que haya más de una tienda conectada.

### 8.2 ¿Todo pedido de Shopify se despacha desde la tienda física, o hay logística de envío distinta?

Determina si además de este estudio (catálogo/stock/órdenes/contabilidad) se
necesita una integración de shipping (tarifas de envío, tracking, printing
de etiquetas) — fuera del alcance de este documento tal como está.

### 8.3 ¿Se permite editar stock directamente desde el admin de Shopify, o queda de solo lectura ahí? (§4.2.1)

Determina si el sync inverso de inventario (más allá de órdenes/reembolsos)
es necesario desde el día uno o puede diferirse.

### 8.4 ¿Los precios se sincronizan también, o solo la disponibilidad/stock?

`canal_producto_config.precio` ya existe y ya se usa para Rappi/PedidosYa/
UberEats (precio distinto por canal) — technically trivial de extender a
Shopify, pero vale confirmarlo como decisión de producto: ¿el precio online
puede ser distinto al de la tienda física (como ya pasa con los otros
canales, que descuentan comisión) o debe ser siempre igual?

### 8.5 ¿Qué pasa con productos a granel o con fecha de vencimiento próxima?

El catálogo curado (§1.3) ya resuelve "qué productos sí/no se venden online"
a nivel general, pero productos a granel (venta por peso, ver
`pos-granel.test.ts`) y productos con oferta por vencimiento próximo
(`en_oferta`/`precio_oferta`, §Optimizador de Vencimientos) probablemente
necesiten una regla explícita de inclusión/exclusión, no dejarlo a criterio
caso a caso del operador.

## 9. Estimación de tamaño

| Capa | Tamaño del cambio |
|---|---|
| Modelo de datos (Supabase) | Pequeño — 1 fila en `canales_externos`, 2 columnas nuevas en `canal_producto_config`, 3 cuentas contables nuevas, ampliar 1 CHECK constraint. Reutiliza el 95% del esquema existente de canales. |
| Adaptador Shopify (`src/lib/canales/shopify/`) | Mediano-grande — auth OAuth (distinto a los demás canales), `validateWebhook` (HMAC propio), `parseOrder`/`parseWebhookEvent` (payload de Shopify, distinto shape), `syncCatalog`/`setAvailability` sobre GraphQL (mutaciones nuevas, no reutilizables de REST). |
| Webhook de intake | Pequeño si se sigue el patrón actual (§4.6a); mediano si se generaliza (§4.6b, toca código compartido con Rappi). |
| Push saliente de stock (§4.2) | **Grande** — es la pieza que no existe hoy en ninguna forma. Requiere instrumentar 6 puntos de cambio de stock (o 1 trigger de Postgres), diseño de cola/reintentos, protección contra loop de sync, reconciliación periódica. |
| Flujo de aceptación automática | Pequeño — `aceptarOrdenExterna()` ya soporta esto, solo cambia el disparador. |
| Manejo de sobreventa post-pago (§4.4/§6.2) | **Grande, funcionalidad nueva** — no existe hoy ningún flujo de "venta ya cobrada que hay que revertir automáticamente con reembolso al canal". |
| Devoluciones/reembolsos bidireccionales (§4.5) | Mediano-grande — handler de `refunds/create`, y extensión del modelo de notas de crédito para reembolsos que no salen de caja física. |
| Contabilidad (§4.8) | Mediano — cuentas nuevas + lógica de reconocimiento de gasto no ligado a venta (suscripción) es un patrón que no existe hoy en `generador-asientos.ts`. |
| Frontend (`/canales`) | Pequeño-mediano — página de configuración Shopify (similar a `canales/[canal]/page.tsx` existente), pero las órdenes de Shopify no necesitan una UI de "aceptar/rechazar" como Rappi (§1.1, auto-aceptado) — si acaso, una vista de solo lectura de lo ya procesado. |
| Tests | Grande — ver §5, tabla de repercusiones, fila Tests. |

**En una frase**: la mayor parte de la infraestructura de "canal externo"
(modelo de datos, pipeline de venta transaccional, contabilidad, auditoría)
ya existe y ya anticipa Shopify explícitamente en sus comentarios — el
esfuerzo real está concentrado en dos piezas que hoy no existen en ninguna
forma: el push de stock saliente en tiempo casi real (§4.2) y el manejo de
sobreventa sobre una venta ya cobrada (§4.4/§6.2), porque son las dos
consecuencias directas de que Shopify sea un storefront de autoservicio y no
un marketplace con aceptación manual como los tres canales ya conectados.

## 10. Plan de fases propuesto

### Fase 0 — Verificación previa

- Crear tienda Shopify de desarrollo (developer store) y verificar contra
  ella cada afirmación marcada **[verificar contra Shopify real]** en este
  documento — especialmente el comportamiento exacto de reserva en checkout
  (§3.2) y el flujo de auth de apps custom (§3.9).
- Confirmar contra Supabase real cuál de las dos migraciones `012` (§2.6)
  refleja el schema vivo.
- Intentar recuperar `docs/revision_claude_shopify.md` (§2.6/§6.5) por
  `git blame`/fuera del repo antes de asumir que no existe ningún estudio
  previo relacionado.
- Resolver con Pablo las preguntas abiertas de §8 (mínimo 8.1 y 8.3, que
  bloquean decisiones de diseño de datos).
- Registrar IDs de test nuevos propuestos (ej. `SHF-XX`) en
  `docs/spec-registry.md`, verificando primero que no colisionen (§2.3
  AGENTS.md).

### Fase 1 — Modelo de datos y adaptador base (sin tráfico real)

- Migración 074 (§4.1).
- `src/lib/canales/shopify/{types,auth,adapter}.ts` — implementar
  `IExternalChannel` completo, empezando por lo que no requiere webhook
  (`getToken`, `syncCatalog`, `setAvailability` contra GraphQL).
- Registrar en `registry.ts`, `VENTANA_ACEPTACION`, `CUENTAS_POR_COBRAR`,
  `CUENTAS_COMISION`.

### Fase 2 — Push saliente de stock (la pieza que no existe hoy)

- Instrumentar los 6 puntos de cambio de stock (§4.2) — decidir trigger de
  Postgres vs. hooks explícitos.
- Job de reconciliación periódica (cron).
- Protección contra loop de sync (§4.2, eco de `inventory_levels/update`).
- Tests de todos los escenarios de §20 AGENTS.md aplicados a este flujo
  nuevo (duplicados, fuera de orden, reintentos, rollback).

### Fase 3 — Intake de órdenes y auto-aceptación

- Webhook de intake (§4.3, decidir alcance §4.6).
- Resolución robusta SKU/variant_id (§4.3.1).
- Auto-invocación de `aceptarOrdenExterna()` sin operador de por medio.
- Tests: primera entrega, duplicada, payload inválido, HMAC inválido, dos
  entregas concurrentes (mismo patrón que exige AGENTS.md §13.2 para el
  webhook de canales existente).

### Fase 4 — Manejo de sobreventa y devoluciones

- Diseñar y construir el flujo de reembolso automático cuando
  `crear_venta_tx` rechaza una orden ya pagada (§4.4, §6.2) — requiere
  decisión de producto de Pablo sobre el mensaje/proceso hacia el cliente,
  no solo el mecanismo técnico.
- Handler de `refunds/create` (§4.5).
- Extender el modelo de notas de crédito para reembolsos que no salen de
  caja física.

### Fase 5 — Contabilidad y reportes

- Cuentas nuevas (§4.8), lógica de reconocimiento de gasto de suscripción.
- `VentasPorCanal.tsx`, `CANAL_LABELS`, reportes de recompras/predicción de
  demanda — decidir si Shopify entra al mismo pool de datos o se segmenta.

### Fase 6 — Piloto y lanzamiento

- Con "Continue selling when out of stock" **apagado** (§3.3, §4.4.3)
  verificado explícitamente en cada producto sincronizado.
- Piloto con subconjunto reducido de catálogo antes de habilitar todo el
  catálogo curado.
- Runbook de conexión documentado (OAuth, developer store → producción,
  configuración de Locations).

---

## Fuentes consultadas (búsquedas web, 2026-09-22)

- [Shopify Inventory API Explained for Brands [2026]](https://www.prediko.io/blog/shopify-inventory-api)
- [About webhooks — shopify.dev](https://shopify.dev/docs/apps/build/webhooks)
- [Shopify Real-Time Inventory: Architecture, APIs & Best Practices](https://www.addwebsolution.com/blog/shopify-real-time-inventory)
- [Shopify Inventory Sync Best Practices 2026](https://nventory.io/blog/shopify-inventory-sync-best-practices-2026)
- [Complete Shopify API Guide [2026]](https://smart-webtech.com/guide/complete-shopify-api-guide-from-setup-to-integrations/)
- [Shopify Admin API Guide 2026: GraphQL, Auth & Limits](https://www.adsx.com/blog/shopify-admin-api-guide)
- [Shopify Webhooks Guide: Events, HMAC & Examples](https://mgroupweb.com/blogs/shopify-webhooks-developer-guide/)
- [Guide to Shopify Webhooks Features and Best Practices — Hookdeck](https://hookdeck.com/webhooks/platforms/shopify-webhooks-features-and-best-practices-guide)
- [Order webhooks — shopify.dev](https://shopify.dev/docs/agents/orders/order-webhooks)
- [Shopify Webhook Integration Guide — GetHook](https://gethook.to/blog/shopify-webhook-integration-guide)
- [Shopify Help Center — Selling out of stock products](https://help.shopify.com/en/manual/products/inventory/setup/selling-when-out-of-stock)
- [How Shopify Moved Inventory Reservations from Redis to MySQL](https://www.hellointerview.com/learn/system-design/in-the-wild/shopify-inventory-reservations)
- [Prevent Overselling on Shopify During Sales and Launches](https://www.useretrace.com/resources/shopify-inventory/prevent-overselling-on-shopify)
- [Shopify Multi Location Inventory: Complete Setup Guide (2026)](https://mgroupweb.com/blogs/shopify-multi-location-inventory/)
- [Shopify Help Center — Understanding inventory management for multiple locations and apps](https://help.shopify.com/en/manual/products/inventory/setup/multi-managed-inventory)
- [How to Implement Webhook Idempotency — Hookdeck](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency)
- [How to Handle Duplicate Shopify Webhook Events — Hookdeck](https://hookdeck.com/webhooks/platforms/how-to-handle-duplicate-shopify-webhook-events)
- [Ignore duplicate webhooks — shopify.dev](https://shopify.dev/docs/apps/build/webhooks/ignore-duplicates)
- [Access tokens for custom apps in the Shopify admin — shopify.dev](https://shopify.dev/docs/apps/auth/admin-app-access-tokens)
- [Generate access tokens for admin-created custom apps — shopify.dev](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin)
