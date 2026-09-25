-- ============================================================================
-- Verificación REAL de la Fase 1b — granel (migraciones 077, 078)
-- Plan: stock_canales_externos.md §4.6 / §6 paso 1.5 — AGENTS.md §11.4
-- Proyecto Supabase: wnxrdbnvreofrrmhcybc
--
-- Ejecutar en Supabase → SQL Editor DESPUÉS de aplicar 077 → 078.
-- Todo corre dentro de BEGIN … ROLLBACK: crea tiendas y productos de prueba,
-- ejercita las funciones y DESHACE TODO al final (incluida la función
-- auxiliar pg_temp.verif_venta). No persiste nada.
--
-- Resultado esperado: la última consulta devuelve
--   'FASE 1b: TODAS LAS VERIFICACIONES OK'.
-- Si alguna verificación falla, el DO lanza 'Gn FALLÓ: …' y las consultas
-- siguientes dan "current transaction is aborted" — igual se hace ROLLBACK.
--
-- Ventas de prueba con p_worker_clerk_id => NULL (FK a clerk_users; no se
-- crean usuarios falsos). Los user_id de sacos / movimientos son texto libre.
--
-- NO cubre (requiere dos sesiones): dos cajas abriendo saco a la vez (G9).
-- Ver instrucciones al final.
-- ============================================================================

BEGIN;

