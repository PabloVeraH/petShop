-- migrations/078_granel_ventas_devoluciones.sql
-- Fase 1b del plan docs/canales-stock/stock_canales_externos.md — segunda de
-- dos migraciones que se aplican JUNTAS y EN ORDEN (077 → 078). Depende de
-- consumir_granel, devolver_granel y fraccion_gramos de 077.
--
-- Estado: APLICADA el 2026-09-24 (execute_sql vía MCP, con confirmación explícita
-- del usuario) y verificada con docs/canales-stock/stock_canales_fase1b_verificacion.sql (G1–G17 OK).
-- Antes: requería confirmación explícita del usuario
-- (AGENTS.md §0.1 / §11.2).
--
-- ─── Qué cambia (resto: copia literal de 074 / 075) ──────────────────────
-- crear_venta_tx   (base: 074)
--   - Sin casts ::INTEGER de cantidad (S9/V12: '0.5'::INTEGER lanzaba error
--     → toda venta a granel fallaba).
--   - Línea granel (es_granel = true): gramos enteros obligatorios; la BD
--     fija cantidad = gramos / 1000 (kg, para precio y recibo) — no confía
--     en la cantidad del cliente. Descuenta gramos del saco abierto con
--     consumir_granel (stock total baja gramos/peso, D20); si no alcanzan,
--     abre saco nuevo solo si la línea trae abrir_saco = true (el POS lo
--     confirmó, G1); si no, 'Saco abierto insuficiente'.
--   - Línea por unidad: cantidad entera obligatoria ('Cantidad inválida').
--   - Guarda venta_items.es_granel / gramos (V20).
--   - Alerta de consumo: gramos reales para granel (antes cantidad × peso).
--   - Parámetro nuevo p_user_id (usuario autenticado, para abierto_por /
--     cerrado_por del saco; p_worker_clerk_id lo elige el cliente). Firma
--     nueva → DROP + CREATE (PostgREST llama por nombre; DEFAULT NULL).
-- anular_venta_tx   (base: 075)
--   - Ítem granel: los gramos NETOS pendientes (gramos − Σ devuelto por NC
--     con restituir_stock, §23.5) vuelven al saco abierto (devolver_granel,
--     G7). Costo proporcional gramos/peso × costo (G5).
-- crear_nota_credito_tx   (base: 075)
--   - cantidad_devuelta NUMERIC: granel en kg (3 decimales = gramos
--     exactos); por unidad sigue exigiendo enteros.
--   - Ítem granel: devolver_granel(gramos) en vez de lotes; costo
--     proporcional (G5).
--
-- §23.5 AGENTS.md: cantidades netas, fidelización, frecuencia, NCs activas,
-- saldo a favor, crédito consumido como pago y reclamo atómico inicial de
-- anular_venta_tx quedan idénticos.

BEGIN;

-- ── 1. crear_venta_tx ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text);

