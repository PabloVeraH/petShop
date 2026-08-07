# Plan: Valor monetario de un servicio (Fase 4 de "servicios agendables")

Este documento diseña que cada `servicio` tenga un precio, que la `cita`
creada contra ese servicio herede ese valor, que el valor se **cobre** al
completar la cita (con soporte de pago mixto y pago con nota de crédito), y
que ese cobro genere el asiento contable correspondiente y pueda revertirse
más adelante emitiendo una nota de crédito.

Es la continuación directa de `docs/plan_servicios.md` (Fase 1: catálogo de
servicios) y `docs/plan_sirvientes.md` (Fase 3: encargados). Ninguno de los
dos planes anteriores incluía un valor monetario — el precio de un servicio
es un concepto completamente nuevo en el dominio hasta este plan.

## 0. Nota de terminología — "cancelado" vs. "cancelada"

Usaste la palabra "cancelado" en el sentido de **pagado/saldado** ("el valor
... debe ser cancelado al finalizar el servicio" — uso estándar en Chile:
"cancelar una cuenta" = pagarla). Esto **no** tiene relación con
`citas.estado = 'cancelada'`, que ya existe en el dominio y significa "la
cita se anuló, el servicio no se prestó" (`cancelar_cita_tx`,
migración 066). Para evitar la colisión, en este plan y en el código
resultante:

- **Nunca** se usa la palabra "cancelar"/"cancelado" para referirse al pago.
- Se usa **"cobrar"/"pagar"/"completar con pago"** para el dinero, y
  **"cancelar"/"cancelada"** se reserva exclusivamente para el estado de
  cita anulada que ya existe.
- La nueva función SQL se llama `completar_cita_tx` (no
  `cancelar_cita_tx`, que ya existe y significa otra cosa).

Si en algún punto el código o la UI dicen "cancelar" refiriééndose a dinero,
es un bug de nomenclatura contra este plan.

## 1. Decisiones confirmadas contigo (2026-08-06)

| # | Pregunta | Decisión |
|---|----------|----------|
| 1 | ¿"Completar" exige el pago en el momento? | **Sí, bloqueante.** El botón "Completar" abre un flujo de pago; la cita solo pasa a `completada` si el pago se registra con éxito. |
| 2 | ¿El precio es editable al cobrar? | **No.** Precio fijo del servicio, tomado (snapshot) al **crear** la cita — mismo patrón que `duracion_minutos` hoy. Sin descuento manual en esta fase. |
| 3 | ¿Cómo se revierte un cobro ya hecho? | **Solo nota de crédito** contra la venta del servicio. La cita queda `completada` (el servicio sí se prestó); un flujo de "anular cita completada" que además revierta el estado queda **fuera de alcance**. |
| 4 | ¿El cobro suma a fidelización? | **Sí**, mismo tratamiento que una venta de producto (`total_historico`, `frecuencia_compras`, recálculo de nivel de descuento). |

## 2. Hallazgos verificados contra el código y la base real (no asumidos)

Antes de diseñar, verifiqué el estado real (lectura, sin escritura) porque
determina si se puede reutilizar la infraestructura de ventas o hay que
construir algo paralelo:

- **`venta_items.producto_id` es `NOT NULL REFERENCES productos(id)`**
  (`migrations/000_base_schema.sql`). Ningún item de venta hoy puede existir
  sin un producto real con stock/costo.
- **`nota_credito_items.producto_id` es `NOT NULL REFERENCES productos(id)`**
  (`migrations/006_notas_credito.sql`). Mismo acoplamiento duro para
  devoluciones.
- **`pagos.venta_id` es `NOT NULL REFERENCES ventas(id)`**
  (`migrations/008_pagos.sql`). **Todo** pago — incluido pagar con nota de
  crédito o con saldo a favor vía `gastar_saldo_a_favor_pago`
  (`migrations/051_atomic_saldos_a_favor.sql`, que hace
  `INSERT INTO pagos (..., venta_id, ...)`) — exige una venta existente.
  **Conclusión**: no existe manera de que una cita "se pague" sin que exista
  una fila en `ventas` — ni siquiera pagando con crédito existente. Esto no
  es una decisión de diseño, es una restricción real del schema actual.
- **`crear_venta_tx`** (`migrations/037_crear_venta_transaction.sql`) itera
  `p_items` asumiendo `producto_id`, descuenta stock (FIFO o legado),
  registra `stock_movements`, calcula `consumo_alertas` por mascota/alimento
  y COGS por `productos.costo`. Nada de eso aplica a un servicio (sin stock,
  sin lotes, sin costo de mercancía). **Extender esta función para que
  también entienda "líneas de servicio" agregaría ramas condicionales a una
  función ya compleja y con historial de bugs de concurrencia reparados en
  varias migraciones (037→059)** — alto riesgo para el flujo de ventas de
  productos, que no tiene nada que ver con este cambio.
- **`generador-asientos.ts`** es un conjunto de funciones puras
  (`lineasVenta`, `lineasVentaConNc`, `lineasNotaCredito`, ...) que arman
  líneas de asiento a partir de montos ya calculados — no conocen ni les
  importa si el origen es un producto o un servicio. **Son reutilizables sin
  cambios** para casi todo este plan, salvo una cuenta contable nueva (§5).
- **`servicios`** (migración 063) no tiene ninguna columna de precio hoy.
- **`citas`** (migración 066/067) no tiene ninguna columna de precio ni
  referencia a `ventas` hoy.
