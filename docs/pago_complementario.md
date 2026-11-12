# Pago complementario (mixto) en el POS — análisis de factibilidad

**Fecha:** 2026-11-08 (revisión fiscal: 2026-11-12)
**Alcance:** una venta pagada con dos o más medios (ej. parte efectivo + parte
débito, parte efectivo + nota de crédito, etc.), en el POS presencial.
**Naturaleza:** análisis y diseño. Este documento no implementa código ni
aplica migraciones.

**Cómo se verificó**

- **Verificado en código:** flujo POS (`src/stores/pos.ts`,
  `src/app/(app)/pos/page.tsx`, `src/app/(app)/pos/api.ts`,
  `src/app/(app)/pos/components/ModalPago.tsx`), creación de venta
  (`src/app/api/ventas/route.ts`), RPC `crear_venta_tx`
  (`migrations/092_fechas_hora_chile.sql`, base 078), tabla `pagos`
  (`migrations/000_baseline.sql`), contabilidad
  (`src/lib/contabilidad/generador-asientos.ts`), anulación
  (`src/lib/ventas/anular-venta.ts`), pagos sueltos
  (`src/app/api/pagos/route.ts`), saldo a favor
  (`src/app/api/saldos-a-favor/route.ts`), validación
  (`src/lib/validation/ventas.ts`), reportes (`src/app/api/reports/route.ts`).
- **Verificado en fuente SII:** formato boleta electrónica v4.2 (texto del PDF
  oficial, campos 10, 18, 20 y 21), **Resolución Exenta N° 176/2020
  (resolutivo 2°, texto del PDF oficial)**, Resolución Exenta N° 44/2025,
  página SII "Tu voucher es tu boleta" (modelos de emisión), Circular N°
  45/2024, DL 825 art. 9, formato DTE.
- **Verificado vía jurisprudencia publicada por el SII, no en el texto
  consolidado del Código:** rango de la multa del art. 97 N° 10 del Código
  Tributario (§6.0).
- **Calculado, no publicado por el SII en lo que se revisó:** valor en pesos del
  umbral de 135 UF para 2026 (ver §6.3). La Res. Ex. N° 110/2026 se revisó y
  no lo fija (es una autorización a un contribuyente puntual).
- **No verificado:** criterio oficial del SII para identificar al pagador en
  una venta > 135 UF documentada con voucher + boleta (§6.3), y para el código
  `<MedioPago>` de una boleta cuyo saldo se pagó con dos medios no
  electrónicos (§6.2).

**Contexto de la tienda (informado por el usuario, 2026-11-12):** la tienda no
emite boletas ni DTE propios, y no es objetivo a corto plazo. Entrega un ticket
interno del sistema, y la máquina Transbank emite el voucher, que es válido como
boleta. El objetivo es cumplir con el SII en forma y fondo para evitar multas.

---

## 1. Veredicto

**Técnicamente factible y de bajo riesgo, con una condición: el cambio no es de
UI, es de contrato y de asiento contable.**

La base de datos ya modela N pagos por venta (`pagos` es 1:N desde el
baseline). Lo que falta es:

1. que la creación de venta acepte y registre N pagos en la misma transacción;
2. que la contabilidad deje de mapear "un método → una cuenta";
3. que la anulación sume todos los pagos no-crédito, no solo el primero;
4. que reportes y recibos lean el desglose cuando `ventas.metodo_pago = 'mixto'`.

Ninguno de esos cuatro puntos requiere una tabla nueva. El riesgo real no es
técnico: es **fiscal**.

**Hallazgo fiscal principal (§6.0):** la Res. Ex. SII N° 176/2020 regula
exactamente el pago mixto: el voucher Transbank sirve de boleta **solo por la
parte pagada con tarjeta**, y por el saldo pagado en efectivo, transferencia u
otro medio **hay que emitir boleta**. El ticket interno del sistema no es un
documento tributario. Hoy la tienda no emite boletas, así que **toda venta o
porción de venta que no se paga con tarjeta queda sin documento tributario**.
Eso es un incumplimiento preexistente, sancionable por el art. 97 N° 10 del
Código Tributario, que el pago mixto no crea pero sí multiplica. **Habilitar el
pago mixto sin resolver esto expone a la tienda a multas.** Para eso no hace
falta integrar DTE: basta con emitir la boleta del saldo con el sistema gratuito
del SII (web o app e-Boleta) o con un proveedor. El sistema solo tiene que
indicarle al cajero **cuánto boletear** (§4.9).

**Decisiones de producto tomadas (2026-11-08):**

1. Solo se registra el monto aplicado; **no se modela vuelto** ni efectivo
   recibido.
2. `saldo_a_favor` **se permite** como parte del cobro inicial (no solo como
   flujo post-venta).
