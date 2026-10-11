-- 055_fix_oc_recibida_sin_precio.sql
-- Revierte a "pendiente" las órdenes de compra en estado "recibida" que tienen
-- items con precio_unitario NULL (error de bypass del flujo "recibir" vía
-- PATCH { estado: "recibida" }).
--
-- Ver ticket: [Proveedores] Órdenes de compra en estado "recibida" con
-- "Precio pendiente".

DO $$
DECLARE
  rec record;
  affected_count integer := 0;
BEGIN
  FOR rec IN
    SELECT oc.id, oc.numero, oc.store_id
    FROM ordenes_compra oc
    WHERE oc.estado = 'recibida'
      AND EXISTS (
        SELECT 1 FROM ordenes_compra_items oci
        WHERE oci.orden_id = oc.id AND oci.precio_unitario IS NULL
      )
  LOOP
    -- Revertir estado de la OC a pendiente
    UPDATE ordenes_compra
    SET estado = 'pendiente'
    WHERE id = rec.id;

    -- Limpiar datos de recepción en items
    UPDATE ordenes_compra_items
    SET cantidad_recibida = NULL,
        precio_unitario   = NULL,
        subtotal          = NULL
    WHERE orden_id = rec.id;

    -- Eliminar cuentas por pagar creadas erróneamente durante el bypass
    DELETE FROM cuentas_pagar WHERE orden_id = rec.id;

    affected_count := affected_count + 1;

    RAISE NOTICE 'OC % (%): revertida a pendiente — precio_unitario NULL en items', rec.numero, rec.id;
  END LOOP;

  RAISE NOTICE 'Total OCs corregidas: %', affected_count;
END $$;
