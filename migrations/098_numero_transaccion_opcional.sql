-- 098: "Nro. Transacción en ventas" (configuración por tienda).
--
-- Hasta aquí todo pago con débito, crédito o transferencia exigía número de
-- transacción, en el POS y en el cobro de citas. Pedido (2026-11-24): que cada
-- tienda pueda dejarlo opcional desde /settings.
--
-- Cambios:
--   1. stores.numero_transaccion_obligatorio (boolean, default true = como
--      hasta hoy). Lo cambia el storeAdmin/systemAdmin (PATCH /api/settings).
--   2. validar_pagos: parámetro p_trx_obligatoria (default true; NULL = true:
--      si no se puede leer la configuración, se exige). Solo condiciona el
--      número de transacción: suma exacta, NC, saldo y lo demás no cambian.
--   3. crear_venta_tx (copia de la 096) y completar_cita_tx (copia de la 093):
--      pasan la configuración de SU tienda. El resto es idéntico.
--
-- pagos.numero_transaccion ya acepta NULL (efectivo): sin cambio de columna. Si
-- el cajero lo escribe igual, se guarda como siempre.
--
-- Datos: no cambia filas. El código anterior sigue funcionando con esta
-- migración. APLICAR ANTES DE DESPLEGAR el código nuevo (GET /api/settings,
-- GET /api/tienda/nombre, POST /api/ventas y PATCH /api/citas leen la columna).
-- Requiere 090, 093 y 096. Reversible: validar_pagos y completar_cita_tx de la
-- 093, crear_venta_tx de la 096 y DROP COLUMN.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS numero_transaccion_obligatorio boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.stores.numero_transaccion_obligatorio IS
  'Si true (default), los pagos con débito, crédito o transferencia exigen número de transacción (POS y citas).';

-- Firma nueva: se elimina la de 4 parámetros para no dejar dos sobrecargas.
-- Los llamadores con 3 o 4 argumentos usan el default.
DROP FUNCTION IF EXISTS public.validar_pagos(jsonb, numeric, uuid, boolean);
DROP FUNCTION IF EXISTS public.validar_pagos(jsonb, numeric, uuid, boolean, boolean);

CREATE FUNCTION public.validar_pagos(p_pagos jsonb, p_total numeric, p_cliente_id uuid, p_permitir_plataforma boolean DEFAULT false, p_trx_obligatoria boolean DEFAULT true) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_pago  RECORD;
  v_n     INTEGER;
  v_nc    INTEGER := 0;
  v_saldo INTEGER := 0;
  v_suma  NUMERIC := 0;