3. `ventas.metodo_pago = 'mixto'` para 2+ medios.
4. El pago mixto **se replica en citas**.
5. El control de 135 UF **no se implementa ahora** (originalmente "para la
   integración DTE"; revisado en §6.3, porque no habrá DTE).
6. No hay backfill: el proyecto no tiene ventas reales todavía (demo).

**Decisión fiscal (2026-11-12):**

7. La tienda **no integra DTE**. El voucher Transbank documenta la parte
   pagada con tarjeta. La parte que no se paga con tarjeta se documenta con una
   boleta emitida fuera del sistema (sistema gratuito del SII o un proveedor).
   El sistema calcula y muestra ese monto (§4.9). Registrar el folio de la
   boleta externa es una **propuesta pendiente de decisión** (§9.3).

El detalle y las consecuencias de cada decisión están en §9.2.

---

## 2. Cómo se cobra hoy (estado verificado)

### 2.1 UI del POS

`ModalPago.tsx` ofrece **un método base** (`efectivo`, `debito`, `credito`,
`transferencia`, `nota_credito`) y, si el método base no es NC, un panel
opcional para validar **una** nota de crédito por un monto parcial. El "resto"
se cobra con el método base:

```ts
const montoNc = pagoNc?.monto ?? 0;
const montoResto = Math.round(tot - montoNc);
```

No existe forma de dividir el resto entre dos medios (ej. $5.000 efectivo +
$12.000 débito). El estado del POS (`src/stores/pos.ts`) guarda un solo
`metodoPago`, un solo `numeroTransaccion` y un solo `pagoNc`.

### 2.2 Contrato de creación

`VentaCreateSchema` (`src/lib/validation/ventas.ts`) acepta:

```ts
metodoPago: "efectivo" | "debito" | "credito" | "transferencia"
          | "saldo_favor" | "plataforma" | "nota_credito" | "mixto";
numeroTransaccion?: string;
pagoNc?: { nota_credito_id, numero_nc, monto };
```

`"mixto"` ya existe en el enum, pero **no significa pago complementario**: hoy
solo describe "NC parcial + un método", y lo asigna la ruta después del RPC:

```ts
const metodoPagoVenta = pagoNc
  ? (pagoNc.monto >= total ? "nota_credito" : "mixto")
  : metodoPago;
```

Reutilizar `"mixto"` para efectivo + tarjeta es correcto en semántica, pero hay
que **redefinirlo explícitamente** y decidir qué valor va a
`ventas.metodo_pago` cuando hay 3+ medios.

### 2.3 RPC `crear_venta_tx`

Recibe un solo `p_metodo_pago`, un `p_pago_nc` opcional y un
`p_numero_transaccion`. El bloque de pagos (092, §4) hace exactamente esto:

- si hay NC: inserta `pagos(metodo='nota_credito', monto=v_monto_nc,
  nota_credito_id=...)`; y si queda resto, inserta **una** fila con
  `p_metodo_pago` por `v_monto_resto`;
- si no hay NC: inserta **una** fila con `p_metodo_pago` por el total.

La venta queda `estado='pagada'` siempre, dentro de la misma transacción. Es
atómico: no puede existir venta sin pago ni pago sin venta.

### 2.4 Tabla `pagos`

```sql
CREATE TABLE public.pagos (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL,
  venta_id uuid NOT NULL,
  metodo varchar(50) NOT NULL,
  monto numeric(12,2) NOT NULL,
  numero_transaccion varchar(100),
  comprobante varchar(100),
  created_at timestamp,
  updated_at timestamp,
  nota_credito_id uuid
);
```

Puntos relevantes:

- **Ya soporta N filas por venta.** No hace falta migración de schema para el
  caso básico.
- **No hay `CHECK (monto > 0)`** ni constraint que exija
  `SUM(pagos.monto) = ventas.total`. La integridad depende hoy del código.
- **No hay columna para vuelto.** El POS no registra "efectivo recibido";
  registra el monto aplicado. Para pago mixto conviene mantener esa semántica:
  `pagos.monto` = monto aplicado a la venta, no billete recibido.
- **No hay `metodo` restringido por CHECK.** El enum vive solo en Zod.

### 2.5 Contabilidad

`lineasVenta` y `lineasVentaCanal`
(`src/lib/contabilidad/generador-asientos.ts`) hacen:

```ts
const cuentaCaja = params.metodoPago === "efectivo" ? CUENTAS.CAJA : CUENTAS.BANCO;
```

Es decir: **todo el cobro va a Caja o todo va a Banco**, según un único
método. `lineasVentaConNc` agrega una línea a `SALDOS_FAVOR` por la NC y otra a
Caja/Banco por el resto. Con un pago efectivo + débito, el asiento completo
caería en Banco (o en Caja si el método base fuera efectivo), falseando ambos
saldos.

### 2.6 Anulación

`src/lib/ventas/anular-venta.ts` revierte el pago no-crédito con:

```ts
const pagoResto = (pagosVenta ?? [])
  .find((p) => !METODOS_CREDITO.has(p.metodo));
```

`.find()` devuelve **el primer** pago no-crédito. Con dos pagos no-crédito, el
contra-asiento de anulación solo revierte uno y deja el otro sin reversar. Es
un bug latente que el pago mixto convierte en bug real.

### 2.7 Reportes, dashboard y recibos

- `GET /api/reports` y `GET /api/dashboard` agrupan por
  `ventas.metodo_pago`, no por `pagos`. Una venta mixta aparecería como
  `"mixto"` (o como el método base si no se actualiza), sin desglose.
- El recibo (`GET /api/recibos/[ventaId]`) y el detalle de venta
  (`GET /api/ventas/[id]`) **sí listan todas las filas de `pagos`** y muestran
  el desglose cuando hay más de una. Esa parte ya está resuelta.
- La exportación CSV de reportes usa `ventas.metodo_pago` como una columna de
  texto; un pago mixto saldría como `mixto` sin detalle.

### 2.8 Otros flujos de pago que ya existen

| Flujo | Qué hace | Relevancia para pago mixto |
|---|---|---|
| `POST /api/pagos` | Inserta un pago suelto sobre una venta existente y la marca `pagada` si la suma cubre el total | Ya permite N pagos, pero **no** es el flujo del POS. Si se usara para una venta nueva, duplicaría pagos: `crear_venta_tx` ya insertó el total y dejó `estado='pagada'`. |
| `POST /api/saldos-a-favor` | RPC `gastar_saldo_a_favor_pago`: descuenta saldo e inserta `pagos(metodo='saldo_a_favor')` sobre una venta existente | Hoy es **post-venta**. Por decisión (§9.2), el saldo a favor también debe poder usarse en el cobro inicial: se descuenta dentro de `crear_venta_tx`, no con esta ruta. |
| `completar_cita_tx` | Mismo patrón que `crear_venta_tx`: un método + NC opcional | Superficie adyacente: por decisión (§9.2), se replica el mismo `pagos[]` en el mismo cambio para no dejar la cita inconsistente. |

---

## 3. Gaps concretos

| # | Gap | Dónde | Severidad |
|---|---|---|---|
| G1 | La API no acepta N pagos; solo un método + NC | `VentaCreateSchema`, `crear_venta_tx` | Alta (bloqueante) |
| G2 | El asiento contable mapea un método a una sola cuenta | `generador-asientos.ts` | Alta |
| G3 | La anulación revierte solo el primer pago no-crédito | `anular-venta.ts` | Alta |
| G4 | Reportes/dashboard no desglosan por `pagos` | `/api/reports`, `/api/dashboard` | Media |
| G5 | `SUM(pagos.monto) = ventas.total` no se valida en BD | `pagos` / RPC | Media (se puede cerrar en RPC) |
| G6 | `pagos` no tiene CHECK de monto positivo | `pagos` | Baja (Zod + RPC lo cubren) |
| G7 | La UI no permite dividir el resto | `ModalPago.tsx`, `pos.ts` | Alta (funcional) |
| G8 | `ventas.metodo_pago='mixto'` no distingue "NC parcial" de "efectivo+tarjeta" | `ventas` | Media (semántica/reportes) |
| G9 | Citas replica el patrón de un solo método | `completar_cita_tx`, `/api/citas/[id]` | Media (consistencia) |
| G10 | No hay campo de vuelto ni de efectivo recibido | `pagos`/POS | Cerrado por decisión: solo monto aplicado |

---

## 4. Diseño propuesto (mínimo)

### 4.1 Contrato

Agregar a `VentaCreateSchema` un campo opcional:

```ts
pagos: z.array(z.object({
  metodo: z.enum(["efectivo", "debito", "credito", "transferencia",
                  "nota_credito", "saldo_a_favor", "plataforma"]),
  monto: z.number().int().positive(),
  numeroTransaccion: z.string().max(100).optional(),
  notaCreditoId: UUIDSchema.optional(),
  comprobante: z.string().max(100).optional(),
})).min(2).max(5).optional(),
```

Reglas de validación (en Zod **y** en el RPC, porque son límites de confianza
distintos):

1. `pagos` y `metodoPago` son mutuamente excluyentes: si viene `pagos`, no se
   acepta `pagoNc` ni `numeroTransaccion` sueltos (evita dos fuentes de verdad).
2. `SUM(pagos.monto) === total` exacto, en pesos enteros. Sin tolerancia: el
   POS calcula el total con `calcularTotalCarrito`, y el último monto se
   autocalcula como resto. Nada de "redondear a favor".
3. Cada `monto > 0`.
4. `metodo='nota_credito'` exige `notaCreditoId`; `notaCreditoId` solo se
   acepta con ese método.
5. `metodo` en `{debito, credito, transferencia}` exige
   `numeroTransaccion` (misma regla que hoy, aplicada por fila).
6. Como máximo **una** fila `nota_credito` y como máximo **una**
   `saldo_a_favor` (evita doble consumo del mismo crédito).
7. `store_id` nunca sale del body: se toma del contexto, igual que hoy.
8. `metodo='saldo_a_favor'` exige `clienteId` en la venta (el saldo pertenece
   a un cliente) y se descuenta **dentro del RPC**, con `UPDATE ... WHERE
   saldo_disponible >= monto`. No se llama a `gastar_saldo_a_favor_pago` desde
   la ruta: esa función inserta el pago por su cuenta y duplicaría la fila.

Compatibilidad: si `pagos` no viene, el RPC mantiene el camino actual
(`p_metodo_pago` + `p_pago_nc`). Ningún caller existente se rompe.

### 4.2 RPC

Nueva firma de `crear_venta_tx` con `p_pagos jsonb DEFAULT NULL`, o una función
nueva `crear_venta_pagos_tx` que reutilice el cuerpo. Preferible **una sola
función**: dos funciones que crean ventas divergen (ya pasó con
`completar_cita_tx`, que duplica un subconjunto).

Dentro del bloque de pagos:

```sql
IF p_pagos IS NOT NULL THEN
  -- validar suma exacta contra p_total; si no, RAISE EXCEPTION
  -- validar montos > 0 y métodos conocidos
  FOR v_pago IN SELECT * FROM jsonb_to_recordset(p_pagos)
    AS x(metodo text, monto numeric, numero_transaccion text,
         nota_credito_id uuid, comprobante text)
  LOOP
    INSERT INTO pagos (...) VALUES (...);
    IF v_pago.metodo = 'nota_credito' THEN
      -- mismo tratamiento que hoy: marcar NC usada y descontar saldo
    END IF;
    IF v_pago.metodo = 'saldo_a_favor' THEN
      -- UPDATE saldos_a_favor SET saldo_disponible = saldo_disponible - monto
      --  WHERE cliente_id = ... AND store_id = ... AND saldo_disponible >= monto
      --  RETURNING ...; si 0 filas -> RAISE EXCEPTION (saldo insuficiente)
    END IF;
  END LOOP;
ELSE
  -- camino actual sin cambios
END IF;
```

Detalles que el RPC debe mantener:

- **Atomicidad**: la validación de suma y los inserts ocurren en la misma
  transacción. Si algo falla, no queda venta a medias.
- **Idempotencia**: `p_idempotency_key` sigue cubriendo el reintento de red.
  No insertar pagos fuera del RPC.
- **`ventas.metodo_pago`**: si hay más de un método no-crédito, o hay
  crédito + otro método, `'mixto'`. Si hay un solo método, ese método. Si es
  solo NC, `'nota_credito'`. Esta decisión debe vivir en **un solo lugar**
  (el RPC), no repetirse en la ruta como hoy.

### 4.3 Contabilidad

Reemplazar el mapeo "método → cuenta" por "lista de pagos → líneas de debito".
Para una venta con total $17.000, neto $14.286, IVA $2.714:

```
Debe  Caja          $5.000   (pago efectivo)
Debe  Banco        $12.000   (pago débito)
Haber IVA por pagar $2.714
Haber Ventas       $14.286
```

Reglas:

- Agrupar por cuenta: dos pagos electrónicos (débito + transferencia) pueden
  producir **una** línea de Banco por la suma, o dos líneas separadas. Para
  trazabilidad del medio, dos líneas es mejor y no cuesta nada.
- Los métodos de crédito interno (`nota_credito`, `saldo_a_favor`) van a
  `SALDOS_FAVOR`, como hoy.
- El IVA **no cambia**: se sigue extrayendo del bruto con `extraerIva()`
  (§23.3). El pago mixto no altera la base ni el devengo.
- Si el canal es `rappi`/`pedidosya`/`ubereats`, la cuenta es la CxC del canal
  y el pago es del canal, no del cliente: **no aplicar mixto** a esos canales
  (el POS no los cobra).

La forma más simple es cambiar los builders para aceptar
`pagos: { metodo, monto }[]` y, si no viene, construir un array de un elemento
con el método actual. Así el camino viejo y el nuevo comparten una sola
implementación.

### 4.4 Anulación

`anular-venta.ts` debe:

- sumar o iterar **todos** los pagos no-crédito, agrupados por cuenta, y
  emitir el contra-asiento por cada cuenta involucrada;
- mantener el tratamiento actual de `nota_credito`/`saldo_a_favor` (paso 6 de
  `anular_venta_tx`, §23.5) sin cambios.

No hay que tocar la lógica transaccional de stock/fidelización: el pago mixto
no la afecta. El cambio es solo en la construcción de líneas contables.

### 4.5 Reportes

Dos opciones:

- **A (mínima):** mantener `ventas.metodo_pago` y agregar un desglose
  derivado consultando `pagos` para las ventas con `metodo_pago='mixto'`.
- **B (correcta a largo plazo):** calcular el breakdown de métodos desde
  `pagos` para todas las ventas, y dejar `ventas.metodo_pago` solo como
  etiqueta de display.

Recomendación: **A ahora, B cuando se toque reportes por otro motivo.** B
implica recalcular métodos desde `pagos` para todas las ventas. No hay backfill
pendiente: el proyecto no tiene ventas reales todavía (demo), y A cubre
cualquier venta histórica sin tocarla.

El dashboard tiene el mismo problema y la misma solución.

### 4.6 UI

`ModalPago` pasa de "método + NC opcional" a una lista de filas:

```
[ Efectivo     ] $ [ 5.000 ]  [x]
[ Débito       ] $ [12.000 ]  [x]   TRX [_______]
[ + Agregar pago ]           Resto: $0
```

Reglas de UI:

- El total se calcula con las funciones puras del store en el mismo render
  (§23.4), nunca con getters.
- "Resto" = `total - suma(filas)`, recalculado en el render.
- El botón "Cobrar" se deshabilita si `resto !== 0` o si falta TRX en un método
  electrónico.
- La fila de NC reutiliza el validador actual; solo permite un código.
- La fila "Saldo a favor" solo aparece si hay cliente seleccionado, y valida
  contra el saldo disponible antes de enviar.
- No hay campo de vuelto: cada monto es el **aplicado** a la venta, no el
  billete recibido.
- No persistir el arreglo de pagos en `localStorage` (misma razón que
  `metodoPago`/`pagoNc`: estado de cobro no debe sobrevivir a un refresh).

### 4.7 Recibos

Ya listan todas las filas de `pagos`. Solo hay que verificar que el texto
impreso distinga "Efectivo $5.000 / Débito $12.000" y no muestre "mixto" como
si fuera un medio. Si el recibo muestra el método de la venta, usar el desglose
cuando `metodo_pago='mixto'`.

### 4.8 Citas

`completar_cita_tx` tiene el mismo patrón (un método + NC opcional) y su ruta
usa `lineasVentaServicio` / `lineasVentaServicioConNc` para el asiento.

**Decisión (§9.2): se replica.** La cita debe aceptar el mismo `pagos[]` y
aplicar las mismas reglas de suma/montos/métodos. Para no duplicar la lógica,
extraer el bloque de validación + inserción de pagos a una función SQL interna
(ej. `registrar_pagos_venta_tx`) invocada por `crear_venta_tx` y por
`completar_cita_tx`, y hacer que los builders de asiento de servicio acepten N
pagos igual que los de venta. `crear_venta_tx` y `completar_cita_tx` ya
divergen en otros detalles; no agregar una tercera copia del bloque de pagos.

### 4.9 Monto a boletear (requisito fiscal, §6.0)

Como la tienda no emite DTE y el voucher solo cubre la parte con tarjeta, el
sistema debe decirle al cajero **por cuánto emitir boleta** en cada venta:

```
montoBoleta = Σ pagos.monto  donde metodo ∉ {debito, credito}
```

Es decir: efectivo + transferencia + nota_credito + saldo_a_favor. La NC
interna y el saldo a favor **también** entran (§6.5). `plataforma` no aplica,
porque las ventas de canal no pasan por el cobro mixto del POS (§4.3).

Reglas:

- Una función pura única (ej. `calcularMontoBoleta(pagos)`), usada por el
  modal de pago, el ticket y los reportes. No duplicar el filtro de métodos.
- **Modal de pago y pantalla de confirmación:** si `montoBoleta > 0`, mostrar
  de forma destacada "Emitir boleta por $X (efectivo $A / transferencia $B /
  crédito interno $C)". Si es 0, mostrar "Voucher Transbank cubre el total".
