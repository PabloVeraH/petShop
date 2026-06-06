-- Migration 044: soporte venta a granel
-- Cambia cantidad de INTEGER a NUMERIC para permitir fracciones de kg.
-- Agrega precio_venta_kg a productos para habilitar modo granel.

-- 1. Agregar precio_venta_kg a productos
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS precio_venta_kg DECIMAL(10,2) DEFAULT NULL
    CHECK (precio_venta_kg > 0 OR precio_venta_kg IS NULL);

COMMENT ON COLUMN productos.precio_venta_kg IS
  'Si es mayor a 0, el producto puede venderse a granel. Precio por 1 kg (con IVA).';

-- 2. Cambiar productos.stock a NUMERIC para soportar fracciones de bolsa
ALTER TABLE productos
  ALTER COLUMN stock TYPE NUMERIC(10,3) USING stock::NUMERIC(10,3);

-- 3. Cambiar venta_items.cantidad a NUMERIC
ALTER TABLE venta_items
  DROP CONSTRAINT IF EXISTS venta_items_cantidad_check,
  ALTER COLUMN cantidad TYPE NUMERIC(10,3) USING cantidad::NUMERIC(10,3);
ALTER TABLE venta_items
  ADD CONSTRAINT venta_items_cantidad_check CHECK (cantidad > 0);

-- 4. Cambiar lotes_producto.cantidad_actual y cantidad_inicial a NUMERIC
ALTER TABLE lotes_producto
  DROP CONSTRAINT IF EXISTS lotes_producto_cantidad_inicial_check,
  DROP CONSTRAINT IF EXISTS lotes_producto_cantidad_actual_check,
  ALTER COLUMN cantidad_inicial TYPE NUMERIC(10,3) USING cantidad_inicial::NUMERIC(10,3),
  ALTER COLUMN cantidad_actual  TYPE NUMERIC(10,3) USING cantidad_actual::NUMERIC(10,3);
ALTER TABLE lotes_producto
  ADD CONSTRAINT lotes_producto_cantidad_inicial_check CHECK (cantidad_inicial > 0),
  ADD CONSTRAINT lotes_producto_cantidad_actual_check  CHECK (cantidad_actual >= 0);

