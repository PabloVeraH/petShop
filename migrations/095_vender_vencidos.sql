-- 095: "Vender productos vencidos" (configuración por tienda) y mensaje claro
-- cuando el stock que se ve no se puede vender porque está en lotes vencidos.
--
-- Problema (mascotaspetshop, 2026-11-23): un producto con "Stock: 1" no se
-- podía vender ("Stock insuficiente para completar la venta"). productos.stock
-- suma TODOS los lotes activos (trigger sync_producto_stock_from_lotes), pero
-- deducir_stock_fifo solo descontaba de lotes con fecha_vencimiento >= hoy: el
-- único lote estaba vencido. El cajero no tenía cómo saberlo.
--
-- Cambios:
--   1. stores.vender_vencidos (boolean, default false = como hasta hoy: no se
--      venden lotes vencidos). Lo cambia el storeAdmin/systemAdmin en
--      /settings (PATCH /api/settings ya exige admin).
--   2. deducir_stock_fifo: parámetro nuevo p_incluir_vencidos (default false,
--      así abrir_saco_interno y PATCH /api/inventario/[id] siguen igual). Con
--      true consume PRIMERO los lotes vigentes (FIFO) y solo después los
--      vencidos: un lote vencido se vende solo si no hay stock vigente.
--      El error de stock ahora nombra el producto y separa vigentes y vencidos.
--      Mismo prefijo "Stock insuficiente" (lo interpretan stock-errors.ts,
--      procesar-orden.ts y POST /api/ventas).
--   3. crear_venta_tx: lee stores.vender_vencidos y lo aplica SOLO a ventas del
--      POS (p_canal = 'pos'). Las órdenes de canales externos nunca venden
--      lotes vencidos (nadie ve la advertencia y el cliente no la aceptó).
--      El resto de la función es idéntico a la 093.
--
-- Datos: no cambia filas (la columna nace en false para todas las tiendas).
-- Sin revisión previa. Reversible: volver a aplicar deducir_stock_fifo y
-- crear_venta_tx de la 093/092 y DROP COLUMN stores.vender_vencidos.
-- APLICAR ANTES DE DESPLEGAR el código que lee stores.vender_vencidos
-- (GET /api/settings y GET /api/tienda/nombre fallarían sin la columna). El
-- código anterior sigue funcionando con esta migración.
-- Requiere la 090 (registro al final), 092 (hoy_negocio) y 093.

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS vender_vencidos boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stores.vender_vencidos IS
  'Si true, el POS puede vender unidades de lotes vencidos (con advertencia), después de agotar los vigentes. Solo ventas canal pos.';

-- Firma nueva (parámetro extra): se elimina la de 4 parámetros para que no
-- queden dos sobrecargas. Los llamadores con 4 argumentos usan el default.
DROP FUNCTION IF EXISTS public.deducir_stock_fifo(uuid, uuid, numeric, uuid);

