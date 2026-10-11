-- migrations/076_lotes_conteo_merma.sql
-- Fase 1 del plan docs/canales-stock/stock_canales_externos.md — tercera de tres migraciones
-- que se aplican JUNTAS y EN ORDEN (074 → 075 → 076).
--
-- Estado: **NO APLICADA**. Requiere confirmación explícita del usuario
-- (AGENTS.md §0.1 / §11.2).
--
-- Funciones nuevas (todas atómicas, tenant-scoped por p_store_id, con
-- bloqueo producto → lote igual que deducir_stock_fifo):
--
--   convertir_stock_suelto_a_lote  D11/D21 — si el producto no tiene lotes
--                                  activos y tiene stock > 0, lo convierte en
--                                  "LOTE-0" (vencimiento obligatorio).
--   registrar_lote                 D11 — S6: registrar un lote nuevo ya no
--                                  borra el stock suelto (100 suelto + lote de
--                                  50 → LOTE-0 = 100, lote nuevo = 50, stock
--                                  150). Registra el stock_movements de
--                                  la entrada física (no del LOTE-0).
--   ajustar_stock_conteo           D22 — fija el stock contado (por lote si el
--                                  producto tiene lotes) con motivo y
--                                  stock_movements 'ajuste_conteo'.
--   merma_lote_vencido             D23 — da de baja un lote vencido
--                                  (activo=false, nunca DELETE) con
--                                  stock_movements 'merma' y usuario.
--
-- La autorización (solo storeAdmin/systemAdmin para conteo y merma) se
-- valida en los endpoints; estas funciones solo son ejecutables por
-- service_role (grants al final).

BEGIN;