- **Ticket interno:** incluir el desglose de pagos y la leyenda "Este ticket no
  es un documento tributario". Esto es una recomendación: no la exige ninguna
  norma leída. Evita que el cliente o un fiscalizador lo tome por boleta.
- **Reporte diario/cierre de caja:** total "a boletear" del día por medio, para
  cuadrar contra las boletas emitidas en el sistema del SII.
- Una venta pagada 100 % con tarjeta da `montoBoleta = 0`. Esto ya funciona
  hoy, con o sin pago mixto.

Este cálculo no depende del pago mixto: hoy también hay ventas 100 % efectivo
sin boleta. Por eso conviene implementarlo **antes o junto con** la fase 1
(§8).

---

## 5. Contabilidad: casos que deben cuadrar

| Caso | Debe | Haber |
|---|---|---|
| Efectivo + débito | Caja + Banco | IVA + Ventas |
| Efectivo + transferencia | Caja + Banco | IVA + Ventas |
| Efectivo + NC | Caja + Saldos a favor | IVA + Ventas |
| NC + débito | Saldos a favor + Banco | IVA + Ventas |
| NC total | Saldos a favor | IVA + Ventas |
| NC + efectivo + débito | Saldos a favor + Caja + Banco | IVA + Ventas |

Invariante: `Σ debe === Σ haber === total`, y
`neto + IVA === total` con `extraerIva()`.