CREATE FUNCTION public.deducir_stock_fifo(p_producto_id uuid, p_store_id uuid, p_cantidad numeric, p_venta_item_id uuid DEFAULT NULL::uuid, p_incluir_vencidos boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_restante  NUMERIC := p_cantidad;
  v_lote      RECORD;
  v_deducir   NUMERIC;
  v_vigente   NUMERIC;
  v_vencido   NUMERIC;
  v_disponible NUMERIC;
  v_nombre    TEXT;
  v_hoy       DATE := public.hoy_negocio();
  v_resultado JSONB := '[]'::JSONB;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida para descontar stock: %', p_cantidad;
  END IF;

  -- Bloqueo del producto (tenant-scoped): serializa ventas concurrentes del
  -- mismo producto — la segunda espera y luego ve los lotes ya descontados.
  SELECT nombre INTO v_nombre
    FROM productos
   WHERE id = p_producto_id AND store_id = p_store_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  SELECT COALESCE(SUM(cantidad_actual) FILTER (WHERE fecha_vencimiento >= v_hoy), 0),
         COALESCE(SUM(cantidad_actual) FILTER (WHERE fecha_vencimiento <  v_hoy), 0)
    INTO v_vigente, v_vencido
    FROM lotes_producto
   WHERE producto_id     = p_producto_id
     AND store_id        = p_store_id
     AND activo          = TRUE
     AND cantidad_actual > 0;

  v_disponible := v_vigente + (CASE WHEN p_incluir_vencidos THEN v_vencido ELSE 0 END);

  IF v_disponible < p_cantidad THEN
    IF v_vencido > 0 AND NOT p_incluir_vencidos THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": vigentes %, en lotes vencidos %, solicitado %',
        v_nombre, trim_scale(v_vigente), trim_scale(v_vencido), trim_scale(p_cantidad);
    END IF;
    RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %',
      v_nombre, trim_scale(v_disponible), trim_scale(p_cantidad);
  END IF;

  -- Vigentes primero (false < true), luego FIFO por ingreso.
  FOR v_lote IN
    SELECT id, cantidad_actual, fecha_ingreso, fecha_vencimiento
      FROM lotes_producto
     WHERE producto_id     = p_producto_id
       AND store_id        = p_store_id
       AND activo          = TRUE
       AND cantidad_actual > 0
       AND (p_incluir_vencidos OR fecha_vencimiento >= v_hoy)
     ORDER BY (fecha_vencimiento < v_hoy) ASC, fecha_ingreso ASC, created_at ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;

    v_deducir := LEAST(v_lote.cantidad_actual, v_restante);

    UPDATE lotes_producto
       SET cantidad_actual = cantidad_actual - v_deducir,
           updated_at      = NOW()
     WHERE id = v_lote.id;

    IF p_venta_item_id IS NOT NULL THEN
      INSERT INTO venta_item_lotes (venta_item_id, lote_id, cantidad)
      VALUES (p_venta_item_id, v_lote.id, v_deducir);
    END IF;

    v_resultado := v_resultado || jsonb_build_array(
      jsonb_build_object(
        'lote_id',           v_lote.id,
        'cantidad_deducida', v_deducir,
        'fecha_ingreso',     v_lote.fecha_ingreso,
        'vencido',           v_lote.fecha_vencimiento < v_hoy
      )
    );

    v_restante := v_restante - v_deducir;
  END LOOP;

  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.deducir_stock_fifo(uuid, uuid, numeric, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.deducir_stock_fifo(uuid, uuid, numeric, uuid, boolean) TO service_role;

-- crear_venta_tx: idéntica a la 093 salvo (a) v_incluir_vencidos, leído de la
-- tienda y limitado al canal 'pos', y (b) su paso a deducir_stock_fifo.

CREATE OR REPLACE FUNCTION public.crear_venta_tx(p_store_id uuid, p_items jsonb, p_cliente_id uuid, p_worker_clerk_id text, p_subtotal numeric, p_descuento_pct numeric, p_impuesto numeric, p_total numeric, p_metodo_pago text, p_canal text, p_procedencia text, p_numero_comprobante text, p_pago_nc jsonb, p_numero_transaccion text, p_fidelizacion_niveles jsonb, p_dias_aviso integer, p_idempotency_key text DEFAULT NULL::text, p_user_id text DEFAULT NULL::text, p_pagos jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
  v_pagos              JSONB;
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
  v_incluir_vencidos   BOOLEAN;
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

  -- ── 1. Validar pagos y determinar método de pago final (093) ──────────────
  --     Lista nueva (p_pagos) o parámetros antiguos convertidos. Se valida
  --     antes de tocar nada: suma exacta contra p_total, forma y cardinalidad.
  v_pagos := COALESCE(p_pagos, public.pagos_desde_legado(p_metodo_pago, p_pago_nc, p_numero_transaccion, p_total));
  v_metodo_pago_final := public.validar_pagos(v_pagos, p_total, p_cliente_id, p_canal <> 'pos');

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

  -- ── 2b. Lotes vencidos (095): solo ventas del POS y si la tienda lo
  --       habilitó en /settings. Canales externos: nunca.
  SELECT p_canal = 'pos' AND vender_vencidos
    INTO v_incluir_vencidos
    FROM stores
   WHERE id = p_store_id;
  v_incluir_vencidos := COALESCE(v_incluir_vencidos, FALSE);

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
          v_venta_item_id,
          v_incluir_vencidos
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
          v_fecha_termino  := public.hoy_negocio() + v_dias_estimados;

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

  -- ── 4. Registrar pagos y consumir crédito (093) ──────────────────────────
  PERFORM public.aplicar_pagos(p_store_id, v_venta.id, p_cliente_id, v_pagos);

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
$$;

REVOKE ALL ON FUNCTION public.crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text, text, jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('095', '095_vender_vencidos')
ON CONFLICT (version) DO NOTHING;
