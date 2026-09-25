-- ============================================================================
-- Verificación REAL de la Fase 1 (migraciones 074, 075, 076)
-- Plan: stock_canales_externos.md §6 Fase 1 (paso 1.8) — AGENTS.md §11.4
-- Proyecto Supabase: wnxrdbnvreofrrmhcybc
--
-- Ejecutar en Supabase → SQL Editor DESPUÉS de aplicar 074 → 075 → 076.
-- Todo corre dentro de BEGIN … ROLLBACK: crea una tienda y productos de
-- prueba, ejercita las funciones y DESHACE TODO al final. No persiste nada.
--
-- Resultado esperado: la última consulta devuelve
--   'FASE 1: TODAS LAS VERIFICACIONES OK'.
-- Si alguna verificación falla, el DO lanza 'Tn FALLÓ: …' y las consultas
-- siguientes dan "current transaction is aborted" — igual se hace ROLLBACK.
--
-- Las ventas de prueba usan p_worker_clerk_id => NULL: ventas.worker_clerk_id
-- tiene FK a clerk_users (ON DELETE SET NULL, nullable) y no se crean
-- usuarios falsos. user_id de stock_movements es texto libre ('verif').
--
-- NO cubre (requiere dos sesiones simultáneas): concurrencia real de dos
-- ventas por el último stock. Ver instrucciones al final.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  s       uuid;   -- tienda de prueba
  s_otra  uuid;   -- otra tienda (aislamiento)
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid;
  l_a uuid; l_b uuid; l_venc uuid; l_nuevo uuid; l4 uuid;
  r       jsonb;
  v_id    uuid;
  vi_id   uuid;
  n       numeric;
  c       integer;
  d       date;