- Estado real de las tablas afectadas (verificado, no inferido):
  `servicios` 1 fila, `citas` 2 filas, ambas sin precio por construcción
  (la columna no existe todavía).

**Decisión de arquitectura que se desprende de estos hallazgos** (no es una
pregunta abierta — es la única opción viable dado que `pagos.venta_id` es
`NOT NULL`): el cobro de una cita **sí crea una fila en `ventas`** (con un
único `venta_item` que referencia el servicio), pero se hace con una función
SQL **nueva y separada** (`completar_cita_tx`), no extendiendo
`crear_venta_tx`. Esto da compatibilidad completa con reportes, recibos y
listados de ventas existentes (una cita pagada aparece en `/sales` como
cualquier venta) sin tocar una línea del flujo de venta de productos.

## 3. Modelo de datos

### 3a. `servicios.precio`

```sql
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS precio NUMERIC(10,2)
  CHECK (precio IS NULL OR precio > 0);
```

**Nullable a nivel de BD** (mismo patrón que `citas.encargado_id` en
plan_sirvientes.md §2): la única fila existente hoy no tiene precio y no hay
forma de inventarle uno con criterio de negocio real. La obligatoriedad se
aplica en la capa de aplicación: `ServicioCreateSchema` exige `precio` para
servicios **nuevos**; `ServicioUpdateSchema` lo acepta opcional para poder
completar el precio de servicios existentes. `crear_cita_tx` (§3c) valida
`precio IS NOT NULL` al crear una cita nueva — un servicio sin precio
configurado no se puede agendar. Precio bruto (IVA incluido), como todos los
precios del sistema (AGENTS.md §0.8).

### 3b. `citas.precio` y `citas.venta_id`

```sql
ALTER TABLE citas ADD COLUMN IF NOT EXISTS precio NUMERIC(10,2);
ALTER TABLE citas ADD COLUMN IF NOT EXISTS venta_id UUID REFERENCES ventas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_citas_venta_id ON citas(venta_id);
```

`precio` se copia desde `servicios.precio` **al crear la cita**
(`crear_cita_tx`), igual que `duracion_minutos` — no se recalcula si el
precio del servicio cambia después (decisión §1.2). Las 2 citas existentes
quedan con `precio = NULL` ("citas legado", ver §3d). `venta_id` queda NULL
hasta que la cita se completa con pago; `ON DELETE SET NULL` (no
`RESTRICT`) porque anular una venta no debe impedirse por tener una cita
apuntándola — ver §23.5 de AGENTS.md, `anular_venta_tx` ya existe y no sabe
nada de citas; este plan no lo modifica (§9, fuera de alcance).

### 3c. `crear_cita_tx` — cambio mínimo

Un solo agregado: validar y copiar el precio.

```sql
-- Después de validar que el servicio existe y está activo:
IF v_precio IS NULL THEN
  RAISE EXCEPTION 'El servicio no tiene precio configurado' USING ERRCODE = 'P0002';
END IF;
-- ... y agregar v_precio a la lista de columnas del INSERT INTO citas (..., precio)
```

`v_precio` se obtiene del mismo `SELECT ... FROM servicios WHERE id =
p_servicio_id ...` que ya trae `duracion_minutos` — no es una consulta
nueva, es una columna más del mismo `SELECT INTO`.

### 3d. `completar_cita_tx` — función nueva

Reemplaza, **solo para la rama de pago**, la lógica que hoy vive en JS en
`PATCH /api/citas/[id]` (`estado = 'confirmada' → 'completada'` con guarda
de carrera). Espejo deliberado de dos funciones ya existentes para reusar
patrones probados, no inventar nuevos:

- El **reclamo atómico del estado** es igual a `cancelar_cita_tx`
  (migración 066) y al patrón de `anular_venta_tx` (AGENTS.md §23.5): el
  `UPDATE ... WHERE estado = 'confirmada'` es la **primera** operación de la
  función. Si 0 filas se afectan, aborta antes de tocar cualquier otra
  tabla — dos clics simultáneos en "Completar y cobrar" no pueden generar
  dos ventas para la misma cita.
- La **creación de venta + pago(s) + fidelización** es un subconjunto
  deliberadamente reducido de `crear_venta_tx` (migración 037): mismo
  soporte de pago mixto con nota de crédito (`p_pago_nc`), mismo cálculo de
  nivel de fidelización — pero **sin** iterar items de producto, sin stock,
  sin lotes, sin `consumo_alertas`, sin COGS (un servicio no tiene costo de
  mercancía en este modelo).