La anulación debe espejar **cada** línea de debito, no solo la primera. Para
una venta pagada con NC, el contra-asiento usa `lineasAnulacionVentaConNc`
(no `lineasAnulacionVentaCanal`), porque el dinero de la NC nunca entró a
Caja/Banco (§23.5, ticket 6a5f9ad3fbf979e68251d40e). Con pago mixto, la
anulación debe combinar ambos criterios: NC → Saldos a favor; efectivo/tarjeta
→ Caja/Banco por sus montos reales.

---

## 6. Análisis SII

> Esta sección describe obligaciones del emisor. El repo **no emite DTE al
> SII**: `ventas.numero_comprobante` es un número interno
> (`YYYYMMDD-XXXXXXXX`), y el ticket que imprime **no es un documento
> tributario**. Las obligaciones de §6.0 aplican **hoy**, aunque el sistema no
> emita DTE: recaen sobre la tienda, no sobre el software. Las de §6.2 a §6.4
> (campos XML) solo aplican a quien emita la boleta, sea el sistema gratuito
> del SII, un proveedor o, a futuro, este sistema.
>
> Esto es un análisis normativo, no asesoría tributaria. Antes de operar,
> conviene validarlo con el contador de la tienda.

### 6.0 Qué documento corresponde a cada medio de pago (Res. Ex. SII N° 176/2020)

