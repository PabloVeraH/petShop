-- migrations/074_stock_estricto.sql
-- Fase 1 del plan docs/canales-stock/stock_canales_externos.md — integridad de stock (D1, D2,
-- D3, D23). Primera de tres migraciones que se aplican JUNTAS y EN ORDEN:
--   074_stock_estricto.sql         ← esta (primitivas de stock)
--   075_devoluciones_a_lotes.sql   (anular_venta_tx / crear_nota_credito_tx)
--   076_lotes_conteo_merma.sql     (registrar_lote, conteo físico, merma)
--
-- Estado: **NO APLICADA**. Requiere confirmación explícita del usuario
-- (AGENTS.md §0.1 / §11.2 — wnxrdbnvreofrrmhcybc es el único entorno).
--
-- ─── Hallazgos que corrige (verificados contra pg_get_functiondef real, ────
--     2026-09-24; ver docs/canales-stock/stock_canales_externos.md §3 / §3.3b)
-- S4/V13  decrement_stock(uuid, integer) y (uuid, numeric) hacen
--         `SET stock = GREATEST(0, stock - n)`: una venta sin lotes mayor que
--         el stock deja 0 y PASA (viola D2). Además hay dos sobrecargas que
--         PostgREST puede resolver a cualquiera de las dos.
-- V13/V14 deducir_stock_fifo tiene dos sobrecargas: la (integer) excluye
--         lotes vencidos, la (numeric) no. Ninguna bloquea filas → dos ventas
--         concurrentes del mismo producto leen la misma suma y compiten.
-- V14/D23 "Tiene lotes" en crear_venta_tx se evalúa con cantidad_actual > 0:
--         un producto cuyos lotes quedaron en 0 cae en decrement_stock y
--         descuenta productos.stock directo (el trigger lo pisa después).
-- (nuevo) increment_stock sobre un producto CON lotes (recepción de OC sin
--         vencimiento, NC de un ítem vendido antes de tener lotes) suma a
--         productos.stock; el próximo cambio de lote recalcula
--         stock = Σ lotes y esas unidades desaparecen (misma familia que S6).
-- V7      stock_movements.cantidad y venta_item_lotes.cantidad son INTEGER
--         mientras productos.stock / lotes_producto.cantidad_* son
--         NUMERIC(10,3).
--
-- ─── Invariantes que quedan garantizadas en BD ────────────────────────────
-- I1 (D2)  Ninguna deducción deja productos.stock < 0 ni consume más que lo
--          disponible: toda deducción bloquea la fila del producto
--          (FOR UPDATE) y falla con 'Stock insuficiente ...' si no alcanza.
--          CHECK productos.stock >= 0 como red de seguridad.
-- I2 (D11) Un producto con lotes activos solo cambia su stock a través de
--          sus lotes: decrement_stock / increment_stock rechazan productos
--          con lotes activos.
-- I3 (D23) El stock vendible de un producto con lotes = solo lotes vigentes
--          (fecha_vencimiento >= hoy). Una sola versión de cada función.
--
-- ─── Grants ───────────────────────────────────────────────────────────────
-- Patrón de 069: toda función creada o reemplazada repite el REVOKE de
-- PUBLIC/anon/authenticated en la MISMA migración (Supabase vuelve a otorgar
-- EXECUTE al crear/reemplazar).

BEGIN;

-- ── 1. Tipos de columnas de cantidad (V7) ────────────────────────────────
-- Ensanchamiento INTEGER → NUMERIC(10,3): todo valor existente es
-- representable, no hay vistas dependientes (verificado en pg_depend).
ALTER TABLE stock_movements  ALTER COLUMN cantidad TYPE NUMERIC(10,3);
ALTER TABLE venta_item_lotes ALTER COLUMN cantidad TYPE NUMERIC(10,3);

