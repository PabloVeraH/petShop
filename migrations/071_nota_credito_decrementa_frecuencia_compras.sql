-- Migration 071: crear_nota_credito_tx decrementa frecuencia_compras cuando la
-- devolución completa el retorno TOTAL de la venta
--
-- Ticket Trello 6a77e9d5cc6b547f60e1799b ("[Clientes] Contador de 'compras' en
-- Fidelización no se ajusta al devolver el 100% de una compra").
--
-- ─── Causa raíz (verificada contra el sistema real) ──────────────────────
-- al crear una Nota de Crédito, crear_nota_credito_tx (migración 070
-- desplegada) decrementa fidelizacion.total_historico por el monto de la NC
-- y recalcula descuento_actual, pero NUNCA toca fidelizacion.frecuencia_compras.
-- En paralelo:
--   - crear_venta_tx incrementa frecuencia_compras +1 por venta;
--   - anular_venta_tx la decrementa −1 por venta anulada (migración 057).
--
-- Resultado: al devolver el 100% de una compra, el monto acumulado baja a $0
-- pero el contador queda en "1 compra" → la ficha del cliente muestra la señal
-- contradictoria "1 compra · $0 acumulados" del ticket. Verificado contra el
-- proyecto real: prosrc desplegado de crear_nota_credito_tx == migración 070
-- (sin ninguna referencia a frecuencia_compras); el mismo defecto NO existe en
-- anular_venta_tx (057, decrementa).
--
-- ─── Semántica fijada ─────────────────────────────────────────────────────
-- frecuencia_compras = "compras activas" del cliente: ventas NO anuladas y NO
-- devueltas al 100%. Es la única semántica que hace consistentes monto y
-- contador con el flujo existente (anular_venta_tx ya decrementa por venta
-- anulada; el monto ya se ajusta por NC). Alternativas descartadas en el
-- ticket (que ambos campos queden sin cambios, o tooltip documentando la
-- mezcla) chocan con el comportamiento ya establecido y auditado de que el
-- monto SÍ se ajusta al devolver (§23.5 AGENTS.md).
--
-- ─── Criterio de "retorno completo" ───────────────────────────────────────
-- Por CANTIDAD, no por monto: para CADA venta_item de la venta, la cantidad
-- devuelta acumulada (TODAS las NCs de la venta, cualquier estado) alcanza la
-- cantidad vendida. Se usa cantidad porque el monto de una NC se redondea por
-- item (ROUND(cantidad * precio_unitario * factor_descuento) en el loop 2c) y
-- puede diferir en unos pesos del total de la venta
-- (ROUND(Σ subtotal − descuento) en la ruta) cuando hay descuento + varios
-- items — un umbral de monto >= total fallaría en ese borde y dejaría el
-- contador sin decrementar pese a un retorno del 100% real. La cantidad es
-- exacta (ambas INTEGER) y ya está validada en el paso 2b (nunca se devuelve
-- más que lo vendido), así que "ningún item con saldo pendiente" == retorno
-- total.
--
-- ─── Interacción con anular_venta_tx (mismo cambio, defecto adyacente) ────
-- Sin tocar anular, el nuevo decremento de la NC crearía un DOBLE decremento:
-- venta devuelta al 100% (frecuencia −1 en la NC) que luego se anula
-- (frecuencia −1 en anular) → contador infravalorado. anular_venta_tx ahora
-- solo decrementa frecuencia si la venta aún contaba como compra, usando el
-- MISMO criterio de retorno completo por cantidad — coherente con el neto de
-- monto (paso 4) que también usa TODAS las NCs, cualquier estado.
--
-- Dato legado — backfill puntual aplicado con autorización explícita del
-- usuario al desplegar esta migración (2026-08-10, proyecto real
-- wnxrdbnvreofrrmhcybc, verificado antes de escribir contra el mismo
-- criterio de retorno completo por cantidad): 2 clientes con la firma
-- "N compras · $0 acumulados" (total_historico=0, frecuencia_compras=1),
-- cada uno con exactamente 1 venta 'pagada' devuelta al 100% y ninguna otra
-- venta. UPDATE acotado a esos 2 cliente_id (frecuencia_compras 1→0), fuera
-- de esta migración SQL — no se automatiza como backfill general porque
-- requeriría autorización explícita en cada aplicación futura; cualquier
-- caso legado nuevo que aparezca después de esta fecha queda sin backfillear
-- hasta que se autorice de nuevo.
--
-- ─── REVOKE (obligatorio, ver 069) ────────────────────────────────────────
-- CREATE OR REPLACE sobre crear_nota_credito_tx y anular_venta_tx re-otorga
-- EXECUTE a PUBLIC/anon/authenticated (comportamiento de Supabase). Se repite
-- el REVOKE en la misma migración que reescribe ambas funciones.

-- ── 1. crear_nota_credito_tx (v3 — decrementa frecuencia en retorno total) ──
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
  v_nueva_frecuencia INTEGER;
  v_retorno_completo BOOLEAN;
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

-- ── 2. anular_venta_tx (v3 — no doble-decrementa frecuencia en venta 100% devuelta) ──
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
  v_pago             RECORD;
  v_cliente_destino  UUID;
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
  v_retorno_completo BOOLEAN;
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

      -- Ticket Trello 6a77e9d5cc6b547f60e1799b: solo decrementar frecuencia si
      -- la venta aún contaba como compra. Una venta devuelta al 100% vía NC ya
      -- la decrementó al completarse el retorno (crear_nota_credito_tx v3) —
      -- restarla de nuevo aquí duplicaría el efecto (contador infravalorado).
      -- Mismo criterio por cantidad que la NC (todas las NCs, cualquier estado)
      -- para no depender del redondeo por-item del monto.
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
        THEN v_fid.frecuencia_compras
        ELSE GREATEST(0, v_fid.frecuencia_compras - 1)
      END;

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

  -- 6. Restaurar el saldo_a_favor CONSUMIDO como pago de ESTA venta (espejo
  --    de crear_venta_tx paso 4 y de gastar_saldo_a_favor_pago): al anularse
  --    la venta, los productos vuelven al stock (paso 3) y el cliente
  --    recupera el crédito que usó. Sin este paso el cliente perdía el
  --    crédito consumido y el pasivo Saldos a Favor (que el contra-asiento
  --    reacredita) quedaba sin respaldo en el subledger.
  FOR v_pago IN
    SELECT metodo, monto, nota_credito_id
      FROM pagos
     WHERE venta_id = p_venta_id
       AND metodo IN ('nota_credito', 'saldo_a_favor')
  LOOP
    -- Mismo destinatario que el decremento original: para 'nota_credito',
    -- el cliente de la venta ORIGEN de la NC (crear_venta_tx decrementa a
    -- ese cliente); para 'saldo_a_favor', el cliente de esta venta.
    v_cliente_destino := NULL;
    IF v_pago.metodo = 'nota_credito' AND v_pago.nota_credito_id IS NOT NULL THEN
      SELECT v2.cliente_id INTO v_cliente_destino
        FROM notas_credito nc
        JOIN ventas v2 ON v2.id = nc.venta_id
       WHERE nc.id = v_pago.nota_credito_id;
    END IF;
    v_cliente_destino := COALESCE(v_cliente_destino, v_venta.cliente_id);

    IF v_cliente_destino IS NOT NULL AND v_pago.monto > 0 THEN
      PERFORM incrementar_saldo_a_favor(p_store_id, v_cliente_destino, v_pago.monto);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('venta', to_jsonb(v_venta), 'costo_total', v_costo_total);
END;
$$;

-- ── 3. Grants / revokes ───────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION crear_nota_credito_tx TO service_role;
GRANT EXECUTE ON FUNCTION anular_venta_tx TO service_role;
-- REVOKE obligatorio (ver 069): CREATE OR REPLACE re-otorga EXECUTE a
-- PUBLIC/anon/authenticated — sin esto el hueco de seguridad vuelve.
REVOKE EXECUTE ON FUNCTION crear_nota_credito_tx FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_nota_credito_tx FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION anular_venta_tx FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION anular_venta_tx FROM anon, authenticated;
