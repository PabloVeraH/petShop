-- ============================================================================
-- Verificación REAL de la Fase 2 — núcleo de canales (migración 079)
-- Plan: stock_canales_externos.md §6 Fase 2 — AGENTS.md §11.4
-- Proyecto Supabase: wnxrdbnvreofrrmhcybc
--
-- Ejecutar DESPUÉS de aplicar 079. Todo corre dentro de BEGIN … ROLLBACK:
-- crea dos tiendas de prueba, ejercita las restricciones y DESHACE TODO.
-- Resultado esperado: 'FASE 2: TODAS LAS VERIFICACIONES OK'.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  s1 uuid; s2 uuid; o1 uuid;
  c  integer;
BEGIN
  INSERT INTO stores (name) VALUES ('VERIF-FASE2 A (rollback)') RETURNING id INTO s1;
  INSERT INTO stores (name) VALUES ('VERIF-FASE2 B (rollback)') RETURNING id INTO s2;

  -- ── K1 UNIQUE por tienda (C16): mismo external_order_id en dos tiendas ──
  INSERT INTO canal_ordenes (store_id, canal_id, external_order_id, estado, payload, items)
  VALUES (s1, 'rappi', 'VERIF-EXT-1', 'pending', '{}', '[]') RETURNING id INTO o1;
  INSERT INTO canal_ordenes (store_id, canal_id, external_order_id, estado, payload, items)
  VALUES (s2, 'rappi', 'VERIF-EXT-1', 'pending', '{}', '[]');
  SELECT count(*) INTO c FROM canal_ordenes WHERE external_order_id = 'VERIF-EXT-1';
  IF c <> 2 THEN RAISE EXCEPTION 'K1 FALLÓ: dos tiendas deben poder tener el mismo external_order_id'; END IF;

  -- ── K2 idempotencia: reentrega en la misma tienda → ON CONFLICT DO NOTHING
  INSERT INTO canal_ordenes (store_id, canal_id, external_order_id, estado, payload, items)
  VALUES (s1, 'rappi', 'VERIF-EXT-1', 'pending', '{}', '[]')
  ON CONFLICT (store_id, canal_id, external_order_id) DO NOTHING;
  GET DIAGNOSTICS c = ROW_COUNT;
  IF c <> 0 THEN RAISE EXCEPTION 'K2 FALLÓ: la reentrega no debe insertar (insertó %)', c; END IF;
  BEGIN
    INSERT INTO canal_ordenes (store_id, canal_id, external_order_id, estado, payload, items)
    VALUES (s1, 'rappi', 'VERIF-EXT-1', 'pending', '{}', '[]');
    RAISE EXCEPTION 'K2 FALLÓ: sin ON CONFLICT el duplicado debía violar el UNIQUE';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  SELECT count(*) INTO c FROM pg_constraint WHERE conname = 'canal_ordenes_canal_id_external_order_id_key';
  IF c <> 0 THEN RAISE EXCEPTION 'K2 FALLÓ: el UNIQUE global anterior debía eliminarse'; END IF;

  -- ── K3 CHECK de estados (§4.3, sin 'reserved' — D6) ─────────────────────
  BEGIN
    UPDATE canal_ordenes SET estado = 'reserved' WHERE id = o1;
    RAISE EXCEPTION 'K3 FALLÓ: ''reserved'' ya no es un estado válido';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE canal_ordenes SET estado = 'processing' WHERE id = o1;
  UPDATE canal_ordenes SET estado = 'failed', intentos = 3, ultimo_error = 'x' WHERE id = o1;

  -- ── K4 items debe ser un arreglo; intentos no negativo ───────────────────
  BEGIN
    UPDATE canal_ordenes SET items = '{}'::jsonb WHERE id = o1;
    RAISE EXCEPTION 'K4 FALLÓ: items debe ser un arreglo JSON';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE canal_ordenes SET intentos = -1 WHERE id = o1;
    RAISE EXCEPTION 'K4 FALLÓ: intentos negativo debía rechazarse';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO canal_ordenes (store_id, canal_id, external_order_id, estado, payload)
    VALUES (s1, 'rappi', 'VERIF-EXT-2', 'pending', '{}');
    RAISE EXCEPTION 'K4 FALLÓ: items es obligatorio (sin default)';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;

  -- ── K5 recargo_pct (D7) ──────────────────────────────────────────────────
  INSERT INTO canal_config (store_id, canal_id, activo) VALUES (s1, 'rappi', false);
  SELECT count(*) INTO c FROM canal_config WHERE store_id = s1 AND recargo_pct = 0;
  IF c <> 1 THEN RAISE EXCEPTION 'K5 FALLÓ: recargo_pct debe nacer en 0'; END IF;
  BEGIN
    UPDATE canal_config SET recargo_pct = -1 WHERE store_id = s1;
    RAISE EXCEPTION 'K5 FALLÓ: recargo_pct negativo debía rechazarse';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── K6 canal_outbox: coalescencia por dedupe_key solo entre vivos ────────
  INSERT INTO canal_outbox (store_id, canal_id, tipo, dedupe_key)
  VALUES (s1, 'rappi', 'availability', 'avail:VERIF:rappi:P1');
  BEGIN
    INSERT INTO canal_outbox (store_id, canal_id, tipo, dedupe_key)
    VALUES (s1, 'rappi', 'availability', 'avail:VERIF:rappi:P1');
    RAISE EXCEPTION 'K6 FALLÓ: dos trabajos pendientes con la misma dedupe_key';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE canal_outbox SET estado = 'done', processed_at = NOW() WHERE dedupe_key = 'avail:VERIF:rappi:P1';
  INSERT INTO canal_outbox (store_id, canal_id, tipo, dedupe_key)
  VALUES (s1, 'rappi', 'availability', 'avail:VERIF:rappi:P1');   -- permitido: el anterior ya terminó
  BEGIN
    INSERT INTO canal_outbox (store_id, canal_id, tipo) VALUES (s1, 'rappi', 'otro_tipo');
    RAISE EXCEPTION 'K6 FALLÓ: tipo inválido debía rechazarse';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO canal_outbox (store_id, canal_id, tipo, estado) VALUES (s1, 'rappi', 'confirm', 'reserved');
    RAISE EXCEPTION 'K6 FALLÓ: estado inválido debía rechazarse';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── K7 RLS e índice de expiración sin 'reserved' ─────────────────────────
  SELECT count(*) INTO c FROM pg_class WHERE relname = 'canal_outbox' AND relrowsecurity;
  IF c <> 1 THEN RAISE EXCEPTION 'K7 FALLÓ: RLS debe estar habilitado en canal_outbox'; END IF;
  SELECT count(*) INTO c FROM pg_indexes
   WHERE indexname = 'idx_canal_ordenes_expiry' AND indexdef NOT LIKE '%reserved%';
  IF c <> 1 THEN RAISE EXCEPTION 'K7 FALLÓ: el índice de expiración no debe incluir ''reserved'''; END IF;
END $$;

ROLLBACK;

SELECT 'FASE 2: TODAS LAS VERIFICACIONES OK' AS resultado;
