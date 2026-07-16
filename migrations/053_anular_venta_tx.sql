-- Migración 053: anular_venta_tx
--
-- Envuelve la anulación de venta en una única transacción ACID, análoga a
-- crear_venta_tx (migración 037). Reemplaza los ~8 SELECT/UPDATE/INSERT
-- secuenciales de PATCH /api/ventas/[id] con una sola llamada RPC.
--
-- Corrige dos problemas del código JS anterior:
--
-- 1. RACE CONDITION (doble crédito por concurrencia): el JS verificaba
--    `estado !== 'anulada'` en un SELECT temprano y recién actualizaba
--    `estado = 'anulada'` al FINAL, después de restaurar stock, decrementar
--    fidelización y revertir saldo_a_favor. Dos requests concurrentes para
--    la misma venta (doble clic, dos pestañas, reintento de red) pasaban
--    ambos la verificación inicial y ambos ejecutaban la reversión completa
--    — incluyendo revertir_saldo_a_favor DOS veces. Aquí el UPDATE de
--    estado es la PRIMERA operación (reclamo atómico con
--    `WHERE estado != 'anulada'`): si 0 filas se actualizan, la función
--    aborta inmediatamente sin tocar stock/fidelización/saldo.
--
-- 2. ATOMICIDAD: al ser una única función plpgsql, cualquier error en
--    cualquier paso (ej. constraint violation) hace ROLLBACK automático de
--    TODA la operación — no puede quedar stock restaurado sin fidelización
--    actualizada, ni saldo revertido sin la NC marcada como anulada.
--
-- Preserva exactamente la lógica de negocio ya auditada y documentada en
-- AGENTS.md §22.5/§22.6 (commits 9b7fe62, 6245ee1):
--   - Stock: se restaura solo la cantidad AÚN NO devuelta vía NC con
--     restituir_stock=true (evita duplicar unidades ya restituidas al
--     crear la NC).
--   - Fidelización: se descuenta el NETO (venta.total − Σ monto_total de
--     TODAS las NCs de la venta, cualquier estado) — no el total completo.
--   - Saldo a favor: se revierte SOLO para NCs con estado='activa' (una NC
--     "usada" ya fue consumida como pago de otra venta; revertirla de nuevo
--     sería un tercer descuento sobre el mismo crédito). Reutiliza la
--     función atómica revertir_saldo_a_favor (migración 051).