La Res. 176 (31-12-2020, vigente desde el 01-01-2021) define cuándo el
comprobante de pago electrónico (voucher) sustituye a la boleta. Resolutivo 2°,
texto oficial:

> "En las operaciones cuyo pago se realice en dinero efectivo o se materialice
> a través de un medio de pago que no sea una 'tarjeta de crédito', 'tarjeta de
> débito' u otro medio de pago electrónico, que no pueda identificarse por el
> administrador de medios de pago electrónico, los contribuyentes deberán
> emitir la correspondiente boleta de ventas y servicios."
>
> "En aquellos casos en que se pague parte del precio de la venta o servicio a
> través de un medio electrónico y el saldo en dinero efectivo o utilizando un
> medio de pago distinto […], el contribuyente deberá emitir la boleta de
> ventas y servicios correspondiente por la parte del saldo del precio que se
> haya solucionado por los modos indicados."

Aplicado a los métodos del sistema, con el modelo de emisión de la tienda
("no emito boleta cuando recibo un pago electrónico"):

| `pagos.metodo` | Documento tributario | Quién lo emite |
|---|---|---|
| `debito`, `credito` (Transbank) | Voucher (vale como boleta) | Máquina Transbank |
| `efectivo` | **Boleta electrónica** | Tienda, fuera del sistema |
| `transferencia` | **Boleta electrónica** (la transferencia no la administra un operador de medios de pago) | Tienda, fuera del sistema |
| `nota_credito`, `saldo_a_favor` | **Boleta electrónica** (crédito interno, no es medio electrónico, §6.5) | Tienda, fuera del sistema |

**Ejemplo:** venta de $17.000 = $12.000 débito + $5.000 efectivo. Va un voucher
por $12.000 y una boleta por $5.000. No es fraccionamiento: es la forma que
prescribe el SII. No hay que emitir boleta por el total, porque la parte con
tarjeta quedaría documentada dos veces.

**Modelo de emisión:** el SII permite declarar, en sii.cl, uno de dos modelos:
"no emito boleta cuando recibo un pago electrónico" (voucher + boleta por el
saldo) o "siempre emito boleta" (boleta por el total + voucher). Lo informado
por la tienda corresponde al primero. **Hay que confirmar en sii.cl que ese es
el modelo declarado.** Si no lo es, la tabla anterior no aplica.

**Situación actual y sanción:** la tienda no emite boletas. Toda venta, o
porción de venta, pagada en efectivo, por transferencia o con crédito interno
queda hoy sin documento tributario. El art. 97 N° 10 del Código Tributario
sanciona el no otorgamiento de boletas. Según la jurisprudencia publicada por
el SII, la multa va del 50 % al 500 % del monto de la operación (mínimo 2 UTM,
máximo 40 UTA), y puede agregarse una clausura de hasta 20 días. Este rango no
se verificó contra el texto consolidado del Código.

**Cómo cumplir sin integrar DTE:** el SII ofrece un sistema gratuito de boleta
electrónica (web sii.cl y app e-Boleta). También se pueden usar sistemas de
mercado, incluido el POS de Transbank con boleta. El sistema de la tienda no
necesita emitir la boleta: solo calcular y mostrar el monto (§4.9).

### 6.1 IVA: el pago mixto no cambia el devengo

DL 825, art. 9: el IVA se devenga al emitirse la factura o boleta, o al
producirse la entrega, lo que ocurra primero — **con independencia del medio o
momento del pago**. Un pago en dos partes no posterga ni divide el IVA: la
venta completa se devenga una vez.

Consecuencia para el sistema: el asiento contable no debe reconocer ingreso ni
IVA "a medida que se cobra". Se reconoce el total al crear la venta, y los
pagos solo afectan qué cuenta de activo (Caja/Banco/Saldos a favor) se debita.
La implementación actual ya hace esto; el pago mixto no la cambia.

### 6.2 Boleta electrónica: `<MedioPago>` no tiene código mixto

> **Relevancia acotada por §6.0:** con el modelo "voucher + boleta por el
> saldo", la boleta solo cubre la parte no pagada con tarjeta. Si ese saldo es
> de un solo medio (ej. solo efectivo), el código es directo: `1` para efectivo,
> `3` para transferencia. La ambigüedad de abajo solo queda viva cuando el
> **saldo** combina dos medios no electrónicos (ej. efectivo + transferencia, o
> efectivo + NC), o si la tienda cambia al modelo "siempre emito boleta". Este
> campo lo llena el sistema que emite la boleta (SII gratuito o proveedor), no
> este repo.

Formato boleta electrónica v4.2 (SII, 2025-09-08), campo 10:

| Código | Descripción |
|---|---|
| 1 | Efectivo |
| 2 | Pago electrónico |
| 3 | Transferencia electrónica |
| 4 | Cheque |
| 5 | Otro |

El campo es **obligatorio cuando el monto total > 135 UF** (Ley 21.713) y
obligatorio al imprimir. El formato define **un solo** `<MedioPago>` por
documento: es un campo numérico de 1 dígito, sin campo de monto por medio.
No existe una estructura oficial para "parte efectivo, parte tarjeta".

Interpretaciones posibles, ninguna confirmada por el SII en las fuentes
revisadas:

1. **Código 5 (`Otro`)** para todo pago con más de un medio. Es el más honesto
   semánticamente, pero pierde el dato de que hubo efectivo.
2. **Código del medio principal** (el de mayor monto). Refleja la mayor parte
   del pago, pero oculta la otra.
3. **Código 1 (`Efectivo`)** si hubo cualquier efectivo. Prioriza la
   trazabilidad del efectivo, pero describe mal el total.

**Recomendación (corregida 2026-11-12):** primero aplicar §6.0. La parte con
tarjeta va solo en el voucher; la boleta va **solo por el saldo**. Si el saldo
es de un único medio, usar su código. Si el saldo combina dos medios no
electrónicos, hay dos opciones, ninguna confirmada por el SII: una boleta por
el saldo con código `5`, o una boleta por medio (ej. una de efectivo con `1` y
otra de transferencia con `3`). La segunda refleja mejor el medio y no es
fraccionamiento mientras no se use para quedar bajo 135 UF (§6.3). Consultar
por escrito.

