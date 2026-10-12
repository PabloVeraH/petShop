# Ideas desde repositorios open source con más de 1.000 estrellas

Fecha: 2026-10-11. Estrellas tomadas de la API pública de GitHub ese día.

## Cómo se hizo

1. Búsqueda en GitHub (`stars:>1000`) por: *point of sale*, *pos system*,
   *inventory management*, *erp*, *appointment scheduling*, *accounting
   software*, *headless commerce*, *veterinary*.
2. Para cada repositorio elegido se leyó su README (y, cuando el README no
   bastaba, su documentación oficial) para **confirmar** que la
   funcionalidad citada existe. No se citan funcionalidades sin esa
   confirmación.
3. Se revisó el código de petShop (`src/`, `migrations/000_baseline.sql`,
   `docs/pendientes.md`, `docs/roadmap-implementacion.html`) para no
   proponer algo que ya existe y para describir el punto de partida real.

Prioridad: **Alta** = impacto directo en la operación diaria de la tienda;
**Media** = mejora ventas o fidelización; **Baja** = conveniencia o casos
puntuales. Esfuerzo: **S** (días), **M** (1–2 semanas), **L** (más).

## Resumen

| # | Idea | Prioridad | Esfuerzo | Repositorio principal |
|---|------|-----------|----------|-----------------------|
| 1 | Apertura y cierre de caja con arqueo | Alta | M | opensourcepos/opensourcepos |
| 2 | Ventas en espera (aparcar un carrito) | Alta | S | tngoman/Store-POS |
| 3 | Reposición: borrador de orden de compra automático | Alta | S–M | frappe/erpnext |
| 4 | Fidelización por puntos canjeables con vencimiento | Media | M | frappe/erpnext |
| 5 | Cupones y reglas de promoción | Media | M–L | vendurehq/vendure |
| 6 | Reserva online de citas y recordatorios | Media | M | alextselegidis/easyappointments |
| 7 | Alta de productos por código de barras (Open Pet Food Facts) | Media | S | grocy/grocy |
| 8 | Impresión de etiquetas con código de barras y precio | Media | S–M | opensourcepos/opensourcepos |
| 9 | Gift cards | Baja | M | opensourcepos/opensourcepos |
| 10 | Kits y combos de productos | Baja | M | opensourcepos/opensourcepos |
| 11 | Impresión directa en impresora térmica | Baja | M | Blair2004/NexoPOS |
| 12 | POS con varias cajas y tolerancia a cortes de red | Baja | L | tngoman/Store-POS |

---

## 1. Apertura y cierre de caja con arqueo

**Descripción.** Cada turno abre una "sesión de caja" con un monto inicial
en efectivo. Al cerrar, el cajero cuenta el efectivo real y el sistema lo
compara con lo esperado (inicial + ventas en efectivo − devoluciones en
efectivo − retiros). La diferencia queda registrada y firmada por el usuario.