```sql
CREATE OR REPLACE FUNCTION completar_cita_tx(
  p_cita_id              UUID,
  p_store_id             UUID,
  p_metodo_pago          TEXT,     -- método del "resto" si hay NC mixta, o el único método
  p_numero_transaccion   TEXT,
  p_pago_nc              JSONB,    -- {nota_credito_id, monto, numero_nc} | null
  p_fidelizacion_niveles JSONB,
  p_completado_por       TEXT      -- clerk user id
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cita RECORD;
  v_venta RECORD;
  v_numero_comprobante TEXT;
  v_subtotal NUMERIC;
  v_iva NUMERIC;
  v_metodo_pago_final TEXT;
  v_monto_nc NUMERIC;
  v_monto_resto NUMERIC;
  -- ...variables de fidelización, iguales a crear_venta_tx §5
BEGIN
  -- 1. Reclamo atómico: primera y única operación que puede completar esta
  --    cita. Trae store_id, cliente_id, servicio_id, precio en el mismo UPDATE.
  UPDATE citas
     SET estado = 'completada'
   WHERE id = p_cita_id AND store_id = p_store_id AND estado = 'confirmada'
  RETURNING * INTO v_cita;

  IF NOT FOUND THEN
    -- Distinguir "no encontrada" de "ya no completable" (mismo patrón que
    -- cancelar_cita_tx) sin haber mutado nada.
    ...
  END IF;

  IF v_cita.precio IS NULL THEN
    RAISE EXCEPTION 'Esta cita no tiene un precio asociado (creada antes de esta funcionalidad) — complétala sin cobro' USING ERRCODE = 'PS005';
  END IF;

  -- 2. Crear venta (un único venta_item, servicio_id en vez de producto_id — §3e)
  v_subtotal := v_cita.precio;  -- sin descuento manual, decisión §1.2
  v_iva := extraer_iva_pg(v_subtotal); -- ver nota abajo sobre dónde vive esta fórmula

  INSERT INTO ventas (store_id, cliente_id, subtotal, impuesto, descuento, total, metodo_pago, canal, procedencia, estado, numero_comprobante)
  VALUES (p_store_id, v_cita.cliente_id, v_subtotal, v_iva, 0, v_subtotal, v_metodo_pago_final, 'pos', 'presencial', 'pagada', v_numero_comprobante)
  RETURNING * INTO v_venta;

  INSERT INTO venta_items (venta_id, servicio_id, mascota_id, cantidad, precio_unitario, subtotal)
  VALUES (v_venta.id, v_cita.servicio_id, v_cita.mascota_id, 1, v_cita.precio, v_cita.precio);

  -- 3. Pago(s) — mismo patrón que crear_venta_tx paso 4 (NC total/mixta o método único)
  -- 4. Fidelización — mismo patrón que crear_venta_tx paso 5, idéntico cálculo de nivel
  -- 5. UPDATE citas SET venta_id = v_venta.id WHERE id = p_cita_id

  RETURN jsonb_build_object('cita', to_jsonb(v_cita) || jsonb_build_object('venta_id', v_venta.id), 'venta', to_jsonb(v_venta));
END;
$$;
```

**Nota importante — dónde vive `extraerIva`**: hoy `extraerIva()`/
`netoDesdeBruto()` viven **solo en TypeScript** (`src/lib/tax.ts`), no en
SQL — `crear_venta_tx` recibe `p_impuesto` ya calculado desde la ruta API,
no lo calcula la función. **Este plan sigue el mismo patrón**: el cálculo de
IVA se hace en `PATCH /api/citas/[id]` con `extraerIva()` (igual que
`postVenta()` hoy) y se pasa a `completar_cita_tx` como parámetro
(`p_impuesto`), **no** se reimplementa la fórmula en PL/pgSQL. El
pseudocódigo de arriba simplifica esto para legibilidad — la firma real
recibe `p_impuesto NUMERIC` en vez de calcularlo internamente. Ver AGENTS.md
§23.3: no duplicar la fórmula de IVA en ningún call site nuevo.

Errores nuevos: `PS005` (cita legado sin precio, ver §3g) — se suma a
`PS001`-`PS004` ya existentes.

Código de error `P0002` reutilizado para "cita no encontrada" y para
validaciones de NC (mismo patrón que `crear_venta_tx`/rutas existentes:
esas validaciones de NC — existe, activa, no vencida, monto no excede el
total — se hacen **en la ruta API antes de invocar el RPC**, igual que
`postVenta()` hoy, no dentro de la función).

### 3e. `venta_items` y `nota_credito_items` — soporte de línea de servicio

```sql
ALTER TABLE venta_items ALTER COLUMN producto_id DROP NOT NULL;
ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS servicio_id UUID REFERENCES servicios(id);
ALTER TABLE venta_items ADD CONSTRAINT venta_items_producto_xor_servicio
  CHECK ((producto_id IS NOT NULL) <> (servicio_id IS NOT NULL));

ALTER TABLE nota_credito_items ALTER COLUMN producto_id DROP NOT NULL;
ALTER TABLE nota_credito_items ADD COLUMN IF NOT EXISTS servicio_id UUID REFERENCES servicios(id);
ALTER TABLE nota_credito_items ADD CONSTRAINT nc_items_producto_xor_servicio
  CHECK ((producto_id IS NOT NULL) <> (servicio_id IS NOT NULL));
```

`<>` entre dos expresiones `IS NOT NULL` (booleanas) es XOR: exactamente uno
de los dos debe estar presente, nunca ambos, nunca ninguno. Esto es
**aditivo y retrocompatible** — las filas existentes ya tienen
`producto_id` poblado, siguen cumpliendo el CHECK sin tocarlas.

### 3f. `crear_nota_credito_tx` — cambios para poder devolver un servicio

Migración 061 (ya aplicada). Tres cambios puntuales, no un rediseño:

1. El `SELECT` que trae los datos del item de venta (`v_venta_item`) agrega
   `vi.servicio_id` a las columnas leídas (hoy solo trae `vi.producto_id`,
   `vi.precio_unitario`, `vi.cantidad`, `p.costo` vía `LEFT JOIN
   productos`). El `LEFT JOIN` ya es seguro con `producto_id NULL` — no
   necesita cambiar, `p.costo` naturalmente sale `NULL` → `COALESCE(...,
   0)` ya existente lo deja en 0 para líneas de servicio.
