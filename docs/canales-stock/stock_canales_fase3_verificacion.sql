-- ============================================================================
-- Verificación REAL de la Fase 3 — claim_canal_outbox (080) y DROP de
-- stock_reservas (081). Plan: stock_canales_externos.md §6 Fase 3 — AGENTS.md §11.4
-- Proyecto Supabase: wnxrdbnvreofrrmhcybc
--
-- Ejecutar DESPUÉS de aplicar 080 (y 081 si se aplicó). BEGIN … ROLLBACK:
-- crea una tienda y trabajos de prueba y DESHACE TODO.
-- Resultado esperado: 'FASE 3: TODAS LAS VERIFICACIONES OK'.
-- NO cubre: dos workers concurrentes (SKIP LOCKED) — ver instrucciones al final.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  s uuid;
  c integer;
  r record;
BEGIN
  INSERT INTO stores (name) VALUES ('VERIF-FASE3 (rollback)') RETURNING id INTO s;

  -- Trabajos: 2 listos, 1 con reintento futuro, 1 muerto, 1 hecho,
  -- 1 'processing' reciente y 1 'processing' vencido (su worker murió).
  INSERT INTO canal_outbox (store_id, canal_id, tipo, payload, next_attempt_at)
  VALUES (s, 'rappi', 'confirm', '{"v":"listo1"}', NOW() - interval '2 min'),
         (s, 'rappi', 'ready',   '{"v":"listo2"}', NOW() - interval '1 min'),
         (s, 'rappi', 'confirm', '{"v":"futuro"}', NOW() + interval '10 min');
  INSERT INTO canal_outbox (store_id, canal_id, tipo, payload, estado)
  VALUES (s, 'rappi', 'confirm', '{"v":"muerto"}', 'dead'),
         (s, 'rappi', 'confirm', '{"v":"hecho"}', 'done');
  INSERT INTO canal_outbox (store_id, canal_id, tipo, payload, estado, intentos, updated_at)
  VALUES (s, 'rappi', 'reject', '{"v":"proc_reciente"}', 'processing', 1, NOW()),
         (s, 'rappi', 'reject', '{"v":"proc_vencido"}', 'processing', 1, NOW() - interval '10 min');

  -- ── L1 reclama solo lo listo + lo vencido, en orden, y lo marca processing
  c := 0;
  FOR r IN SELECT * FROM claim_canal_outbox(10, 300) LOOP
    c := c + 1;
    IF r.estado <> 'processing' THEN RAISE EXCEPTION 'L1 FALLÓ: el trabajo reclamado debe quedar processing'; END IF;
    IF r.payload->>'v' NOT IN ('listo1', 'listo2', 'proc_vencido') THEN
      RAISE EXCEPTION 'L1 FALLÓ: reclamó un trabajo no elegible (%)', r.payload->>'v';
    END IF;
  END LOOP;
  IF c <> 3 THEN RAISE EXCEPTION 'L1 FALLÓ: debía reclamar 3 trabajos, reclamó %', c; END IF;

  -- ── L2 intentos se incrementa (vencido: 1 → 2; listos: 0 → 1) ────────────
  SELECT count(*) INTO c FROM canal_outbox
   WHERE store_id = s AND ((payload->>'v' IN ('listo1', 'listo2') AND intentos = 1)
                        OR (payload->>'v' = 'proc_vencido' AND intentos = 2));
  IF c <> 3 THEN RAISE EXCEPTION 'L2 FALLÓ: intentos no se incrementó correctamente'; END IF;

  -- ── L3 una segunda llamada inmediata no vuelve a entregar lo ya reclamado
  SELECT count(*) INTO c FROM claim_canal_outbox(10, 300);
  IF c <> 0 THEN RAISE EXCEPTION 'L3 FALLÓ: un segundo reclamo no debe devolver trabajos (devolvió %)', c; END IF;

  -- ── L4 respeta el límite ─────────────────────────────────────────────────
  UPDATE canal_outbox SET estado = 'pending', next_attempt_at = NOW() - interval '1 min'
   WHERE store_id = s AND payload->>'v' IN ('listo1', 'listo2', 'futuro');
  SELECT count(*) INTO c FROM claim_canal_outbox(2, 300);
  IF c <> 2 THEN RAISE EXCEPTION 'L4 FALLÓ: con p_limit = 2 debía reclamar 2, reclamó %', c; END IF;

  -- ── L5 límite inválido → error ───────────────────────────────────────────
  BEGIN
    PERFORM claim_canal_outbox(0, 300);
    RAISE EXCEPTION 'L5 FALLÓ: p_limit = 0 debía rechazarse';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Límite inválido%' THEN RAISE; END IF;
  END;

  -- ── L6 grants (patrón 069) ───────────────────────────────────────────────
  IF has_function_privilege('anon', 'claim_canal_outbox(integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'claim_canal_outbox(integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'L6 FALLÓ: anon/authenticated no deben poder reclamar la outbox';
  END IF;

  -- ── L7 081: stock_reservas eliminada (si se aplicó 081) ──────────────────
  IF to_regclass('public.stock_reservas') IS NOT NULL THEN
    RAISE NOTICE 'L7: stock_reservas aún existe (081 no aplicada)';
  END IF;
END $$;

ROLLBACK;

SELECT 'FASE 3: TODAS LAS VERIFICACIONES OK' AS resultado;

-- ============================================================================
-- Concurrencia (manual, opcional — dos pestañas del SQL Editor):
--   Preparar (y dejar para borrar al final) 2 trabajos 'pending' de prueba.
--   Pestaña A:  BEGIN; SELECT id FROM claim_canal_outbox(1, 300);   (sin COMMIT)
--   Pestaña B:  BEGIN; SELECT id FROM claim_canal_outbox(1, 300);
--               → debe devolver el OTRO trabajo inmediatamente (SKIP LOCKED),
--                 nunca el mismo que A ni quedar esperando.
--   Ambas:      ROLLBACK; y borrar los trabajos de prueba.
-- ============================================================================
