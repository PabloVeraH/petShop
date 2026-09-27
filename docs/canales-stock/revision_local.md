# Revisión local de feat/stockCanales (Fases 1–6)

> Escrito el 2026-09-26. Rama `feat/stockCanales` @ `2616c72`.
> Complementa `stock_canales_externos.md` (plan) y `rappi_salida_produccion.md` (runbook).

## 1. Arrancar el proyecto en local (Windows)

### 1.1 Dependencias

```powershell
cd C:\Users\HP\Documents\Proyectos\petShop
git checkout feat/stockCanales
npm install          # package-lock cambió (oxlint)
```

### 1.2 `.env.local` (no existe en esta máquina)

```dotenv
# Clerk — instancia de DESARROLLO (pk_test / sk_test)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Supabase demo (el único entorno: todo lo que hagas en local escribe AQUÍ)
NEXT_PUBLIC_SUPABASE_URL=https://wnxrdbnvreofrrmhcybc.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Tiene que ser LA MISMA de Vercel (64 hex). Con otra clave, las credenciales
# que guardes en local no se descifran en producción y viceversa.
ENCRYPTION_KEY=...

CRON_SECRET=<cualquier valor local>
ENABLED_CHANNELS=rappi
NEXT_PUBLIC_APP_URL=http://localhost:3000

# En local todas las requests comparten un solo contador del rate limit
# (sin x-forwarded-for); con el default de 100/15 min la app responde 429.
RATE_LIMIT_API_MAX=5000

# NO definir en local:
#  HUB_URL / HUB_SYNC_SECRET  → sin ellas no se sincronizan ventas de prueba al Hub
#  RAPPI_API_BASE / RAPPI_AUTH_BASE → fuera de producción usan el default dev de Rappi
#  RESEND_*, SLACK_WEBHOOK_URL, PAGERDUTY_API_KEY, WHATSAPP_APP_SECRET, OPENROUTER_*
```

### 1.3 Instancia dev de Clerk

1. **Session token** (Dashboard → Sessions → Customize session token) debe
   exponer la metadata, porque el código lee `sessionClaims.publicMetadata`:
   `{ "publicMetadata": "{{user.public_metadata}}" }`.
2. Dos usuarios de prueba de **una tienda de la BD demo con licencia vigente**:
   - admin: `{"storeId": "<uuid tienda>", "storeAdmin": true}`
   - worker: `{"storeId": "<uuid tienda>"}`
3. **Los dos deben existir en `clerk_users`** (`clerk_id` = user id de la
   instancia dev). `ventas.worker_clerk_id` tiene FK a `clerk_users`: sin esa
   fila **toda venta POS falla**. El webhook de Clerk no llega a localhost, así
   que hay tres opciones: que ya existan (verificar con un SELECT), exponer
   `/api/webhooks/clerk` con un túnel (cloudflared/ngrok), o crear las filas
   con INSERT (con tu confirmación).

### 1.4 Levantar

```powershell
npm run dev
```

(El script usa `cross-env` desde 2026-09-27, así que funciona igual en
Windows y en Linux.)

Smoke test: abrir http://localhost:3000, entrar como admin → `/pos`,
`/inventory` y `/canales` cargan sin errores de consola.

### 1.5 Datos de prueba (vía UI, como admin)

Crear productos con prefijo `QA-` (fáciles de encontrar y desactivar):

| Producto | Configuración |
|----------|---------------|
| `QA-UNIDAD` | SKU `QA-UNIDAD`, sin lotes, stock 5, `stock_minimo` 2, precio 5.000 |
| `QA-LOTE` | SKU `QA-LOTE`, stock suelto 10 (sin lotes), vencimientos activados, precio 3.000 |
| `QA-GRANEL` | SKU `QA-GRANEL`, `peso_gramos` 15000, `precio_venta_kg` 4.000, stock 3, precio 50.000 |

### 1.6 Habilitar Rappi temporalmente (escritura en BD — autorizada para esta revisión)

En el SQL Editor de Supabase:

```sql
update canales_externos set habilitado = true where id = 'rappi';
```

Luego en `/canales/rappi` (admin): Client ID `qa-client`, Client Secret
`qa-secret`, ID de tienda en Rappi `900000001`, Webhook Secret `qa-webhook-secret`;
activar el canal. Las credenciales actuales de Rappi en la BD usan los campos
viejos (V23) y ya no validan, así que reemplazarlas no pierde nada.

### 1.7 Comandos de terminal que pedirá la revisión (PowerShell)