2. El bloque de restitución de stock (`IF v_restituir THEN ... lotes o
   increment_stock ... END IF`) se guarda además con
   `AND v_venta_item.producto_id IS NOT NULL` — un servicio no tiene stock
   que restituir, sin importar el valor de `restituir_stock` que envíe el
   cliente (defensa en profundidad, no confiar en el flag para decidir si
   hay stock que tocar).
3. El `INSERT INTO nota_credito_items (...)` agrega `servicio_id` a la
   lista de columnas, tomado del mismo `v_venta_item.servicio_id`.

**Nada más cambia** en esta función: el cálculo de precio con descuento
proporcional, el `INSERT INTO notas_credito`, el incremento de
`saldo_a_favor` y la actualización de fidelización son agnósticos de
producto vs. servicio — ya operan sobre montos, no sobre el tipo de item.

### 3g. Citas "legado" (creadas antes de esta migración)

Las 2 citas existentes quedan con `precio = NULL`. `completar_cita_tx`
rechaza completarlas con pago (`PS005`, §3d). **Decisión de diseño**: la
ruta API (§4) detecta `precio IS NULL` **antes** de llamar al RPC nuevo y
usa el camino **legado** — el `UPDATE` simple con guarda de estado que ya
existe hoy en `PATCH /api/citas/[id]`, sin venta ni pago. Esto es
intencional: no fuerza a completar/eliminar datos de prueba para poder
aplicar esta migración, y no inventa un precio retroactivo para citas que
nunca lo tuvieron.

### 3h. Migración — `migrations/068_valor_servicio.sql`

Contiene 3a + 3b + 3c (`CREATE OR REPLACE crear_cita_tx`, misma nota de
`DROP FUNCTION` explícito antes del `REPLACE` que en 067, porque la firma
no cambia esta vez — solo agrega columnas internas, no parámetros, así que
**no** hace falta `DROP FUNCTION` aquí, a diferencia de 067) + 3d (`CREATE
OR REPLACE completar_cita_tx`, función nueva) + 3e + 3f (`CREATE OR REPLACE
crear_nota_credito_tx`) + `GRANT EXECUTE ... TO service_role` / `REVOKE ...
FROM PUBLIC, anon, authenticated` para `completar_cita_tx` (mismo motivo
que 066/067 — Supabase otorga EXECUTE a anon/authenticated en funciones
nuevas). **No aplicar sin tu confirmación explícita** (AGENTS.md §11.2).

## 4. Contrato de API

### Servicios (extendido)

- **`POST /api/servicios`** — `ServicioCreateSchema` gana `precio:
  z.number().positive()` obligatorio.
- **`PATCH /api/servicios/[id]`** — `ServicioUpdateSchema` gana `precio:
  z.number().positive().optional()`.
- **`GET /api/servicios`** / **`GET /api/servicios/[id]`** — el `.select()`
  ya usa `*`, así que `precio` aparece automáticamente; no hay cambio de
  código, solo de dato.

### Citas (extendido)

- **`GET /api/citas`** / **`GET /api/citas/[id]`** — igual que arriba,
  `precio` y `venta_id` aparecen solos vía `.select("*")`.
- **`PATCH /api/citas/[id]`**, acción `"completar"` — cambia de "UPDATE
  simple" a una rama condicional:
  1. `SELECT precio, estado FROM citas WHERE id = ... AND store_id = ...`
     (ya existe hoy para el guard 404/409 — se reutiliza, solo se agrega
     `precio` a las columnas leídas).
  2. Si `precio IS NULL` → camino **legado**, sin cambios (§3g).
  3. Si `precio IS NOT NULL` → validar el body extendido
     (`CompletarConPagoSchema`, §6), pre-validar la NC igual que
     `postVenta()` hoy (existe / activa / no vencida / monto ≤ total,
     mismo bloque de código, mismo lugar en el flujo — antes del RPC),
     calcular `impuesto = extraerIva(cita.precio)` en JS, llamar
     `completar_cita_tx` vía RPC, mapear `PS005`→400 (caso legado con
     precio nulo — no debería ocurrir si el paso 2 filtró bien, pero
     defensa en profundidad) y los códigos de error de NC igual que
     ventas.
  4. Tras respuesta exitosa: `crearAsiento()` fire-and-forget (mismo patrón
     que `postVenta()`, no bloquea la respuesta al usuario) con la nueva
     cuenta `VENTAS_SERVICIOS` (§5).
- Acciones `"cancelar"` y `"no_show"` — **sin cambios**. Completar el
  requisito de pago no aplica a una cita que nunca se prestó.

### Notas de crédito (extendido)

- **`POST /api/notas-credito`** — debe poder emitir una NC contra un
  `venta_item` de tipo servicio. Requiere: el `SELECT` que arma el detalle
  de items a devolver agrega un join a `servicios(nombre)` junto al join
  existente a `productos(nombre)` (mismo patrón que `GET /api/citas` ya
  usa para joins opcionales — uno de los dos siempre será `NULL`); el body
  que llega del cliente (`venta_item_id`, `cantidad_devuelta`,
  `restituir_stock`) no cambia de forma — `restituir_stock` para una línea
  de servicio se ignora en el RPC (§3f punto 2), así que no hace falta que
  el frontend sepa distinguir el caso al armar el request. **Este endpoint
  requiere revisión línea por línea al implementar** — no fue auditado
  completo en este plan, a diferencia de `crear_nota_credito_tx` (§3f).