-- 5. Actualizar decrement_stock para aceptar NUMERIC
CREATE OR REPLACE FUNCTION decrement_stock(
  p_producto_id UUID,
  p_cantidad    NUMERIC
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE productos
     SET stock = GREATEST(0, stock - p_cantidad)
   WHERE id = p_producto_id;
END;
$$;

-- 6. Actualizar deducir_stock_fifo para aceptar NUMERIC
CREATE OR REPLACE FUNCTION deducir_stock_fifo(
  p_producto_id   UUID,
  p_store_id      UUID,
  p_cantidad      NUMERIC,
  p_venta_item_id UUID
) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_lote            RECORD;
  v_restante        NUMERIC := p_cantidad;
  v_resultado       JSONB   := '[]'::JSONB;
  v_deducir         NUMERIC;
  v_stock_disponible NUMERIC;
BEGIN
  SELECT COALESCE(SUM(cantidad_actual), 0)
    INTO v_stock_disponible
    FROM lotes_producto
   WHERE producto_id    = p_producto_id
     AND store_id       = p_store_id
     AND activo         = TRUE
     AND cantidad_actual > 0;

  IF v_stock_disponible < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente en lotes: disponible=%, solicitado=%',
      v_stock_disponible, p_cantidad;
  END IF;

  FOR v_lote IN
    SELECT id, cantidad_actual, fecha_ingreso
      FROM lotes_producto
     WHERE producto_id    = p_producto_id
       AND store_id       = p_store_id
       AND activo         = TRUE
       AND cantidad_actual > 0
     ORDER BY fecha_ingreso ASC
  LOOP
    EXIT WHEN v_restante <= 0;
    v_deducir := LEAST(v_lote.cantidad_actual, v_restante);

    UPDATE lotes_producto
       SET cantidad_actual = cantidad_actual - v_deducir,
           updated_at      = NOW()
     WHERE id = v_lote.id;

    INSERT INTO venta_item_lotes (venta_item_id, lote_id, cantidad)
    VALUES (p_venta_item_id, v_lote.id, v_deducir);

    v_resultado := v_resultado || jsonb_build_object(
      'lote_id',           v_lote.id,
      'cantidad_deducida', v_deducir,
      'fecha_ingreso',     v_lote.fecha_ingreso
    );
    v_restante := v_restante - v_deducir;
  END LOOP;

  RETURN v_resultado;
END;
$$;

-- 7. Actualizar crear_venta_tx para usar NUMERIC en cantidad
CREATE OR REPLACE FUNCTION crear_venta_tx(
  p_store_id              UUID,
  p_items                 JSONB,    -- [{producto_id, cantidad, precio_unitario, subtotal, mascota_id?}]
  p_cliente_id            UUID,
  p_worker_clerk_id       TEXT,
  p_subtotal              NUMERIC,
  p_descuento_pct         NUMERIC,
  p_impuesto              NUMERIC,
  p_total                 NUMERIC,
  p_metodo_pago           TEXT,     -- método del pago "resto" (si hay NC mixta) o el único método
  p_canal                 TEXT,
  p_procedencia           TEXT,
  p_numero_comprobante    TEXT,
  p_pago_nc               JSONB,    -- {nota_credito_id, monto, numero_nc} | null
  p_numero_transaccion    TEXT,
  p_fidelizacion_niveles  JSONB,    -- [{monto, descuento}]
  p_dias_aviso            INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_venta              RECORD;
  v_venta_item_id      UUID;
  v_idx                INTEGER;
  v_item               JSONB;
  v_producto_id        UUID;
  v_mascota_id         UUID;
  v_lote_count         INTEGER;
  v_metodo_pago_final  TEXT;
  v_monto_nc           NUMERIC;
  v_monto_resto        NUMERIC;
  v_nc_cliente_id      UUID;
  v_saldo_disp         NUMERIC;
  v_peso_gramos        NUMERIC;
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
  -- ── 1. Determinar método de pago final ────────────────────────────────────
  IF p_pago_nc IS NOT NULL THEN
    v_monto_nc          := (p_pago_nc->>'monto')::NUMERIC;
    v_monto_resto       := ROUND((p_total - v_monto_nc) * 100) / 100;
    v_metodo_pago_final := CASE WHEN v_monto_nc >= p_total THEN 'nota_credito' ELSE 'mixto' END;
  ELSE
    v_metodo_pago_final := p_metodo_pago;
  END IF;

  -- ── 2. Crear venta ────────────────────────────────────────────────────────
  INSERT INTO ventas (
    store_id, cliente_id, worker_clerk_id,
    subtotal, descuento, impuesto, total,
    metodo_pago, canal, procedencia, estado, numero_comprobante
  ) VALUES (
    p_store_id, p_cliente_id, p_worker_clerk_id,
    p_subtotal, p_descuento_pct, p_impuesto, p_total,
    v_metodo_pago_final, p_canal, p_procedencia, 'pagada', p_numero_comprobante
  ) RETURNING * INTO v_venta;

  -- ── 3. Procesar items ─────────────────────────────────────────────────────
  FOR v_idx IN 0..jsonb_array_length(p_items) - 1 LOOP
    v_item        := p_items->v_idx;
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_mascota_id  := NULLIF(v_item->>'mascota_id', '')::UUID;

    -- 3a. Insertar venta_item
    INSERT INTO venta_items (
      venta_id, producto_id, cantidad, precio_unitario, subtotal, mascota_id
    ) VALUES (
      v_venta.id,
      v_producto_id,
      (v_item->>'cantidad')::NUMERIC,
      (v_item->>'precio_unitario')::NUMERIC,
      (v_item->>'subtotal')::NUMERIC,
      v_mascota_id
    ) RETURNING id INTO v_venta_item_id;

    -- 3b. Descontar stock: FIFO si hay lotes activos, legado si no
    SELECT COUNT(*) INTO v_lote_count
    FROM lotes_producto
    WHERE producto_id   = v_producto_id
      AND store_id      = p_store_id
      AND activo        = true
      AND cantidad_actual > 0;

    IF v_lote_count > 0 THEN
      PERFORM deducir_stock_fifo(
        v_producto_id,
        p_store_id,
        (v_item->>'cantidad')::NUMERIC,
        v_venta_item_id
      );
    ELSE
      PERFORM decrement_stock(
        v_producto_id,
        (v_item->>'cantidad')::NUMERIC
      );
    END IF;

    -- 3c. Registrar movimiento de stock
    INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas)
    VALUES (
      v_producto_id,
      'salida',
      -(v_item->>'cantidad')::NUMERIC,
      v_venta.id,
      'Venta ' || v_venta.id
    );

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
          v_total_gramos   := (v_item->>'cantidad')::NUMERIC * v_peso_gramos;
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

  RETURN to_jsonb(v_venta);
END;
$$;

GRANT EXECUTE ON FUNCTION crear_venta_tx TO service_role;