-- ── 2. Red de seguridad: stock nunca negativo (I1) ───────────────────────
-- Fase 0 (Q9): 0 productos con stock negativo → VALIDATE no debería fallar.
-- ADD CONSTRAINT IF NOT EXISTS no existe en PostgreSQL → DO block.
DO $$
BEGIN
  ALTER TABLE productos
    ADD CONSTRAINT productos_stock_no_negativo CHECK (stock >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
ALTER TABLE productos VALIDATE CONSTRAINT productos_stock_no_negativo;

-- ── 3. decrement_stock: una sola versión, estricta (S4, I1, I2) ──────────
DROP FUNCTION IF EXISTS decrement_stock(uuid, integer);
DROP FUNCTION IF EXISTS decrement_stock(uuid, numeric);

CREATE FUNCTION decrement_stock(p_producto_id uuid, p_cantidad numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stock NUMERIC;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida para descontar stock: %', p_cantidad;
  END IF;

  -- Bloquear la fila serializa esta deducción contra otras ventas/ajustes y
  -- contra registrar_lote (que convierte el stock suelto en lote bajo el
  -- mismo bloqueo): la verificación de lotes y el UPDATE ven el mismo estado.
  SELECT stock INTO v_stock FROM productos WHERE id = p_producto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  IF EXISTS (SELECT 1 FROM lotes_producto
              WHERE producto_id = p_producto_id AND activo = TRUE) THEN
    RAISE EXCEPTION 'Producto con lotes activos: el stock se descuenta desde los lotes (producto=%)',
      p_producto_id;
  END IF;

  IF COALESCE(v_stock, 0) < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente: disponible %, solicitado %',
      COALESCE(v_stock, 0), p_cantidad;
  END IF;

  UPDATE productos SET stock = stock - p_cantidad WHERE id = p_producto_id;
END;
$function$;

-- ── 4. increment_stock: una sola versión, rechaza productos con lotes (I2) ─
DROP FUNCTION IF EXISTS increment_stock(uuid, integer);
DROP FUNCTION IF EXISTS increment_stock(uuid, numeric);

CREATE FUNCTION increment_stock(p_producto_id uuid, p_cantidad numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida para incrementar stock: %', p_cantidad;
  END IF;

  PERFORM 1 FROM productos WHERE id = p_producto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  -- Con lotes activos, productos.stock lo recalcula el trigger
  -- sync_stock_on_lote como Σ lotes: sumar aquí se perdería en el próximo
  -- cambio de lote. El llamador debe registrar un lote (registrar_lote) o
  -- devolver a un lote (devolver_stock_producto).
  IF EXISTS (SELECT 1 FROM lotes_producto
              WHERE producto_id = p_producto_id AND activo = TRUE) THEN
    RAISE EXCEPTION 'Producto con lotes activos: el ingreso de stock requiere un lote con fecha de vencimiento (producto=%)',
      p_producto_id;
  END IF;

  UPDATE productos SET stock = COALESCE(stock, 0) + p_cantidad WHERE id = p_producto_id;
END;
$function$;

-- ── 5. deducir_stock_fifo: una sola versión, vigentes, con bloqueo (D3, I1, I3)
DROP FUNCTION IF EXISTS deducir_stock_fifo(uuid, uuid, integer, uuid);
DROP FUNCTION IF EXISTS deducir_stock_fifo(uuid, uuid, numeric, uuid);

CREATE FUNCTION deducir_stock_fifo(
  p_producto_id   uuid,
  p_store_id      uuid,
  p_cantidad      numeric,
  p_venta_item_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
     AND fecha_vencimiento >= CURRENT_DATE;

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
       AND fecha_vencimiento >= CURRENT_DATE
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
$function$;

-- ── 6. devolver_stock_producto: devolución SIN trazabilidad de lotes (I2) ──
-- Para unidades que vuelven sin venta_item_lotes (ítem vendido cuando el
-- producto aún no tenía lotes, o remanente no asignable). Si el producto hoy
-- tiene lotes activos, las unidades van al lote activo más antiguo (vigente
-- si existe) — el que FIFO consume primero; típicamente el LOTE-0 que nació
-- del stock suelto de donde salieron esas unidades. Sin lotes: incremento
-- directo.
CREATE OR REPLACE FUNCTION devolver_stock_producto(
  p_producto_id uuid,
  p_store_id    uuid,
  p_cantidad    numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
   ORDER BY (fecha_vencimiento >= CURRENT_DATE) DESC, fecha_ingreso ASC, created_at ASC, id ASC
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
$function$;

-- ── 7. devolver_a_lotes_venta_item: devolución PROPORCIONAL a sus lotes ───
-- Reemplaza a devolver_stock_a_lotes (S13/V19: devolvía la cantidad COMPLETA
-- del ítem en cada NC, aunque fuera parcial). Asignación determinista: los
-- venta_item_lotes del ítem, en el orden en que se consumieron, forman un
-- intervalo acumulado [0, Σ cantidad). Una devolución de p_cantidad unidades
-- cuando ya se devolvieron p_ya_devuelto a lotes cubre el tramo
-- [p_ya_devuelto, p_ya_devuelto + p_cantidad) y cada lote recibe su
-- intersección con ese tramo. Devoluciones parciales sucesivas no se solapan
-- y su suma nunca supera lo consumido. Retorna cuánto se colocó en lotes;
-- el llamador coloca el remanente (si lo hubiera) con devolver_stock_producto.
-- Nota: un lote dado de baja (activo = false) recibe igual sus unidades
-- (trazabilidad), pero no cuentan como stock mientras siga inactivo.
CREATE OR REPLACE FUNCTION devolver_a_lotes_venta_item(
  p_venta_item_id uuid,
  p_ya_devuelto   numeric,
  p_cantidad      numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vil       RECORD;
  v_desde     NUMERIC := GREATEST(COALESCE(p_ya_devuelto, 0), 0);
  v_hasta     NUMERIC := GREATEST(COALESCE(p_ya_devuelto, 0), 0) + COALESCE(p_cantidad, 0);
  v_acumulado NUMERIC := 0;
  v_porcion   NUMERIC;
  v_colocado  NUMERIC := 0;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RETURN 0;
  END IF;

  -- Orden de bloqueo producto → lote, igual que deducir_stock_fifo (el
  -- trigger sync_stock_on_lote actualiza productos al tocar un lote): evita
  -- un deadlock con una venta concurrente del mismo producto.
  PERFORM 1
     FROM productos p
     JOIN venta_items vi ON vi.producto_id = p.id
    WHERE vi.id = p_venta_item_id
      FOR UPDATE OF p;

  FOR v_vil IN
    SELECT vil.lote_id, vil.cantidad
      FROM venta_item_lotes vil
     WHERE vil.venta_item_id = p_venta_item_id
     ORDER BY vil.created_at ASC, vil.id ASC
  LOOP
    v_porcion := LEAST(v_acumulado + v_vil.cantidad, v_hasta) - GREATEST(v_acumulado, v_desde);
    IF v_porcion > 0 THEN
      UPDATE lotes_producto
         SET cantidad_actual = cantidad_actual + v_porcion,
             updated_at      = NOW()
       WHERE id = v_vil.lote_id;
      v_colocado := v_colocado + v_porcion;
    END IF;
    v_acumulado := v_acumulado + v_vil.cantidad;
    EXIT WHEN v_acumulado >= v_hasta;
  END LOOP;

  RETURN v_colocado;
END;
$function$;

-- ── 8. crear_venta_tx: "tiene lotes" = cualquier lote activo (I2, I3) ─────
-- ÚNICO cambio respecto de la definición vigente (059, verificada con
-- pg_get_functiondef el 2026-09-24): el paso 3b decide FIFO vs.
-- decrement_stock con "existe algún lote activo" (antes: con
-- cantidad_actual > 0). Así un producto con lotes agotados o vencidos es
-- rechazado por deducir_stock_fifo ("disponible N unidades vigentes") en vez
-- de caer en decrement_stock sobre productos.stock. Los casts ::INTEGER de
-- cantidad se mantienen: granel se corrige en la Fase 1b.
CREATE OR REPLACE FUNCTION public.crear_venta_tx(p_store_id uuid, p_items jsonb, p_cliente_id uuid, p_worker_clerk_id text, p_subtotal numeric, p_descuento_pct numeric, p_impuesto numeric, p_total numeric, p_metodo_pago text, p_canal text, p_procedencia text, p_numero_comprobante text, p_pago_nc jsonb, p_numero_transaccion text, p_fidelizacion_niveles jsonb, p_dias_aviso integer, p_idempotency_key text DEFAULT NULL::text)
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

    -- 3a. Insertar venta_item
    INSERT INTO venta_items (
      venta_id, producto_id, cantidad, precio_unitario, subtotal, mascota_id
    ) VALUES (
      v_venta.id,
      v_producto_id,
      (v_item->>'cantidad')::INTEGER,
      (v_item->>'precio_unitario')::NUMERIC,
      (v_item->>'subtotal')::NUMERIC,
      v_mascota_id
    ) RETURNING id INTO v_venta_item_id;

    -- 3b. Descontar stock: FIFO si el producto tiene CUALQUIER lote activo
    --     (migración 074 — antes solo si algún lote tenía cantidad > 0);
    --     decrement_stock estricto si no tiene lotes. Ambas fallan con
    --     'Stock insuficiente ...' si no alcanza (D2).
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
        (v_item->>'cantidad')::INTEGER,
        v_venta_item_id
      );
    ELSE
      PERFORM decrement_stock(
        v_producto_id,
        (v_item->>'cantidad')::INTEGER
      );
    END IF;

    -- 3c. Registrar movimiento de stock
    INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas)
    VALUES (
      v_producto_id,
      'salida',
      -(v_item->>'cantidad')::INTEGER,
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
          v_total_gramos   := (v_item->>'cantidad')::INTEGER * v_peso_gramos;
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

-- ── 9. Grants (patrón 069) ───────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION decrement_stock(uuid, numeric)                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION decrement_stock(uuid, numeric)                     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_stock(uuid, numeric)                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_stock(uuid, numeric)                     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION deducir_stock_fifo(uuid, uuid, numeric, uuid)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION deducir_stock_fifo(uuid, uuid, numeric, uuid)      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION devolver_stock_producto(uuid, uuid, numeric)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION devolver_stock_producto(uuid, uuid, numeric)       FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION devolver_a_lotes_venta_item(uuid, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION devolver_a_lotes_venta_item(uuid, numeric, numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION crear_venta_tx                                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_venta_tx                                     FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION decrement_stock(uuid, numeric)                      TO service_role;
GRANT EXECUTE ON FUNCTION increment_stock(uuid, numeric)                      TO service_role;
GRANT EXECUTE ON FUNCTION deducir_stock_fifo(uuid, uuid, numeric, uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION devolver_stock_producto(uuid, uuid, numeric)        TO service_role;
GRANT EXECUTE ON FUNCTION devolver_a_lotes_venta_item(uuid, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION crear_venta_tx                                      TO service_role;

COMMIT;