## 5. Contabilidad

### 5a. Cuenta nueva

```ts
// src/lib/contabilidad/types.ts — agregar a CUENTAS
VENTAS_SERVICIOS: { codigo: '410103', nombre: 'Venta de Servicios', tipo: 'INGRESO' as TipoCuenta },
```

`410102` ya está tomado por `DEVOLUCIONES` — se usa `410103`, siguiente
código libre en la serie de ingresos. Separar "Venta de Productos" de
"Venta de Servicios" en el plan de cuentas es lo correcto contablemente
(dos líneas de negocio distintas en el Estado de Resultado) y es gratis:
ningún reporte existente asume que `CUENTAS.VENTAS` es la única cuenta de
tipo `INGRESO` — ya conviven con `DEVOLUCIONES` del mismo tipo.

### 5b. Builders nuevos en `generador-asientos.ts`

Dos funciones nuevas, mismo patrón exacto que `lineasVenta`/
`lineasVentaConNc` pero acreditando `VENTAS_SERVICIOS` en vez de `VENTAS`:

```ts
export function lineasVentaServicio(params: {
  metodoPago: string; montoNeto: number; iva: number; total: number;
}): LineaAsiento[] { /* Dr Caja|Banco, Cr IVA_PAGAR, Cr VENTAS_SERVICIOS */ }

export function lineasVentaServicioConNc(params: {
  montoNeto: number; iva: number; total: number;
  montoNc: number; montoResto: number; metodoPagoResto?: string;
}): LineaAsiento[] { /* Dr SaldosFavor (+ Dr Caja|Banco si hay resto), Cr IVA_PAGAR, Cr VENTAS_SERVICIOS */ }
```

### 5c. Reversión (nota de crédito de un servicio) — sin builder nuevo

`lineasNotaCredito()` (ya existe, `generador-asientos.ts`) es agnóstica del
tipo de item: debita `DEVOLUCIONES`, reversa IVA, acredita
Caja/Banco/SaldosFavor según corresponda — **funciona sin cambios** para
devolver un servicio. `lineasNotaCreditoCOGS()` simplemente no se invoca
para una NC 100% de servicio, porque `costoTotal` sale en 0 (§3f punto 1) —
el `if (costoTotal > 0)` que ya existe en `POST /api/notas-credito` filtra
esto solo, sin cambios de código ahí tampoco (pendiente de confirmar al
implementar, ver §4).

### 5d. `tipoMovimiento`

Se reutiliza `'VENTA'` para el asiento de cobro de cita y `'NOTA_CREDITO'`
para su reversión — son los mismos tipos de movimiento que ya existen
(`src/lib/contabilidad/types.ts`), no hace falta agregar uno nuevo al
`TipoMovimiento` union. `referenciaId` = `venta.id` (misma convención que
ventas de producto), lo que significa que **el Libro Diario, el Balance de
Prueba y el Estado de Resultado ya incluyen automáticamente estos asientos
sin ningún cambio en `/api/contabilidad/**`** — son consultas agregadas
sobre `journal_entries`/`journal_detail` que no filtran por origen.

## 6. Validación con Zod

`src/lib/validation/servicios.ts`:

```ts
export const ServicioCreateSchema = z.object({
  // ...campos existentes...
  precio: z.number().positive("El precio debe ser mayor a 0"),
});

export const ServicioUpdateSchema = z.object({
  // ...campos existentes...
  precio: z.number().positive("El precio debe ser mayor a 0").optional(),
});
```

`src/lib/validation/citas.ts` — extender la rama `"completar"` de
`CitaAccionSchema`. Mismo patrón de `superRefine` que `VentaCreateSchema`
para exigir `numeroTransaccion` en débito/crédito/transferencia:

```ts
export const CitaAccionSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("cancelar"), motivo: z.string().min(5).max(500) }),
  z.object({
    accion: z.literal("completar"),
    metodoPago: z.enum(["efectivo", "debito", "credito", "transferencia"]).optional(),
    numeroTransaccion: z.string().optional(),
    pagoNc: z.object({
      nota_credito_id: UUIDSchema,
      numero_nc: z.string(),
      monto: z.number().positive(),
    }).optional(),
  }).superRefine((val, ctx) => {
    if (["debito", "credito", "transferencia"].includes(val.metodoPago ?? "") && !val.numeroTransaccion?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Número de transacción obligatorio", path: ["numeroTransaccion"] });
    }
  }),
  z.object({ accion: z.literal("no_show") }),
]);
```

`metodoPago`/`numeroTransaccion`/`pagoNc` quedan **opcionales a nivel de
schema** porque la acción `"completar"` sigue sirviendo para citas legado
sin precio (§3g), donde no se envía nada de esto. La ruta API (§4) decide
si son obligatorios **en runtime** según si la cita tiene `precio` — Zod
valida forma, no la regla de negocio condicional al registro consultado
(mismo principio que ya aplica en otros endpoints de este proyecto: Zod en
el límite de confianza, reglas de negocio dependientes de estado en la
ruta).

## 7. Tipos TypeScript