-- ── 1. convertir_stock_suelto_a_lote (D11, D21) ──────────────────────────
CREATE OR REPLACE FUNCTION convertir_stock_suelto_a_lote(
  p_store_id          uuid,
  p_producto_id       uuid,
  p_fecha_vencimiento date,
  p_fecha_ingreso_max date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prod  RECORD;
  v_fecha DATE;
  v_lote  lotes_producto%ROWTYPE;
BEGIN
  SELECT id, stock, fecha_vencimiento, created_at
    INTO v_prod
    FROM productos
   WHERE id = p_producto_id AND store_id = p_store_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  -- Ya tiene lotes (todo su stock ya está en lotes) o no hay nada que
  -- convertir: no-op.
  IF EXISTS (SELECT 1 FROM lotes_producto
              WHERE producto_id = p_producto_id AND store_id = p_store_id AND activo = TRUE)
     OR COALESCE(v_prod.stock, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  -- D21: el vencimiento del stock existente es obligatorio (la UI lo pide,
  -- prellenado con productos.fecha_vencimiento). lotes_producto.fecha_vencimiento
  -- es NOT NULL (V6): no se inventa una fecha.
  v_fecha := COALESCE(p_fecha_vencimiento, v_prod.fecha_vencimiento);
  IF v_fecha IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha de vencimiento del stock existente (% unidades)', v_prod.stock;
  END IF;

  -- fecha_ingreso lo más antigua posible (alta del producto) y nunca
  -- posterior al lote nuevo: FIFO consume primero el stock que ya existía.
  INSERT INTO lotes_producto (
    store_id, producto_id, numero_lote, cantidad_inicial, cantidad_actual,
    fecha_vencimiento, fecha_ingreso, notas
  ) VALUES (
    p_store_id, p_producto_id, 'LOTE-0', v_prod.stock, v_prod.stock,
    v_fecha,
    LEAST(COALESCE(v_prod.created_at::date, CURRENT_DATE), COALESCE(p_fecha_ingreso_max, CURRENT_DATE)),
    'Stock existente convertido a lote (D11)'
  )
  RETURNING * INTO v_lote;

  UPDATE productos SET tiene_vencimiento = TRUE
   WHERE id = p_producto_id AND store_id = p_store_id AND tiene_vencimiento IS DISTINCT FROM TRUE;

  RETURN to_jsonb(v_lote);
END;
$function$;

-- ── 2. registrar_lote (D11 — corrige S6) ─────────────────────────────────
CREATE OR REPLACE FUNCTION registrar_lote(
  p_store_id                   uuid,
  p_producto_id                uuid,
  p_cantidad_inicial           numeric,
  p_fecha_vencimiento          date,
  p_user_id                    text,
  p_cantidad_actual            numeric DEFAULT NULL,
  p_numero_lote                text    DEFAULT NULL,
  p_fecha_ingreso              date    DEFAULT NULL,
  p_orden_compra_id            uuid    DEFAULT NULL,
  p_notas                      text    DEFAULT NULL,
  p_fecha_venc_stock_existente date    DEFAULT NULL,
  p_movimiento_notas           text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lote_inicial JSONB;
  v_lote         lotes_producto%ROWTYPE;
  v_actual       NUMERIC := COALESCE(p_cantidad_actual, p_cantidad_inicial);
  v_ingreso      DATE    := COALESCE(p_fecha_ingreso, CURRENT_DATE);
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
$function$;

-- ── 3. ajustar_stock_conteo (D22) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION ajustar_stock_conteo(
  p_store_id      uuid,
  p_producto_id   uuid,
  p_lote_id       uuid,
  p_stock_contado numeric,
  p_motivo        text,
  p_user_id       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stock_anterior NUMERIC;
  v_anterior       NUMERIC;
  v_delta          NUMERIC;
  v_stock_nuevo    NUMERIC;
  v_tiene_lotes    BOOLEAN;
  v_numero_lote    TEXT;
BEGIN
  IF p_stock_contado IS NULL OR p_stock_contado < 0 THEN
    RAISE EXCEPTION 'Cantidad contada inválida: %', p_stock_contado;
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'El motivo del conteo es obligatorio (mínimo 5 caracteres)';
  END IF;

  SELECT COALESCE(stock, 0) INTO v_stock_anterior
    FROM productos
   WHERE id = p_producto_id AND store_id = p_store_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  SELECT EXISTS (SELECT 1 FROM lotes_producto
                  WHERE producto_id = p_producto_id AND store_id = p_store_id AND activo = TRUE)
    INTO v_tiene_lotes;

  IF v_tiene_lotes THEN
    IF p_lote_id IS NULL THEN
      RAISE EXCEPTION 'Producto con lotes: el conteo físico se registra por lote';
    END IF;
    SELECT cantidad_actual, numero_lote INTO v_anterior, v_numero_lote
      FROM lotes_producto
     WHERE id = p_lote_id AND producto_id = p_producto_id AND store_id = p_store_id AND activo = TRUE
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lote no encontrado: %', p_lote_id;
    END IF;

    UPDATE lotes_producto
       SET cantidad_actual = p_stock_contado,
           updated_at      = NOW()
     WHERE id = p_lote_id;
  ELSE
    IF p_lote_id IS NOT NULL THEN
      RAISE EXCEPTION 'Lote no encontrado: %', p_lote_id;
    END IF;
    v_anterior := v_stock_anterior;
    UPDATE productos SET stock = p_stock_contado WHERE id = p_producto_id;
  END IF;

  v_delta := p_stock_contado - v_anterior;

  IF v_delta <> 0 THEN
    INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
    VALUES (
      p_producto_id,
      'ajuste_conteo',
      v_delta,
      p_lote_id,
      'Conteo físico' || CASE WHEN v_numero_lote IS NOT NULL THEN ' lote ' || v_numero_lote ELSE '' END
        || ': ' || trim(p_motivo),
      p_user_id
    );
  END IF;

  SELECT COALESCE(stock, 0) INTO v_stock_nuevo FROM productos WHERE id = p_producto_id;

  RETURN jsonb_build_object(
    'stock_anterior',    v_stock_anterior,
    'stock_nuevo',       v_stock_nuevo,
    'cantidad_anterior', v_anterior,
    'cantidad_contada',  p_stock_contado,
    'delta',             v_delta,
    'lote_id',           p_lote_id
  );
END;
$function$;

-- ── 4. merma_lote_vencido (D23) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION merma_lote_vencido(
  p_store_id uuid,
  p_lote_id  uuid,
  p_motivo   text,
  p_user_id  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF v_lote.fecha_vencimiento >= CURRENT_DATE THEN
    RAISE EXCEPTION 'El lote no está vencido (vence %)', v_lote.fecha_vencimiento;
  END IF;

  v_cantidad := v_lote.cantidad_actual;

  -- Baja, nunca DELETE: venta_item_lotes conserva la trazabilidad.
  UPDATE lotes_producto
     SET activo     = FALSE,
         notas      = COALESCE(notas || ' | ', '') || 'Baja por vencimiento ' || CURRENT_DATE,
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
$function$;

-- ── 5. Grants (patrón 069) ───────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION convertir_stock_suelto_a_lote(uuid, uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION convertir_stock_suelto_a_lote(uuid, uuid, date, date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION registrar_lote(uuid, uuid, numeric, date, text, numeric, text, date, uuid, text, date, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION registrar_lote(uuid, uuid, numeric, date, text, numeric, text, date, uuid, text, date, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION ajustar_stock_conteo(uuid, uuid, uuid, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ajustar_stock_conteo(uuid, uuid, uuid, numeric, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION merma_lote_vencido(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION merma_lote_vencido(uuid, uuid, text, text) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION convertir_stock_suelto_a_lote(uuid, uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION registrar_lote(uuid, uuid, numeric, date, text, numeric, text, date, uuid, text, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION ajustar_stock_conteo(uuid, uuid, uuid, numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION merma_lote_vencido(uuid, uuid, text, text) TO service_role;

COMMIT;
