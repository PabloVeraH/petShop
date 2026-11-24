-- 099: venta a granel por gramos o por valor (configuración por tienda).
--
-- Pedido (2026-11-24): el cliente suele pedir un monto ("$2.000 de alimento").
-- Con la tienda en 'valor', el cajero escribe el monto, el sistema calcula los
-- gramos (al gramo más cercano) y se cobra justo ese monto.
--
-- Cambios:
--   1. stores.venta_granel_por: 'gramos' (default, como hasta hoy) o 'valor'.
--      Lo cambia el storeAdmin/systemAdmin (PATCH /api/settings).
--   2. crear_nota_credito_tx (copia de la 093): una línea a granel devuelve la
--      parte de su subtotal cobrado, no kg × precio. Vendida por valor, 182 g a
--      $11.000/kg se cobran $2.000 y antes devolvería $2.002. Las líneas por
--      unidad y de servicio no cambian.
--   3. crear_nota_credito_tx no devuelve más de lo vendido: rechaza la misma
--      línea repetida y bloquea la venta (dos devoluciones simultáneas). Fallas
--      anteriores, encontradas al revisar la función (2026-11-24).
--
-- crear_venta_tx no cambia: ya guarda el subtotal y los gramos que calcula el
-- servidor (POST /api/ventas valida gramos contra monto con el precio de la BD).
--
-- Datos: no cambia filas. Ventas a granel anteriores: su subtotal es gramos ×
-- precio redondeado, así que su devolución sin descuento da lo mismo que antes.
-- El código anterior sigue funcionando con esta migración. APLICAR ANTES DE
-- DESPLEGAR el código nuevo (GET /api/settings, GET /api/tienda/nombre y POST
-- /api/ventas leen la columna). Requiere 090 y 093. Reversible:
-- crear_nota_credito_tx de la 093 y DROP COLUMN.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS venta_granel_por text NOT NULL DEFAULT 'gramos';

DO $$
BEGIN
  ALTER TABLE public.stores
    ADD CONSTRAINT stores_venta_granel_por_check CHECK (venta_granel_por IN ('gramos', 'valor'));
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

COMMENT ON COLUMN public.stores.venta_granel_por IS
  'Cómo se ingresa la venta a granel en el POS: gramos (default) o valor (monto en pesos; el sistema calcula los gramos).';

