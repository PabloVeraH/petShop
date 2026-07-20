-- 056_fix_oc_recibida_precio_cero.sql
-- Revierte a "pendiente" las órdenes de compra "recibida" cuyos items
-- quedaron con precio_unitario = 0 (no NULL) por el bug de
-- OrdenCompraReceiveItemSchema (z.number().nonnegative() en vez de exigir
-- >0), combinado con el fallback `parseFloat(precio ?? "0") || 0` del
-- frontend cuando el usuario dejaba el campo de precio vacío.
--
-- Complementa la migración 055 (que solo cubría precio_unitario IS NULL y
-- por eso no corrigió estos casos reales — confirmado contra producción).
-- Acotada explícitamente a las 2 OC identificadas en el ticket Trello
-- 6a5c650f0343bb8c9f4228ed (no un scan amplio por precio_unitario=0, para
-- no tocar accidentalmente algún item legítimamente gratuito/promocional
-- en otra orden).
--
-- Decisión explícita (confirmada con el usuario): el stock físico ya
-- ingresado por estas OC (lotes_producto, stock_movements, productos.stock)
-- se asume real y NO se revierte — solo se corrige el papeleo de la OC
-- (estado, precio/cantidad de items, cuentas por pagar). Los 2 asientos
-- contables existentes para estas OC son $0/$0 (débito=crédito=0,
-- generados antes de que crearAsiento() rechazara asientos de monto cero
-- — commit d85d1f3) y se eliminan por no tener efecto económico real;
-- journal_detail se limpia por ON DELETE CASCADE.

DO $$
DECLARE
  rec record;
  affected_count integer := 0;
BEGIN
  FOR rec IN
    SELECT oc.id, oc.numero, oc.store_id
    FROM ordenes_compra oc
    WHERE oc.numero IN ('OC-20260518-EFC839', 'OC-20260505-D0EAE0')
      AND oc.estado = 'recibida'
  LOOP
    -- subtotal/impuesto/total en NULL — mismo valor inicial que una OC
    -- recién creada (POST /api/ordenes-compra), no "0.00" (que en la UI
    -- podría confundirse con un total real de cero en vez de "aún sin
    -- recibir").
    UPDATE ordenes_compra
    SET estado = 'pendiente', subtotal = NULL, impuesto = NULL, total = NULL
    WHERE id = rec.id;

    UPDATE ordenes_compra_items
    SET cantidad_recibida = NULL,
        precio_unitario   = NULL,
        subtotal          = NULL
    WHERE orden_id = rec.id;

    DELETE FROM cuentas_pagar WHERE orden_id = rec.id;

    -- Asientos $0/$0 huérfanos de esta OC — sin efecto económico real.
    DELETE FROM journal_entries
    WHERE referencia_numero = rec.numero
      AND tipo_movimiento = 'COMPRA'
      AND total_debito = 0
      AND total_credito = 0;

    affected_count := affected_count + 1;

    RAISE NOTICE 'OC % (%): revertida a pendiente — precio_unitario=0 en items, asiento $0/$0 eliminado', rec.numero, rec.id;
  END LOOP;

  RAISE NOTICE 'Total OCs corregidas: %', affected_count;
END $$;
