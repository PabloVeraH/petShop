-- ============================================================================
-- Verificación REAL de la Fase 4 — disponibilidad por canal (migración 082).
-- Plan: stock_canales_externos.md §4.4, §6 Fase 4 (4.2, 4.7) — AGENTS.md §11.4
-- Proyecto Supabase: wnxrdbnvreofrrmhcybc
--
-- Ejecutar DESPUÉS de aplicar 082. BEGIN … ROLLBACK: crea una tienda,
-- productos, lotes y trabajos de prueba y DESHACE TODO.
-- Resultado esperado: 'FASE 4: TODAS LAS VERIFICACIONES OK'.
-- NO cubre: dos ventas concurrentes compitiendo por la misma dedupe_key
-- (ver instrucciones al final).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  s   uuid;
  s2  uuid;
  p   uuid;
  pl  uuid;
  pg  uuid;
  pn  uuid;
  c   integer;
  e   record;
BEGIN
  INSERT INTO stores (name) VALUES ('VERIF-FASE4 (rollback)') RETURNING id INTO s;
  INSERT INTO stores (name) VALUES ('VERIF-FASE4 otra (rollback)') RETURNING id INTO s2;

  UPDATE canal_config SET activo = TRUE WHERE store_id = s AND canal_id = 'rappi';
  IF NOT FOUND THEN
    INSERT INTO canal_config (store_id, canal_id, activo) VALUES (s, 'rappi', TRUE);
  END IF;

  -- p: sin lotes, stock 10, mínimo 3 → cupo 7; publicado y disponible.
  INSERT INTO productos (store_id, sku, nombre, stock, stock_minimo, precio, activo)
  VALUES (s, 'VF4-P', 'Verif F4 simple', 10, 3, 10000, TRUE) RETURNING id INTO p;
  INSERT INTO canal_producto_config (store_id, canal_id, producto_id, activo, publicado_at, ultimo_disponible_publicado)
  VALUES (s, 'rappi', p, TRUE, NOW(), TRUE);

  -- ── M1 cambio de stock sin cruzar el mínimo → NO encola ────────────────
  UPDATE productos SET stock = 4 WHERE id = p;
  SELECT count(*) INTO c FROM canal_outbox WHERE store_id = s AND tipo = 'availability';
  IF c <> 0 THEN RAISE EXCEPTION 'M1 FALLÓ: stock 10→4 (cupo 1) no cambia la disponibilidad y encoló % trabajos', c; END IF;

  -- ── M2 cruza el mínimo hacia abajo → exactamente 1 trabajo ─────────────
  UPDATE productos SET stock = 3 WHERE id = p;
  SELECT count(*) INTO c FROM canal_outbox
   WHERE store_id = s AND tipo = 'availability' AND estado = 'pending'
     AND dedupe_key = 'avail:' || s::text || ':rappi';
  IF c <> 1 THEN RAISE EXCEPTION 'M2 FALLÓ: stock = mínimo debía encolar 1 trabajo, hay %', c; END IF;
  SELECT * INTO e FROM estado_disponibilidad_canal(s, 'rappi', p);
  IF e.disponible OR e.cupo <> 0 THEN RAISE EXCEPTION 'M2 FALLÓ: estado esperado apagado/cupo 0, obtuvo %/%', e.disponible, e.cupo; END IF;

  -- ── M3 más cambios mientras hay uno vivo → coalescencia (sigue 1) ──────
  UPDATE productos SET stock = 2 WHERE id = p;
  UPDATE productos SET stock = 1 WHERE id = p;
  SELECT count(*) INTO c FROM canal_outbox WHERE store_id = s AND tipo = 'availability';
  IF c <> 1 THEN RAISE EXCEPTION 'M3 FALLÓ: la coalescencia debía dejar 1 trabajo, hay %', c; END IF;

  -- Simula el worker: publicó "apagado" y terminó.
  UPDATE canal_outbox SET estado = 'done' WHERE store_id = s;
  UPDATE canal_producto_config SET ultimo_disponible_publicado = FALSE WHERE producto_id = p;

  -- ── M4 sigue bajo el mínimo → NO encola (ya publicado apagado) ─────────
  UPDATE productos SET stock = 2 WHERE id = p;
  SELECT count(*) INTO c FROM canal_outbox WHERE store_id = s AND estado = 'pending';
  IF c <> 0 THEN RAISE EXCEPTION 'M4 FALLÓ: sin cambio de estado publicado no debía encolar (hay %)', c; END IF;

  -- ── M5 cruza el mínimo hacia arriba (recepción) → 1 trabajo ────────────
  UPDATE productos SET stock = 8 WHERE id = p;
  SELECT count(*) INTO c FROM canal_outbox WHERE store_id = s AND estado = 'pending';
  IF c <> 1 THEN RAISE EXCEPTION 'M5 FALLÓ: stock sobre el mínimo debía encolar 1 trabajo, hay %', c; END IF;
  UPDATE canal_outbox SET estado = 'done' WHERE store_id = s;
  UPDATE canal_producto_config SET ultimo_disponible_publicado = TRUE WHERE producto_id = p;

  -- ── M6 subir stock_minimo hasta el stock → encola ──────────────────────
  UPDATE productos SET stock_minimo = 8 WHERE id = p;
  SELECT count(*) INTO c FROM canal_outbox WHERE store_id = s AND estado = 'pending';
  IF c <> 1 THEN RAISE EXCEPTION 'M6 FALLÓ: stock_minimo = stock debía encolar, hay %', c; END IF;
  UPDATE canal_outbox SET estado = 'done' WHERE store_id = s;
  -- Vuelve al estado publicado (TRUE; el worker simulado no lo cambió) → no encola.
  UPDATE productos SET stock_minimo = 3 WHERE id = p;
  SELECT count(*) INTO c FROM canal_outbox WHERE store_id = s AND estado = 'pending';
  IF c <> 0 THEN RAISE EXCEPTION 'M6 FALLÓ: volver al estado publicado no debía encolar, hay %', c; END IF;

  -- ── M7 deshabilitar en el canal y desactivar el producto → encola ──────
  UPDATE canal_producto_config SET activo = FALSE WHERE producto_id = p;
  SELECT count(*) INTO c FROM canal_outbox WHERE store_id = s AND estado = 'pending';
  IF c <> 1 THEN RAISE EXCEPTION 'M7 FALLÓ: deshabilitar en el canal debía encolar, hay %', c; END IF;
  UPDATE canal_outbox SET estado = 'done' WHERE store_id = s;
  UPDATE canal_producto_config SET activo = TRUE WHERE producto_id = p;
  UPDATE canal_outbox SET estado = 'done' WHERE store_id = s;
  UPDATE productos SET activo = FALSE WHERE id = p;
  SELECT count(*) INTO c FROM canal_outbox WHERE store_id = s AND estado = 'pending';
  IF c <> 1 THEN RAISE EXCEPTION 'M7 FALLÓ: desactivar el producto debía encolar, hay %', c; END IF;
  UPDATE canal_outbox SET estado = 'done' WHERE store_id = s;
  UPDATE productos SET activo = TRUE WHERE id = p;
  UPDATE canal_outbox SET estado = 'done' WHERE store_id = s;

  -- ── M8 producto NO publicado → nunca encola ────────────────────────────
  INSERT INTO productos (store_id, sku, nombre, stock, stock_minimo, precio, activo)
  VALUES (s, 'VF4-N', 'Verif F4 no publicado', 10, 3, 10000, TRUE) RETURNING id INTO pn;
  INSERT INTO canal_producto_config (store_id, canal_id, producto_id, activo)
  VALUES (s, 'rappi', pn, TRUE);
  UPDATE productos SET stock = 0 WHERE id = pn;
  SELECT count(*) INTO c FROM canal_outbox WHERE store_id = s AND estado = 'pending';
  IF c <> 0 THEN RAISE EXCEPTION 'M8 FALLÓ: un producto no publicado no debe encolar (hay %)', c; END IF;

  -- ── M9 con lotes: solo lotes vigentes cuentan (D23) ────────────────────
  INSERT INTO productos (store_id, sku, nombre, stock, stock_minimo, precio, activo)
  VALUES (s, 'VF4-L', 'Verif F4 lotes', 0, 1, 10000, TRUE) RETURNING id INTO pl;
  INSERT INTO lotes_producto (store_id, producto_id, cantidad_inicial, cantidad_actual, fecha_vencimiento, activo)
  VALUES (s, pl, 5, 5, CURRENT_DATE - 1, TRUE),
         (s, pl, 2, 2, CURRENT_DATE + 30, TRUE);
  IF unidades_vendibles_canal(pl) <> 2 THEN
    RAISE EXCEPTION 'M9 FALLÓ: unidades vendibles con lote vencido = %, esperado 2', unidades_vendibles_canal(pl);
  END IF;
  INSERT INTO canal_producto_config (store_id, canal_id, producto_id, activo, publicado_at)
  VALUES (s, 'rappi', pl, TRUE, NOW());
  SELECT * INTO e FROM estado_disponibilidad_canal(s, 'rappi', pl);
  IF NOT e.disponible OR e.cupo <> 1 THEN RAISE EXCEPTION 'M9 FALLÓ: esperado disponible/cupo 1, obtuvo %/%', e.disponible, e.cupo; END IF;

  -- ── M10 stock fraccionario heredado sin lotes → se trunca (D18) ────────
  INSERT INTO productos (store_id, sku, nombre, stock, stock_minimo, precio, activo)
  VALUES (s, 'VF4-G', 'Verif F4 fraccion', 3.5, 0, 10000, TRUE) RETURNING id INTO pg;
  IF unidades_vendibles_canal(pg) <> 3 THEN
    RAISE EXCEPTION 'M10 FALLÓ: stock 3,5 debía dar 3 unidades vendibles, dio %', unidades_vendibles_canal(pg);
  END IF;

  -- ── M11 licencia vencida (D15) → todo apagado ──────────────────────────
  UPDATE stores SET license_end_date = CURRENT_DATE - 1 WHERE id = s;
  SELECT count(*) INTO c FROM estado_disponibilidad_canal(s, 'rappi') x WHERE x.disponible;
  IF c <> 0 THEN RAISE EXCEPTION 'M11 FALLÓ: con licencia vencida no debe haber productos disponibles (hay %)', c; END IF;
  -- La reconciliación (no el trigger) detecta el vencimiento: encolar_* lo ve.
  UPDATE canal_outbox SET estado = 'done' WHERE store_id = s;
  SELECT encolar_disponibilidad_canal(s, 'rappi') INTO c;
  IF c <> 1 THEN RAISE EXCEPTION 'M11 FALLÓ: encolar_disponibilidad_canal debía encolar 1 trabajo, encoló %', c; END IF;
  UPDATE stores SET license_end_date = NULL WHERE id = s;

  -- ── M12 tenant: cupos_canal_tienda y el estado solo ven la tienda pedida
  SELECT count(*) INTO c FROM cupos_canal_tienda(s2);
  IF c <> 0 THEN RAISE EXCEPTION 'M12 FALLÓ: cupos_canal_tienda de otra tienda devolvió % filas', c; END IF;
  SELECT count(*) INTO c FROM estado_disponibilidad_canal(s2);
  IF c <> 0 THEN RAISE EXCEPTION 'M12 FALLÓ: estado_disponibilidad_canal de otra tienda devolvió % filas', c; END IF;
  SELECT count(*) INTO c FROM cupos_canal_tienda(s);
  IF c <> 4 THEN RAISE EXCEPTION 'M12 FALLÓ: cupos_canal_tienda debía devolver 4 productos, devolvió %', c; END IF;

  -- ── M13 grants (patrón 069) ────────────────────────────────────────────
  IF has_function_privilege('anon', 'estado_disponibilidad_canal(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'estado_disponibilidad_canal(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'encolar_disponibilidad_canal(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'encolar_disponibilidad_canal(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'cupos_canal_tienda(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'unidades_vendibles_canal(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M13 FALLÓ: anon/authenticated no deben ejecutar las funciones de disponibilidad';
  END IF;

  -- ── M14 columna renombrada: precio_override nullable, CHECK > 0 ────────
  BEGIN
    UPDATE canal_producto_config SET precio_override = 0 WHERE producto_id = p;
    RAISE EXCEPTION 'M14 FALLÓ: precio_override = 0 debía violar el CHECK';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  UPDATE canal_producto_config SET precio_override = NULL WHERE producto_id = p;
END $$;

ROLLBACK;

SELECT 'FASE 4: TODAS LAS VERIFICACIONES OK' AS resultado;

-- ============================================================================
-- Concurrencia (manual, opcional — dos pestañas del SQL Editor), con una
-- tienda de prueba que tenga DOS productos publicados y disponibles:
--   Pestaña A:  BEGIN; UPDATE productos SET stock = stock_minimo WHERE id = <P1>;  (sin COMMIT)
--   Pestaña B:  BEGIN; UPDATE productos SET stock = stock_minimo WHERE id = <P2>;
--               → queda ESPERANDO (misma dedupe_key viva sin confirmar).
--   Pestaña A:  COMMIT;  → B continúa sin error (ON CONFLICT DO NOTHING).
--   Pestaña B:  COMMIT;
--   Resultado:  un solo trabajo 'availability' pending para la tienda/canal;
--               al procesarlo el worker apaga P1 y P2 en una sola llamada.
--   Limpiar los datos de prueba al terminar.
-- ============================================================================
