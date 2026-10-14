---
tags:
  - petshop
  - contabilidad
  - pendientes
---

# petShop — Faltantes de contaduría

Todos los pendientes contables del sistema, juntos en un solo lugar. Salen de
`docs/informe_security.md` (hallazgo 5), `docs/pendientes.md` (mermas, que se
trasladó aquí) y `docs/canales-stock/stock_canales_externos.md`. También se
revisaron `plan_valorServicio.md`, `informe_ideas_1000_estrellas.md`,
`storeBranch.md` y `conexion_shopify.md`, y el código de
`src/lib/contabilidad/` y `src/app/api/**` (revisión del 2026-10-13).

Regla del sistema (AGENTS.md §0.8, §23.3): todos los precios de venta son
**brutos**. El IVA se extrae con `extraerIva()`/`netoDesdeBruto()` de
`src/lib/tax.ts` y la tasa sale de `IVA_RATE`.

## Resumen

| # | Pendiente | Tipo | Prioridad |
|---|-----------|------|-----------|
| 1 | IVA de órdenes de compra: suma 19% fijo sobre el neto | Decisión del contador + código | Media |
| 2 | Mermas y ajustes por conteo no generan asiento | Decisión del contador + código | Media |
| 3 | Validar D24: comisión de canales con IVA | Decisión del contador | Media |
| 4 | ✅ Asientos de compra, pago a proveedor y cobro de cita sin `after()` | Código | Resuelto 2026-10-13 |
| 5 | ✅ El backfill no cubría pagos a proveedor ni liquidaciones de canal | Código | Resuelto 2026-10-13 |
| 6 | Exports Excel/PDF de contabilidad con poca cobertura de tests | Tests | Baja |
| 7 | Ideas y alcances futuros (arqueo de caja, sucursales, Shopify, no-show) | Producto | — |

---

## 1. IVA de órdenes de compra (hallazgo 5 del informe de seguridad)

**Necesita decisión del contador antes de tocar código.**

Al recibir una OC, `src/app/api/ordenes-compra/[id]/route.ts:314` hace:

```ts
const impuesto = Math.round(totalNeto * 0.19);
const total = totalNeto + impuesto;
```

- **Trata el precio de compra como neto** y le **suma** el IVA. En el resto
  del sistema los precios son brutos y el IVA se extrae.
- **Tasa fija en el código.** Es el único `0.19` que queda en `src/` (fuera
  de `tax.ts`) y no respeta `IVA_RATE`.
- **El asiento es coherente con ese supuesto neto.** `lineasCompra()`
  (`src/lib/contabilidad/generador-asientos.ts:510`) registra Debe
  Inventario (neto) + IVA Crédito Fiscal, y Haber Proveedores (total). La
  cuenta por pagar se crea por `total`.
- **Puede ser intencional,** porque las facturas de proveedores suelen venir
  en neto. Nunca se documentó.

**Decisión a tomar:** el `precio_unitario` que se ingresa al recibir una OC,
¿es neto (como factura el proveedor) o bruto?

- **Si es neto:** reemplazar `0.19` por `IVA_RATE` y dejarlo documentado aquí
  y en AGENTS.md §23.3 como excepción explícita a "todo es bruto".
- **Si es bruto:** usar `extraerIva(total)` / `netoDesdeBruto(total)`. Hay
  que revisar las OC ya recibidas (`subtotal`, `impuesto`, `total`), sus
  `cuentas_pagar` y sus asientos `COMPRA`. Corregirlas sería un backfill que
  requiere autorización (AGENTS.md §0.1).

**Lo mínimo, se decida lo que se decida:** usar `IVA_RATE`. Faltan además
tests que fijen el cálculo y el asiento de recepción.

## 2. Mermas y ajustes de stock sin asiento contable

*(Trasladado desde `docs/pendientes.md`. Estado al 2026-09-24, sin cambios a
2026-10-13.)*

Las bajas de inventario quedan registradas en stock (`stock_movements`, con
el usuario), pero **no generan asiento contable**. El libro diario sigue
mostrando ese inventario como activo aunque ya no exista.

### Qué operaciones faltan