BEGIN
  IF p_pagos IS NULL OR jsonb_typeof(p_pagos) <> 'array' THEN
    RAISE EXCEPTION 'Pagos inválidos: se esperaba una lista de pagos' USING ERRCODE = 'PV001';
  END IF;
  v_n := jsonb_array_length(p_pagos);
  IF v_n = 0 OR v_n > 5 THEN
    RAISE EXCEPTION 'Pagos inválidos: se permiten de 1 a 5 medios de pago' USING ERRCODE = 'PV001';
  END IF;

  FOR v_pago IN
    SELECT * FROM jsonb_to_recordset(p_pagos)
      AS x(metodo text, monto numeric, numero_transaccion text, nota_credito_id uuid)
  LOOP
    IF v_pago.metodo IS NULL OR (v_pago.metodo NOT IN
       ('efectivo', 'debito', 'credito', 'transferencia', 'nota_credito', 'saldo_a_favor')
       AND NOT (p_permitir_plataforma AND v_pago.metodo = 'plataforma')) THEN
      RAISE EXCEPTION 'Pagos inválidos: método de pago no permitido (%)', COALESCE(v_pago.metodo, 'vacío')
        USING ERRCODE = 'PV001';
    END IF;
    -- $0 solo como pago único de una venta de $0 (100 % de descuento); la suma
    -- exacta contra el total lo garantiza.
    -- Un crédito interno por $0 no paga nada pero igual reclamaría la NC
    -- (quedaría 'usada' sin descontar): siempre > 0.
    IF v_pago.monto IS NULL OR v_pago.monto < 0 OR v_pago.monto <> trunc(v_pago.monto)
       OR (v_pago.monto = 0 AND (v_n > 1 OR v_pago.metodo IN ('nota_credito', 'saldo_a_favor'))) THEN
      RAISE EXCEPTION 'Pagos inválidos: cada monto debe ser un entero mayor a 0' USING ERRCODE = 'PV001';
    END IF;
    IF COALESCE(p_trx_obligatoria, TRUE)
       AND v_pago.metodo IN ('debito', 'credito', 'transferencia')
       AND NULLIF(btrim(v_pago.numero_transaccion), '') IS NULL THEN
      RAISE EXCEPTION 'Pagos inválidos: falta el número de transacción del pago con %', v_pago.metodo
        USING ERRCODE = 'PV001';
    END IF;
    IF (v_pago.metodo = 'nota_credito') <> (v_pago.nota_credito_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Pagos inválidos: la nota de crédito solo va en un pago con nota de crédito'
        USING ERRCODE = 'PV001';
    END IF;
    IF v_pago.metodo = 'nota_credito' THEN v_nc := v_nc + 1; END IF;
    IF v_pago.metodo = 'saldo_a_favor' THEN v_saldo := v_saldo + 1; END IF;
    v_suma := v_suma + v_pago.monto;
  END LOOP;

  -- Una NC tipo saldo_a_favor y el saldo del cliente son el mismo dinero:
  -- combinarlos en una venta abre un doble consumo (decisión D8).
  IF v_nc > 1 OR v_saldo > 1 OR (v_nc > 0 AND v_saldo > 0) THEN
    RAISE EXCEPTION 'Pagos inválidos: máximo una nota de crédito o un pago con saldo a favor por venta, no ambos'
      USING ERRCODE = 'PV001';
  END IF;
  IF v_saldo > 0 AND p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'El saldo a favor requiere un cliente asociado a la venta' USING ERRCODE = 'PV007';
  END IF;
  IF v_suma <> p_total THEN
    RAISE EXCEPTION 'Pagos inválidos: la suma de los pagos (%) no coincide con el total (%)', v_suma, p_total
      USING ERRCODE = 'PV001';
  END IF;

  RETURN CASE WHEN v_n = 1 THEN p_pagos->0->>'metodo' ELSE 'mixto' END;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_pagos(jsonb, numeric, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validar_pagos(jsonb, numeric, uuid, boolean, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.completar_cita_tx(p_cita_id uuid, p_store_id uuid, p_metodo_pago text, p_numero_transaccion text, p_impuesto numeric, p_pago_nc jsonb, p_fidelizacion_niveles jsonb, p_completado_por text, p_pagos jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_cita               RECORD;
  v_venta              RECORD;
  v_numero_comprobante TEXT;
  v_metodo_pago_final  TEXT;
  v_pagos              JSONB;
  v_estado             TEXT;
  v_fid_total          NUMERIC;
  v_fid_frecuencia     INTEGER;
  v_nuevo_descuento    NUMERIC;
  v_nivel              JSONB;
  v_nivel_idx          INTEGER;
BEGIN
  UPDATE citas
     SET estado = 'completada'
   WHERE id = p_cita_id AND store_id = p_store_id AND estado = 'confirmada'
  RETURNING * INTO v_cita;

  IF NOT FOUND THEN
    SELECT estado INTO v_estado FROM citas WHERE id = p_cita_id AND store_id = p_store_id;
    IF v_estado IS NULL THEN
      RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'P0002';
    ELSE
      RAISE EXCEPTION 'No se puede completar una cita en estado %', v_estado USING ERRCODE = 'PS003';
    END IF;
  END IF;

  IF v_cita.precio IS NULL THEN
    RAISE EXCEPTION 'Esta cita no tiene un precio asociado (creada antes de esta funcionalidad) — complétala sin cobro' USING ERRCODE = 'PS005';
  END IF;

  -- Pagos (093): lista nueva o parámetros antiguos convertidos. validar_pagos
  -- rechaza suma distinta del precio (incluye la NC mayor al total, antes PS007).
  v_pagos := COALESCE(p_pagos, public.pagos_desde_legado(p_metodo_pago, p_pago_nc, p_numero_transaccion, v_cita.precio));
  v_metodo_pago_final := public.validar_pagos(
    v_pagos, v_cita.precio, v_cita.cliente_id,
    p_trx_obligatoria => (SELECT numero_transaccion_obligatorio FROM stores WHERE id = p_store_id));

  v_numero_comprobante := to_char(public.hoy_negocio(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  INSERT INTO ventas (
    store_id, cliente_id, worker_clerk_id,
    subtotal, descuento, impuesto, total,
    metodo_pago, canal, procedencia, estado, numero_comprobante
  ) VALUES (
    p_store_id, v_cita.cliente_id, p_completado_por,
    v_cita.precio, 0, p_impuesto, v_cita.precio,
    v_metodo_pago_final, 'pos', 'presencial', 'pagada', v_numero_comprobante
  ) RETURNING * INTO v_venta;

  INSERT INTO venta_items (venta_id, servicio_id, mascota_id, cantidad, precio_unitario, subtotal)
  VALUES (v_venta.id, v_cita.servicio_id, v_cita.mascota_id, 1, v_cita.precio, v_cita.precio);

  PERFORM public.aplicar_pagos(p_store_id, v_venta.id, v_cita.cliente_id, v_pagos);

  IF v_cita.cliente_id IS NOT NULL THEN
    SELECT total_historico, frecuencia_compras
      INTO v_fid_total, v_fid_frecuencia
      FROM fidelizacion
     WHERE cliente_id = v_cita.cliente_id;

    v_fid_total      := COALESCE(v_fid_total, 0) + v_cita.precio;
    v_fid_frecuencia := COALESCE(v_fid_frecuencia, 0) + 1;
    v_nuevo_descuento := 0;

    FOR v_nivel_idx IN REVERSE jsonb_array_length(p_fidelizacion_niveles) - 1..0 LOOP
      v_nivel := p_fidelizacion_niveles->v_nivel_idx;
      IF v_fid_total >= (v_nivel->>'monto')::NUMERIC THEN
        v_nuevo_descuento := (v_nivel->>'descuento')::NUMERIC;
        EXIT;
      END IF;
    END LOOP;

    INSERT INTO fidelizacion (cliente_id, total_historico, frecuencia_compras, descuento_actual, updated_at)
    VALUES (v_cita.cliente_id, v_fid_total, v_fid_frecuencia, v_nuevo_descuento, NOW())
    ON CONFLICT (cliente_id) DO UPDATE SET
      total_historico    = EXCLUDED.total_historico,
      frecuencia_compras = EXCLUDED.frecuencia_compras,
      descuento_actual   = EXCLUDED.descuento_actual,
      updated_at         = EXCLUDED.updated_at;
  END IF;

  UPDATE citas SET venta_id = v_venta.id WHERE id = p_cita_id;

  RETURN jsonb_build_object('cita', to_jsonb(v_cita) || jsonb_build_object('venta_id', v_venta.id), 'venta', to_jsonb(v_venta));
END;
$$;

REVOKE ALL ON FUNCTION public.completar_cita_tx(uuid, uuid, text, text, numeric, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.completar_cita_tx(uuid, uuid, text, text, numeric, jsonb, jsonb, text, jsonb) TO service_role;

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
  v_metodo_pago_final := public.validar_pagos(
    v_pagos, p_total, p_cliente_id, p_canal <> 'pos',
    (SELECT numero_transaccion_obligatorio FROM stores WHERE id = p_store_id));

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
    --     Granel (078): gramos del saco elegido (096; consumir_granel valida que el
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
        COALESCE(p_user_id, p_worker_clerk_id),
        NULLIF(v_item->>'saco_id', '')::UUID
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
VALUES ('098', '098_numero_transaccion_opcional')
ON CONFLICT (version) DO NOTHING;