> La versión anterior de este párrafo recomendaba "no emitir dos boletas por
> una sola venta" y usar `5` por el total. Eso **contradice la Res. 176/2020**
> para la combinación tarjeta + efectivo, porque la parte con tarjeta ya está
> documentada por el voucher.

**Riesgo:** si el SII exige que el código refleje el medio realmente usado, una
boleta con `5` podría observarse. El caso solo aparece cuando el saldo combina
dos medios no electrónicos.

### 6.3 Ley 21.713 y art. 92 ter: umbral de 135 UF

Resolución Exenta N° 44/2025 (SII):

- Las ventas **superiores a 135 UF** exigen boleta electrónica con
  **identificación del pagador** (nombre y RUT) y registro de la forma de pago.
- El umbral se determina **anualmente en pesos**, según el valor de la UF al
  **31 de diciembre del año anterior**.
- Rige desde el 1 de septiembre de 2025 (registro interno desde el 1 de junio
  de 2025).
- **Prohíbe expresamente** pagar en cantidades inferiores al límite o hacer
  compras sucesivas con el mismo fin (fraccionamiento).

Valores:

| Año | UF al 31-dic del año anterior | 135 UF en pesos | Estado |
|---|---|---|---|
| 2025 | $38.416,69 (31-dic-2024) | $5.186.253,15 | Publicado en Res. Ex. 44/2025 |
| 2026 | $39.727,96 (31-dic-2025) | **$5.363.274,60** | **Calculado**, no verificado en una resolución 2026 |

El cálculo de 2026 es `135 × 39.727,96`. Debe confirmarse contra la resolución
anual del SII antes de usarlo como constante en código. Si se implementa el
chequeo, **no hardcodear el monto**: leerlo de configuración o de una tabla, y
documentar la fuente.

**Decisión (§9.2):** el control de 135 UF **no se implementa en esta fase**.
El pago mixto no lo agrava: el umbral se evalúa sobre el total, no sobre cada
pago.

> **Revisión 2026-11-12:** la decisión original lo dejaba "para la integración
> DTE", pero la tienda no integrará DTE (decisión 7). La obligación igual
> existe: los datos del pagador (nombre, RUT, forma de pago) se cargan en la
> boleta que se emite fuera del sistema. Para una tienda de mascotas, una venta
> de más de ~$5,3 millones es improbable, así que mantener la decisión es
> razonable. Mínimo recomendado: una advertencia en el POS cuando el total supere
> un umbral **configurable**, del tipo "venta > 135 UF: la boleta debe
> identificar nombre y RUT del comprador". No hardcodear el monto.

Campos del formato v4.2 que se activan sobre 135 UF (texto oficial): `<RUTRecep>`
debe ser el RUT real del cliente (campo 18), `<RznSocRecep>` es obligatorio
(campo 20) y `<Contacto>` debe imprimirse (campo 21).

**Ambigüedad no resuelta (voucher + boleta sobre 135 UF):** con el modelo de
§6.0, una venta grande pagada en parte con tarjeta queda documentada en dos
documentos, y el voucher no lleva RUT del comprador. No se encontró criterio del
SII sobre cómo se identifica al pagador en ese caso. Si llega a ocurrir,
consultar al SII o emitir la operación completa con boleta (modelo "siempre
emito boleta") para ese caso.

Implicaciones para pago mixto:

- El umbral se evalúa sobre el **total de la venta**, no sobre cada pago. Un
  pago mixto no permite "quedar bajo 135 UF".
- Si el total supera el umbral, hay que capturar nombre y RUT del pagador **una
  vez**, no por medio de pago.
- Si hay efectivo, debe constar la circunstancia (art. 92 ter). Con pago mixto
  es más fácil perder ese dato si la UI solo guarda "método principal".
- El POS actual no captura RUT del pagador en el flujo de cobro (solo cliente
  opcional). Es un gap preexistente, no creado por el pago mixto, pero el pago
  mixto lo hace más visible.

### 6.4 Factura electrónica: `<FmaPago>`

Formato DTE:

| Código | Descripción |
|---|---|
| 1 | Contado |
| 2 | Crédito |
| 3 | Sin costo |

Una venta pagada al momento con efectivo + tarjeta es **Contado (1)**: el pago
es inmediato aunque use dos medios. Solo sería **Crédito (2)** si parte del
precio queda pendiente con plazo. El sistema actual no modela ventas a crédito
con plazo; `estado='pagada'` es siempre inmediato.

### 6.5 Nota de crédito interna vs. DTE 61

La `nota_credito` del sistema es un **crédito comercial interno**: devuelve
dinero o genera saldo a favor, pero **no es un DTE tipo 61**. No informa al
SII ni revierte el débito fiscal de la venta original.

Consecuencias:

- Usar una NC interna como medio de pago de una venta nueva **no tiene
  equivalente en `<MedioPago>`**. Para el SII la venta nueva es una venta
  afecta más; el crédito es una relación comercial entre las partes.
- **La parte de la venta pagada con NC interna o saldo a favor requiere
  boleta** (Res. 176/2020, resolutivo 2°): no es tarjeta ni medio electrónico
  administrado por un operador, así que ningún voucher la cubre. En
  `<MedioPago>` el código más razonable es `5` (Otro); el SII no lo ha
  confirmado. Se incluye en `montoBoleta` (§4.9).
- Si la devolución que originó la NC fue una devolución real de mercadería, el
  débito fiscal debió revertirse con un DTE 61. Si no se emitió, hay una
  diferencia de IVA (preexistente, no causada por el pago mixto).
- El pago mixto con NC **no crea** ese problema, pero lo hace más frecuente y
  más difícil de auditar si el reporte dice "mixto" sin desglose.

Recomendación: en el documento interno y en la UI, distinguir "medio de pago
fiscal" (efectivo, tarjeta, transferencia, cheque) de "crédito interno" (NC,
saldo a favor). No presentar la NC como si fuera un medio de pago del SII.

### 6.6 Trazabilidad del efectivo

Art. 92 ter exige que conste la circunstancia del pago en efectivo cuando
corresponde. Para pago mixto:

- guardar el monto exacto en efectivo (`pagos.metodo='efectivo'`);
- no agruparlo con tarjeta bajo un genérico "mixto";
- si se integra DTE, decidir el `<MedioPago>` según §6.2 y dejar el desglose
  en el sistema, no en un campo libre.