CREATE OR REPLACE FUNCTION public.crear_nota_credito_tx(p_store_id uuid, p_user_id text, p_venta_id uuid, p_items jsonb, p_numero_nc text, p_motivo text, p_tipo_reembolso text, p_metodo_reembolso text, p_fecha_vencimiento date, p_cliente_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_venta RECORD;
  v_item RECORD;
  v_venta_item RECORD;
  v_ya_devuelto NUMERIC;
  v_disponible NUMERIC;
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
  v_ya_devuelto_lotes NUMERIC;
  v_colocado NUMERIC;
  v_gramos_dev INTEGER;
  v_frac NUMERIC;
  v_asignado_en_nc JSONB := '{}'::JSONB;
  v_fid RECORD;
  v_niveles JSONB;
  v_nuevo_total INTEGER;
  v_nueva_frecuencia INTEGER;
  v_retorno_completo BOOLEAN;
  v_nuevo_descuento NUMERIC;
  v_nc_items JSONB := '[]'::JSONB;
  v_nc_cliente_id UUID;
BEGIN
  -- 0. (099) Una línea repetida pasaba dos veces el control de "disponible" y
  --    devolvía el doble.
  IF (SELECT count(*) <> count(DISTINCT (x->>'venta_item_id')::UUID) FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'Cantidad inválida: un producto está repetido en la devolución';
  END IF;

  -- 1. Validar venta: ownership por store_id, no anulada. FOR UPDATE (099):
  --    serializa devoluciones (y la anulación) de la misma venta; sin él, dos
  --    simultáneas veían lo mismo disponible y devolvían el doble.
  SELECT id, cliente_id, total, descuento, estado
    INTO v_venta
    FROM ventas
   WHERE id = p_venta_id AND store_id = p_store_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada en esta tienda';
  END IF;

  IF v_venta.estado = 'anulada' THEN
    RAISE EXCEPTION 'No se puede devolver una venta anulada';
  END IF;

  -- 1b. Dueño de la NC (093): toda NC es de un cliente y solo él la usa. Es el
  --     cliente de la venta; si la venta no tenía, el que registra el cajero
  --     (p_cliente_id, de esta tienda). No se puede cambiar el de una venta
  --     que ya tiene cliente. La fidelización (paso 7) sigue usando el cliente
  --     de la venta: una compra sin cliente nunca sumó a nadie.
  IF v_venta.cliente_id IS NOT NULL AND p_cliente_id IS NOT NULL AND p_cliente_id <> v_venta.cliente_id THEN
    RAISE EXCEPTION 'La venta ya tiene cliente: la nota de crédito es suya' USING ERRCODE = 'PV009';
  END IF;
  v_nc_cliente_id := COALESCE(v_venta.cliente_id, p_cliente_id);
  IF v_nc_cliente_id IS NULL THEN
    RAISE EXCEPTION 'La nota de crédito requiere un cliente: registre el cliente de la devolución' USING ERRCODE = 'PV009';
  END IF;
  IF v_venta.cliente_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM clientes WHERE id = p_cliente_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Cliente no encontrado en esta tienda' USING ERRCODE = 'PV009';
  END IF;

  v_descuento_pct := COALESCE(v_venta.descuento, 0);
  v_descuento_factor := CASE WHEN v_descuento_pct > 0
    THEN (100 - v_descuento_pct) / 100.0
    ELSE 1
  END;

  -- 2. Procesar cada item
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    venta_item_id UUID,
    cantidad_devuelta NUMERIC,
    restituir_stock BOOLEAN
  )
  LOOP
    v_restituir := COALESCE(v_item.restituir_stock, true);

    -- 2a. Leer datos del item de venta, validar pertenencia. vi.servicio_id
    --     se lee aquí (cambio 3f.1 de 068) — el LEFT JOIN a productos sigue
    --     siendo seguro con producto_id NULL y deja p.costo NULL → 0.
    SELECT vi.id, vi.cantidad, vi.precio_unitario, vi.subtotal, vi.producto_id, vi.servicio_id,
           vi.es_granel, p.peso_gramos,
           COALESCE(p.costo, 0) AS costo
      INTO v_venta_item
      FROM venta_items vi
      LEFT JOIN productos p ON p.id = vi.producto_id
     WHERE vi.id = v_item.venta_item_id AND vi.venta_id = p_venta_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % no pertenece a la venta %', v_item.venta_item_id, p_venta_id;
    END IF;

    -- 2a'. Cantidad (078): granel en kg con hasta 3 decimales (gramos
    --      exactos); por unidad, entera (antes lo imponía el tipo INTEGER).
    --      Excepción: línea legada con cantidad fraccionaria y es_granel =
    --      false (ventas a granel anteriores a 078) — se permite devolverla
    --      en su misma unidad, como antes de esta migración.
    IF v_item.cantidad_devuelta IS NULL OR v_item.cantidad_devuelta <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para devolver: %', v_item.cantidad_devuelta;
    END IF;
    IF v_venta_item.es_granel THEN
      IF v_item.cantidad_devuelta * 1000 <> trunc(v_item.cantidad_devuelta * 1000) THEN
        RAISE EXCEPTION 'Cantidad inválida para devolver: % kg (máximo 3 decimales)', v_item.cantidad_devuelta;
      END IF;
    ELSIF v_venta_item.cantidad = trunc(v_venta_item.cantidad)
      AND v_item.cantidad_devuelta <> trunc(v_item.cantidad_devuelta) THEN
      RAISE EXCEPTION 'Cantidad inválida para devolver: % (debe ser entera)', v_item.cantidad_devuelta;
    END IF;

    -- 2b. Calcular cantidad disponible
    SELECT COALESCE(SUM(nci.cantidad_devuelta), 0)
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
    IF v_venta_item.es_granel THEN
      -- 099: granel devuelve la parte de lo COBRADO (vi.subtotal), no kg ×
      -- precio: vendida por valor, la línea vale justo el monto pedido. Por
      -- acumulado (hasta aquí − ya devuelto), así varias devoluciones
      -- parciales suman exactamente lo cobrado.
      v_subtotal := ROUND(v_venta_item.subtotal * v_descuento_factor * (v_ya_devuelto + v_item.cantidad_devuelta) / v_venta_item.cantidad)
                  - ROUND(v_venta_item.subtotal * v_descuento_factor * v_ya_devuelto / v_venta_item.cantidad);
    ELSE
      v_subtotal := ROUND(v_item.cantidad_devuelta * v_venta_item.precio_unitario * v_descuento_factor);
    END IF;

    v_monto_total := v_monto_total + v_subtotal;

    IF v_restituir THEN
      IF v_venta_item.es_granel THEN
        -- G5: costo por saco × proporción devuelta (kg × 1000 / peso).
        v_costo_total := v_costo_total
          + COALESCE(ROUND(v_venta_item.costo * v_item.cantidad_devuelta * 1000 / NULLIF(v_venta_item.peso_gramos, 0)), 0);
      ELSE
        v_costo_total := v_costo_total + v_item.cantidad_devuelta * v_venta_item.costo;
      END IF;
    END IF;

    -- 2d. Acumular item data para insert bulk (cambio 3f.3: agrega servicio_id)
    v_nc_items := v_nc_items || jsonb_build_object(
      'venta_item_id', v_item.venta_item_id,
      'producto_id', v_venta_item.producto_id,
      'servicio_id', v_venta_item.servicio_id,
      'cantidad_devuelta', v_item.cantidad_devuelta,
      'precio_unitario', v_precio_con_descuento,
      'subtotal', v_subtotal,
      'restituir_stock', v_restituir,
      'es_granel', COALESCE(v_venta_item.es_granel, false)
    );
  END LOOP;

  IF v_monto_total <= 0 THEN
    RAISE EXCEPTION 'Monto total de la NC debe ser positivo';
  END IF;

  -- 3. INSERT notas_credito
  INSERT INTO notas_credito (
    store_id, venta_id, numero_nc, motivo,
    tipo_reembolso, metodo_reembolso, monto_total,
    estado, fecha_vencimiento, cliente_id
  ) VALUES (
    p_store_id, p_venta_id, p_numero_nc, p_motivo,
    p_tipo_reembolso, p_metodo_reembolso, v_monto_total,
    'activa', p_fecha_vencimiento, v_nc_cliente_id
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
    (item->>'cantidad_devuelta')::NUMERIC,
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
  --    FIX (migración 075, S13): devolver_stock_a_lotes devolvía la cantidad
  --    COMPLETA consumida por el ítem aunque la NC fuera parcial. Ahora cada
  --    lote recibe solo su parte del tramo
  --    [ya devuelto a lotes, ya devuelto + cantidad_devuelta), donde "ya
  --    devuelto" = NCs anteriores con restituir_stock=true + líneas previas
  --    del mismo ítem en ESTA NC. Ítems sin lotes (o producto que hoy tiene
  --    lotes pero no los tenía al vender) → devolver_stock_producto.
  --    Migración 078 (G7): una línea granel devuelve sus gramos al saco
  --    abierto (devolver_granel), no a lotes.
  FOR v_item IN SELECT * FROM jsonb_to_recordset(v_nc_items) AS x(
    venta_item_id UUID,
    producto_id UUID,
    cantidad_devuelta NUMERIC,
    restituir_stock BOOLEAN,
    es_granel BOOLEAN
  )
  LOOP
    v_restituir := COALESCE(v_item.restituir_stock, true);
    CONTINUE WHEN NOT v_restituir OR v_item.producto_id IS NULL;

    IF COALESCE(v_item.es_granel, false) THEN
      v_gramos_dev := ROUND(v_item.cantidad_devuelta * 1000)::INTEGER;
      v_frac := devolver_granel(p_store_id, v_item.producto_id, v_gramos_dev, p_user_id);

      INSERT INTO stock_movements (
        producto_id, tipo, cantidad, referencia_id, notas, user_id
      ) VALUES (
        v_item.producto_id,
        'entrada',
        v_frac,
        v_nc_id,
        'Devolución ' || p_numero_nc || ' (' || v_gramos_dev || ' g granel)',
        p_user_id
      );
      CONTINUE;
    END IF;

    -- 5a. Verificar si el item tiene lotes
    SELECT EXISTS (
      SELECT 1 FROM venta_item_lotes
      WHERE venta_item_id = v_item.venta_item_id
    ) INTO v_has_lotes;

    IF v_has_lotes THEN
      SELECT COALESCE(SUM(nci.cantidad_devuelta), 0) INTO v_ya_devuelto_lotes
        FROM nota_credito_items nci
        JOIN notas_credito nc ON nc.id = nci.nota_credito_id
       WHERE nci.venta_item_id   = v_item.venta_item_id
         AND nc.venta_id         = p_venta_id
         AND nci.restituir_stock = true
         AND nci.nota_credito_id <> v_nc_id;
      v_ya_devuelto_lotes := v_ya_devuelto_lotes
        + COALESCE((v_asignado_en_nc->>(v_item.venta_item_id::TEXT))::NUMERIC, 0);

      v_colocado := devolver_a_lotes_venta_item(
        v_item.venta_item_id, v_ya_devuelto_lotes, v_item.cantidad_devuelta
      );
      IF v_colocado < v_item.cantidad_devuelta THEN
        PERFORM devolver_stock_producto(
          v_item.producto_id, p_store_id, v_item.cantidad_devuelta - v_colocado
        );
      END IF;

      v_asignado_en_nc := v_asignado_en_nc || jsonb_build_object(
        v_item.venta_item_id::TEXT,
        COALESCE((v_asignado_en_nc->>(v_item.venta_item_id::TEXT))::NUMERIC, 0) + v_item.cantidad_devuelta
      );
    ELSE
      PERFORM devolver_stock_producto(
        v_item.producto_id,
        p_store_id,
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
  -- (093) al dueño de la NC: el saldo y la NC son el mismo dinero.
  IF p_tipo_reembolso = 'saldo_a_favor' THEN
    PERFORM incrementar_saldo_a_favor(p_store_id, v_nc_cliente_id, v_monto_total);
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

      -- Ticket Trello 6a77e9d5cc6b547f60e1799b: cuando la devolución completa
      -- el retorno TOTAL de la venta (ningún item conserva cantidad sin
      -- devolver), la venta deja de contar como compra → decrementar
      -- frecuencia_compras, igual que hace anular_venta_tx al anular. Criterio
      -- por CANTIDAD (no por monto >= total) para no fallar por el redondeo
      -- por-item del paso 2c (ver encabezado de la migración). La NC recién
      -- insertada (paso 3) ya queda incluida en la suma de devoluciones.
      SELECT NOT EXISTS (
        SELECT 1
          FROM venta_items vi
         WHERE vi.venta_id = p_venta_id
           AND COALESCE((
                 SELECT SUM(nci.cantidad_devuelta)
                   FROM nota_credito_items nci
                   JOIN notas_credito nc ON nc.id = nci.nota_credito_id
                  WHERE nci.venta_item_id = vi.id
                    AND nc.venta_id = p_venta_id
               ), 0) < vi.cantidad
      ) INTO v_retorno_completo;

      v_nueva_frecuencia := CASE WHEN v_retorno_completo
        THEN GREATEST(0, v_fid.frecuencia_compras - 1)
        ELSE v_fid.frecuencia_compras
      END;

      SELECT (n->>'descuento')::NUMERIC INTO v_nuevo_descuento
        FROM jsonb_array_elements(v_niveles) n
       WHERE v_nuevo_total >= (n->>'monto')::NUMERIC
       ORDER BY (n->>'monto')::NUMERIC DESC
       LIMIT 1;
      v_nuevo_descuento := COALESCE(v_nuevo_descuento, 0);

      UPDATE fidelizacion
         SET total_historico     = v_nuevo_total,
             frecuencia_compras  = v_nueva_frecuencia,
             descuento_actual    = v_nuevo_descuento,
             updated_at          = NOW()
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

REVOKE ALL ON FUNCTION public.crear_nota_credito_tx(uuid, text, uuid, jsonb, text, text, text, text, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.crear_nota_credito_tx(uuid, text, uuid, jsonb, text, text, text, text, date, uuid) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('099', '099_venta_granel_por_valor')
ON CONFLICT (version) DO NOTHING;