```powershell
$env:RAPPI_WEBHOOK_SECRET='qa-webhook-secret'
$base = '--url','http://localhost:3000','--store-id','<uuid tienda>'
node scripts/canales/simular-rappi.mjs @base --evento PING
node scripts/canales/simular-rappi.mjs @base --evento NEW_ORDER --rappi-store 900000001 --item QA-UNIDAD:1:5500
node scripts/canales/simular-rappi.mjs @base --evento NEW_ORDER --rappi-store 900000001 --orden 1111111111 --item QA-UNIDAD:1:5500   # repetir = duplicado
node scripts/canales/simular-rappi.mjs @base --evento NEW_ORDER --rappi-store 900000001 --item NO-EXISTE:1:1000
node scripts/canales/simular-rappi.mjs @base --evento NEW_ORDER --rappi-store 900000001 --item QA-UNIDAD:99:5500
node scripts/canales/simular-rappi.mjs @base --evento ORDER_EVENT_CANCEL --rappi-store 900000001 --orden <order_id>
node scripts/canales/simular-rappi.mjs @base --evento MENU_REJECTED --motivo "Prueba QA"
# firma inválida:
$env:RAPPI_WEBHOOK_SECRET='otro'; node scripts/canales/simular-rappi.mjs @base --evento PING
# procesar outbox / reconciliar a mano (sin pg_cron en local):
curl.exe -X POST -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/canales-outbox
curl.exe -X POST -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/canales-reconciliar
```

### 1.8 Limpieza al terminar

1. Anular las ventas de prueba (la lista que entregue la revisión).
2. Desactivar los productos `QA-*` (no borrarlos: tienen movimientos).
3. Desactivar Rappi en `/canales/rappi` y
   `update canales_externos set habilitado = false where id = 'rappi';`
4. Los trabajos `dead` de la outbox generados por las llamadas salientes sin
   credenciales reales pueden quedar; no afectan nada.

---

## 2. Prompt para Claude en Chrome

Reemplazar `<uuid tienda>`, `<CRON_SECRET>` y los usuarios antes de pegarlo.

````text
Eres QA de una app de gestión de tienda de mascotas (Next.js + Supabase + Clerk)
que corre en http://localhost:3000. Tu trabajo es revisar exhaustivamente,
desde el navegador, que las funcionalidades nuevas de la rama feat/stockCanales
funcionen bien y sean seguras. No tienes terminal: cuando un paso diga
"PEDIR AL USUARIO", detente, muéstrame el comando exacto y espera a que te
confirme que lo ejecuté y te pegue la salida.

## Reglas
- La base de datos es un entorno de DEMO compartido y no debe perder datos.
  Solo crea o modifica datos de productos cuyo nombre empiece con "QA-". No
  edites, vendas ni ajustes ningún otro producto, cliente o configuración.
- Anota el número/ID de cada venta que crees: al final hay que anularlas.
- NO registres una liquidación válida en Canales (genera un asiento contable
  que no se revierte desde la UI): prueba solo sus validaciones.
- No cambies roles, licencias, usuarios ni configuración de otros canales.
- Los precios incluyen IVA. Las cantidades en CLP son enteras.
- Ante cualquier resultado inesperado: saca captura, revisa la consola y la
  pestaña Network (status y cuerpo de la respuesta de /api/...) y sigue con el
  siguiente caso. No intentes "arreglar" datos.
- En cada pantalla revisa también: errores en consola, textos "undefined"/"NaN",
  montos mal formateados, spinners infinitos y comportamiento en ancho de móvil.

## Usuarios
- ADMIN (storeAdmin): <email admin>
- WORKER (storeWorker): <email worker>
Tienda: <uuid tienda>. Yo cambio de sesión cuando me lo pidas.

## Contexto de negocio (reglas que debes verificar)
- D1/D2: un solo stock por producto; nunca se vende más que el stock (ningún canal, incluido POS).
- D3: FIFO por lotes; una venta mayor que el lote más antiguo sigue con el siguiente.
- D11/D21: si un producto con stock suelto recibe su primer lote, el stock suelto
  se convierte en "lote inicial" (LOTE-0) y la UI exige su fecha de vencimiento.
- D22: "Conteo físico" solo admin, motivo obligatorio.
- D23: solo cuentan como vendibles los lotes vigentes; los vencidos se dan de baja con "merma".
- Granel (D18–D20): se vende por gramos desde un saco abierto; vender 500 g de un
  saco de 15 kg baja el stock 0,0333 (3,33 %). Si no alcanzan los gramos, el POS
  obliga a confirmar la apertura de un saco nuevo. Abrir un saco no cambia el stock
  total. Un solo saco abierto por producto. "Deshacer apertura" solo admin y solo
  si el saco no tiene ventas. Se muestra "N sacos + X kg".