### 6.7 Qué NO exige el SII (para no sobre-implementar)

- No exige una boleta por el **total** cuando parte se pagó con tarjeta (con el
  modelo "no emito boleta con pago electrónico"): el voucher ya documenta esa
  parte. Sí exige boleta por el saldo (§6.0). *(Corregido 2026-11-12: la
  versión anterior decía "no exige dos boletas por pago mixto", lo que inducía a
  no documentar la parte en efectivo.)*
- No exige que el sistema interno emita DTE: la boleta puede emitirse con el
  sistema gratuito del SII.
- No exige un campo XML nuevo.
- No exige que el POS registre el número de voucher de cada tarjeta para el
  SII; eso es control interno/comercial. El sistema ya guarda
  `numero_transaccion` por pago.

---

## 7. Casos límite y pruebas requeridas

### 7.1 Casos de dominio

1. Suma de pagos menor al total → 400, no se crea venta.
2. Suma mayor al total → 400. No hay vuelto: el monto es el aplicado.
3. Un pago con monto 0 o negativo → 400.
4. Método electrónico sin `numeroTransaccion` → 400.
5. Dos filas `nota_credito` → 400.
6. NC por monto mayor a su saldo → 400/409, sin consumirla.
7. NC + efectivo + débito (3 medios) → asiento con 3 débitos, suma exacta.
8. Saldo a favor mayor al disponible → excepción del RPC, rollback completo,
   sin descontar saldo ni insertar pago.
9. Dos pagos concurrentes con el mismo saldo a favor → uno gana el `UPDATE`
   condicional, el otro falla; nunca saldo negativo.
10. Venta con total > 135 UF y pago mixto → **no se bloquea** (decisión §9.2).
    Solo muestra la advertencia (caso 17).
11. Venta de canal (`rappi`/`pedidosya`/`ubereats`) con `pagos` → rechazar mixto
    o ignorarlo, porque el cobro lo hace el canal.
12. Reintento con la misma `idempotencyKey` → devuelve la venta existente, no
    duplica pagos ni asientos.
13. Anulación de venta mixta → contra-asiento por cada cuenta, sin duplicar
    stock/fidelización/saldo (§23.5). El saldo a favor consumido como pago se
    reacredita (paso 6 de `anular_venta_tx`, migración 057).
14. Venta histórica con `metodo_pago='mixto'` y solo dos pagos (NC + resto) →
    reportes siguen funcionando.
15. Pago mixto en una cita → mismo contrato y mismas validaciones que la venta.
16. `montoBoleta` (§4.9): 100 % tarjeta da 0; débito + efectivo da solo el
    efectivo; efectivo + transferencia + NC da la suma de los tres; crédito +
    débito da 0. Es el mismo valor en modal, ticket y reporte de cierre.
17. Venta con total sobre el umbral configurado → el POS muestra la
    advertencia de identificación del comprador. No bloquea.

### 7.2 Pruebas por capa (§19.1)

**Backend (integración):**

- camino feliz de 2 y 3 medios, verificando filas de `pagos`, `ventas.metodo_pago`,
  asiento contable y totales;
- 401 sin sesión y 403 con rol insuficiente (si el endpoint lo exige);
- aislamiento de tenant: `venta_id`/`nota_credito_id` de otra tienda → 404/400,
  nunca datos ajenos;
- `store_id` malicioso en body → ignorado;
- suma inválida, montos inválidos, métodos inválidos, TRX faltante;
- idempotencia (doble POST con la misma key);
- anulación de venta mixta y su contra-asiento;
- NC consumida parcialmente y su efecto en `saldos_a_favor`;
- saldo a favor en el cobro inicial: descuento atómico, saldo insuficiente,
  dos requests concurrentes;
- cita con el mismo `pagos[]`: filas, `ventas.metodo_pago` y asiento de
  servicio.

**Frontend (componentes):**

- `ModalPago` renderiza con 0, 1 y N filas;
- agregar/quitar fila actualiza el resto en el mismo render;
- "Cobrar" deshabilitado con resto ≠ 0 o TRX faltante;
- el submit llama a `/api/ventas` con el body `pagos[]` correcto (URL, método,
  body), no solo que el botón exista;
- error de API (`ok:false`) se muestra en pantalla;
- el gate de rol (si aplica) es UX, no seguridad (§19.1).

**Contabilidad (unit):**

- `lineasVenta`/`lineasVentaCanal` con N pagos: suma de débitos = total,
  suma de créditos = total, neto + IVA = total;
- agrupación Caja/Banco correcta;
- `lineasVentaConNc` con NC + dos medios;
- anulación: cada cuenta revertida una vez.

**IDs:** no asignar hasta hacer el grep de las dos fuentes
(`docs/spec-registry.md` y `tests/`) que exige §2.3. Registrar los nuevos en el
mismo commit.

---

## 8. Plan de implementación sugerido

| Fase | Cambio | Riesgo | Test |
|---|---|---|---|
| F | `calcularMontoBoleta` + aviso "emitir boleta por $X" en modal y ticket + leyenda "no es documento tributario" + total a boletear en el cierre (§4.9). **Independiente del mixto; cierra el incumplimiento actual** | Bajo | unit + componentes |
| 0 | Semántica de `ventas.metodo_pago` con mixto (decidida: `'mixto'`) | Bajo | — |
| 1 | `VentaCreateSchema.pagos[]` + reglas Zod | Bajo | unit de schema |
| 2 | `crear_venta_tx` con `p_pagos` (validación de suma + inserts + saldo a favor) | Medio | integración RPC |
| 3 | Builders contables con N pagos | Medio | unit contabilidad |
| 4 | `anular-venta` con N pagos | Medio | integración anulación |
| 5 | `ModalPago` con filas | Medio | componentes |
| 6 | Reportes/dashboard con desglose | Bajo | integración reportes |
| 7 | Recibos: mostrar desglose | Bajo | integración recibo |
| 8 | Citas: mismo `pagos[]` + builders de servicio | Medio | integración citas |

Cada fase debe dejar `npm run build && npm test`, `typecheck` y `lint` en verde
(§2.4). Las migraciones se crean y se muestran; **aplicarlas requiere
confirmación explícita** (AGENTS.md §11.2).

No hay fase de backfill: no existen ventas reales (decisión §9.2).

---

## 9. Riesgos y decisiones

### 9.1 Riesgos

