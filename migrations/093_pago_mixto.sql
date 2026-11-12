-- 093: pago mixto (una venta o cita pagada con 1 a 5 medios) + endurecimiento
-- del consumo de crédito interno + umbral configurable de 135 UF.
--
-- Diseño: docs/pago_complementario.md y docs/plan_pago_mixto.md.
--
-- Contenido:
--   1. stores.umbral_identificacion_comprador (pesos; NULL = sin aviso). El POS
--      avisa que la boleta debe identificar al comprador (Ley 21.713) cuando el
--      total lo supera. No bloquea.
--   2. Funciones internas del cobro, compartidas por venta y cita:
--      - pagos_desde_legado(): convierte los parámetros antiguos
--        (p_metodo_pago + p_pago_nc + p_numero_transaccion) a la lista p_pagos.
--      - validar_pagos(): forma, suma exacta contra el total, cardinalidad;
--        devuelve ventas.metodo_pago (método único o 'mixto'). ÚNICO lugar
--        donde se decide esa etiqueta.
--      - aplicar_pagos(): inserta las filas de pagos y consume el crédito.
--   3. crear_venta_tx y completar_cita_tx: idénticas a la 092 salvo el bloque
--      de pagos, que pasa a las funciones de (2), y un parámetro nuevo
--      p_pagos jsonb DEFAULT NULL. Sin p_pagos se usan los parámetros
--      antiguos, así que el código desplegado antes de esta migración sigue
--      funcionando. Se hace DROP + CREATE porque cambia la firma (un CREATE OR
--      REPLACE con otra firma dejaría dos sobrecargas y PostgREST no sabría
--      cuál llamar). crear_venta_tx conserva el search_path de la 087.
--
-- Cambios de comportamiento (decisiones D7/D8 del plan):
--   - Una NC con tipo_reembolso = 'reembolso_directo' ya no sirve como pago (el
--     dinero ya se devolvió; antes se aceptaba y se cobraba dos veces).
--   - Pagar con una NC tipo 'saldo_a_favor' exige que el saldo del cliente de
--     origen alcance (antes: GREATEST(0, saldo - monto), que dejaba usar una NC
--     cuyo saldo ya se había gastado).
--   - El reclamo de la NC exige store_id, estado 'activa' y que no esté vencida
--     también en crear_venta_tx (antes solo lo validaba la ruta; el UPDATE de
--     la RPC no filtraba por tienda ni estado).
--   - Métodos 'saldo_favor', 'plataforma' y 'mixto' ya no se aceptan como
--     método de un pago (registraban un pago "con crédito" sin consumirlo).
--   - Montos en pesos enteros; la suma de los pagos debe ser exactamente el
--     total.
--
-- Errores (ERRCODE estable, la API los mapea a HTTP):
--   PV001 pagos inválidos (400) · PV002 NC no encontrada (404) ·
--   PV003 NC no disponible (409) · PV004 NC vencida (410) ·
--   PV005 NC con reembolso directo (409) · PV006 saldo insuficiente (409) ·
--   PV007 saldo a favor sin cliente (400).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, constraint en bloque DO, DROP
-- FUNCTION IF EXISTS + CREATE. Reversible: volver a crear crear_venta_tx y
-- completar_cita_tx desde la 092 (+ el ALTER de la 087), DROP de las tres
-- funciones nuevas y de la columna. Requiere la 092 (hoy_negocio) y la 090.

-- ── 1. Umbral de identificación del comprador ───────────────────────────────
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS umbral_identificacion_comprador integer;