| Operación | Dónde vive | Qué registra hoy | Asiento contable |
|-----------|-----------|-------------------|------------------|
| Merma de lote vencido (D23) | `POST /api/lotes/[id]/merma` → RPC `merma_lote_vencido` (migración 076) | lote `activo=false`, `stock_movements.tipo='merma'` con `cantidad = −unidades` y `user_id` | ❌ ninguno |
| Merma del resto de un saco granel abierto (G6) | `POST /api/productos/[id]/saco` `{accion:"merma"}` → RPC `cerrar_saco_merma` (migración 077) | `sacos_abiertos` cerrado con `motivo_cierre='merma'`, `gramos_merma`, `cerrado_por`; `stock_movements.tipo='merma'` con `cantidad = −gramos/peso_gramos` | ❌ ninguno |
| Ajuste por conteo físico (D22) | `POST /api/inventario/[id]/conteo` → RPC `ajustar_stock_conteo` | `stock_movements.tipo='ajuste_conteo'` con el delta (±) | ❌ ninguno |

Abrir un saco o deshacer una apertura no necesita asiento. El stock total no
cambia: solo pasa un saco de "cerrado" a "abierto" (G5).

### Qué habría que hacer

1. **Decisión contable (contador): qué cuenta de gasto usar para la merma.**
   - Hoy `CUENTAS` (`src/lib/contabilidad/types.ts`) **no tiene** una cuenta
     de merma o pérdida de inventario.
   - Hay dos opciones: crear una nueva (por ejemplo "Merma de inventario",
     tipo GASTO, código 5102xx) o usar `COGS` (510101).
   - También hay que decidir a qué cuenta va un ajuste por conteo
     **positivo** (aparecen unidades): la misma con signo contrario, u otra.
2. **Monto, valorizado a costo:**
   - Lote: `unidades × productos.costo`.
   - Saco granel: `gramos_merma / peso_gramos × productos.costo`, con el
     mismo criterio proporcional que el COGS de la venta a granel (G5).
   - Conteo: `|delta| × productos.costo`.
3. **Asiento propuesto:** Debe *Gasto de merma*, Haber *Inventario*
   (`INVENTARIO` 111001). Para un conteo positivo, al revés.
4. **Implementación, siguiendo el patrón existente:**
   - En cada endpoint, después de que la RPC termine bien, llamar a
     `crearAsiento()` dentro de `after()`, igual que en `POST /api/ventas`
     (AGENTS.md §10.1).
   - Agregar `lineasMerma(monto)` en `generador-asientos.ts` y
     probablemente un `tipoMovimiento` nuevo.
   - Las RPC ya devuelven `cantidad_baja`, `gramos_merma` y `delta`. El
     costo hay que leerlo de `productos` o hacer que la RPC lo devuelva.
5. **Datos históricos:** las mermas y conteos anteriores no tienen asiento.
   Si el contador lo pide, el backfill sale de `stock_movements`
   (`tipo IN ('merma','ajuste_conteo')`) y requiere autorización explícita.
6. **Tests:**
   - Backend: el asiento usa las cuentas y el monto correctos; no hay
     asiento si el costo es 0; un fallo de contabilidad no rompe la merma.
   - Contrato de `lineasMerma`: el debe es igual al haber.

Referencias: `docs/canales-stock/stock_canales_externos.md` §4.6 (G5, G6),
D22 y D23; `migrations/076_lotes_conteo_merma.sql`,
`migrations/077_granel_sacos_abiertos.sql`.

## 3. Validar D24 con el contador: liquidaciones de canales externos

La Fase 5 de canales (`stock_canales_externos.md`, migración 083) implementó
la conciliación de liquidaciones de Rappi, PedidosYa y Uber Eats.

- **Asiento:** `lineasLiquidacionCanal` con la cuenta `COMISIONES_CANAL`
  520101 y el `TipoMovimiento` `LIQUIDACION_CANAL`.
- **Supuesto sin validar:** que la plataforma factura la comisión **con
  IVA**. Por eso el asiento debita IVA Crédito Fiscal sobre la comisión
  (`generador-asientos.ts:799`).

**Pendiente:** confirmar con el contador el supuesto de IVA y el código de
cuenta. Si la comisión no lleva IVA, o lo lleva distinto, hay que ajustar
`lineasLiquidacionCanal` y sus tests (LQC-*). Hoy todavía no hay órdenes
reales de canales, así que no hay datos que corregir.

## 4. ✅ Asientos que se podían perder en serverless (sin `after()`)

> **Resuelto 2026-10-13:** los tres flujos usan `after()` con try/catch interno. Los tests I-111, I-CITA-58 y "recibir sin lotes" de `ordenes-compra.test.ts` verifican que el asiento se agenda con `after()`; sin el fix fallan los 3. Texto original:

Ventas, notas de crédito y anulaciones ya crean su asiento dentro de
`after()` de `next/server`. Así la plataforma espera a que termine después de
responder. Tres flujos siguen con un fire-and-forget puro
(`(async () => …)().catch(…)`). Ese patrón ya perdió asientos en producción
(ticket Trello 6a77e779358cdccca29dc3e3):

| Flujo | Archivo |
|-------|---------|
| Recepción de OC (asiento `COMPRA`) | `src/app/api/ordenes-compra/[id]/route.ts:359` |
| Pago a proveedor (asiento `PAGO_PROVEEDOR`) | `src/app/api/cuentas-pagar/route.ts:125` |
| Cobro de cita (asiento `VENTA` de servicio) | `src/app/api/citas/[id]/route.ts:311` |

**Arreglo:** envolver cada uno en `after(async () => { … })`, como en
`src/app/api/ventas/route.ts:483`. El cambio es de código solamente, no hace
falta una decisión de negocio. En los tests hay que mockear `after` como en
los de ventas.

## 5. ✅ El backfill cubre pagos a proveedor y liquidaciones de canal

> **Resuelto 2026-10-13.** `POST /api/contabilidad/backfill` también crea:
>
> - **`PAGO_PROVEEDOR`** para cuentas por pagar `pagada` sin asiento, con la
>   fecha `updated_at`, la misma que usa `PATCH /api/cuentas-pagar`.
> - **`LIQUIDACION_CANAL`** para liquidaciones con `journal_entry_id` nulo.
>   Si el asiento ya existe pero no quedó vinculado, solo lo vincula. La
>   fecha de depósito no se guarda en la tabla, así que se usa `created_at`.
>
> Tests I-BF-01 a I-BF-05. En el demo (solo lectura, 2026-10-13) había 2 de
> 12 pagos a proveedor sin asiento y 0 liquidaciones; correr el backfill los
> crea.
>
> Sigue siendo manual (sin cron ni botón en la UI) y sigue sin cubrir mermas
> (punto 2), porque todavía no existe ese asiento. Pendiente: decidir si el
> storeAdmin debería tener un botón de backfill en `/contabilidad`.

## 6. Tests de contabilidad

En la auditoría (`informe_security.md`, sección Cobertura), los **exports
Excel y PDF de contabilidad** figuraban con 0% de cobertura. Después se
agregaron tests de autorización (SEC-35) y algunos de PDF (balance y estado
de resultado). Falta medir de nuevo con `npm run test:coverage` y cubrir el
contenido de los exports: libro diario y los Excel de balance y estado de
resultado.

## 7. Ideas y alcances futuros (no comprometidos)

Estos no son defectos. Son decisiones que quedaron fuera de alcance y que
tienen un componente contable:

- **Arqueo de caja por turno** (`informe_ideas_1000_estrellas.md` §1): tabla
  `sesiones_caja` y un asiento por la diferencia (sobrante o faltante) con
  `crearAsiento()`. Requiere decidir la cuenta de "diferencias de caja".
- **Recargo por cancelación o no-show de citas**
  (`plan_valorServicio.md` §12): hoy no genera cobro ni asiento.
- **Contabilidad multi-sucursal** (`storeBranch.md`): los asientos y el
  cierre de mes son por tienda. Consolidar estados financieros entre
  sucursales es una decisión contable (entidad legal y tributaria), fuera
  del primer alcance.
- **Shopify, Fase 5** (`conexion_shopify.md` §4.8): cuentas nuevas y
  reconocimiento del gasto de suscripción, si se conecta Shopify.

---

## Ya resuelto (como referencia, no reabrir)

- **IVA aditivo en ventas históricas:** reparado en `migrations/050`. La
  fuente única es `src/lib/tax.ts` (AGENTS.md §23.3).
- **COGS duplicado en el cierre de mes:** el cierre solo calcula el COGS de
  las ventas que no tienen su asiento. El asiento 230 se revirtió con el
  232 (`src/lib/contabilidad/cierre-mes.ts`).
- **COGS del estado de resultado en 0** por la columna inexistente
  `venta_item_lotes.costo_unitario` (`src/lib/contabilidad/estado-resultado.ts`).
- **Anulación con NC previa:** el efecto neto se calcula en `anular_venta_tx`
  (migraciones 053 y 057). El contra-asiento reacredita Saldos a Favor
  (AGENTS.md §23.5).
- **El storeWorker no ve ni modifica la contabilidad** (SEC-18, SEC-35).