- **Fiscal (alto, preexistente):** la tienda no emite boleta por las ventas, o
  porciones de venta, pagadas en efectivo, por transferencia o con crédito
  interno. Es sancionable por el art. 97 N° 10 del Código Tributario (multa
  sobre el monto de la operación y posible clausura, §6.0). El pago mixto lo
  hace más frecuente. Mitigación: fase F (§8) **y** que la tienda emita esas
  boletas (sistema gratuito del SII o proveedor). El software solo puede
  avisar; emitir la boleta es responsabilidad del contribuyente.
- **Fiscal (bajo):** el código `<MedioPago>` cuando el saldo combina dos
  medios no electrónicos no está definido por el SII (§6.2). Mitigación:
  consulta escrita.
- **Contable (medio):** si la anulación no se corrige junto con el cobro, una
  venta mixta anulada deja un pago sin reversar. Es un bug real, no teórico.
- **Reportes (bajo):** `ventas.metodo_pago='mixto'` sin desglose oculta cuánto
  entró por Caja y cuánto por Banco. Afecta conciliación y cierre de caja.
- **Doble pago (bajo pero destructivo):** usar `/api/pagos` para completar una
  venta mixta después de `crear_venta_tx` duplicaría pagos, porque la venta ya
  nace `pagada`. Mitigación: no usar ese endpoint para ventas nuevas; el cobro
  mixto se resuelve en la creación.
- **Fraccionamiento (bajo):** no usar el pago mixto para partir una venta en
  varios documentos con el fin de quedar bajo el umbral de 135 UF. La Res.
  44/2025 lo prohíbe. Voucher por la parte con tarjeta + boleta por el saldo
  (§6.0) **no** es fraccionamiento: es lo que manda la Res. 176/2020.

### 9.2 Decisiones tomadas (2026-11-08)

1. **Sin vuelto.** `pagos.monto` es el monto aplicado a la venta. No se agrega
   columna de efectivo recibido ni de cambio. Si en el futuro se necesita
   arqueo de caja por billete, es una decisión nueva, no un requisito del pago
   mixto.
2. **`saldo_a_favor` permitido en el cobro inicial.** Origen del saldo: una
   NC con `tipo_reembolso='saldo_a_favor'` lo crea vía
   `incrementar_saldo_a_favor` dentro de `crear_nota_credito_tx`. Debe poder
   usarse como una fila más de `pagos[]`. Requiere `clienteId` y descuento
   atómico dentro del RPC (§4.1–4.2). El endpoint `/api/saldos-a-favor` sigue
   existiendo para pagos sobre ventas ya creadas, pero el POS no lo usa para
   el cobro inicial.
3. **`ventas.metodo_pago = 'mixto'`** cuando hay 2+ medios (o crédito interno
   + otro). La etiqueta es solo display; el desglose real vive en `pagos`.
4. **Citas se replican.** Mismo `pagos[]`, misma validación, mismos builders de
   asiento de servicio; extraer el bloque común a una función SQL interna
   (§4.8).
5. **135 UF no se bloquea.** No se implementa el control ahora. Como no habrá
   DTE (decisión 7), se recomienda como mínimo la advertencia configurable de
   §6.3. No se hardcodea el valor 2026.
6. **Sin backfill.** No hay ventas reales todavía (demo). Si aparecen datos
   históricos, los reportes los cubren con la opción A (§4.5).
7. **Sin DTE propio (2026-11-12).** Voucher Transbank para la parte con
   tarjeta. Boleta emitida fuera del sistema por el saldo (Res. 176/2020). El
   sistema calcula `montoBoleta` (§4.9).

### 9.3 Preguntas que siguen abiertas

1. **Modelo de emisión declarado en sii.cl.** Confirmar que la tienda tiene
   declarado "no emito boleta cuando recibo un pago electrónico". Todo §6.0
   depende de eso. Lo hace el contribuyente con su clave tributaria.
2. **Cómo emitirá la tienda las boletas del saldo** (sistema gratuito del SII,
   app e-Boleta, proveedor o POS Transbank con boleta). Es una decisión del
   negocio, no del software.
3. **¿Registrar en el sistema el folio de la boleta externa?** Por ejemplo, un
   campo opcional en la venta. Facilita la conciliación y la defensa ante una
   fiscalización, pero exige migración y UI. Pendiente de decisión.
4. **Código `<MedioPago>` cuando el saldo combina dos medios no electrónicos**
   (§6.2), e **identificación del pagador en una venta > 135 UF con voucher +
   boleta** (§6.3). Sin criterio oficial en las fuentes revisadas. Consultar
   por escrito al SII o al contador.
5. **Valor oficial 2026 del umbral de 135 UF.** El cálculo ($5.363.274,60) usa
   la UF al 31-dic-2025 ($39.727,96), pero no se encontró la resolución 2026
   que lo publique (la Res. 110/2026 no lo fija). Solo es relevante para la
   advertencia de §6.3.

---

## Anexo: fuentes

- SII, *Formato Boletas Electrónicas de Ventas y Servicios*, versión 4.2,
  2025-09-08 — campo `<MedioPago>`.
- SII, Resolución Exenta N° 44 del 07.04.2025 — umbral 135 UF, identificación
  del pagador, prohibición de fraccionamiento.
- SII, Resolución Exenta N° 176 del 31.12.2020 — voucher como sustituto de la
  boleta; resolutivo 2°: boleta por el saldo pagado sin tarjeta
  (`sii.cl/normativa_legislacion/resoluciones/2020/reso176.pdf`).
- SII, "Tu voucher es tu boleta" — modelos de emisión declarables
  (`sii.cl/destacados/boleta_electronica_voucher/`).
- SII, Resolución Exenta N° 110 del 27.08.2026 — revisada; no aplica (es una
  autorización a un contribuyente puntual).
- Código Tributario, art. 97 N° 10 — sanción por no otorgar boleta. Rango
  tomado de la jurisprudencia publicada por el SII
  (`sii.cl/pagina/jurisprudencia/judicial/2012/tta/jj3050.htm`).
- SII, sistema gratuito de boleta electrónica / app e-Boleta.
- SII, Circular N° 45/2024 — art. 92 ter (contexto).
- DL 825, art. 9 — devengo del IVA.
- SII, formato DTE — campo `<FmaPago>`.
- SII, valores UF 2025 y 2026 (`sii.cl/valores_y_fechas/uf/`).
- Código del repo citado en §2.