BEGIN
  INSERT INTO stores (name) VALUES ('VERIF-FASE1 (rollback)') RETURNING id INTO s;
  INSERT INTO stores (name) VALUES ('VERIF-FASE1 otra (rollback)') RETURNING id INTO s_otra;

  -- ── T1 decrement_stock estricto (S4, D2) ──────────────────────────────
  INSERT INTO productos (store_id, nombre, sku, precio, stock, activo)
  VALUES (s, 'T1', 'VERIF-T1', 1000, 5, true) RETURNING id INTO p1;
  BEGIN
    PERFORM decrement_stock(p1, 6);
    RAISE EXCEPTION 'T1 FALLÓ: decrement_stock(6) con stock 5 debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Stock insuficiente%' THEN RAISE; END IF;
  END;
  PERFORM decrement_stock(p1, 5);
  SELECT stock INTO n FROM productos WHERE id = p1;
  IF n <> 0 THEN RAISE EXCEPTION 'T1 FALLÓ: stock esperado 0, quedó %', n; END IF;

  -- ── T2 CHECK stock >= 0 ───────────────────────────────────────────────
  BEGIN
    UPDATE productos SET stock = -1 WHERE id = p1;
    RAISE EXCEPTION 'T2 FALLÓ: el CHECK debía impedir stock negativo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── T3/T4 FIFO: cruza lotes, excluye vencidos, rechaza exceso (D3, D23)
  INSERT INTO productos (store_id, nombre, sku, precio, stock, activo)
  VALUES (s, 'T4', 'VERIF-T4', 1000, 0, true) RETURNING id INTO p2;
  r := registrar_lote(s, p2, 3, '2030-01-01', 'verif', p_fecha_ingreso => '2026-01-01');
  l_a := (r->'lote'->>'id')::uuid;
  r := registrar_lote(s, p2, 5, '2030-06-01', 'verif', p_fecha_ingreso => '2026-02-01');
  l_b := (r->'lote'->>'id')::uuid;
  r := registrar_lote(s, p2, 10, '2020-01-01', 'verif', p_fecha_ingreso => '2019-12-01');
  l_venc := (r->'lote'->>'id')::uuid;
  SELECT stock INTO n FROM productos WHERE id = p2;
  IF n <> 18 THEN RAISE EXCEPTION 'T4 FALLÓ: stock inicial esperado 18 (3+5+10), es %', n; END IF;

  -- T3: increment_stock rechaza productos con lotes (I2)
  BEGIN
    PERFORM increment_stock(p2, 1);
    RAISE EXCEPTION 'T3 FALLÓ: increment_stock sobre producto con lotes debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Producto con lotes%' THEN RAISE; END IF;
  END;

  PERFORM deducir_stock_fifo(p2, s, 6);
  SELECT cantidad_actual INTO n FROM lotes_producto WHERE id = l_a;
  IF n <> 0 THEN RAISE EXCEPTION 'T4 FALLÓ: lote A esperado 0, es %', n; END IF;
  SELECT cantidad_actual INTO n FROM lotes_producto WHERE id = l_b;
  IF n <> 2 THEN RAISE EXCEPTION 'T4 FALLÓ: lote B esperado 2, es %', n; END IF;
  SELECT cantidad_actual INTO n FROM lotes_producto WHERE id = l_venc;
  IF n <> 10 THEN RAISE EXCEPTION 'T4 FALLÓ: el lote vencido no debía tocarse, es %', n; END IF;
  BEGIN
    PERFORM deducir_stock_fifo(p2, s, 3);
    RAISE EXCEPTION 'T4 FALLÓ: pedir 3 con 2 vigentes debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Stock insuficiente%' THEN RAISE; END IF;
  END;
  -- Aislamiento: otra tienda no puede descontar este producto
  BEGIN
    PERFORM deducir_stock_fifo(p2, s_otra, 1);
    RAISE EXCEPTION 'T4 FALLÓ: FIFO con otra tienda debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Producto no encontrado%' THEN RAISE; END IF;
  END;

  -- ── T5 D11: 100 sueltas + lote de 50 → LOTE-0 = 100, total 150 (S6) ───
  INSERT INTO productos (store_id, nombre, sku, precio, stock, activo, created_at)
  VALUES (s, 'T5', 'VERIF-T5', 1000, 100, true, '2025-06-01') RETURNING id INTO p3;
  BEGIN
    PERFORM registrar_lote(s, p3, 50, '2031-01-01', 'verif');
    RAISE EXCEPTION 'T5 FALLÓ: sin vencimiento del stock existente debía rechazar (D21)';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Falta la fecha de vencimiento%' THEN RAISE; END IF;
  END;
  r := registrar_lote(s, p3, 50, '2031-01-01', 'verif', p_fecha_venc_stock_existente => '2030-12-01');
  IF r->'lote_inicial' IS NULL OR jsonb_typeof(r->'lote_inicial') = 'null' THEN
    RAISE EXCEPTION 'T5 FALLÓ: debía crear el LOTE-0';
  END IF;
  l_nuevo := (r->'lote'->>'id')::uuid;
  SELECT stock INTO n FROM productos WHERE id = p3;
  IF n <> 150 THEN RAISE EXCEPTION 'T5 FALLÓ: stock esperado 150, es %', n; END IF;
  IF (r->'lote_inicial'->>'cantidad_actual')::numeric <> 100 THEN
    RAISE EXCEPTION 'T5 FALLÓ: LOTE-0 esperado 100';
  END IF;
  IF (r->'lote_inicial'->>'fecha_ingreso')::date > (r->'lote'->>'fecha_ingreso')::date THEN
    RAISE EXCEPTION 'T5 FALLÓ: el LOTE-0 debe ingresar antes que el lote nuevo (FIFO)';
  END IF;
  SELECT count(*) INTO c FROM stock_movements WHERE producto_id = p3;
  IF c <> 1 THEN RAISE EXCEPTION 'T5 FALLÓ: solo la entrada física registra movimiento (esperado 1, hay %)', c; END IF;
  -- FIFO consume primero el LOTE-0
  PERFORM deducir_stock_fifo(p3, s, 100);
  SELECT cantidad_actual INTO n FROM lotes_producto WHERE id = l_nuevo;
  IF n <> 50 THEN RAISE EXCEPTION 'T5 FALLÓ: FIFO debía consumir el LOTE-0 primero (lote nuevo %)', n; END IF;
  -- T6: un segundo lote no crea otro LOTE-0
  r := registrar_lote(s, p3, 5, '2031-02-01', 'verif');
  IF jsonb_typeof(r->'lote_inicial') <> 'null' THEN RAISE EXCEPTION 'T6 FALLÓ: no debía crear otro LOTE-0'; END IF;
  -- Aislamiento: otra tienda no registra lotes en este producto
  BEGIN
    PERFORM registrar_lote(s_otra, p3, 1, '2031-01-01', 'verif');
    RAISE EXCEPTION 'T6 FALLÓ: registrar_lote con otra tienda debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Producto no encontrado%' THEN RAISE; END IF;
  END;

  -- ── T7 venta + NC parciales + anulación con lotes (S12, S13, §23.5) ────
  INSERT INTO productos (store_id, nombre, sku, precio, stock, activo)
  VALUES (s, 'T7', 'VERIF-T7', 1000, 0, true) RETURNING id INTO p4;
  r := registrar_lote(s, p4, 10, '2030-01-01', 'verif');
  l4 := (r->'lote'->>'id')::uuid;
  r := crear_venta_tx(
    p_store_id => s,
    p_items => jsonb_build_array(jsonb_build_object('producto_id', p4, 'cantidad', 3, 'precio_unitario', 1000, 'subtotal', 3000)),
    p_cliente_id => NULL, p_worker_clerk_id => NULL, p_subtotal => 3000, p_descuento_pct => 0,
    p_impuesto => 479, p_total => 3000, p_metodo_pago => 'efectivo', p_canal => 'pos',
    p_procedencia => 'presencial', p_numero_comprobante => 'VERIF-T7', p_pago_nc => NULL,
    p_numero_transaccion => NULL, p_fidelizacion_niveles => '[]'::jsonb, p_dias_aviso => 5
  );
  v_id := (r->'venta'->>'id')::uuid;
  SELECT id INTO vi_id FROM venta_items WHERE venta_id = v_id;
  SELECT cantidad_actual INTO n FROM lotes_producto WHERE id = l4;
  IF n <> 7 THEN RAISE EXCEPTION 'T7 FALLÓ: tras vender 3, lote esperado 7, es %', n; END IF;

  -- NC parcial 1 de 3: el lote recibe 1 (antes de 075 recibía 3 — S13)
  PERFORM crear_nota_credito_tx(s, 'verif', v_id,
    jsonb_build_array(jsonb_build_object('venta_item_id', vi_id, 'cantidad_devuelta', 1, 'restituir_stock', true)),
    'VERIF-NC1', 'verificación', 'efectivo', 'efectivo', NULL);
  SELECT cantidad_actual INTO n FROM lotes_producto WHERE id = l4;
  IF n <> 8 THEN RAISE EXCEPTION 'T7 FALLÓ (S13): tras NC parcial de 1, lote esperado 8, es %', n; END IF;
  -- Segunda NC parcial 1: el lote recibe 1 más
  PERFORM crear_nota_credito_tx(s, 'verif', v_id,
    jsonb_build_array(jsonb_build_object('venta_item_id', vi_id, 'cantidad_devuelta', 1, 'restituir_stock', true)),
    'VERIF-NC2', 'verificación', 'efectivo', 'efectivo', NULL);
  SELECT cantidad_actual INTO n FROM lotes_producto WHERE id = l4;
  IF n <> 9 THEN RAISE EXCEPTION 'T7 FALLÓ (S13): tras 2ª NC, lote esperado 9, es %', n; END IF;
  -- Anular: devuelve SOLO el neto pendiente (1) y lo devuelve AL LOTE (S12)
  PERFORM anular_venta_tx(s, v_id, 'verif');
  SELECT cantidad_actual INTO n FROM lotes_producto WHERE id = l4;
  IF n <> 10 THEN RAISE EXCEPTION 'T7 FALLÓ (S12/§23.5): tras anular, lote esperado 10, es %', n; END IF;
  SELECT stock INTO n FROM productos WHERE id = p4;
  IF n <> 10 THEN RAISE EXCEPTION 'T7 FALLÓ: stock debe ser Σ lotes = 10, es %', n; END IF;

  -- ── T8 venta sin lotes: D2 atómico en crear_venta_tx + anulación ───────
  INSERT INTO productos (store_id, nombre, sku, precio, stock, activo)
  VALUES (s, 'T8', 'VERIF-T8', 1000, 5, true) RETURNING id INTO p5;
  BEGIN
    PERFORM crear_venta_tx(
      p_store_id => s,
      p_items => jsonb_build_array(jsonb_build_object('producto_id', p5, 'cantidad', 6, 'precio_unitario', 1000, 'subtotal', 6000)),
      p_cliente_id => NULL, p_worker_clerk_id => NULL, p_subtotal => 6000, p_descuento_pct => 0,
      p_impuesto => 958, p_total => 6000, p_metodo_pago => 'efectivo', p_canal => 'pos',
      p_procedencia => 'presencial', p_numero_comprobante => 'VERIF-T8a', p_pago_nc => NULL,
      p_numero_transaccion => NULL, p_fidelizacion_niveles => '[]'::jsonb, p_dias_aviso => 5
    );
    RAISE EXCEPTION 'T8 FALLÓ: vender 6 con stock 5 debía rechazar (D2)';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Stock insuficiente%' THEN RAISE; END IF;
  END;
  r := crear_venta_tx(
    p_store_id => s,
    p_items => jsonb_build_array(jsonb_build_object('producto_id', p5, 'cantidad', 2, 'precio_unitario', 1000, 'subtotal', 2000)),
    p_cliente_id => NULL, p_worker_clerk_id => NULL, p_subtotal => 2000, p_descuento_pct => 0,
    p_impuesto => 319, p_total => 2000, p_metodo_pago => 'efectivo', p_canal => 'pos',
    p_procedencia => 'presencial', p_numero_comprobante => 'VERIF-T8b', p_pago_nc => NULL,
    p_numero_transaccion => NULL, p_fidelizacion_niveles => '[]'::jsonb, p_dias_aviso => 5
  );
  SELECT stock INTO n FROM productos WHERE id = p5;
  IF n <> 3 THEN RAISE EXCEPTION 'T8 FALLÓ: stock esperado 3, es %', n; END IF;
  PERFORM anular_venta_tx(s, (r->'venta'->>'id')::uuid, 'verif');
  SELECT stock INTO n FROM productos WHERE id = p5;
  IF n <> 5 THEN RAISE EXCEPTION 'T8 FALLÓ: tras anular, stock esperado 5, es %', n; END IF;

  -- ── T9 NC de un ítem vendido SIN lotes cuando el producto ya los tiene ──
  INSERT INTO productos (store_id, nombre, sku, precio, stock, activo)
  VALUES (s, 'T9', 'VERIF-T9', 1000, 10, true) RETURNING id INTO p6;
  r := crear_venta_tx(
    p_store_id => s,
    p_items => jsonb_build_array(jsonb_build_object('producto_id', p6, 'cantidad', 4, 'precio_unitario', 1000, 'subtotal', 4000)),
    p_cliente_id => NULL, p_worker_clerk_id => NULL, p_subtotal => 4000, p_descuento_pct => 0,
    p_impuesto => 639, p_total => 4000, p_metodo_pago => 'efectivo', p_canal => 'pos',
    p_procedencia => 'presencial', p_numero_comprobante => 'VERIF-T9', p_pago_nc => NULL,
    p_numero_transaccion => NULL, p_fidelizacion_niveles => '[]'::jsonb, p_dias_aviso => 5
  );
  v_id := (r->'venta'->>'id')::uuid;
  SELECT id INTO vi_id FROM venta_items WHERE venta_id = v_id;
  PERFORM registrar_lote(s, p6, 5, '2031-01-01', 'verif', p_fecha_venc_stock_existente => '2030-12-01');
  SELECT stock INTO n FROM productos WHERE id = p6;
  IF n <> 11 THEN RAISE EXCEPTION 'T9 FALLÓ: 6 suelto + 5 = 11, es %', n; END IF;
  PERFORM crear_nota_credito_tx(s, 'verif', v_id,
    jsonb_build_array(jsonb_build_object('venta_item_id', vi_id, 'cantidad_devuelta', 2, 'restituir_stock', true)),
    'VERIF-NC3', 'verificación', 'efectivo', 'efectivo', NULL);
  SELECT stock INTO n FROM productos WHERE id = p6;
  IF n <> 13 THEN RAISE EXCEPTION 'T9 FALLÓ: la devolución debe ir a un lote (stock 13), es %', n; END IF;
  SELECT COALESCE(SUM(cantidad_actual), 0) INTO n FROM lotes_producto WHERE producto_id = p6 AND activo;
  IF n <> 13 THEN RAISE EXCEPTION 'T9 FALLÓ: Σ lotes debe ser 13 (sin desalineo), es %', n; END IF;

  -- ── T10 ajustar_stock_conteo (D22) ─────────────────────────────────────
  UPDATE productos SET stock = 9.5 WHERE id = p5;           -- decimal heredado (S9)
  r := ajustar_stock_conteo(s, p5, NULL, 9, 'Conteo verificación', 'verif');
  IF (r->>'stock_nuevo')::numeric <> 9 OR (r->>'delta')::numeric <> -0.5 THEN
    RAISE EXCEPTION 'T10 FALLÓ: esperado stock 9 / delta -0.5, fue %', r;
  END IF;
  SELECT count(*) INTO c FROM stock_movements WHERE producto_id = p5 AND tipo = 'ajuste_conteo' AND cantidad = -0.5 AND user_id = 'verif';
  IF c <> 1 THEN RAISE EXCEPTION 'T10 FALLÓ: falta el movimiento ajuste_conteo -0.5 con usuario'; END IF;
  BEGIN
    PERFORM ajustar_stock_conteo(s, p4, NULL, 1, 'Conteo verificación', 'verif');
    RAISE EXCEPTION 'T10 FALLÓ: producto con lotes sin lote_id debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Producto con lotes%' THEN RAISE; END IF;
  END;
  r := ajustar_stock_conteo(s, p4, l4, 7, 'Conteo verificación', 'verif');
  SELECT stock INTO n FROM productos WHERE id = p4;
  IF n <> 7 THEN RAISE EXCEPTION 'T10 FALLÓ: conteo por lote debía dejar stock 7, es %', n; END IF;
  BEGIN
    PERFORM ajustar_stock_conteo(s_otra, p5, NULL, 1, 'Conteo verificación', 'verif');
    RAISE EXCEPTION 'T10 FALLÓ: conteo con otra tienda debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Producto no encontrado%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM ajustar_stock_conteo(s, p5, NULL, 1, 'abc', 'verif');
    RAISE EXCEPTION 'T10 FALLÓ: motivo corto debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El motivo del conteo%' THEN RAISE; END IF;
  END;

  -- ── T11 merma_lote_vencido (D23) ───────────────────────────────────────
  BEGIN
    PERFORM merma_lote_vencido(s, l_b, NULL, 'verif');
    RAISE EXCEPTION 'T11 FALLÓ: un lote vigente no se da de baja por vencimiento';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El lote no está vencido%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM merma_lote_vencido(s_otra, l_venc, NULL, 'verif');
    RAISE EXCEPTION 'T11 FALLÓ: merma con otra tienda debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Lote no encontrado%' THEN RAISE; END IF;
  END;
  r := merma_lote_vencido(s, l_venc, 'Vencido en bodega', 'verif');
  IF (r->>'cantidad_baja')::numeric <> 10 THEN RAISE EXCEPTION 'T11 FALLÓ: cantidad_baja esperada 10'; END IF;
  SELECT stock INTO n FROM productos WHERE id = p2;
  IF n <> 2 THEN RAISE EXCEPTION 'T11 FALLÓ: tras la merma solo quedan 2 vigentes, stock %', n; END IF;
  SELECT count(*) INTO c FROM lotes_producto WHERE id = l_venc AND activo = false;
  IF c <> 1 THEN RAISE EXCEPTION 'T11 FALLÓ: el lote debe quedar inactivo (no borrado)'; END IF;
  SELECT count(*) INTO c FROM stock_movements WHERE referencia_id = l_venc AND tipo = 'merma' AND cantidad = -10 AND user_id = 'verif';
  IF c <> 1 THEN RAISE EXCEPTION 'T11 FALLÓ: falta el movimiento merma -10 con usuario'; END IF;
  BEGIN
    PERFORM merma_lote_vencido(s, l_venc, NULL, 'verif');
    RAISE EXCEPTION 'T11 FALLÓ: dar de baja dos veces debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El lote ya está dado de baja%' THEN RAISE; END IF;
  END;

  -- ── T12 Grants (patrón 069): anon/authenticated sin EXECUTE ───────────
  IF has_function_privilege('anon', 'decrement_stock(uuid,numeric)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'decrement_stock(uuid,numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'increment_stock(uuid,numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'deducir_stock_fifo(uuid,uuid,numeric,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'devolver_stock_producto(uuid,uuid,numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'devolver_a_lotes_venta_item(uuid,numeric,numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'registrar_lote(uuid,uuid,numeric,date,text,numeric,text,date,uuid,text,date,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'convertir_stock_suelto_a_lote(uuid,uuid,date,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'ajustar_stock_conteo(uuid,uuid,uuid,numeric,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'merma_lote_vencido(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'merma_lote_vencido(uuid,uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T12 FALLÓ: anon/authenticated tienen EXECUTE sobre una función de stock';
  END IF;
  SELECT count(*) INTO c FROM pg_proc
   WHERE proname IN ('decrement_stock', 'increment_stock', 'deducir_stock_fifo', 'devolver_stock_a_lotes');
  IF c <> 3 THEN RAISE EXCEPTION 'T12 FALLÓ: debe quedar una sola versión de cada función (hay % filas)', c; END IF;
END $$;

SELECT 'FASE 1: TODAS LAS VERIFICACIONES OK' AS resultado;

ROLLBACK;

-- ============================================================================
-- Concurrencia (manual, opcional — dos pestañas del SQL Editor):
--   Pestaña A:  BEGIN; SELECT deducir_stock_fifo('<producto>', '<store>', <todo el stock>);
--               (NO hacer COMMIT todavía)
--   Pestaña B:  BEGIN; SELECT deducir_stock_fifo('<producto>', '<store>', 1);
--               → debe quedar ESPERANDO (bloqueo FOR UPDATE del producto).
--   Pestaña A:  ROLLBACK;  → B continúa y descuenta 1.   Pestaña B: ROLLBACK;
--   Con COMMIT en A (en vez de ROLLBACK), B debe fallar con 'Stock insuficiente'.
--   Usar un producto de prueba y terminar AMBAS pestañas con ROLLBACK.
-- ============================================================================
