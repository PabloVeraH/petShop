-- 092: "hoy" de las funciones SQL en hora de Chile, no en UTC.
--
-- CURRENT_DATE usa la zona de la sesión, que en Supabase es UTC: entre las
-- ~20:00/21:00 y las 24:00 de Chile ya es "mañana". Efectos vistos en el
-- código: el comprobante de una cita cobrada de noche sale con la fecha del
-- día siguiente; un lote que vence hoy deja de venderse (FIFO, canales) y se
-- puede dar de baja por vencido horas antes; la fecha de ingreso de un lote y
-- la fecha estimada de término de alimento se corren un día; la licencia de
-- canales vence ~3-4 h antes. La app ya calcula estas fechas en hora de Chile
-- (src/lib/dates.ts, commit 5f4af3c); esta migración alinea la base.
--
-- Cambiar la zona de la base no sirve: las columnas son `timestamp without
-- time zone` con hora UTC y now() las llena según esa zona.
--
-- Contenido:
--   1. public.hoy_negocio(): fecha actual en America/Santiago.
--   2. Las 10 funciones que usaban CURRENT_DATE, idénticas a
--      000_baseline.sql salvo CURRENT_DATE → public.hoy_negocio() (y, en
--      convertir_stock_suelto_a_lote, la fecha de alta del producto pasada a
--      hora de Chile). crear_venta_tx lleva el search_path que le fijó la 087:
--      CREATE OR REPLACE reemplaza todos los atributos de la función y sin él
--      lo perdería. Los GRANT/REVOKE se conservan.
--   3. Defaults de cuentas_pagar.fecha_emision y lotes_producto.fecha_ingreso.
--
-- Fuera de alcance: sync_ventas_historico() (también usa CURRENT_DATE) no se
-- toca: su SELECT agrega sin GROUP BY, falla al ejecutarse y nada la llama.
-- Datos ya guardados con la fecha UTC no se corrigen aquí.
--
-- Idempotente (CREATE OR REPLACE / SET DEFAULT). Reversible: volver a crear
-- las funciones y defaults desde 000_baseline.sql (+ el ALTER de la 087 para
-- crear_venta_tx) y DROP FUNCTION public.hoy_negocio().
-- Requiere la 090 (registro al final).

-- ── 1. Fecha del negocio ────────────────────────────────────────────────────
-- now() es timestamptz: AT TIME ZONE lo pasa a la hora local de Chile (con
-- horario de verano) sin depender de la zona de la sesión.
CREATE OR REPLACE FUNCTION public.hoy_negocio() RETURNS date
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT (now() AT TIME ZONE 'America/Santiago')::date
$$;