DO $$
BEGIN
  ALTER TABLE public.stores
    ADD CONSTRAINT stores_umbral_identificacion_comprador_positivo
    CHECK (umbral_identificacion_comprador IS NULL OR umbral_identificacion_comprador > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.stores.umbral_identificacion_comprador IS
  'Monto en pesos sobre el cual la boleta debe identificar al comprador (135 UF, Ley 21.713; se fija cada año con la UF al 31-dic). NULL = sin aviso.';

-- ── 2. Funciones internas del cobro ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pagos_desde_legado(p_metodo_pago text, p_pago_nc jsonb, p_numero_transaccion text, p_total numeric) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_monto_nc NUMERIC;
  v_resto    NUMERIC;
  v_trx      TEXT := NULLIF(btrim(p_numero_transaccion), '');
  v_pagos    JSONB;
BEGIN
  IF p_pago_nc IS NULL THEN
    RETURN jsonb_build_array(jsonb_build_object(
      'metodo', p_metodo_pago, 'monto', p_total,
      'numero_transaccion', v_trx, 'nota_credito_id', NULL));
  END IF;

  v_monto_nc := (p_pago_nc->>'monto')::NUMERIC;
  v_pagos := jsonb_build_array(jsonb_build_object(
    'metodo', 'nota_credito', 'monto', v_monto_nc,
    'numero_transaccion', NULL, 'nota_credito_id', p_pago_nc->>'nota_credito_id'));

  -- Un resto negativo (NC mayor al total) no se descarta: queda como suma
  -- distinta del total y validar_pagos lo rechaza.
  v_resto := p_total - v_monto_nc;
  IF v_resto <> 0 THEN
    v_pagos := v_pagos || jsonb_build_array(jsonb_build_object(
      'metodo', p_metodo_pago, 'monto', v_resto,
      'numero_transaccion', v_trx, 'nota_credito_id', NULL));
  END IF;
  RETURN v_pagos;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_pagos(p_pagos jsonb, p_total numeric, p_cliente_id uuid) RETURNS text
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
    IF v_pago.metodo IS NULL OR v_pago.metodo NOT IN
       ('efectivo', 'debito', 'credito', 'transferencia', 'nota_credito', 'saldo_a_favor') THEN
      RAISE EXCEPTION 'Pagos inválidos: método de pago no permitido (%)', COALESCE(v_pago.metodo, 'vacío')
        USING ERRCODE = 'PV001';
    END IF;
    -- $0 solo como pago único de una venta de $0 (100 % de descuento); la suma
    -- exacta contra el total lo garantiza.
    IF v_pago.monto IS NULL OR v_pago.monto < 0 OR v_pago.monto <> trunc(v_pago.monto)
       OR (v_pago.monto = 0 AND v_n > 1) THEN
      RAISE EXCEPTION 'Pagos inválidos: cada monto debe ser un entero mayor a 0' USING ERRCODE = 'PV001';
    END IF;
    IF v_pago.metodo IN ('debito', 'credito', 'transferencia')
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

-- Requiere p_pagos ya validado por validar_pagos (misma transacción).
CREATE OR REPLACE FUNCTION public.aplicar_pagos(p_store_id uuid, p_venta_id uuid, p_cliente_id uuid, p_pagos jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_pago          RECORD;
  v_nc            RECORD;
  v_nc_cliente_id UUID;
BEGIN
  FOR v_pago IN
    SELECT * FROM jsonb_to_recordset(p_pagos)
      AS x(metodo text, monto numeric, numero_transaccion text, nota_credito_id uuid)
  LOOP
    IF v_pago.metodo = 'nota_credito' THEN
      -- FOR UPDATE: dos cobros concurrentes con la misma NC se serializan
      -- aquí; el segundo ve estado 'usada' y falla con PV003.
      SELECT id, numero_nc, monto_total, estado, fecha_vencimiento, tipo_reembolso, venta_id
        INTO v_nc
        FROM notas_credito
       WHERE id = v_pago.nota_credito_id AND store_id = p_store_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Nota de crédito no encontrada' USING ERRCODE = 'PV002';
      END IF;
      IF v_nc.tipo_reembolso IS DISTINCT FROM 'saldo_a_favor' THEN
        RAISE EXCEPTION 'Esta nota de crédito ya se reembolsó directamente al cliente y no se puede usar como pago'
          USING ERRCODE = 'PV005';
      END IF;
      IF v_nc.estado <> 'activa' THEN
        RAISE EXCEPTION 'La nota de crédito ya no está disponible (fue usada por otra operación)'
          USING ERRCODE = 'PV003';
      END IF;
      IF v_nc.fecha_vencimiento IS NOT NULL AND v_nc.fecha_vencimiento < public.hoy_negocio() THEN
        RAISE EXCEPTION 'La nota de crédito está vencida' USING ERRCODE = 'PV004';
      END IF;
      IF v_pago.monto > v_nc.monto_total THEN
        RAISE EXCEPTION 'Pagos inválidos: el monto de la nota de crédito supera su valor' USING ERRCODE = 'PV001';
      END IF;

      UPDATE notas_credito SET estado = 'usada' WHERE id = v_nc.id AND store_id = p_store_id;

      -- La NC tipo saldo_a_favor sumó su monto al saldo del cliente de la venta
      -- de origen al crearse: usarla descuenta ese mismo saldo. Condicional, sin
      -- piso 0 (D8): si el saldo ya se gastó, la NC no paga nada.
      SELECT v2.cliente_id INTO v_nc_cliente_id
        FROM ventas v2
       WHERE v2.id = v_nc.venta_id AND v2.store_id = p_store_id;

      IF v_nc_cliente_id IS NOT NULL THEN
        UPDATE saldos_a_favor
           SET saldo_disponible = saldo_disponible - v_pago.monto,
               updated_at       = NOW()
         WHERE cliente_id = v_nc_cliente_id
           AND store_id = p_store_id
           AND saldo_disponible >= v_pago.monto;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Saldo insuficiente: el saldo a favor de esta nota de crédito ya fue utilizado'
            USING ERRCODE = 'PV006';
        END IF;
      END IF;

      INSERT INTO pagos (store_id, venta_id, metodo, monto, nota_credito_id, numero_transaccion)
      VALUES (p_store_id, p_venta_id, 'nota_credito', v_pago.monto, v_nc.id, v_nc.numero_nc);

    ELSIF v_pago.metodo = 'saldo_a_favor' THEN
      -- Mismo descuento atómico y condicional que gastar_saldo_a_favor_pago
      -- (AGENTS.md §23.6), dentro de la transacción del cobro.
      UPDATE saldos_a_favor
         SET saldo_disponible = saldo_disponible - v_pago.monto,
             updated_at       = NOW()
       WHERE cliente_id = p_cliente_id
         AND store_id = p_store_id
         AND saldo_disponible >= v_pago.monto;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Saldo a favor insuficiente para este pago' USING ERRCODE = 'PV006';
      END IF;

      INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
      VALUES (p_store_id, p_venta_id, 'saldo_a_favor', v_pago.monto, NULL);

    ELSE
      INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
      VALUES (p_store_id, p_venta_id, v_pago.metodo, v_pago.monto, NULLIF(btrim(v_pago.numero_transaccion), ''));
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.pagos_desde_legado(text, jsonb, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_pagos(jsonb, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aplicar_pagos(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pagos_desde_legado(text, jsonb, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.validar_pagos(jsonb, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.aplicar_pagos(uuid, uuid, uuid, jsonb) TO service_role;

-- ── 3. RPC de cobro ─────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.completar_cita_tx(uuid, uuid, text, text, numeric, jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION public.completar_cita_tx(p_cita_id uuid, p_store_id uuid, p_metodo_pago text, p_numero_transaccion text, p_impuesto numeric, p_pago_nc jsonb, p_fidelizacion_niveles jsonb, p_completado_por text, p_pagos jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
  v_metodo_pago_final := public.validar_pagos(v_pagos, v_cita.precio, v_cita.cliente_id);

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

DROP FUNCTION IF EXISTS public.crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text, text);

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
  v_metodo_pago_final := public.validar_pagos(v_pagos, p_total, p_cliente_id);

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

REVOKE ALL ON FUNCTION public.completar_cita_tx(uuid, uuid, text, text, numeric, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.completar_cita_tx(uuid, uuid, text, text, numeric, jsonb, jsonb, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text, text, jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('093', '093_pago_mixto')
ON CONFLICT (version) DO NOTHING;
