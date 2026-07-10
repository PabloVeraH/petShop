-- Migración 050: reparar IVA inflado en ventas históricas (19–22 jun 2026)
--
-- Causa raíz: entre el 19 y el 22 de junio de 2026 /api/ventas calculó
-- impuesto = ROUND(total × 0.19) (fórmula aditiva) sobre precios que ya
-- incluían IVA, en vez de extraerlo: ROUND(total × 0.19 / 1.19).
-- El código fue corregido en el commit 779a68f, pero 18 ventas quedaron
-- persistidas con el impuesto inflado, y sus asientos contables de ingreso
-- registran "IVA por Pagar" (210501) sobreestimado y "Venta de Productos"
-- (410101) subestimado. Los comprobantes muestran ese valor almacenado.
--
-- Reparación (idempotente, acotada a las filas con el patrón exacto del bug):
--   1. ventas.impuesto → extracción correcta
--   2. journal_detail: línea 210501 (crédito) → IVA correcto
--   3. journal_detail: línea 410101 (crédito) → total − IVA correcto
-- El débito (caja/banco) y los totales del asiento no cambian: el asiento
-- sigue balanceado (total = iva + neto antes y después).
--
-- No toca: ventas con impuesto fraccional de eras anteriores (mar–jun 6),
-- que ya cumplen la semántica de extracción (solo sin redondear a peso entero).

BEGIN;

CREATE TEMP TABLE _iva_fix ON COMMIT DROP AS
SELECT
  id,
  total,
  impuesto                        AS impuesto_incorrecto,
  ROUND(total * 0.19 / 1.19)      AS impuesto_correcto
FROM ventas
WHERE impuesto = ROUND(total * 0.19)
  AND impuesto IS DISTINCT FROM ROUND(total * 0.19 / 1.19);

-- 1. Corregir el impuesto almacenado en la venta
UPDATE ventas v
SET impuesto = f.impuesto_correcto,
    updated_at = now()
FROM _iva_fix f
WHERE v.id = f.id;

-- 2. Línea "IVA por Pagar" del asiento de ingreso (solo si aún tiene el valor inflado)
UPDATE journal_detail jd
SET credito = f.impuesto_correcto
FROM journal_entries je
JOIN _iva_fix f ON je.referencia_id = f.id
WHERE jd.journal_entry_id = je.id
  AND je.tipo_movimiento = 'VENTA'
  AND je.descripcion NOT ILIKE 'COGS%'
  AND jd.cuenta_codigo = '210501'
  AND jd.credito = f.impuesto_incorrecto;

-- 3. Línea "Venta de Productos" del mismo asiento (ingreso neto corregido)
UPDATE journal_detail jd
SET credito = f.total - f.impuesto_correcto
FROM journal_entries je
JOIN _iva_fix f ON je.referencia_id = f.id
WHERE jd.journal_entry_id = je.id
  AND je.tipo_movimiento = 'VENTA'
  AND je.descripcion NOT ILIKE 'COGS%'
  AND jd.cuenta_codigo = '410101'
  AND jd.credito = f.total - f.impuesto_incorrecto;

COMMIT;