```ts
// src/types/index.ts
export interface Servicio {
  // ...campos existentes...
  precio: number | null;
}

export interface Cita {
  // ...campos existentes...
  precio: number | null;
  venta_id?: string | null;
  venta?: Pick<Venta, "numero_comprobante" | "total">; // si se agrega el join en GET
}
```

Si existe un tipo `VentaItem`/`NotaCreditoItem` en `src/types/index.ts`
(confirmar al implementar — no verificado en este plan si están tipados
aparte o inline), ambos ganan `servicio_id?: string | null` y
`producto_id` pasa a `string | null` (antes seguramente `string`
obligatorio).

## 8. UI

### 8a. `ServiciosTab.tsx` — campo de precio

Nuevo input de precio en el formulario de crear/editar (junto a
`duracion_minutos`), formateado como moneda. **Confirmar al implementar**
cuál es el patrón de formato de moneda ya usado en el proyecto (ej.
`ProductoCreateForm`, `ModalPago`) para no inventar uno nuevo — no fue
inspeccionado en este plan. Listado de servicios muestra el precio junto a
la duración; "Sin precio" si es `null`.

### 8b. `NuevaCitaForm.tsx` — precio informativo

Al seleccionar un servicio, mostrar su precio como texto informativo
(no editable, decisión §1.2) junto a la duración ya mostrada en el
`<option>` (`"Peluquería (60 min)"` → `"Peluquería (60 min) — $15.000"`, o
un texto aparte bajo el selector). Si el servicio no tiene precio, deshabilitar
su selección o mostrar una advertencia — a definir con detalle al
implementar; `crear_cita_tx` de todas formas lo bloquea server-side (§3c),
esto es solo UX preventiva.

### 8c. `CitasTab.tsx` — precio en el listado y flujo de cobro

- Mostrar `c.precio` formateado en la fila de cada cita (o "Sin valor" para
  citas legado).
- El botón "Completar" (hoy dispara `accion({accion:"completar"})`
  directo) cambia de comportamiento:
  - Si `c.precio === null` → comportamiento actual sin cambios.
  - Si `c.precio !== null` → abre un modal de cobro nuevo
    (`ModalCobroCita.tsx`), con su **propio estado local** para
    `metodoPago`/`pagoNc`/`numeroTransaccion`/`ncCodigo`/`ncValidado` (sin
    tocar `usePOSStore()` ni el store del carrito) y su propia función
    `validarNc()` contra `GET /api/notas-credito?numero_nc=...` (mismo
    endpoint que ya usa `ModalPago.tsx`, sin cambios ahí).

**Decisión (2026-08-06): duplicar, no extraer un componente compartido.**
Verificado leyendo `ModalPago.tsx` completo antes de decidir: el selector
de método de pago + NC ahí **no es un componente aislado** — está atado
directamente al store Zustand del POS (`metodoPago`, `pagoNc`,
`numeroTransaccion` son campos de `usePOSStore()`, no estado local), y ese
mismo archivo tiene un bug histórico ya reparado (ticket
`6a619fafd0aa9aa5ad06b1dd`) sobre fuga de estado de NC entre aperturas del
modal, con un `useEffect` de "reset a neutro" puesto ahí específicamente
para no repetirlo. Extraer un componente compartido hoy implicaría: (a)
convertir esa lógica de "atada al store" a "componente controlado" —un
refactor real de `ModalPago.tsx`, no un lift-and-shift—, (b) re-verificar
sus tests existentes contra el nuevo árbol de render, y (c) asumir ese
riesgo sobre la pantalla de mayor tráfico y mayor costo de bug de todo el
sistema (el cobro del POS), por una funcionalidad (cobro de citas) que
todavía no existe. Lo genuinamente compartible es acotado — la fila de
botones de método + el panel de código NC + el input de N° de transacción
(~100-120 líneas) — mientras que el resto de `ModalPago.tsx` (vendedor,
procedencia, descuento, notas internas, email) no aplica a una cita según
las decisiones de §1. Construir ambos flujos por separado primero y
extraer después, si el patrón resulta ser realmente idéntico una vez que
existen dos usos reales y estables, evita diseñar la abstracción a ciegas
— exactamente el riesgo que YAGNI busca evitar.

`ModalCobroCita.tsx` reutiliza sin cambios: `extraerIva()`/`tax.ts`,
`Button`/`Dialog` (componentes UI ya compartidos), y el mismo formato de
método de pago (`efectivo`/`debito`/`credito`/`transferencia`) — no
duplica esos, solo la fila de botones + panel NC + input de transacción,
acotado a lo que el cobro de cita necesita (sin vendedor, procedencia,
descuento manual ni email — fuera de alcance por §1/§12).

  - Al confirmar el pago: `PATCH /api/citas/[id]` con
    `{accion: "completar", metodoPago, numeroTransaccion?, pagoNc?}`;
    invalida `["citas"]` en éxito.

## 9. Permisos y auditoría

| Acción | Quién | Auditoría |
|--------|-------|-----------|
| Editar precio de un servicio | `storeAdmin` / `systemAdmin` (mismo gate que el resto del CRUD de servicios) | `logAudit` ya existente en `PATCH /api/servicios/[id]`, sin cambios de política |
| Completar y cobrar una cita | Cualquier staff autenticado de la tienda (decisión heredada de plan_servicios.md §9a — completar una cita no requiere admin, igual que registrar una venta en el POS) | `logAudit` fire-and-forget con `entityType: "cita"`, incluir `venta_id`/monto/método en `newValues` — nunca datos de tarjeta (esta app no los recibe ni los guarda) |
| Emitir NC de un servicio | Igual que NC de producto hoy (confirmar el gate real de `POST /api/notas-credito` al implementar — no fue re-verificado en este plan) | Ya cubierto por la auditoría existente de notas de crédito |

