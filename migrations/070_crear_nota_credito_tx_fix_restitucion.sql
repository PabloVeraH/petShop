-- Migration 070: fix crear_nota_credito_tx — loop de restitución de stock roto
--
-- Ticket Trello 6a76cc3f6fc812dda0a2ce43 ("[POS] CRÍTICO: Devolución parcial
-- con Nota de Crédito falla con error 500 y sin feedback al usuario").
--
-- ─── Causa raíz (verificada contra el sistema real) ──────────────────────
-- El loop 5 de crear_nota_credito_tx (restitución de stock) se escribió como:
--
--     FOR v_item IN SELECT * FROM jsonb_array_elements(v_nc_items) AS item
--     LOOP
--       v_restituir := (v_item.item->>'restituir_stock')::BOOLEAN;
--       ...
--
-- jsonb_array_elements(jsonb) tiene un parámetro de salida (OUT) nombrado
-- explícitamente `value` (verificado: SELECT proargnames FROM pg_proc WHERE
-- proname='jsonb_array_elements' → {from_json,value}). Por eso
-- `SELECT * FROM jsonb_array_elements(...) AS item` produce una columna
-- llamada `value` — NI el alias de tabla `item` NI el nombre de la función
-- jsonb_array_elements, como podría asumirse por analogía con funciones que
-- retornan un tipo base sin OUT nombrado. El record v_item NO tiene campo
-- `item`, y acceder a v_item.item lanza:
--
--     record "v_item" has no field "item"   (SQLSTATE 42703)
--
-- (verificado con un DO block aislado contra el proyecto real, sin tocar
-- datos: mismo mensaje exacto; v_item.value sí funciona).
--
-- El primer loop de la misma función (jsonb_to_recordset con lista de columnas
-- tipadas AS x(...)) sí funciona porque ahí SÍ se nombran las columnas. Este
-- loop copiaba el defecto de la 061 y la 068 lo heredó al redefinir la función
-- para líneas de servicio.
--
-- Alcance real del fallo: la línea que revienta (v_restituir := ...) es la
-- PRIMERA instrucción del loop, ANTES de cualquier chequeo de
-- restituir_stock o producto_id. Falla en la primera iteración sin importar
-- el valor de esos campos — es decir, TODA devolución con al menos un ítem
-- falla (no solo las que tienen restituir_stock=true; ese es simplemente el
-- valor por defecto de la UI, y por eso es el caso que se observó en QA).
-- Confirmado en audit_logs (04-08 y 08-08-2026, acción CREATE, resultado
-- failure): la nota de crédito nunca se crea y el frontend no mostraba error.
--
-- ─── Verificación contra el sistema real (no destructiva, ROLLBACK) ──────
-- Reproducido llamando el RPC desplegado con una venta real + su item y
-- restituir_stock=true: responde 42703 "record "v_item" has no field "item"",
-- y como la función es una transacción plpgsql, el error revierte TODO
-- (verificado: 0 notas_credito, 0 stock_movements creados). Mismo patrón de
-- verificación usado en AGENTS.md §23.5 para anular_venta_tx.
--
-- ─── Fix ─────────────────────────────────────────────────────────────────
-- Reescribir el loop 5 usando jsonb_to_recordset con columnas tipadas, el
-- mismo patrón del loop 1 que sí funciona. La lógica de negocio (salto de
-- servicios con producto_id NULL, lotes vs stock directo, stock_movements)
-- no cambia una línea.
--
-- ─── REVOKE (obligatorio, ver 069) ──────────────────────────────────────
-- CREATE OR REPLACE sobre crear_nota_credito_tx re-otorga EXECUTE a
-- PUBLIC/anon/authenticated (comportamiento de Supabase). La 069 cerró ese
-- hueco de seguridad; esta migración debe repetir el REVOKE en la misma
-- migración que reescribe la función (regla explícita de 069 líneas 38-40).

CREATE OR REPLACE FUNCTION crear_nota_credito_tx(
  p_store_id UUID,
  p_user_id TEXT,
  p_venta_id UUID,
  p_items JSONB,
  p_numero_nc TEXT,
  p_motivo TEXT,
  p_tipo_reembolso TEXT,
  p_metodo_reembolso TEXT,
  p_fecha_vencimiento DATE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venta RECORD;
  v_item RECORD;
  v_venta_item RECORD;
  v_ya_devuelto INTEGER;
  v_disponible INTEGER;
  v_descuento_pct NUMERIC;
  v_descuento_factor NUMERIC;
  v_precio_con_descuento INTEGER;
  v_subtotal INTEGER;
  v_monto_total INTEGER := 0;
  v_costo_total INTEGER := 0;
  v_costo_unitario INTEGER;
  v_restituir BOOLEAN;
  v_nc_id UUID;
  v_has_lotes BOOLEAN;
  v_fid RECORD;
  v_niveles JSONB;
  v_nuevo_total INTEGER;
  v_nuevo_descuento NUMERIC;
  v_nc_items JSONB := '[]'::JSONB;
BEGIN
  -- 1. Validar venta: ownership por store_id, no anulada
  SELECT id, cliente_id, total, descuento, estado
    INTO v_venta
    FROM ventas
   WHERE id = p_venta_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada en esta tienda';
  END IF;

  IF v_venta.estado = 'anulada' THEN
    RAISE EXCEPTION 'No se puede devolver una venta anulada';
  END IF;

  v_descuento_pct := COALESCE(v_venta.descuento, 0);
  v_descuento_factor := CASE WHEN v_descuento_pct > 0
    THEN (100 - v_descuento_pct) / 100.0
    ELSE 1
  END;

  -- 2. Procesar cada item
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    venta_item_id UUID,
    cantidad_devuelta INTEGER,
    restituir_stock BOOLEAN
  )
  LOOP
    v_restituir := COALESCE(v_item.restituir_stock, true);

    -- 2a. Leer datos del item de venta, validar pertenencia. vi.servicio_id
    --     se lee aquí (cambio 3f.1 de 068) — el LEFT JOIN a productos sigue
    --     siendo seguro con producto_id NULL y deja p.costo NULL → 0.
    SELECT vi.id, vi.cantidad, vi.precio_unitario, vi.producto_id, vi.servicio_id,
           COALESCE(p.costo, 0) AS costo
      INTO v_venta_item
      FROM venta_items vi
      LEFT JOIN productos p ON p.id = vi.producto_id
     WHERE vi.id = v_item.venta_item_id AND vi.venta_id = p_venta_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % no pertenece a la venta %', v_item.venta_item_id, p_venta_id;
    END IF;

    -- 2b. Calcular cantidad disponible
    SELECT COALESCE(SUM(nci.cantidad_devuelta), 0)::INTEGER
      INTO v_ya_devuelto
      FROM nota_credito_items nci
      JOIN notas_credito nc ON nc.id = nci.nota_credito_id
     WHERE nci.venta_item_id = v_item.venta_item_id
       AND nc.venta_id = p_venta_id;

    v_disponible := v_venta_item.cantidad - v_ya_devuelto;

    IF v_item.cantidad_devuelta > v_disponible THEN
      RAISE EXCEPTION 'Cantidad devuelta (%) excede el disponible (%) para el item %',
        v_item.cantidad_devuelta, v_disponible, v_item.venta_item_id;
    END IF;

    -- 2c. Calcular precios con descuento proporcional
    v_precio_con_descuento := ROUND(v_venta_item.precio_unitario * v_descuento_factor);
    v_subtotal := ROUND(v_item.cantidad_devuelta * v_venta_item.precio_unitario * v_descuento_factor);

    v_monto_total := v_monto_total + v_subtotal;

    IF v_restituir THEN
      v_costo_total := v_costo_total + v_item.cantidad_devuelta * v_venta_item.costo;
    END IF;

    -- 2d. Acumular item data para insert bulk (cambio 3f.3: agrega servicio_id)
    v_nc_items := v_nc_items || jsonb_build_object(
      'venta_item_id', v_item.venta_item_id,
      'producto_id', v_venta_item.producto_id,
      'servicio_id', v_venta_item.servicio_id,
      'cantidad_devuelta', v_item.cantidad_devuelta,
      'precio_unitario', v_precio_con_descuento,
      'subtotal', v_subtotal,
      'restituir_stock', v_restituir
    );
  END LOOP;

  IF v_monto_total <= 0 THEN
    RAISE EXCEPTION 'Monto total de la NC debe ser positivo';
  END IF;

  -- 3. INSERT notas_credito
  INSERT INTO notas_credito (
    store_id, venta_id, numero_nc, motivo,
    tipo_reembolso, metodo_reembolso, monto_total,
    estado, fecha_vencimiento
  ) VALUES (
    p_store_id, p_venta_id, p_numero_nc, p_motivo,
    p_tipo_reembolso, p_metodo_reembolso, v_monto_total,
    'activa', p_fecha_vencimiento
  )
  RETURNING id INTO v_nc_id;

  -- 4. INSERT nota_credito_items
  INSERT INTO nota_credito_items (
    nota_credito_id, venta_item_id, producto_id, servicio_id,
    cantidad_devuelta, precio_unitario, subtotal, restituir_stock
  )
  SELECT
    v_nc_id,
    (item->>'venta_item_id')::UUID,
    (item->>'producto_id')::UUID,
    (item->>'servicio_id')::UUID,
    (item->>'cantidad_devuelta')::INTEGER,
    (item->>'precio_unitario')::INTEGER,
    (item->>'subtotal')::INTEGER,
    (item->>'restituir_stock')::BOOLEAN
  FROM jsonb_array_elements(v_nc_items) item;

  -- 5. Restituir stock y registrar movimientos
  --    FIX (migración 070): jsonb_to_recordset con columnas tipadas. El
  --    SELECT * sobre jsonb_array_elements(...) AS item nombraba la columna
  --    `value` (OUT param de la función, no el alias `item`), y v_item.item
  --    lanzaba "record "v_item" has no field "item"" (SQLSTATE 42703) en la
  --    primera línea del loop, antes de leer restituir_stock — toda
  --    devolución con al menos un ítem fallaba con 500, no solo las de
  --    restituir_stock=true. Las líneas de servicio (producto_id NULL) se
  --    saltan completo (cambio 3f.2 de 068).
  FOR v_item IN SELECT * FROM jsonb_to_recordset(v_nc_items) AS x(
    venta_item_id UUID,
    producto_id UUID,
    cantidad_devuelta INTEGER,
    restituir_stock BOOLEAN
  )
  LOOP
    v_restituir := COALESCE(v_item.restituir_stock, true);
    CONTINUE WHEN NOT v_restituir OR v_item.producto_id IS NULL;

    -- 5a. Verificar si el item tiene lotes
    SELECT EXISTS (
      SELECT 1 FROM venta_item_lotes
      WHERE venta_item_id = v_item.venta_item_id
    ) INTO v_has_lotes;

    IF v_has_lotes THEN
      PERFORM devolver_stock_a_lotes(v_item.venta_item_id);
    ELSE
      PERFORM increment_stock(
        v_item.producto_id,
        v_item.cantidad_devuelta
      );
    END IF;

    -- 5b. Registrar movimiento de stock
    INSERT INTO stock_movements (
      producto_id, tipo, cantidad, referencia_id, notas, user_id
    ) VALUES (
      v_item.producto_id,
      'entrada',
      v_item.cantidad_devuelta,
      v_nc_id,
      'Devolución ' || p_numero_nc,
      p_user_id
    );
  END LOOP;

  -- 6. Incrementar saldo a favor si corresponde
  IF p_tipo_reembolso = 'saldo_a_favor' AND v_venta.cliente_id IS NOT NULL THEN
    PERFORM incrementar_saldo_a_favor(p_store_id, v_venta.cliente_id, v_monto_total);
  END IF;

  -- 7. Actualizar fidelización (decrementar total_historico, recalcular descuento)
  IF v_venta.cliente_id IS NOT NULL THEN
    SELECT total_historico, frecuencia_compras INTO v_fid
      FROM fidelizacion WHERE cliente_id = v_venta.cliente_id;

    IF FOUND THEN
      SELECT fidelizacion_niveles INTO v_niveles FROM stores WHERE id = p_store_id;
      IF v_niveles IS NULL OR jsonb_array_length(v_niveles) = 0 THEN
        v_niveles := '[{"monto":50000,"descuento":5},{"monto":150000,"descuento":10},{"monto":300000,"descuento":20}]'::JSONB;
      END IF;

      v_nuevo_total := GREATEST(0, v_fid.total_historico - v_monto_total);

      SELECT (n->>'descuento')::NUMERIC INTO v_nuevo_descuento
        FROM jsonb_array_elements(v_niveles) n
       WHERE v_nuevo_total >= (n->>'monto')::NUMERIC
       ORDER BY (n->>'monto')::NUMERIC DESC
       LIMIT 1;
      v_nuevo_descuento := COALESCE(v_nuevo_descuento, 0);

      UPDATE fidelizacion
         SET total_historico  = v_nuevo_total,
             descuento_actual = v_nuevo_descuento,
             updated_at       = NOW()
       WHERE cliente_id = v_venta.cliente_id;
    END IF;
  END IF;

  -- 8. Retornar datos para el llamador (contabilidad fire-and-forget en JS)
  RETURN jsonb_build_object(
    'id', v_nc_id,
    'numero_nc', p_numero_nc,
    'monto_total', v_monto_total,
    'costo_total', v_costo_total,
    'venta_cliente_id', v_venta.cliente_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION crear_nota_credito_tx TO service_role;
-- REVOKE obligatorio (ver 069): CREATE OR REPLACE re-otorga EXECUTE a
-- PUBLIC/anon/authenticated — sin esto el hueco de seguridad vuelve.
REVOKE EXECUTE ON FUNCTION crear_nota_credito_tx FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_nota_credito_tx FROM anon, authenticated;