CREATE FUNCTION public.crear_venta_tx(p_store_id uuid, p_items jsonb, p_cliente_id uuid, p_worker_clerk_id text, p_subtotal numeric, p_descuento_pct numeric, p_impuesto numeric, p_total numeric, p_metodo_pago text, p_canal text, p_procedencia text, p_numero_comprobante text, p_pago_nc jsonb, p_numero_transaccion text, p_fidelizacion_niveles jsonb, p_dias_aviso integer, p_idempotency_key text DEFAULT NULL::text, p_user_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_venta              RECORD;
  v_existente          RECORD;
  v_venta_item_id      UUID;
  v_idx                INTEGER;
  v_item               JSONB;
  v_producto_id        UUID;
  v_mascota_id         UUID;
  v_tiene_lotes        BOOLEAN;
  v_es_granel          BOOLEAN;
  v_gramos             INTEGER;
  v_cantidad           NUMERIC;
  v_peso_saco          INTEGER;
  v_metodo_pago_final  TEXT;
  v_monto_nc           NUMERIC;
  v_monto_resto        NUMERIC;
  v_nc_cliente_id      UUID;
  v_saldo_disp         NUMERIC;
  v_peso_gramos        INTEGER;
  v_es_alimento        BOOLEAN;
  v_mascota_cliente_id UUID;
  v_gramos_porcion     NUMERIC;
  v_veces_dia          INTEGER;
  v_consumo_diario     NUMERIC;
  v_total_gramos       NUMERIC;
  v_dias_estimados     INTEGER;
  v_fecha_termino      DATE;
  v_fid_total          NUMERIC;
  v_fid_frecuencia     INTEGER;
  v_nuevo_descuento    NUMERIC;
  v_nivel              JSONB;
  v_nivel_idx          INTEGER;
BEGIN
  -- ── 0. Idempotencia — reclamo temprano ────────────────────────────────────
  -- Si esta idempotency_key ya generó una venta para esta tienda, es un
  -- reintento (red, doble clic) del MISMO intento de cobro: devolver la venta
  -- ya creada sin repetir ningún efecto (stock, pagos, fidelización).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existente FROM ventas
     WHERE store_id = p_store_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      -- created=false: el caller (POST /api/ventas) usa esto para NO repetir
      -- auditoría, email/WhatsApp ni asientos contables de una venta que ya
      -- los disparó en el intento original.
      RETURN jsonb_build_object('venta', to_jsonb(v_existente), 'created', false);
    END IF;
  END IF;

  -- ── 1. Determinar método de pago final ────────────────────────────────────
  IF p_pago_nc IS NOT NULL THEN
    v_monto_nc          := (p_pago_nc->>'monto')::NUMERIC;
    v_monto_resto       := ROUND((p_total - v_monto_nc) * 100) / 100;
    v_metodo_pago_final := CASE WHEN v_monto_nc >= p_total THEN 'nota_credito' ELSE 'mixto' END;
  ELSE
    v_metodo_pago_final := p_metodo_pago;
  END IF;

  -- ── 2. Crear venta ────────────────────────────────────────────────────────
  -- Envuelto en su propio bloque para capturar la carrera: dos requests
  -- concurrentes con la MISMA idempotency_key (ninguno vio el check del paso 0
  -- todavía committeado) — el segundo INSERT choca contra el índice único
  -- parcial y, en vez de fallar, devuelve la venta que ganó la carrera.
  BEGIN
    INSERT INTO ventas (
      store_id, cliente_id, worker_clerk_id,
      subtotal, descuento, impuesto, total,
      metodo_pago, canal, procedencia, estado, numero_comprobante, idempotency_key
    ) VALUES (
      p_store_id, p_cliente_id, p_worker_clerk_id,
      p_subtotal, p_descuento_pct, p_impuesto, p_total,
      v_metodo_pago_final, p_canal, p_procedencia, 'pagada', p_numero_comprobante, p_idempotency_key
    ) RETURNING * INTO v_venta;
  EXCEPTION WHEN unique_violation THEN
    IF p_idempotency_key IS NOT NULL THEN
      SELECT * INTO v_existente FROM ventas
       WHERE store_id = p_store_id AND idempotency_key = p_idempotency_key;
      IF FOUND THEN
        RETURN jsonb_build_object('venta', to_jsonb(v_existente), 'created', false);
      END IF;
    END IF;
    RAISE;
  END;

  -- ── 3. Procesar items ─────────────────────────────────────────────────────
  FOR v_idx IN 0..jsonb_array_length(p_items) - 1 LOOP
    v_item        := p_items->v_idx;
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_mascota_id  := NULLIF(v_item->>'mascota_id', '')::UUID;
    v_es_granel   := COALESCE((v_item->>'es_granel')::BOOLEAN, FALSE);

    -- 3.0 Cantidad (migración 078). Granel: gramos enteros = fuente de
    --     verdad; cantidad (kg) se deriva aquí. Por unidad: entera.
    IF v_es_granel THEN
      v_gramos := (v_item->>'gramos')::INTEGER;
      IF v_gramos IS NULL OR v_gramos <= 0 THEN
        RAISE EXCEPTION 'Cantidad inválida: una venta a granel requiere gramos (producto=%)', v_producto_id;
      END IF;
      v_cantidad := v_gramos / 1000.0;
    ELSE
      v_gramos   := NULL;
      v_cantidad := (v_item->>'cantidad')::NUMERIC;
      IF v_cantidad IS NULL OR v_cantidad <= 0 OR v_cantidad <> trunc(v_cantidad) THEN
        RAISE EXCEPTION 'Cantidad inválida: la venta por unidad requiere una cantidad entera (producto=%, cantidad=%)',
          v_producto_id, v_item->>'cantidad';
      END IF;
    END IF;

    -- 3a. Insertar venta_item
    INSERT INTO venta_items (
      venta_id, producto_id, cantidad, precio_unitario, subtotal, mascota_id, es_granel, gramos
    ) VALUES (
      v_venta.id,
      v_producto_id,
      v_cantidad,
      (v_item->>'precio_unitario')::NUMERIC,
      (v_item->>'subtotal')::NUMERIC,
      v_mascota_id,
      v_es_granel,
      v_gramos
    ) RETURNING id INTO v_venta_item_id;

    -- 3b. Descontar stock.
    --     Granel (078): gramos del saco abierto (consumir_granel valida que el
    --     producto sea de esta tienda y esté habilitado para granel).
    --     Por unidad: FIFO si el producto tiene CUALQUIER lote activo
    --     (074); decrement_stock estricto si no. Todas fallan con
    --     'Stock insuficiente ...' si no alcanza (D2).
    IF v_es_granel THEN
      PERFORM consumir_granel(
        p_store_id,
        v_producto_id,
        v_venta_item_id,
        v_gramos,
        COALESCE((v_item->>'abrir_saco')::BOOLEAN, FALSE),
        COALESCE(p_user_id, p_worker_clerk_id)
      );
    ELSE
      SELECT EXISTS (
        SELECT 1
          FROM lotes_producto
         WHERE producto_id = v_producto_id
           AND store_id    = p_store_id
           AND activo      = true
      ) INTO v_tiene_lotes;

      IF v_tiene_lotes THEN
        PERFORM deducir_stock_fifo(
          v_producto_id,
          p_store_id,
          v_cantidad,
          v_venta_item_id
        );
      ELSE
        PERFORM decrement_stock(
          v_producto_id,
          v_cantidad
        );
      END IF;
    END IF;

    -- 3c. Registrar movimiento de stock. Granel: la proporción del saco
    --     (gramos / peso), que es lo que bajó el stock total.
    IF v_es_granel THEN
      SELECT peso_gramos INTO v_peso_saco FROM productos WHERE id = v_producto_id;
      INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
      VALUES (
        v_producto_id,
        'salida',
        -fraccion_gramos(v_gramos, v_peso_saco),
        v_venta.id,
        'Venta ' || v_venta.id || ' (' || v_gramos || ' g granel)',
        p_user_id
      );
    ELSE
      INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas)
      VALUES (
        v_producto_id,
        'salida',
        -v_cantidad,
        v_venta.id,
        'Venta ' || v_venta.id
      );
    END IF;

    -- 3d. Consumo alerta si hay mascota vinculada
    IF v_mascota_id IS NOT NULL THEN
      SELECT p.peso_gramos, c.es_alimento
        INTO v_peso_gramos, v_es_alimento
        FROM productos p
        LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE p.id = v_producto_id;

      IF v_es_alimento AND v_peso_gramos IS NOT NULL THEN
        SELECT cliente_id, gramos_porcion, veces_dia
          INTO v_mascota_cliente_id, v_gramos_porcion, v_veces_dia
          FROM mascotas
         WHERE id = v_mascota_id;

        IF v_gramos_porcion > 0 AND v_veces_dia > 0 THEN
          v_consumo_diario := v_gramos_porcion * v_veces_dia;
          v_total_gramos   := CASE WHEN v_es_granel THEN v_gramos ELSE v_cantidad * v_peso_gramos END;
          v_dias_estimados := ROUND(v_total_gramos / v_consumo_diario);
          v_fecha_termino  := CURRENT_DATE + v_dias_estimados;

          INSERT INTO consumo_alertas (
            store_id, cliente_id, mascota_id, producto_id,
            fecha_estimada_termino, dias_aviso, enviado
          ) VALUES (
            p_store_id, v_mascota_cliente_id, v_mascota_id, v_producto_id,
            v_fecha_termino, p_dias_aviso, false
          )
          ON CONFLICT (mascota_id, producto_id) DO UPDATE SET
            fecha_estimada_termino = EXCLUDED.fecha_estimada_termino,
            dias_aviso             = EXCLUDED.dias_aviso,
            enviado                = false;

          UPDATE mascotas
             SET alimento_habitual_id = v_producto_id
           WHERE id = v_mascota_id;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- ── 4. Registrar pagos ────────────────────────────────────────────────────
  IF p_pago_nc IS NOT NULL THEN
    -- Pago con nota de crédito (puede ser total o parcial)
    INSERT INTO pagos (store_id, venta_id, metodo, monto, nota_credito_id, numero_transaccion)
    VALUES (
      p_store_id, v_venta.id, 'nota_credito',
      v_monto_nc, (p_pago_nc->>'nota_credito_id')::UUID, p_pago_nc->>'numero_nc'
    );

    IF v_monto_resto > 0 THEN
      INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
      VALUES (p_store_id, v_venta.id, p_metodo_pago, v_monto_resto, p_numero_transaccion);
    END IF;

    -- Marcar NC como usada
    UPDATE notas_credito
       SET estado = 'usada'
     WHERE id = (p_pago_nc->>'nota_credito_id')::UUID;

    -- Deducir saldo_a_favor si la NC tiene venta de origen con cliente
    SELECT v2.cliente_id INTO v_nc_cliente_id
      FROM notas_credito nc
      JOIN ventas v2 ON v2.id = nc.venta_id
     WHERE nc.id = (p_pago_nc->>'nota_credito_id')::UUID
       AND nc.venta_id IS NOT NULL;

    IF v_nc_cliente_id IS NOT NULL THEN
      SELECT saldo_disponible INTO v_saldo_disp
        FROM saldos_a_favor
       WHERE cliente_id = v_nc_cliente_id AND store_id = p_store_id;

      IF FOUND THEN
        UPDATE saldos_a_favor
           SET saldo_disponible = GREATEST(0, v_saldo_disp - v_monto_nc),
               updated_at       = NOW()
         WHERE cliente_id = v_nc_cliente_id AND store_id = p_store_id;
      END IF;
    END IF;
  ELSE
    INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
    VALUES (p_store_id, v_venta.id, p_metodo_pago, p_total, p_numero_transaccion);
  END IF;

  -- ── 5. Actualizar fidelización ────────────────────────────────────────────
  IF p_cliente_id IS NOT NULL THEN
    SELECT total_historico, frecuencia_compras
      INTO v_fid_total, v_fid_frecuencia
      FROM fidelizacion
     WHERE cliente_id = p_cliente_id;

    v_fid_total      := COALESCE(v_fid_total, 0) + p_total;
    v_fid_frecuencia := COALESCE(v_fid_frecuencia, 0) + 1;
    v_nuevo_descuento := 0;

    -- Recorrer niveles de mayor a menor monto para encontrar el nivel alcanzado
    FOR v_nivel_idx IN REVERSE jsonb_array_length(p_fidelizacion_niveles) - 1..0 LOOP
      v_nivel := p_fidelizacion_niveles->v_nivel_idx;
      IF v_fid_total >= (v_nivel->>'monto')::NUMERIC THEN
        v_nuevo_descuento := (v_nivel->>'descuento')::NUMERIC;
        EXIT;
      END IF;
    END LOOP;

    INSERT INTO fidelizacion (cliente_id, total_historico, frecuencia_compras, descuento_actual, updated_at)
    VALUES (p_cliente_id, v_fid_total, v_fid_frecuencia, v_nuevo_descuento, NOW())
    ON CONFLICT (cliente_id) DO UPDATE SET
      total_historico    = EXCLUDED.total_historico,
      frecuencia_compras = EXCLUDED.frecuencia_compras,
      descuento_actual   = EXCLUDED.descuento_actual,
      updated_at         = EXCLUDED.updated_at;
  END IF;

  RETURN jsonb_build_object('venta', to_jsonb(v_venta), 'created', true);