## 10. Desglose de tareas — orden de implementación

1. Migración `068_valor_servicio.sql` (3a+3b+3c+3d+3e+3f) — **requiere tu
   autorización explícita para aplicar**, igual que 066/067.
2. Tipos TypeScript (`Servicio.precio`, `Cita.precio`/`venta_id`,
   ajuste de `VentaItem`/`NotaCreditoItem` si están tipados).
3. Zod: `ServicioCreateSchema`/`UpdateSchema` (precio), `CitaAccionSchema`
   (rama `completar` extendida).
4. `generador-asientos.ts`: `VENTAS_SERVICIOS` en `CUENTAS`,
   `lineasVentaServicio`, `lineasVentaServicioConNc`.
5. API: `POST/PATCH /api/servicios[/[id]]` (precio).
6. API: `PATCH /api/citas/[id]` acción `completar` — rama legado vs. rama
   con pago, pre-validación de NC, llamada a `completar_cita_tx`,
   `crearAsiento` fire-and-forget.
7. API: `POST /api/notas-credito` — soporte de línea de servicio (§4,
   pendiente de auditoría línea por línea al implementar).
8. **Actualizar tests existentes** que construyen citas/servicios sin
   precio y asumen el `PATCH .../completar` legado — grep
   `tests/integration/api/citas.test.ts` y
   `tests/integration/api/servicios*.test.ts` antes de dar la tarea por
   completa (gate §2.2 de AGENTS.md).
9. UI: `ServiciosTab.tsx` (campo precio), `NuevaCitaForm.tsx` (precio
   informativo), `CitasTab.tsx` (precio en listado + `ModalCobroCita.tsx`
   nuevo).
10. Tests nuevos (§11).
11. `graphify update .`.

## 11. Plan de pruebas — IDs propuestos

**Re-grepear `docs/spec-registry.md` y `tests/` antes de asignar
definitivamente** (AGENTS.md §2.3). Verificado en este plan: próximo
`I-SRV` libre es 30, próximo `U-SRV` libre es 16, prefijos `I-COB`/`U-COB`
(dominio nuevo: cobro de citas) no usados todavía.

### Integración — extender `tests/integration/api/servicios.test.ts`

| ID | Caso |
|----|------|
| I-SRV-30 | POST servicio sin precio → 400 (ahora obligatorio) |
| I-SRV-31 | POST servicio con precio negativo o cero → 400 |
| I-SRV-32 | PATCH agrega precio a un servicio existente sin precio → 200 |

### Integración — extender `tests/integration/api/citas.test.ts`

| ID | Caso |
|----|------|
| I-CITA-57 | POST cita contra servicio sin precio → 400/404 (P0002) |
| I-CITA-58 | POST cita contra servicio con precio → la cita creada incluye `precio` igual al del servicio |

### Integración — `tests/integration/api/citas-cobro.test.ts` (nuevo)

| ID | Caso |
|----|------|
| I-COB-01 | PATCH completar sobre cita con precio, método efectivo → 200, crea venta+pago+venta_item con servicio_id |
| I-COB-02 | PATCH completar sobre cita legado (precio NULL) → comportamiento actual, sin venta creada |
| I-COB-03 | PATCH completar con débito/crédito/transferencia sin numeroTransaccion → 400 |
| I-COB-04 | PATCH completar con pagoNc que cubre el total → venta con metodo_pago='nota_credito', NC marcada 'usada' |
| I-COB-05 | PATCH completar con pagoNc parcial → pago mixto, resto cobrado por el método indicado |
| I-COB-06 | PATCH completar con NC inexistente/ajena/inactiva/vencida → 404/409/410 (mismos códigos que ventas) |
| I-COB-07 | Dos PATCH completar concurrentes sobre la misma cita → solo uno crea venta (reclamo atómico) |
| I-COB-08 | PATCH completar actualiza fidelización del cliente igual que una venta |
| I-COB-09 | PATCH completar sobre cita ya completada → 409 |
| I-COB-10 | PATCH completar sobre cita de otra tienda → 404 |
| I-COB-11 | Asiento contable generado usa cuenta `VENTAS_SERVICIOS` (410103), no `VENTAS` (410101) |

### Integración — extender `tests/integration/api/notas-credito.test.ts`

| ID | Caso |
|----|------|
| I-NC-XX | NC contra un venta_item de servicio → no intenta restituir stock, `costoTotal` calculado en 0, asiento sin línea COGS (asignar ID real al implementar, revisar rango I-NC existente) |

### Unit — agregar a `tests/unit/lib/validation.test.ts`

| ID | Caso |
|----|------|
| U-SRV-16 | `ServicioCreateSchema`: sin precio → fail |
| U-SRV-17 | `ServicioCreateSchema`: precio ≤ 0 → fail |
| U-SRV-18 | `ServicioUpdateSchema`: precio opcional, `{}` sigue pasando |
| U-COB-01 | `CitaAccionSchema` completar: sin metodoPago/numeroTransaccion → pasa (rama legado válida a nivel de schema) |
| U-COB-02 | `CitaAccionSchema` completar: metodoPago débito sin numeroTransaccion → fail |
| U-COB-03 | `CitaAccionSchema` completar: pagoNc con monto negativo → fail |