-- ── 2. Funciones ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.completar_cita_tx(p_cita_id uuid, p_store_id uuid, p_metodo_pago text, p_numero_transaccion text, p_impuesto numeric, p_pago_nc jsonb, p_fidelizacion_niveles jsonb, p_completado_por text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_cita               RECORD;
  v_venta              RECORD;
  v_numero_comprobante TEXT;
  v_metodo_pago_final  TEXT;
  v_monto_nc           NUMERIC;
  v_monto_resto        NUMERIC;
  v_estado             TEXT;
  v_nc_cliente_id      UUID;
  v_saldo_disp         NUMERIC;
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

  IF p_pago_nc IS NOT NULL THEN
    v_monto_nc          := (p_pago_nc->>'monto')::NUMERIC;

    IF v_monto_nc > v_cita.precio THEN
      RAISE EXCEPTION 'El monto de la nota de crédito no puede exceder el total a cobrar' USING ERRCODE = 'PS007';
    END IF;

    v_monto_resto       := ROUND((v_cita.precio - v_monto_nc) * 100) / 100;
    v_metodo_pago_final := CASE WHEN v_monto_nc >= v_cita.precio THEN 'nota_credito' ELSE 'mixto' END;
  ELSE
    v_metodo_pago_final := p_metodo_pago;
  END IF;

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

  IF p_pago_nc IS NOT NULL THEN
    INSERT INTO pagos (store_id, venta_id, metodo, monto, nota_credito_id, numero_transaccion)
    VALUES (
      p_store_id, v_venta.id, 'nota_credito',
      v_monto_nc, (p_pago_nc->>'nota_credito_id')::UUID, p_pago_nc->>'numero_nc'
    );

    IF v_monto_resto > 0 THEN
      INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
      VALUES (p_store_id, v_venta.id, p_metodo_pago, v_monto_resto, p_numero_transaccion);
    END IF;

    UPDATE notas_credito
       SET estado = 'usada'
     WHERE id = (p_pago_nc->>'nota_credito_id')::UUID
       AND store_id = p_store_id
       AND estado = 'activa';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La nota de crédito ya no está disponible (fue usada por otra operación)' USING ERRCODE = 'PS006';
    END IF;

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
    VALUES (p_store_id, v_venta.id, p_metodo_pago, v_cita.precio, p_numero_transaccion);
  END IF;

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

CREATE OR REPLACE FUNCTION public.convertir_stock_suelto_a_lote(p_store_id uuid, p_producto_id uuid, p_fecha_vencimiento date, p_fecha_ingreso_max date DEFAULT public.hoy_negocio()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_prod    RECORD;
  v_fecha   DATE;
  v_cerrado NUMERIC;
  v_lote    lotes_producto%ROWTYPE;
BEGIN
  SELECT id, stock, fecha_vencimiento, created_at
    INTO v_prod
    FROM productos
   WHERE id = p_producto_id AND store_id = p_store_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  v_cerrado := COALESCE(v_prod.stock, 0) - fraccion_saco_abierto(p_producto_id);

  IF EXISTS (SELECT 1 FROM lotes_producto
              WHERE producto_id = p_producto_id AND store_id = p_store_id AND activo = TRUE)
     OR v_cerrado <= 0 THEN
    RETURN NULL;
  END IF;

  v_fecha := COALESCE(p_fecha_vencimiento, v_prod.fecha_vencimiento);
  IF v_fecha IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha de vencimiento del stock existente (% unidades)', v_cerrado;
  END IF;

  INSERT INTO lotes_producto (
    store_id, producto_id, numero_lote, cantidad_inicial, cantidad_actual,
    fecha_vencimiento, fecha_ingreso, notas
  ) VALUES (
    p_store_id, p_producto_id, 'LOTE-0', v_cerrado, v_cerrado,
    v_fecha,
    LEAST(COALESCE(((v_prod.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Santiago')::date, public.hoy_negocio()), COALESCE(p_fecha_ingreso_max, public.hoy_negocio())),
    'Stock existente convertido a lote (D11)'
  )
  RETURNING * INTO v_lote;

  UPDATE productos SET tiene_vencimiento = TRUE
   WHERE id = p_producto_id AND store_id = p_store_id AND tiene_vencimiento IS DISTINCT FROM TRUE;

  RETURN to_jsonb(v_lote);
END;
$$;

CREATE OR REPLACE FUNCTION public.crear_venta_tx(p_store_id uuid, p_items jsonb, p_cliente_id uuid, p_worker_clerk_id text, p_subtotal numeric, p_descuento_pct numeric, p_impuesto numeric, p_total numeric, p_metodo_pago text, p_canal text, p_procedencia text, p_numero_comprobante text, p_pago_nc jsonb, p_numero_transaccion text, p_fidelizacion_niveles jsonb, p_dias_aviso integer, p_idempotency_key text DEFAULT NULL::text, p_user_id text DEFAULT NULL::text) RETURNS jsonb
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
$$;

CREATE OR REPLACE FUNCTION public.deducir_stock_fifo(p_producto_id uuid, p_store_id uuid, p_cantidad numeric, p_venta_item_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_restante         NUMERIC := p_cantidad;
  v_lote             RECORD;
  v_deducir          NUMERIC;
  v_stock_disponible NUMERIC;
  v_resultado        JSONB := '[]'::JSONB;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida para descontar stock: %', p_cantidad;
  END IF;

  -- Bloqueo del producto (tenant-scoped): serializa ventas concurrentes del
  -- mismo producto — la segunda espera y luego ve los lotes ya descontados.
  PERFORM 1 FROM productos
    WHERE id = p_producto_id AND store_id = p_store_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  SELECT COALESCE(SUM(cantidad_actual), 0)
    INTO v_stock_disponible
    FROM lotes_producto
   WHERE producto_id        = p_producto_id
     AND store_id           = p_store_id
     AND activo             = TRUE
     AND cantidad_actual    > 0
     AND fecha_vencimiento >= public.hoy_negocio();

  IF v_stock_disponible < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente: disponible % unidades vigentes, requerido %',
      v_stock_disponible, p_cantidad;
  END IF;

  FOR v_lote IN
    SELECT id, cantidad_actual, fecha_ingreso
      FROM lotes_producto
     WHERE producto_id        = p_producto_id
       AND store_id           = p_store_id
       AND activo             = TRUE
       AND cantidad_actual    > 0
       AND fecha_vencimiento >= public.hoy_negocio()
     ORDER BY fecha_ingreso ASC, created_at ASC, id ASC
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
        'fecha_ingreso',     v_lote.fecha_ingreso
      )
    );

    v_restante := v_restante - v_deducir;
  END LOOP;

  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.devolver_stock_producto(p_producto_id uuid, p_store_id uuid, p_cantidad numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_lote_id UUID;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RETURN;
  END IF;

  PERFORM 1 FROM productos
    WHERE id = p_producto_id AND store_id = p_store_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  SELECT id INTO v_lote_id
    FROM lotes_producto
   WHERE producto_id = p_producto_id
     AND store_id    = p_store_id
     AND activo      = TRUE
   ORDER BY (fecha_vencimiento >= public.hoy_negocio()) DESC, fecha_ingreso ASC, created_at ASC, id ASC
   LIMIT 1
   FOR UPDATE;

  IF v_lote_id IS NOT NULL THEN
    UPDATE lotes_producto
       SET cantidad_actual = cantidad_actual + p_cantidad,
           updated_at      = NOW()
     WHERE id = v_lote_id;
  ELSE
    UPDATE productos SET stock = COALESCE(stock, 0) + p_cantidad WHERE id = p_producto_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.estado_disponibilidad_canal(p_store_id uuid, p_canal_id text DEFAULT NULL::text, p_producto_id uuid DEFAULT NULL::uuid) RETURNS TABLE(store_id uuid, canal_id text, producto_id uuid, sku text, disponible boolean, cupo integer, ultimo_disponible_publicado boolean, ultima_cantidad_publicada integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT x.store_id, x.canal_id, x.producto_id, x.sku,
         (x.licencia_vigente AND x.producto_activo AND x.habilitado AND x.canal_activo AND x.cupo > 0),
         x.cupo, x.ultimo_disponible_publicado, x.ultima_cantidad_publicada
    FROM (
      SELECT cpc.store_id, cpc.canal_id, cpc.producto_id, p.sku::text AS sku,
             (s.license_end_date IS NULL OR s.license_end_date >= public.hoy_negocio()) AS licencia_vigente,
             COALESCE(p.activo, TRUE)  AS producto_activo,
             cpc.activo                AS habilitado,
             COALESCE(cc.activo, FALSE) AS canal_activo,
             GREATEST(0, unidades_vendibles_canal(p.id) - GREATEST(0, COALESCE(p.stock_minimo, 0))) AS cupo,
             cpc.ultimo_disponible_publicado,
             cpc.ultima_cantidad_publicada
        FROM canal_producto_config cpc
        JOIN productos p      ON p.id = cpc.producto_id AND p.store_id = cpc.store_id
        JOIN stores s         ON s.id = cpc.store_id
        LEFT JOIN canal_config cc ON cc.store_id = cpc.store_id AND cc.canal_id = cpc.canal_id
       WHERE cpc.store_id = p_store_id
         AND (p_canal_id IS NULL OR cpc.canal_id = p_canal_id)
         AND (p_producto_id IS NULL OR cpc.producto_id = p_producto_id)
         AND cpc.publicado_at IS NOT NULL
    ) x;
$$;

CREATE OR REPLACE FUNCTION public.merma_lote_vencido(p_store_id uuid, p_lote_id uuid, p_motivo text, p_user_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_producto_id UUID;
  v_lote        lotes_producto%ROWTYPE;
  v_cantidad    NUMERIC;
BEGIN
  SELECT producto_id INTO v_producto_id
    FROM lotes_producto
   WHERE id = p_lote_id AND store_id = p_store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote no encontrado: %', p_lote_id;
  END IF;

  -- Orden de bloqueo producto → lote (igual que deducir_stock_fifo).
  PERFORM 1 FROM productos WHERE id = v_producto_id AND store_id = p_store_id FOR UPDATE;

  SELECT * INTO v_lote
    FROM lotes_producto
   WHERE id = p_lote_id AND store_id = p_store_id
   FOR UPDATE;

  IF NOT v_lote.activo THEN
    RAISE EXCEPTION 'El lote ya está dado de baja';
  END IF;
  IF v_lote.fecha_vencimiento >= public.hoy_negocio() THEN
    RAISE EXCEPTION 'El lote no está vencido (vence %)', v_lote.fecha_vencimiento;
  END IF;

  v_cantidad := v_lote.cantidad_actual;

  -- Baja, nunca DELETE: venta_item_lotes conserva la trazabilidad.
  UPDATE lotes_producto
     SET activo     = FALSE,
         notas      = COALESCE(notas || ' | ', '') || 'Baja por vencimiento ' || public.hoy_negocio(),
         updated_at = NOW()
   WHERE id = p_lote_id
  RETURNING * INTO v_lote;

  IF v_cantidad > 0 THEN
    INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
    VALUES (
      v_producto_id,
      'merma',
      -v_cantidad,
      p_lote_id,
      'Merma por vencimiento lote ' || COALESCE(v_lote.numero_lote, LEFT(p_lote_id::TEXT, 8))
        || CASE WHEN p_motivo IS NOT NULL AND length(trim(p_motivo)) > 0 THEN ': ' || trim(p_motivo) ELSE '' END,
      p_user_id
    );
  END IF;

  RETURN jsonb_build_object('lote', to_jsonb(v_lote), 'cantidad_baja', v_cantidad);
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_lote(p_store_id uuid, p_producto_id uuid, p_cantidad_inicial numeric, p_fecha_vencimiento date, p_user_id text, p_cantidad_actual numeric DEFAULT NULL::numeric, p_numero_lote text DEFAULT NULL::text, p_fecha_ingreso date DEFAULT NULL::date, p_orden_compra_id uuid DEFAULT NULL::uuid, p_notas text DEFAULT NULL::text, p_fecha_venc_stock_existente date DEFAULT NULL::date, p_movimiento_notas text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_lote_inicial JSONB;
  v_lote         lotes_producto%ROWTYPE;
  v_actual       NUMERIC := COALESCE(p_cantidad_actual, p_cantidad_inicial);
  v_ingreso      DATE    := COALESCE(p_fecha_ingreso, public.hoy_negocio());
BEGIN
  IF p_cantidad_inicial IS NULL OR p_cantidad_inicial <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida para el lote: %', p_cantidad_inicial;
  END IF;
  IF v_actual < 0 OR v_actual > p_cantidad_inicial THEN
    RAISE EXCEPTION 'Cantidad actual inválida para el lote: %', v_actual;
  END IF;
  IF p_fecha_vencimiento IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha de vencimiento del lote';
  END IF;

  -- Bloquea el producto (tenant-scoped) y convierte el stock suelto en
  -- LOTE-0 si corresponde — en la misma transacción que el lote nuevo.
  v_lote_inicial := convertir_stock_suelto_a_lote(
    p_store_id, p_producto_id, p_fecha_venc_stock_existente, v_ingreso
  );

  INSERT INTO lotes_producto (
    store_id, producto_id, numero_lote, cantidad_inicial, cantidad_actual,
    fecha_vencimiento, fecha_ingreso, orden_compra_id, notas
  ) VALUES (
    p_store_id, p_producto_id, p_numero_lote, p_cantidad_inicial, v_actual,
    p_fecha_vencimiento, v_ingreso, p_orden_compra_id, p_notas
  )
  RETURNING * INTO v_lote;
  -- El trigger sync_stock_on_lote deja productos.stock = Σ lotes activos.

  UPDATE productos SET tiene_vencimiento = TRUE
   WHERE id = p_producto_id AND store_id = p_store_id AND tiene_vencimiento IS DISTINCT FROM TRUE;

  -- Movimiento solo de la entrada física (el LOTE-0 no es una entrada).
  IF v_actual > 0 THEN
    INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
    VALUES (
      p_producto_id,
      'entrada',
      v_actual,
      COALESCE(p_orden_compra_id, v_lote.id),
      COALESCE(p_movimiento_notas, 'Ingreso lote ' || COALESCE(p_numero_lote, LEFT(v_lote.id::TEXT, 8))),
      p_user_id
    );
  END IF;

  RETURN jsonb_build_object('lote', to_jsonb(v_lote), 'lote_inicial', v_lote_inicial);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_producto_fecha_vencimiento() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_producto_id UUID := COALESCE(NEW.producto_id, OLD.producto_id);
  v_store_id    UUID := COALESCE(NEW.store_id,    OLD.store_id);
BEGIN
  UPDATE productos
  SET fecha_vencimiento = (
    SELECT MIN(fecha_vencimiento)
    FROM lotes_producto
    WHERE producto_id = v_producto_id
      AND store_id    = v_store_id
      AND activo      = TRUE
      AND cantidad_actual > 0
      AND fecha_vencimiento >= public.hoy_negocio()
  )
  WHERE id       = v_producto_id
    AND store_id = v_store_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.unidades_vendibles_canal(p_producto_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM lotes_producto l
                  WHERE l.producto_id = p.id AND l.activo = TRUE)
    THEN FLOOR(COALESCE((
           SELECT SUM(l.cantidad_actual)
             FROM lotes_producto l
            WHERE l.producto_id        = p.id
              AND l.activo             = TRUE
              AND l.cantidad_actual    > 0
              AND l.fecha_vencimiento >= public.hoy_negocio()), 0))::integer
    ELSE FLOOR(GREATEST(0, COALESCE(p.stock, 0) - fraccion_saco_abierto(p.id)))::integer
  END
  FROM productos p
  WHERE p.id = p_producto_id;
$$;

-- ── 3. Defaults de columnas ─────────────────────────────────────────────────
ALTER TABLE public.cuentas_pagar ALTER COLUMN fecha_emision SET DEFAULT public.hoy_negocio();
ALTER TABLE public.lotes_producto ALTER COLUMN fecha_ingreso SET DEFAULT public.hoy_negocio();

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('092', '092_fechas_hora_chile')
ON CONFLICT (version) DO NOTHING;