- Canales externos: cupo = stock − stock_minimo (D4). Las órdenes se aceptan solas
  (D5) y crean una venta. El worker solo marca "lista para retiro" (D8); config,
  catálogo y precios solo admin. Precio canal = precio base (oferta si está en
  oferta) × (1 + recargo %), redondeado HACIA ARRIBA a la decena, con precio fijo
  opcional por producto (D7, D13, D14). PedidosYa y Uber Eats: "Integración pendiente".

## Casos a probar

### A. Roles y navegación
A1 (WORKER) El menú muestra POS; no muestra Canales ni acciones de admin en Inventario.
A2 (WORKER) Entrar directo por URL a /canales, /canales/rappi y /canales/rappi/catalogo:
    debe redirigir o denegar, nunca mostrar datos.
A3 (WORKER) /pos/pedidos carga (vista de pedidos de canales para el worker).
A4 (WORKER) En Inventario NO aparecen "Conteo", ajuste +/−, "Deshacer apertura",
    "Dar de baja (merma)" de lotes. (Es solo UX; anota si aparecen.)
A5 (ADMIN) Todo lo anterior sí es visible/accesible.

### B. Stock e integridad (ADMIN salvo que se indique)
B1 POS: vende 5 de QA-UNIDAD (stock 5) → OK, stock 0.
B2 POS: intenta vender 1 más de QA-UNIDAD → bloqueado con mensaje claro, sin venta creada.
    Revisa en Network si el backend responde 422 cuando la UI no lo frena.
B3 Inventario → QA-LOTE (stock suelto 10) → registrar lote de 5 unidades:
    debe avisar "las 10 unidades existentes se registrarán como lote inicial" y
    EXIGIR su vencimiento (prellenado si el producto tiene fecha). Resultado:
    stock 15, dos lotes (10 y 5).
B4 POS: vende 12 de QA-LOTE → consume las 10 del lote inicial y 2 del nuevo
    (verifícalo en el detalle de lotes). Stock 3.
B5 Nota de crédito parcial: sobre la venta de B4, devolver 1 unidad con restitución
    de stock → stock sube exactamente 1 (no 12).
B6 Anular la venta de B4 → el stock sube 11 (las 12 vendidas menos la 1 ya devuelta),
    no 12. Verifica que la NC previa no se duplica.
B7 Conteo físico de QA-UNIDAD: motivo vacío o de menos de 5 caracteres → rechazado;
    valor negativo → rechazado; valor 8 con motivo "Conteo QA" → stock 8 y queda
    en el historial de movimientos. Para un producto con lotes debe pedir el lote.
B8 Filtro "Con decimales" en Inventario: funciona (puede no mostrar nada).
B9 Si existe algún lote vencido de un producto QA-, "Dar de baja (merma)" lo desactiva
    y el stock baja. Si no se puede crear un lote vencido desde la UI, anótalo como "no aplica".

### C. Granel (QA-GRANEL: saco 15 kg, stock 3)
C1 POS: vender 500 g sin saco abierto → el POS obliga a confirmar la apertura de un
    saco. Tras vender: stock ≈ 2,9667 y se muestra "2 sacos + 14,5 kg". Precio = 0,5 × 4.000.
C2 Vender 15 kg (más de lo que queda en el saco abierto) → pide abrir otro saco y la
    venta consume el resto + lo que falta del nuevo en una sola operación.
C3 "Abrí un saco nuevo" con el saco actual aún con gramos → exige registrar merma
    del resto antes de abrir. Registrar la merma → el stock baja en esa fracción.
C4 (WORKER) No ve "Deshacer apertura". (ADMIN) Abrir un saco sin ventas y deshacer
    la apertura → vuelve a sacos cerrados; intentar deshacer un saco con ventas → rechazado.
C5 Nota de crédito de una venta granel → los gramos vuelven al saco abierto.
C6 Inventario y POS muestran "N sacos + X kg" coherentes entre sí.

### D. Canales: configuración, catálogo y precios (ADMIN)
D1 /canales/rappi: campos Client ID, Client Secret, ID de tienda en Rappi, Webhook
    Secret. Nunca debe mostrarse un secreto guardado en claro (revisa también la
    respuesta JSON en Network).
D2 PedidosYa y Uber Eats muestran "Integración pendiente" y no se pueden activar.
D3 Catálogo y precios de Rappi: habilitar QA-UNIDAD, QA-LOTE y QA-GRANEL.
    Recargo 10 % → precio calculado de QA-UNIDAD = 5.500; con un precio que no dé
    decena exacta verifica el redondeo hacia arriba a la decena. Recargo > 100 o
    con más de 2 decimales → rechazado. Precio fijo por producto reemplaza al calculado;
    precio fijo 0 o negativo → rechazado. Se muestran stock, cupo (stock − mínimo) y
    estado publicado. QA-GRANEL: el cupo cuenta solo sacos cerrados.