### Unit — `generador-asientos.ts`

| ID | Caso |
|----|------|
| U-CTB-XX | `lineasVentaServicio`/`lineasVentaServicioConNc`: balanceado (Σdébito = Σcrédito), cuenta de ingreso correcta (asignar ID real al implementar) |

## 12. Fuera de alcance (explícitamente diferido)

- **Anular una cita ya completada y pagada** revirtiendo también el estado
  de la cita (no solo el dinero vía NC) — decisión §1.3.
- **Descuento manual al cobrar** — precio siempre fijo, decisión §1.2.
- **Cobro no bloqueante** (completar sin pagar, cobrar después) — decisión
  §1.1.
- **Precio distinto por encargado** para el mismo servicio — el precio es
  del servicio, no del encargado que lo presta.
- **Recargo por cancelación o no-show** — una cita cancelada o marcada
  no-show no genera ningún cobro ni asiento en esta fase.
- **Múltiples servicios en una misma cita/cobro** — sigue siendo una cita =
  un servicio (sin cambios respecto a Fase 2/3).
- **Recibo por WhatsApp/email para el cobro de una cita** — la
  infraestructura (`sendWhatsAppText`, `sendBoletaEmail`) ya existe y
  quedaría trivial de conectar después, pero no se construye en esta fase
  (YAGNI — no fue pedido).
- **Reporte específico de "ventas de servicios"** separado del reporte de
  ventas general — al usar la misma tabla `ventas`/`pagos`, los reportes
  existentes (`/api/reports`, Libro Diario, Balance de Prueba, Estado de
  Resultado) ya incluyen estos montos automáticamente sin cambio de código
  (§5d); una vista/filtro específico "solo servicios" es una extensión
  futura, no parte de esta fase.
- **Backfill de precio en las citas legado** (2 filas existentes) — quedan
  con `precio = NULL` permanentemente salvo que pidas explícitamente
  asignarles un valor retroactivo.

## 13. Verificación de este documento

- Leídos íntegramente y usados como plantilla real (no asumidos):
  `migrations/000_base_schema.sql` (schema de `ventas`/`venta_items`/
  `pagos`), `migrations/006_notas_credito.sql` (schema de
  `notas_credito`/`nota_credito_items`/`saldos_a_favor`),
  `migrations/037_crear_venta_transaction.sql` (`crear_venta_tx` completa),
  `migrations/051_atomic_saldos_a_favor.sql`
  (`gastar_saldo_a_favor_pago`), `migrations/061_crear_nota_credito_tx.sql`
  (ya leída íntegra en sesión previa, releída para este plan),
  `migrations/063_servicios.sql`, `migrations/066_citas.sql`,
  `src/lib/contabilidad/generador-asientos.ts` (todos los builders
  existentes), `src/lib/contabilidad/types.ts` (`CUENTAS` completo),
  `src/app/api/ventas/route.ts` (`postVenta` completo — patrón de cálculo
  de IVA en JS, pre-validación de NC, `crearAsiento` fire-and-forget),
  `src/app/api/citas/[id]/route.ts` (`PATCH` completo, las 3 acciones),
  `src/lib/validation/ventas.ts` (`VentaCreateSchema`/`PagoSchema`).
- Verificado contra la base real (solo lectura): próxima migración libre es
  068; `servicios` tiene 1 fila, `citas` tiene 2 filas, ninguna con precio
  porque la columna no existe todavía; próximos IDs de test libres I-SRV-30,
  U-SRV-16, prefijos I-COB/U-COB sin usar.
- Confirmado que `pagos.venta_id` y `venta_items.producto_id` y
  `nota_credito_items.producto_id` son `NOT NULL` hoy — es la restricción
  real que determina que el cobro de una cita necesariamente crea una
  venta, y que `venta_items`/`nota_credito_items` necesitan la columna
  `servicio_id` nullable para soportar líneas de servicio.
- Leído íntegramente para la decisión de §8c: `ModalPago.tsx`
  (`src/app/(app)/pos/components/`) — confirmado que su selector de método
  de pago + NC está atado a `usePOSStore()` (Zustand), no es estado local
  ni un componente aislado; confirmado el bug histórico de fuga de estado
  de NC (ticket `6a619fafd0aa9aa5ad06b1dd`) que motiva no tocar ese archivo
  para una funcionalidad tangencial.
- Pendiente de verificar al implementar (declarado explícitamente, no
  asumido como resuelto): patrón exacto de formato de moneda ya usado en
  el proyecto para el nuevo input de precio (§8a); contenido línea por
  línea de `POST /api/notas-credito` más allá de lo ya confirmado sobre
  `crear_nota_credito_tx` (§4); gate de permisos exacto de
  `POST /api/notas-credito` (§9).

## 14. Estado final

**Plan completo, no implementado.** Ningún archivo de código fue creado ni
modificado — solo este documento. Requiere tu revisión de §2 (los
hallazgos que fuerzan la arquitectura elegida — en particular que
`pagos.venta_id` es `NOT NULL` y por lo tanto cualquier diseño necesita
crear una venta) y de las decisiones ya confirmadas en §1, para verificar
que quedaron bien reflejadas, antes de empezar a implementar.