**Repositorios.**
- [opensourcepos/opensourcepos](https://github.com/opensourcepos/opensourcepos) — 4.432 ★. README: *"Cash up function"*, *"Sale register with transactions logging"*.
- [Blair2004/NexoPOS](https://github.com/Blair2004/NexoPOS) — 1.273 ★. README: *"POS sales, orders, payments, receipts, refunds, and registers"*.

**Qué mejoraría en petShop.** Hoy no existe ningún concepto de caja o turno
(no hay tablas ni rutas de arqueo). Las ventas y los pagos (`ventas`,
`pagos` con `metodo`) ya tienen lo necesario para calcular el efectivo
esperado. Agregar una tabla `sesiones_caja` (por `store_id`, con
usuario, apertura, cierre, contado y diferencia), un paso en el POS para
abrir y cerrar, y un asiento contable de la diferencia (sobrante o faltante)
con `crearAsiento()`. Da control diario del efectivo, detecta errores o
pérdidas por turno y vendedor, y conecta con el módulo de vendedores.

## 2. Ventas en espera (aparcar un carrito)

**Descripción.** Dejar una venta "en espera" (por ejemplo, el cliente fue a
buscar otro producto o falta confirmar un precio) y atender al siguiente
cliente; luego recuperar el carrito y cobrarlo.

**Repositorio.**
- [tngoman/Store-POS](https://github.com/tngoman/Store-POS) — 1.044 ★. README: historial de transacciones filtrable por estado *"(paid / held)"*.

**Qué mejoraría en petShop.** El carrito del POS vive en un store Zustand
persistido (`src/stores/pos.ts`) y hay **un solo** carrito activo. Permitir
varios carritos guardados con nombre (en el mismo store, o en BD si se
quieren compartir entre cajas) evita perder ventas en horas de alta demanda.
Ojo con la invariante §23.4 de AGENTS.md: los totales deben seguir
calculándose desde los `items` del carrito activo en cada render. No reserva
stock: el stock se valida al cobrar, como hoy.

## 3. Reposición: borrador de orden de compra automático

**Descripción.** Cuando el stock de un producto baja de su nivel de
reposición, el sistema crea solo una solicitud de compra al proveedor
habitual, que el administrador revisa y confirma.

**Repositorio.**
- [frappe/erpnext](https://github.com/frappe/erpnext) — 40.020 ★. Documentación: [Auto creation of Material Request](https://docs.frappe.io/erpnext/user/manual/en/auto-creation-of-material-request) (solicitudes automáticas según nivel de reposición).

**Qué mejoraría en petShop.** Ya existen las piezas: `stock_minimo` en
productos, `proveedor_productos` y el "motor de recompra"
(`/api/recompras`, que cruza `consumo_alertas` con proveedores y sugiere
cuándo ordenar). Lo que falta es el último paso: generar un **borrador** de
`ordenes_compra` por proveedor con las cantidades sugeridas, en vez de solo
mostrarlas. Ahorra tiempo al administrador y evita quiebres de stock en
alimento, que es el producto de recompra más frecuente.

## 4. Fidelización por puntos canjeables con vencimiento

**Descripción.** Cada compra suma puntos (por ejemplo, 1 punto por cada
$1.000). Los puntos se canjean como medio de pago, pueden vencer, y los
niveles (bronce, plata, oro) cambian la tasa de acumulación.

**Repositorios.**
- [frappe/erpnext](https://github.com/frappe/erpnext) — 40.020 ★. Documentación: [Loyalty Programs](https://docs.frappe.io/erpnext/user/manual/en/loyalty-program).
- [opensourcepos/opensourcepos](https://github.com/opensourcepos/opensourcepos) — 4.432 ★. README: *"Rewards"*.
- [Blair2004/NexoPOS](https://github.com/Blair2004/NexoPOS) — 1.273 ★. README: *"Customer groups, rewards, coupons"*.

**Qué mejoraría en petShop.** Hoy la fidelización es por niveles de monto
acumulado (`fidelizacion.total_historico` + `stores.fidelizacion_niveles`)
que dan un **descuento porcentual**. No hay puntos ni canje. Un saldo de
puntos permitiría premiar sin rebajar el precio de cada venta y medir cuánto
pasivo de fidelización hay. Se puede reutilizar el patrón de
`saldos_a_favor`: mutaciones atómicas por RPC (§23.6), registro como método
de pago y reversión al anular (§23.5). Requiere decidir si convive con los
niveles actuales o los reemplaza.

## 5. Cupones y reglas de promoción

**Descripción.** Promociones configurables por condiciones y acciones:
"2x1 en arena", "10% en la categoría snacks", "$3.000 de descuento sobre
$30.000", cupones de un solo uso o con fecha de vencimiento.

**Repositorios.**
- [vendurehq/vendure](https://github.com/vendurehq/vendure) — 8.509 ★. README: *"Catalog, orders, customers, promotions, channels, tax…"*.
- [medusajs/medusa](https://github.com/medusajs/medusa) — 36.700 ★. Documentación: [Promotion Module](https://docs.medusajs.com/resources/commerce-modules/promotion).
- [frappe/erpnext](https://github.com/frappe/erpnext) — 40.020 ★. Documentación: [Pricing Rule](https://docs.frappe.io/erpnext/user/manual/en/pricing-rule).
- [Blair2004/NexoPOS](https://github.com/Blair2004/NexoPOS) — 1.273 ★. README: *"coupons"*.

**Qué mejoraría en petShop.** Hoy solo existe el descuento porcentual
manual en el POS y el de fidelización; no hay cupones ni promociones
(ninguna tabla ni ruta). Un motor simple de reglas (condición sobre
producto, categoría o monto; acción de porcentaje, monto fijo o "lleva X
paga Y") aumenta ticket promedio y rotación de productos próximos a vencer
(se combina con el optimizador de vencimientos con IA que ya existe). Cuidado
con el IVA: el descuento se aplica sobre precios brutos y el IVA se sigue
extrayendo con `src/lib/tax.ts` (§23.3).

## 6. Reserva online de citas y recordatorios

**Descripción.** Una página pública donde el cliente elige servicio
(baño, corte de uñas, peluquería), encargado y horario libre, según los
horarios de trabajo configurados. El sistema envía confirmación y
recordatorio por correo y puede sincronizar con Google Calendar.

**Repositorio.**
- [alextselegidis/easyappointments](https://github.com/alextselegidis/easyappointments) — 4.428 ★. README: *"Appointment and customer management"*, *"Service and provider organization"*, *"Working plans and booking rules"*, *"Google Calendar synchronization"*, *"Email notification system"*.

**Qué mejoraría en petShop.** Ya existen servicios, horarios semanales,
encargados y citas (`crear_cita_tx`, `cancelar_cita_tx`), pero las citas
solo las crea el personal y **no hay recordatorios** (los correos actuales
son las alertas de consumo de `email-alerts`). Una página pública por tienda
reutilizando `crear_cita_tx` (que ya valida disponibilidad) reduce llamadas
y WhatsApp manuales; un recordatorio el día anterior (por correo con Resend,
o WhatsApp que ya está integrado) reduce inasistencias. La página pública
necesita protección contra abuso (rate limit ya existe, más un captcha) y
no debe exponer datos de otros clientes.

## 7. Alta de productos por código de barras con Open Pet Food Facts

**Descripción.** Al escanear un código desconocido, se consulta una base de
datos pública y se precargan nombre, marca, foto e ingredientes.

**Repositorio.**
- [grocy/grocy](https://github.com/grocy/grocy) — 9.581 ★. README: *"Barcode lookup via external services"*, con un plugin de Open Food Facts incluido por defecto.

**Qué mejoraría en petShop.** El POS ya escanea códigos (con cámara o
lector USB, `BarcodeScanner`) y los productos tienen `codigo_barra`, pero un
producto nuevo se carga a mano. El proyecto hermano **Open Pet Food Facts**
tiene una API pública específica de alimento para mascotas (verificada:
`world.openpetfoodfacts.org/api/v2/search` respondió con ~15.500 productos).
Precargar el formulario de Inventario desde ahí acelera la carga del
catálogo al instalar una tienda nueva. La consulta debe hacerse desde el
servidor y el CSP tendría que permitir las imágenes si se usan sus URLs
(mejor descargarlas y subirlas a R2).

## 8. Impresión de etiquetas con código de barras y precio

**Descripción.** Generar e imprimir etiquetas (adhesivos de góndola o de
producto) con nombre, precio y código de barras, usando plantillas.

**Repositorios.**
- [opensourcepos/opensourcepos](https://github.com/opensourcepos/opensourcepos) — 4.432 ★. README: *"Barcode generation and printing"*.
- [inventree/InvenTree](https://github.com/inventree/InvenTree) — 7.698 ★. Documentación: [Label Templates](https://docs.inventree.org/en/latest/report/labels/).

**Qué mejoraría en petShop.** Hoy no hay impresión de etiquetas. Es útil
para productos sin código de fábrica (granel, sacos fraccionados, productos
artesanales) y para cambios de precio masivos. Puede hacerse con una página
de impresión en HTML/CSS (como el recibo actual) y una librería de
código de barras en el navegador, sin hardware especial.

## 9. Gift cards

**Descripción.** Vender tarjetas de regalo con un monto, identificadas por
un código, que luego se usan como medio de pago (total o parcial).

**Repositorio.**
- [opensourcepos/opensourcepos](https://github.com/opensourcepos/opensourcepos) — 4.432 ★. README: *"Gift cards"*.

**Qué mejoraría en petShop.** No existen hoy. Técnicamente se parecen a
`saldos_a_favor` (un saldo que se gasta como pago), pero no están ligadas a
un cliente sino a un código. Se puede copiar el patrón atómico de
`gastar_saldo_a_favor_pago` (§23.6) para evitar doble gasto. Contablemente
la venta de una gift card es un pasivo, no un ingreso, hasta que se usa:
habría que agregar la cuenta y los asientos correspondientes.

## 10. Kits y combos de productos

**Descripción.** Un producto "kit" compuesto por otros (por ejemplo, "kit
cachorro": alimento + plato + juguete) que se vende con un precio propio y
descuenta el stock de cada componente.

**Repositorio.**
- [opensourcepos/opensourcepos](https://github.com/opensourcepos/opensourcepos) — 4.432 ★. README: *"Stock management (items and kits with an extensible list of attributes)"*.

**Qué mejoraría en petShop.** No existe hoy. Sirve para promociones de
temporada y para canales externos (Rappi y otros) donde un combo es un solo
producto. El punto delicado es el stock: el descuento debe ocurrir dentro de
`crear_venta_tx` (FIFO por lotes, granel) y la devolución dentro de
`crear_nota_credito_tx`, para conservar la atomicidad actual.

## 11. Impresión directa en impresora térmica

**Descripción.** Imprimir el recibo directamente en una impresora térmica
(protocolo ESC/POS) sin el diálogo de impresión del navegador.

**Repositorio.**
- [Blair2004/NexoPOS](https://github.com/Blair2004/NexoPOS) — 1.273 ★. README: *"Nexo Print Server — direct Windows printing for ESC/POS-compatible thermal printers"*. Nota: es un módulo que se distribuye aparte del repositorio principal.

**Qué mejoraría en petShop.** Hoy el recibo se genera en HTML
(`/api/recibos/[ventaId]`) y se imprime con el navegador
(`?autoPrint=1`). Funciona, pero depende de configurar márgenes y el diálogo
de impresión en cada equipo. Una impresión directa es más rápida en caja,
pero requiere un pequeño programa local en el PC de la caja. Conviene solo
si las tiendas lo piden.

## 12. POS con varias cajas y tolerancia a cortes de red

**Descripción.** Un servidor local en la tienda al que se conectan varias
cajas por red local, de modo que el POS siga funcionando aunque se caiga
internet.

**Repositorio.**
- [tngoman/Store-POS](https://github.com/tngoman/Store-POS) — 1.044 ★. README: modos *"Standalone / Network Server / Network Terminal"* para varias cajas en LAN.

**Qué mejoraría en petShop.** petShop es 100% en la nube (Vercel +
Supabase): sin internet no se vende. El roadmap ya menciona un "modo
offline" (`docs/roadmap-implementacion.html`). Es la idea de mayor esfuerzo
y riesgo (sincronización de stock, folios, conflictos), así que solo vale la
pena si los cortes de red son un problema real en las tiendas.

---

## Repositorios revisados y descartados

| Repositorio | ★ | Por qué no se usó |
|---|---|---|
| [odoo/odoo](https://github.com/odoo/odoo) | 54.974 | Muy relevante (POS, inventario), pero el README no detalla funcionalidades; las mismas ideas quedaron respaldadas por ERPNext y OSPOS. |
| [twentyhq/twenty](https://github.com/twentyhq/twenty) | 58.219 | CRM genérico; petShop ya cubre clientes y mascotas de forma más específica. |
| [calcom/cal.diy](https://github.com/calcom/cal.diy) (antes cal.com) | 48.957 | Su README indica que los *workflows* (recordatorios) fueron removidos de esta versión; para citas se usó Easy!Appointments. |
| [akaunting/akaunting](https://github.com/akaunting/akaunting), [bigcapitalhq/bigcapital](https://github.com/bigcapitalhq/bigcapital) | 10.176 / 3.931 | Contabilidad; el README no confirma funcionalidades concretas que petShop no tenga. |
| [invoiceninja/invoiceninja](https://github.com/invoiceninja/invoiceninja) | 10.264 | Facturación y portal de clientes; poco aplicable a un POS de mostrador. |
| [GreaterWMS/GreaterWMS](https://github.com/GreaterWMS/GreaterWMS), [fjykTec/ModernWMS](https://github.com/fjykTec/ModernWMS) | 4.407 / 1.786 | Gestión de bodegas grandes; excede lo que necesita una tienda. |

**Sin fuente con más de 1.000 estrellas.** No se encontró ningún
repositorio veterinario o de tiendas de mascotas con más de 1.000 estrellas.
Por eso no se incluyó una idea como una **ficha de salud de la mascota**
(vacunas, desparasitaciones, cumpleaños, con recordatorios), aunque encaja
muy bien con las mascotas y el consumo que petShop ya registra. Si interesa,
se puede investigar con repositorios más chicos.