CREATE OR REPLACE FUNCTION anular_venta_tx(
  p_store_id UUID,
  p_venta_id UUID,
  p_user_id  TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venta            RECORD;
  v_item             RECORD;
  v_nc               RECORD;
  v_ya_devuelto      NUMERIC;
  v_pendiente        NUMERIC;
  v_producto         RECORD;
  v_costo_total      NUMERIC := 0;
  v_total_nc_monto   NUMERIC := 0;
  v_fid              RECORD;
  v_niveles          JSONB;
  v_neto_venta       NUMERIC;
  v_nuevo_total      NUMERIC;
  v_nueva_frecuencia INTEGER;
  v_nuevo_descuento  NUMERIC;
BEGIN
  -- 1. Reclamo atómico: única operación que puede transicionar la venta a
  --    'anulada'. Si otra request concurrente ya ganó la carrera, 0 filas
  --    afectadas y esta ejecución aborta ANTES de tocar stock/fidelización/
  --    saldo — cierra la race condition del bug de doble crédito.
  UPDATE ventas
     SET estado = 'anulada'
   WHERE id = p_venta_id
     AND store_id = p_store_id
     AND estado != 'anulada'
  RETURNING * INTO v_venta;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM ventas WHERE id = p_venta_id AND store_id = p_store_id) THEN
      RAISE EXCEPTION 'La venta ya está anulada';
    ELSE
      RAISE EXCEPTION 'Venta no encontrada';
    END IF;
  END IF;

  -- 2. Monto total de TODAS las NCs de esta venta (cualquier estado) — cada
  --    una ya descontó su propio monto_total de fidelizacion.total_historico
  --    al crearse; se necesita para calcular el neto remanente en el paso 4.
  SELECT COALESCE(SUM(monto_total), 0) INTO v_total_nc_monto
    FROM notas_credito
   WHERE venta_id = p_venta_id;

  -- 3. Restaurar stock: solo la cantidad AÚN NO devuelta vía NC con
  --    restituir_stock=true (esa porción ya incrementó productos.stock
  --    cuando se creó la NC — restaurar la cantidad completa la duplicaría).
  FOR v_item IN
    SELECT id, producto_id, cantidad FROM venta_items WHERE venta_id = p_venta_id
  LOOP
    SELECT COALESCE(SUM(nci.cantidad_devuelta), 0) INTO v_ya_devuelto
      FROM nota_credito_items nci
      JOIN notas_credito nc ON nc.id = nci.nota_credito_id
     WHERE nci.venta_item_id = v_item.id
       AND nc.venta_id = p_venta_id
       AND nci.restituir_stock = true;

    v_pendiente := GREATEST(0, v_item.cantidad - v_ya_devuelto);
    CONTINUE WHEN v_pendiente <= 0;

    SELECT stock, costo INTO v_producto FROM productos WHERE id = v_item.producto_id;
    IF FOUND THEN
      v_costo_total := v_costo_total + COALESCE(v_producto.costo, 0) * v_pendiente;

      UPDATE productos SET stock = stock + v_pendiente WHERE id = v_item.producto_id;

      INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
      VALUES (
        v_item.producto_id,
        'entrada',
        v_pendiente,
        p_venta_id,
        'Anulación ' || COALESCE(v_venta.numero_comprobante, LEFT(p_venta_id::TEXT, 8)),
        p_user_id
      );
    END IF;
  END LOOP;

  -- 4. Fidelización: descontar solo el NETO (venta.total − NCs ya restadas
  --    al crearse). Descontar venta.total completo duplicaría esa resta.
  IF v_venta.cliente_id IS NOT NULL THEN
    SELECT total_historico, frecuencia_compras INTO v_fid
      FROM fidelizacion WHERE cliente_id = v_venta.cliente_id;

    IF FOUND THEN
      SELECT fidelizacion_niveles INTO v_niveles FROM stores WHERE id = p_store_id;
      IF v_niveles IS NULL OR jsonb_array_length(v_niveles) = 0 THEN
        v_niveles := '[{"monto":50000,"descuento":5},{"monto":150000,"descuento":10},{"monto":300000,"descuento":20}]'::JSONB;
      END IF;

      v_neto_venta  := GREATEST(0, COALESCE(v_venta.total, 0) - v_total_nc_monto);
      v_nuevo_total := GREATEST(0, v_fid.total_historico - v_neto_venta);
      v_nueva_frecuencia := GREATEST(0, v_fid.frecuencia_compras - 1);

      -- Mismo criterio que el JS reemplazado: niveles ordenados DESC por
      -- monto, se toma el descuento del primer nivel (mayor monto) cuyo
      -- umbral el nuevo total todavía alcanza.
      SELECT (n->>'descuento')::NUMERIC INTO v_nuevo_descuento
        FROM jsonb_array_elements(v_niveles) n
       WHERE v_nuevo_total >= (n->>'monto')::NUMERIC
       ORDER BY (n->>'monto')::NUMERIC DESC
       LIMIT 1;
      v_nuevo_descuento := COALESCE(v_nuevo_descuento, 0);

      UPDATE fidelizacion
         SET total_historico    = v_nuevo_total,
             frecuencia_compras = v_nueva_frecuencia,
             descuento_actual   = v_nuevo_descuento,
             updated_at         = NOW()
       WHERE cliente_id = v_venta.cliente_id;
    END IF;
  END IF;

  -- 5. Cancelar NCs activas y revertir su saldo_a_favor. Solo estado='activa':
  --    una NC "usada" ya fue consumida como pago de otra venta (crear_venta_tx
  --    ya decrementó su saldo en ese momento) — revertirla de nuevo sería un
  --    tercer descuento sobre el mismo crédito.
  FOR v_nc IN
    SELECT id, tipo_reembolso, monto_total
      FROM notas_credito
     WHERE venta_id = p_venta_id AND estado = 'activa'
  LOOP
    IF v_nc.tipo_reembolso = 'saldo_a_favor' AND v_venta.cliente_id IS NOT NULL THEN
      PERFORM revertir_saldo_a_favor(p_store_id, v_venta.cliente_id, v_nc.monto_total);
    END IF;

    UPDATE notas_credito SET estado = 'anulada' WHERE id = v_nc.id;
  END LOOP;

  RETURN jsonb_build_object('venta', to_jsonb(v_venta), 'costo_total', v_costo_total);
END;
$$;

GRANT EXECUTE ON FUNCTION anular_venta_tx TO service_role;