D4 "Publicar catálogo" → confirma que quedó encolado. Las llamadas a Rappi fallan sin
    credenciales reales: debe verse en Alertas, sin romper la página.
D5 "Preparación para producción": checklist con ítems (entorno, habilitación,
    licencia, credenciales, webhook, catálogo, menú, stock mínimo, crons, outbox) y
    URLs del webhook por evento con ?store_id= y &evento=. No debe mostrar valores
    de variables de entorno ni secretos.
D6 Liquidaciones: SOLO validaciones (montos negativos, fechas invertidas, campos
    vacíos) → errores visibles. No envíes una liquidación válida.
D7 Alertas de canales: la sección carga; el botón de reintento funciona sobre un
    trabajo fallido si lo hay.

### E. Órdenes de Rappi simuladas (PEDIR AL USUARIO cada comando; antes pon el stock
     de QA-UNIDAD en 8 con conteo si no lo está)
E1 PING → espero "HTTP 200" y {"status":"OK","description":"Store on"}; en
    Preparación el ítem "Webhook" pasa a ✓.
E2 NEW_ORDER de 1 QA-UNIDAD → aparece en /pos/pedidos como aceptada (sin que nadie
    acepte), se creó una venta de procedencia Rappi y el stock bajó 1. En el POS
    aparece el aviso/contador de pedido nuevo.
E3 (WORKER) "Marcar lista" en ese pedido → pasa a lista. (WORKER) No ve el botón
    de reintentar pedidos fallidos.
E4 Repetir el mismo NEW_ORDER con el mismo --orden → no se duplica la venta ni el
    pedido ni el descuento de stock.
E5 NEW_ORDER con SKU inexistente → pedido rechazado automáticamente, sin venta.
E6 NEW_ORDER de 99 unidades → rechazado por stock, sin venta, stock intacto.
E7 ORDER_EVENT_CANCEL de la orden de E2 → pedido cancelado, venta anulada, stock restituido.
E8 Firma inválida → el comando muestra HTTP 401 y no aparece nada nuevo en la UI.
E9 MENU_REJECTED → aparece como alerta de menú rechazado.
E10 Disponibilidad: con QA-UNIDAD publicada, vende en POS hasta dejar stock = stock_minimo
    (2). PEDIR AL USUARIO el curl de canales-outbox. En el catálogo el estado
    publicado de QA-UNIDAD debe pasar a apagado (o la alerta del intento de
    apagarlo). Sube el stock con conteo físico → vuelve a encender tras otro curl.

### F. Seguridad desde el navegador (con sesión WORKER, usando la consola del
     navegador con fetch; reporta status y cuerpo)
F1 fetch('/api/canales/config') → 403.
F2 fetch('/api/canales/rappi/productos') → 403; PUT al mismo → 403.
F3 fetch('/api/canales/catalog',{method:'POST'}) → 403.
F4 fetch('/api/canales/alertas') y fetch('/api/canales/liquidacion') → 403.
F5 fetch('/api/inventario/<id QA-UNIDAD>/conteo',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({stock_contado:100,motivo:'prueba worker'})}) → 403 y stock sin cambios.
F6 fetch('/api/canales/orders') → 200 solo con pedidos de su tienda.
F7 fetch('/api/cron/canales-outbox',{method:'POST'}) sin Authorization → 401.
F8 (ADMIN) Copia de Network el body del PUT a /api/canales/rappi/productos que envía la
    UI al habilitar un producto y reenvíalo con fetch: (a) cambiando el id del producto
    por un UUID inventado → 404, sin crear nada; (b) agregando "store_id" al body →
    400 (el schema es estricto) o ignorado, nunca aplicado a otra tienda.

## Entrega
1. Tabla: ID | Caso | Resultado (✅ / ❌ / ⚠️ / no aplica) | Evidencia (qué viste,
   status HTTP, mensaje, captura).
2. Lista de bugs ❌ con pasos para reproducir, resultado esperado vs obtenido,
   severidad (crítico: se vende sin stock, datos de otra tienda, acceso de worker
   a acciones de admin; alto: stock o montos incorrectos; medio: UI rota; bajo: textos).
3. Lista de ventas creadas (número/ID) para anular, y productos QA- creados.
4. Observaciones de UX o dudas de negocio que no sean bugs.
````