-- Auxiliar: venta de una línea (granel o por unidad). Temporal y dentro de
-- la transacción → el ROLLBACK la elimina.
CREATE FUNCTION pg_temp.verif_venta(
  p_store uuid, p_item jsonb, p_total numeric, p_comprobante text
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT crear_venta_tx(
    p_store_id => p_store,
    p_items => jsonb_build_array(p_item),
    p_cliente_id => NULL, p_worker_clerk_id => NULL, p_subtotal => p_total, p_descuento_pct => 0,
    p_impuesto => 0, p_total => p_total, p_metodo_pago => 'efectivo', p_canal => 'pos',
    p_procedencia => 'presencial', p_numero_comprobante => p_comprobante, p_pago_nc => NULL,
    p_numero_transaccion => NULL, p_fidelizacion_niveles => '[]'::jsonb, p_dias_aviso => 5,
    p_user_id => 'verif'
  );
$$;

DO $$
DECLARE
  s      uuid;   -- tienda de prueba
  s_otra uuid;   -- otra tienda (aislamiento)
  pg uuid; pb uuid; pl uuid; pc uuid; pd uuid; pu uuid;
  l_a uuid; l_b uuid;
  r      jsonb;
  v_id   uuid;
  vi_id  uuid;
  saco   uuid;
  n      numeric;
  c      integer;
  t      text;
  i      integer;
BEGIN
  INSERT INTO stores (name) VALUES ('VERIF-FASE1B (rollback)') RETURNING id INTO s;
  INSERT INTO stores (name) VALUES ('VERIF-FASE1B otra (rollback)') RETURNING id INTO s_otra;

  -- Granel sin lotes: saco de 15 000 g, $5.000/kg, costo $30.000 por saco.
  INSERT INTO productos (store_id, nombre, sku, precio, costo, stock, activo, peso_gramos, precio_venta_kg)
  VALUES (s, 'G-granel', 'VERIF-G1', 60000, 30000, 10, true, 15000, 5000) RETURNING id INTO pg;

  -- ── G1 primera venta sin saco abierto exige confirmar apertura (G1/G3) ──
  BEGIN
    PERFORM pg_temp.verif_venta(s, jsonb_build_object('producto_id', pg, 'es_granel', true, 'gramos', 500,
      'cantidad', 0.5, 'precio_unitario', 5000, 'subtotal', 2500), 2500, 'VERIF-G1a');
    RAISE EXCEPTION 'G1 FALLÓ: sin saco abierto y sin abrir_saco debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Saco abierto insuficiente%' THEN RAISE; END IF;
  END;
  SELECT stock INTO n FROM productos WHERE id = pg;
  IF n <> 10 THEN RAISE EXCEPTION 'G1 FALLÓ: el rechazo no debe tocar el stock (%)', n; END IF;

  -- ── G2 venta de 500 g confirmando apertura: stock 10 → 9,967 (D20) ─────
  r := pg_temp.verif_venta(s, jsonb_build_object('producto_id', pg, 'es_granel', true, 'gramos', 500,
    'cantidad', 99, 'precio_unitario', 5000, 'subtotal', 2500, 'abrir_saco', true), 2500, 'VERIF-G2');
  v_id := (r->'venta'->>'id')::uuid;
  SELECT stock INTO n FROM productos WHERE id = pg;
  IF n <> 9.967 THEN RAISE EXCEPTION 'G2 FALLÓ: stock esperado 9.967, es %', n; END IF;
  SELECT id INTO vi_id FROM venta_items WHERE venta_id = v_id;
  SELECT count(*) INTO c FROM venta_items
   WHERE id = vi_id AND es_granel AND gramos = 500 AND cantidad = 0.5;
  IF c <> 1 THEN RAISE EXCEPTION 'G2 FALLÓ: venta_item debe ser granel, 500 g, 0.5 kg (la BD ignora la cantidad del cliente)'; END IF;
  SELECT gramos_restantes, id INTO c, saco FROM sacos_abiertos WHERE producto_id = pg AND cerrado_at IS NULL;
  IF c <> 14500 THEN RAISE EXCEPTION 'G2 FALLÓ: saco abierto esperado 14500 g, es %', c; END IF;
  SELECT count(*) INTO c FROM venta_item_sacos WHERE venta_item_id = vi_id AND saco_id = saco AND gramos = 500;
  IF c <> 1 THEN RAISE EXCEPTION 'G2 FALLÓ: falta venta_item_sacos 500 g'; END IF;
  SELECT count(*) INTO c FROM stock_movements WHERE producto_id = pg AND tipo = 'apertura_saco' AND cantidad = 0;
  IF c <> 1 THEN RAISE EXCEPTION 'G2 FALLÓ: falta el movimiento apertura_saco (cantidad 0)'; END IF;

  -- ── G3 29 ventas más de 500 g: exactamente 1 saco menos, sin deriva (I4)
  FOR i IN 1..29 LOOP
    PERFORM pg_temp.verif_venta(s, jsonb_build_object('producto_id', pg, 'es_granel', true, 'gramos', 500,
      'precio_unitario', 5000, 'subtotal', 2500), 2500, 'VERIF-G3-' || i);
  END LOOP;
  SELECT stock INTO n FROM productos WHERE id = pg;
  IF n <> 9 THEN RAISE EXCEPTION 'G3 FALLÓ: 30 × 500 g deben dejar exactamente 9, es %', n; END IF;
  SELECT count(*) INTO c FROM sacos_abiertos WHERE producto_id = pg AND cerrado_at IS NULL;
  IF c <> 0 THEN RAISE EXCEPTION 'G3 FALLÓ: el saco agotado debía cerrarse'; END IF;
  SELECT count(*) INTO c FROM sacos_abiertos WHERE id = saco AND motivo_cierre = 'agotado' AND gramos_restantes = 0;
  IF c <> 1 THEN RAISE EXCEPTION 'G3 FALLÓ: el saco debía cerrarse como agotado'; END IF;

  -- ── G4 apertura manual + venta que cruza dos sacos en una transacción ──
  r := abrir_saco(s, pg, 'verif', 'manual');
  SELECT stock INTO n FROM productos WHERE id = pg;
  IF n <> 9 THEN RAISE EXCEPTION 'G4 FALLÓ: abrir un saco no cambia el total (9), es %', n; END IF;
  PERFORM pg_temp.verif_venta(s, jsonb_build_object('producto_id', pg, 'es_granel', true, 'gramos', 14800,
    'precio_unitario', 5000, 'subtotal', 74000), 74000, 'VERIF-G4a');
  SELECT stock INTO n FROM productos WHERE id = pg;
  IF n <> 8.013 THEN RAISE EXCEPTION 'G4 FALLÓ: 8 cerrados + 200 g = 8.013, es %', n; END IF;
  BEGIN
    PERFORM pg_temp.verif_venta(s, jsonb_build_object('producto_id', pg, 'es_granel', true, 'gramos', 500,
      'precio_unitario', 5000, 'subtotal', 2500), 2500, 'VERIF-G4b');
    RAISE EXCEPTION 'G4 FALLÓ: 500 g con 200 g restantes y sin confirmar debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Saco abierto insuficiente%' THEN RAISE; END IF;
  END;
  r := pg_temp.verif_venta(s, jsonb_build_object('producto_id', pg, 'es_granel', true, 'gramos', 500,
    'precio_unitario', 5000, 'subtotal', 2500, 'abrir_saco', true), 2500, 'VERIF-G4c');
  SELECT stock INTO n FROM productos WHERE id = pg;
  IF n <> 7.980 THEN RAISE EXCEPTION 'G4 FALLÓ: 7 cerrados + 14700 g = 7.980, es %', n; END IF;
  SELECT count(*) INTO c FROM venta_item_sacos vis JOIN venta_items vi ON vi.id = vis.venta_item_id
   WHERE vi.venta_id = (r->'venta'->>'id')::uuid;
  IF c <> 2 THEN RAISE EXCEPTION 'G4 FALLÓ: la venta debía registrar 2 sacos (200 + 300 g), hay %', c; END IF;

  -- ── G5 las ventas por unidad solo usan sacos cerrados (I5) ─────────────
  INSERT INTO productos (store_id, nombre, sku, precio, stock, activo, peso_gramos, precio_venta_kg)
  VALUES (s, 'G-devol', 'VERIF-G5', 10000, 0, true, 10000, 1000) RETURNING id INTO pb;
  n := devolver_granel(s, pb, 15000, 'verif');      -- sin saco: crea uno origen 'devolucion'
  SELECT stock INTO n FROM productos WHERE id = pb;
  IF n <> 1.5 THEN RAISE EXCEPTION 'G5 FALLÓ: 15000 g devueltos de un saco de 10000 = 1.5, es %', n; END IF;
  BEGIN
    PERFORM decrement_stock(pb, 1);
    RAISE EXCEPTION 'G5 FALLÓ: con 0 sacos cerrados (stock 1.5 todo abierto) vender 1 debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Stock insuficiente%' THEN RAISE; END IF;
  END;

  -- ── G6 abrir con un saco abierto con gramos exige merma antes ─────────
  BEGIN
    PERFORM abrir_saco(s, pg, 'verif', NULL);
    RAISE EXCEPTION 'G6 FALLÓ: con 14700 g abiertos no se debe abrir otro';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Saco abierto con gramos restantes%' THEN RAISE; END IF;
  END;

  -- ── G7 merma del saco abierto guarda usuario y movimiento (G6) ─────────
  BEGIN
    PERFORM cerrar_saco_merma(s, pg, 'abc', 'verif-merma');
    RAISE EXCEPTION 'G7 FALLÓ: motivo corto debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El motivo de la merma%' THEN RAISE; END IF;
  END;
  r := cerrar_saco_merma(s, pg, 'Saco húmedo', 'verif-merma');
  IF (r->>'gramos_merma')::integer <> 14700 THEN RAISE EXCEPTION 'G7 FALLÓ: gramos_merma esperado 14700'; END IF;
  SELECT stock INTO n FROM productos WHERE id = pg;
  IF n <> 7 THEN RAISE EXCEPTION 'G7 FALLÓ: tras la merma quedan 7 cerrados, es %', n; END IF;
  SELECT count(*) INTO c FROM sacos_abiertos
   WHERE producto_id = pg AND motivo_cierre = 'merma' AND cerrado_por = 'verif-merma' AND gramos_merma = 14700;
  IF c <> 1 THEN RAISE EXCEPTION 'G7 FALLÓ: el saco debe guardar cerrado_por y gramos_merma'; END IF;
  SELECT count(*) INTO c FROM stock_movements
   WHERE producto_id = pg AND tipo = 'merma' AND cantidad = -0.98 AND user_id = 'verif-merma';
  IF c <> 1 THEN RAISE EXCEPTION 'G7 FALLÓ: falta movimiento merma -0.98 con usuario'; END IF;
  BEGIN
    PERFORM cerrar_saco_merma(s, pg, 'Saco húmedo', 'verif-merma');
    RAISE EXCEPTION 'G7 FALLÓ: sin saco abierto debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'No hay saco abierto%' THEN RAISE; END IF;
  END;

  -- ── G8 deshacer apertura (G2) ─────────────────────────────────────────
  PERFORM abrir_saco(s, pg, 'verif', NULL);
  r := deshacer_apertura_saco(s, pg, 'verif-admin');
  SELECT stock INTO n FROM productos WHERE id = pg;
  IF n <> 7 OR fraccion_saco_abierto(pg) <> 0 THEN
    RAISE EXCEPTION 'G8 FALLÓ: deshacer debe dejar 7 cerrados y ningún saco abierto (stock %)', n;
  END IF;
  IF r->'saco'->>'motivo_cierre' <> 'deshecho' THEN RAISE EXCEPTION 'G8 FALLÓ: motivo_cierre esperado deshecho'; END IF;
  PERFORM decrement_stock(pg, 7);                     -- los 7 son cerrados de verdad
  PERFORM increment_stock(pg, 7);
  PERFORM abrir_saco(s, pg, 'verif', NULL);
  PERFORM pg_temp.verif_venta(s, jsonb_build_object('producto_id', pg, 'es_granel', true, 'gramos', 100,
    'precio_unitario', 5000, 'subtotal', 500), 500, 'VERIF-G8');
  BEGIN
    PERFORM deshacer_apertura_saco(s, pg, 'verif-admin');
    RAISE EXCEPTION 'G8 FALLÓ: un saco con ventas no se puede deshacer';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El saco no se puede deshacer%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM deshacer_apertura_saco(s, pb, 'verif-admin');
    RAISE EXCEPTION 'G8 FALLÓ: un saco de devolución no se puede deshacer';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El saco no se puede deshacer%' THEN RAISE; END IF;
  END;
  SELECT stock INTO n FROM productos WHERE id = pg;
  IF n <> 6.993 THEN RAISE EXCEPTION 'G8 FALLÓ: 6 cerrados + 14900 g = 6.993, es %', n; END IF;

  -- ── G9 NC parcial de granel: gramos al saco, costo proporcional (G5/G7)
  r := pg_temp.verif_venta(s, jsonb_build_object('producto_id', pg, 'es_granel', true, 'gramos', 1000,
    'precio_unitario', 5000, 'subtotal', 5000), 5000, 'VERIF-G9');
  v_id := (r->'venta'->>'id')::uuid;
  SELECT id INTO vi_id FROM venta_items WHERE venta_id = v_id;
  SELECT stock INTO n FROM productos WHERE id = pg;
  IF n <> 6.927 THEN RAISE EXCEPTION 'G9 FALLÓ: tras vender 1000 g, 6 + 13900 g = 6.927, es %', n; END IF;
  r := crear_nota_credito_tx(s, 'verif', v_id,
    jsonb_build_array(jsonb_build_object('venta_item_id', vi_id, 'cantidad_devuelta', 0.4, 'restituir_stock', true)),
    'VERIF-NCG1', 'verificación', 'efectivo', 'efectivo', NULL);
  IF (r->>'costo_total')::numeric <> 800 THEN
    RAISE EXCEPTION 'G9 FALLÓ: costo devuelto esperado 400/15000 × 30000 = 800, es %', r->>'costo_total';
  END IF;
  IF (r->>'monto_total')::numeric <> 2000 THEN
    RAISE EXCEPTION 'G9 FALLÓ: monto NC esperado 0.4 kg × 5000 = 2000, es %', r->>'monto_total';
  END IF;
  SELECT stock INTO n FROM productos WHERE id = pg;
  IF n <> 6.953 THEN RAISE EXCEPTION 'G9 FALLÓ: 400 g vuelven al saco → 6 + 14300 g = 6.953, es %', n; END IF;
  BEGIN
    PERFORM crear_nota_credito_tx(s, 'verif', v_id,
      jsonb_build_array(jsonb_build_object('venta_item_id', vi_id, 'cantidad_devuelta', 0.0005, 'restituir_stock', true)),
      'VERIF-NCG2', 'verificación', 'efectivo', 'efectivo', NULL);
    RAISE EXCEPTION 'G9 FALLÓ: más de 3 decimales de kg debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Cantidad inválida%' THEN RAISE; END IF;
  END;

  -- ── G10 anular la venta: solo los 600 g netos vuelven (§23.5, G7) ──────
  r := anular_venta_tx(s, v_id, 'verif');
  IF (r->>'costo_total')::numeric <> 1200 THEN
    RAISE EXCEPTION 'G10 FALLÓ: costo de anulación esperado 600/15000 × 30000 = 1200, es %', r->>'costo_total';
  END IF;
  SELECT stock INTO n FROM productos WHERE id = pg;
  IF n <> 6.993 THEN RAISE EXCEPTION 'G10 FALLÓ: tras anular, stock previo a la venta 6.993, es %', n; END IF;
  SELECT count(*) INTO c FROM stock_movements
   WHERE producto_id = pg AND referencia_id = v_id AND tipo = 'entrada' AND cantidad = 0.04;
  IF c <> 1 THEN RAISE EXCEPTION 'G10 FALLÓ: falta el movimiento de anulación (600 g = 0.04)'; END IF;

  -- ── G11 granel con lotes: apertura FIFO del lote más antiguo (G4) ──────
  INSERT INTO productos (store_id, nombre, sku, precio, stock, activo, peso_gramos, precio_venta_kg)
  VALUES (s, 'G-lotes', 'VERIF-G11', 20000, 0, true, 10000, 2000) RETURNING id INTO pl;
  r := registrar_lote(s, pl, 2, '2030-01-01', 'verif', p_fecha_ingreso => '2026-01-01');
  l_a := (r->'lote'->>'id')::uuid;
  r := registrar_lote(s, pl, 3, '2030-06-01', 'verif', p_fecha_ingreso => '2026-02-01');
  l_b := (r->'lote'->>'id')::uuid;
  r := abrir_saco(s, pl, 'verif', NULL);
  IF (r->'saco'->>'lote_id')::uuid IS DISTINCT FROM l_a THEN RAISE EXCEPTION 'G11 FALLÓ: el saco debe salir del lote más antiguo'; END IF;
  SELECT cantidad_actual INTO n FROM lotes_producto WHERE id = l_a;
  IF n <> 1 THEN RAISE EXCEPTION 'G11 FALLÓ: lote A esperado 1, es %', n; END IF;
  SELECT stock INTO n FROM productos WHERE id = pl;
  IF n <> 5 THEN RAISE EXCEPTION 'G11 FALLÓ: abrir no cambia el total (5), es %', n; END IF;
  PERFORM pg_temp.verif_venta(s, jsonb_build_object('producto_id', pl, 'es_granel', true, 'gramos', 2500,
    'precio_unitario', 2000, 'subtotal', 5000), 5000, 'VERIF-G11a');
  SELECT stock INTO n FROM productos WHERE id = pl;
  IF n <> 4.75 THEN RAISE EXCEPTION 'G11 FALLÓ: 4 cerrados + 7500 g = 4.75, es %', n; END IF;
  PERFORM registrar_lote(s, pl, 1, '2031-01-01', 'verif');   -- el trigger conserva la fracción
  SELECT stock INTO n FROM productos WHERE id = pl;
  IF n <> 5.75 THEN RAISE EXCEPTION 'G11 FALLÓ: trigger de lotes debe sumar la fracción (5.75), es %', n; END IF;
  PERFORM ajustar_stock_conteo(s, pl, l_b, 2, 'Conteo verificación', 'verif');
  SELECT stock INTO n FROM productos WHERE id = pl;
  IF n <> 4.75 THEN RAISE EXCEPTION 'G11 FALLÓ: conteo por lote conserva la fracción (4.75), es %', n; END IF;
  PERFORM pg_temp.verif_venta(s, jsonb_build_object('producto_id', pl, 'cantidad', 1,
    'precio_unitario', 20000, 'subtotal', 20000), 20000, 'VERIF-G11b');
  SELECT stock INTO n FROM productos WHERE id = pl;
  IF n <> 3.75 THEN RAISE EXCEPTION 'G11 FALLÓ: venta de 1 saco entero por FIFO (3.75), es %', n; END IF;

  -- ── G12 primer lote de un granel con saco abierto: LOTE-0 = cerrados ───
  INSERT INTO productos (store_id, nombre, sku, precio, stock, activo, peso_gramos, precio_venta_kg)
  VALUES (s, 'G-conv', 'VERIF-G12', 20000, 4, true, 10000, 2000) RETURNING id INTO pc;
  PERFORM abrir_saco(s, pc, 'verif', NULL);
  PERFORM pg_temp.verif_venta(s, jsonb_build_object('producto_id', pc, 'es_granel', true, 'gramos', 5000,
    'precio_unitario', 2000, 'subtotal', 10000), 10000, 'VERIF-G12');
  r := registrar_lote(s, pc, 2, '2031-01-01', 'verif', p_fecha_venc_stock_existente => '2030-12-01');
  IF (r->'lote_inicial'->>'cantidad_actual')::numeric <> 3 THEN
    RAISE EXCEPTION 'G12 FALLÓ: LOTE-0 debe ser solo los 3 cerrados, es %', r->'lote_inicial'->>'cantidad_actual';
  END IF;
  SELECT stock INTO n FROM productos WHERE id = pc;
  IF n <> 5.5 THEN RAISE EXCEPTION 'G12 FALLÓ: 3 + 2 + 5000 g = 5.5, es %', n; END IF;

  -- ── G13 conteo físico de granel sin lotes (D22 + gramos) ──────────────
  INSERT INTO productos (store_id, nombre, sku, precio, stock, activo, peso_gramos, precio_venta_kg)
  VALUES (s, 'G-conteo', 'VERIF-G13', 20000, 5, true, 10000, 2000) RETURNING id INTO pd;
  PERFORM abrir_saco(s, pd, 'verif', NULL);                   -- 4 cerrados + 10000 g
  r := ajustar_stock_conteo(s, pd, NULL, 3, 'Conteo verificación', 'verif', 4000);
  IF (r->>'stock_nuevo')::numeric <> 3.4 OR (r->>'cantidad_anterior')::numeric <> 4
     OR (r->>'delta')::numeric <> -1 OR (r->>'gramos_anterior')::integer <> 10000 THEN
    RAISE EXCEPTION 'G13 FALLÓ: esperado stock 3.4, cerrados 4 → 3, gramos 10000 → 4000; fue %', r;
  END IF;
  r := ajustar_stock_conteo(s, pd, NULL, 3, 'Conteo verificación', 'verif', 0);
  SELECT stock INTO n FROM productos WHERE id = pd;
  IF n <> 3 THEN RAISE EXCEPTION 'G13 FALLÓ: 0 g cierra el saco (stock 3), es %', n; END IF;
  SELECT count(*) INTO c FROM sacos_abiertos WHERE producto_id = pd AND motivo_cierre = 'conteo';
  IF c <> 1 THEN RAISE EXCEPTION 'G13 FALLÓ: el saco debía cerrarse con motivo conteo'; END IF;
  r := ajustar_stock_conteo(s, pd, NULL, 3, 'Conteo verificación', 'verif', 2500);
  SELECT stock INTO n FROM productos WHERE id = pd;
  IF n <> 3.25 THEN RAISE EXCEPTION 'G13 FALLÓ: 2500 g sin saco crean uno (3.25), es %', n; END IF;

  -- ── G14 guardias de esquema: peso con saco abierto, G8 ────────────────
  BEGIN
    UPDATE productos SET peso_gramos = 12000 WHERE id = pd;
    RAISE EXCEPTION 'G14 FALLÓ: cambiar peso con saco abierto debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'No se puede cambiar el peso%' THEN RAISE; END IF;
  END;
  INSERT INTO productos (store_id, nombre, sku, precio, stock, activo)
  VALUES (s, 'G-unidad', 'VERIF-G14', 1000, 10, true) RETURNING id INTO pu;
  BEGIN
    UPDATE productos SET precio_venta_kg = 1000 WHERE id = pu;
    RAISE EXCEPTION 'G14 FALLÓ: precio por kg sin peso_gramos debía violar el CHECK (G8)';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── G15 aislamiento de tienda ─────────────────────────────────────────
  FOREACH t IN ARRAY ARRAY['abrir', 'merma', 'deshacer', 'devolver', 'venta', 'conteo'] LOOP
    BEGIN
      CASE t
        WHEN 'abrir'    THEN PERFORM abrir_saco(s_otra, pd, 'x', NULL);
        WHEN 'merma'    THEN PERFORM cerrar_saco_merma(s_otra, pd, 'Motivo largo', 'x');
        WHEN 'deshacer' THEN PERFORM deshacer_apertura_saco(s_otra, pd, 'x');
        WHEN 'devolver' THEN PERFORM devolver_granel(s_otra, pd, 100, 'x');
        WHEN 'venta'    THEN PERFORM pg_temp.verif_venta(s_otra, jsonb_build_object('producto_id', pd,
                               'es_granel', true, 'gramos', 100, 'precio_unitario', 2000, 'subtotal', 200,
                               'abrir_saco', true), 200, 'VERIF-G15');
        WHEN 'conteo'   THEN PERFORM ajustar_stock_conteo(s_otra, pd, NULL, 1, 'Conteo verificación', 'x', 100);
      END CASE;
      RAISE EXCEPTION 'G15 FALLÓ: % con otra tienda debía rechazar', t;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Producto no encontrado%' THEN RAISE; END IF;
    END;
  END LOOP;
  SELECT stock INTO n FROM productos WHERE id = pd;
  IF n <> 3.25 THEN RAISE EXCEPTION 'G15 FALLÓ: los intentos de otra tienda no deben tocar el stock (%)', n; END IF;

  -- ── G16 validación de cantidades en crear_venta_tx / NC ───────────────
  BEGIN
    PERFORM pg_temp.verif_venta(s, jsonb_build_object('producto_id', pu, 'cantidad', 1.5,
      'precio_unitario', 1000, 'subtotal', 1500), 1500, 'VERIF-G16a');
    RAISE EXCEPTION 'G16 FALLÓ: venta por unidad con 1.5 debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Cantidad inválida%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM pg_temp.verif_venta(s, jsonb_build_object('producto_id', pg, 'es_granel', true,
      'cantidad', 0.5, 'precio_unitario', 5000, 'subtotal', 2500), 2500, 'VERIF-G16b');
    RAISE EXCEPTION 'G16 FALLÓ: granel sin gramos debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Cantidad inválida%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM pg_temp.verif_venta(s, jsonb_build_object('producto_id', pu, 'es_granel', true, 'gramos', 500,
      'precio_unitario', 1000, 'subtotal', 500, 'abrir_saco', true), 500, 'VERIF-G16c');
    RAISE EXCEPTION 'G16 FALLÓ: granel sobre producto sin granel debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Producto no habilitado para granel%' THEN RAISE; END IF;
  END;
  r := pg_temp.verif_venta(s, jsonb_build_object('producto_id', pu, 'cantidad', 2,
    'precio_unitario', 1000, 'subtotal', 2000), 2000, 'VERIF-G16d');
  v_id := (r->'venta'->>'id')::uuid;
  SELECT id INTO vi_id FROM venta_items WHERE venta_id = v_id;
  SELECT stock INTO n FROM productos WHERE id = pu;
  IF n <> 8 THEN RAISE EXCEPTION 'G16 FALLÓ: venta por unidad (regresión) stock esperado 8, es %', n; END IF;
  SELECT count(*) INTO c FROM venta_items WHERE id = vi_id AND NOT es_granel AND gramos IS NULL;
  IF c <> 1 THEN RAISE EXCEPTION 'G16 FALLÓ: venta por unidad debe quedar es_granel=false, gramos NULL'; END IF;
  BEGIN
    PERFORM crear_nota_credito_tx(s, 'verif', v_id,
      jsonb_build_array(jsonb_build_object('venta_item_id', vi_id, 'cantidad_devuelta', 0.5, 'restituir_stock', true)),
      'VERIF-NCG3', 'verificación', 'efectivo', 'efectivo', NULL);
    RAISE EXCEPTION 'G16 FALLÓ: NC de 0.5 en una línea por unidad debía rechazar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Cantidad inválida%' THEN RAISE; END IF;
  END;
  PERFORM crear_nota_credito_tx(s, 'verif', v_id,
    jsonb_build_array(jsonb_build_object('venta_item_id', vi_id, 'cantidad_devuelta', 1, 'restituir_stock', true)),
    'VERIF-NCG4', 'verificación', 'efectivo', 'efectivo', NULL);
  SELECT stock INTO n FROM productos WHERE id = pu;
  IF n <> 9 THEN RAISE EXCEPTION 'G16 FALLÓ: NC por unidad (regresión) stock esperado 9, es %', n; END IF;

  -- ── G17 grants, RLS y firmas únicas ───────────────────────────────────
  IF has_function_privilege('anon', 'abrir_saco(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'abrir_saco(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'abrir_saco_interno(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'consumir_granel(uuid,uuid,uuid,integer,boolean,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'devolver_granel(uuid,uuid,integer,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'cerrar_saco_merma(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'cerrar_saco_merma(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'deshacer_apertura_saco(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'deshacer_apertura_saco(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'ajustar_stock_por_saco(uuid,uuid,numeric,numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'fraccion_saco_abierto(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'fraccion_gramos(integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'decrement_stock(uuid,numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'convertir_stock_suelto_a_lote(uuid,uuid,date,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'ajustar_stock_conteo(uuid,uuid,uuid,numeric,text,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'ajustar_stock_conteo(uuid,uuid,uuid,numeric,text,text,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'anular_venta_tx(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'crear_nota_credito_tx(uuid,text,uuid,jsonb,text,text,text,text,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'crear_venta_tx(uuid,jsonb,uuid,text,numeric,numeric,numeric,numeric,text,text,text,text,jsonb,text,jsonb,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'crear_venta_tx(uuid,jsonb,uuid,text,numeric,numeric,numeric,numeric,text,text,text,text,jsonb,text,jsonb,integer,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G17 FALLÓ: anon/authenticated tienen EXECUTE sobre una función de granel/stock';
  END IF;
  SELECT count(*) INTO c FROM pg_proc WHERE proname IN ('crear_venta_tx', 'ajustar_stock_conteo');
  IF c <> 2 THEN RAISE EXCEPTION 'G17 FALLÓ: debe quedar una sola versión de crear_venta_tx y ajustar_stock_conteo (hay %)', c; END IF;
  SELECT count(*) INTO c FROM pg_class
   WHERE relname IN ('sacos_abiertos', 'venta_item_sacos') AND relrowsecurity;
  IF c <> 2 THEN RAISE EXCEPTION 'G17 FALLÓ: RLS debe estar habilitado en sacos_abiertos y venta_item_sacos'; END IF;
END $$;

SELECT 'FASE 1b: TODAS LAS VERIFICACIONES OK' AS resultado;

ROLLBACK;

-- ============================================================================
-- Concurrencia (manual, opcional — dos pestañas del SQL Editor), G9:
--   Usar un producto granel de PRUEBA sin saco abierto y con stock ≥ 2.
--   Pestaña A:  BEGIN; SELECT abrir_saco('<store>', '<producto>', 'A', NULL);
--               (NO hacer COMMIT todavía)
--   Pestaña B:  BEGIN; SELECT abrir_saco('<store>', '<producto>', 'B', NULL);
--               → debe quedar ESPERANDO (bloqueo FOR UPDATE del producto).
--   Pestaña A:  COMMIT;  → B continúa y falla con
--               'Saco abierto con gramos restantes …' (no abre un segundo saco).
--   Pestaña B:  ROLLBACK.  Luego deshacer la apertura de A:
--               SELECT deshacer_apertura_saco('<store>', '<producto>', 'A');
-- ============================================================================