END;
$function$;

-- ── 2. anular_venta_tx ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.anular_venta_tx(p_store_id uuid, p_venta_id uuid, p_user_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venta            RECORD;
  v_item             RECORD;
  v_nc               RECORD;
  v_pago             RECORD;
  v_cliente_destino  UUID;
  v_ya_devuelto      NUMERIC;
  v_pendiente        NUMERIC;
  v_gramos_pend      INTEGER;
  v_frac             NUMERIC;
  v_colocado         NUMERIC;
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
  --    restituir_stock=true (esa porción ya volvió al stock cuando se creó
  --    la NC — restaurar la cantidad completa la duplicaría).
  --    Migración 075 (S12): las unidades vuelven a los LOTES de los que
  --    salieron (tramo [ya devuelto, ya devuelto + pendiente) de sus
  --    venta_item_lotes), no a productos.stock — el trigger
  --    sync_stock_on_lote las borraba en el próximo cambio de lote.
  --    Migración 078 (G7): una línea granel devuelve sus GRAMOS netos
  --    pendientes al saco abierto (devolver_granel); costo proporcional.
  FOR v_item IN
    SELECT id, producto_id, cantidad, es_granel, gramos
      FROM venta_items
     WHERE venta_id = p_venta_id
  LOOP
    SELECT COALESCE(SUM(nci.cantidad_devuelta), 0) INTO v_ya_devuelto
      FROM nota_credito_items nci
      JOIN notas_credito nc ON nc.id = nci.nota_credito_id
     WHERE nci.venta_item_id = v_item.id
       AND nc.venta_id = p_venta_id
       AND nci.restituir_stock = true;

    v_pendiente := GREATEST(0, v_item.cantidad - v_ya_devuelto);
    CONTINUE WHEN v_pendiente <= 0;

    SELECT stock, costo, peso_gramos INTO v_producto FROM productos WHERE id = v_item.producto_id;
    IF FOUND THEN
      IF v_item.es_granel THEN
        -- cantidad y cantidad_devuelta están en kg (3 decimales = gramos exactos).
        v_gramos_pend := GREATEST(0, v_item.gramos - ROUND(v_ya_devuelto * 1000)::INTEGER);
        CONTINUE WHEN v_gramos_pend <= 0;
        v_frac := devolver_granel(p_store_id, v_item.producto_id, v_gramos_pend, p_user_id);
        v_costo_total := v_costo_total
          + COALESCE(COALESCE(v_producto.costo, 0) * v_gramos_pend / NULLIF(v_producto.peso_gramos, 0), 0);

        INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
        VALUES (
          v_item.producto_id,
          'entrada',
          v_frac,
          p_venta_id,
          'Anulación ' || COALESCE(v_venta.numero_comprobante, LEFT(p_venta_id::TEXT, 8))
            || ' (' || v_gramos_pend || ' g granel)',
          p_user_id
        );
        CONTINUE;
      END IF;

      v_costo_total := v_costo_total + COALESCE(v_producto.costo, 0) * v_pendiente;

      IF EXISTS (SELECT 1 FROM venta_item_lotes WHERE venta_item_id = v_item.id) THEN
        v_colocado := devolver_a_lotes_venta_item(v_item.id, v_ya_devuelto, v_pendiente);
        IF v_colocado < v_pendiente THEN
          PERFORM devolver_stock_producto(v_item.producto_id, p_store_id, v_pendiente - v_colocado);
        END IF;
      ELSE
        PERFORM devolver_stock_producto(v_item.producto_id, p_store_id, v_pendiente);
      END IF;

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
$function$;

-- ── 3. crear_nota_credito_tx ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_nota_credito_tx(p_store_id uuid, p_user_id text, p_venta_id uuid, p_items jsonb, p_numero_nc text, p_motivo text, p_tipo_reembolso text, p_metodo_reembolso text, p_fecha_vencimiento date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    cantidad_devuelta NUMERIC,
    restituir_stock BOOLEAN
  )
  LOOP
    v_restituir := COALESCE(v_item.restituir_stock, true);

    -- 2a. Leer datos del item de venta, validar pertenencia. vi.servicio_id
    --     se lee aquí (cambio 3f.1 de 068) — el LEFT JOIN a productos sigue
    --     siendo seguro con producto_id NULL y deja p.costo NULL → 0.
    SELECT vi.id, vi.cantidad, vi.precio_unitario, vi.producto_id, vi.servicio_id,
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
    v_subtotal := ROUND(v_item.cantidad_devuelta * v_venta_item.precio_unitario * v_descuento_factor);

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
$function$;

-- ── 4. Grants (patrón 069) ───────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION crear_venta_tx        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_venta_tx        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION anular_venta_tx       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION anular_venta_tx       FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION crear_nota_credito_tx FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_nota_credito_tx FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION crear_venta_tx        TO service_role;
GRANT  EXECUTE ON FUNCTION anular_venta_tx       TO service_role;
GRANT  EXECUTE ON FUNCTION crear_nota_credito_tx TO service_role;

COMMIT;
