-- ============================================================================
-- Verificación REAL de la Fase 5 — migración 083 (liquidaciones y estado del
-- menú). Plan: stock_canales_externos.md §6 Fase 5 (5.2, 5.3) — AGENTS.md §11.4
-- Proyecto Supabase: wnxrdbnvreofrrmhcybc
--
-- Ejecutar DESPUÉS de aplicar 083. BEGIN … ROLLBACK: crea una tienda y
-- liquidaciones de prueba y DESHACE TODO.
-- Resultado esperado: 'FASE 5: TODAS LAS VERIFICACIONES OK'.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  s uuid;
BEGIN
  INSERT INTO stores (name) VALUES ('VERIF-FASE5 (rollback)') RETURNING id INTO s;

  -- ── N1 liquidación válida (ejemplo D24) ────────────────────────────────
  INSERT INTO canal_liquidaciones (store_id, canal_id, periodo_desde, periodo_hasta, monto_bruto, comision, monto_neto)
  VALUES (s, 'rappi', '2026-09-01', '2026-09-15', 100000, 23800, 76200);

  -- ── N2 misma tienda/canal/período → UNIQUE ─────────────────────────────
  BEGIN
    INSERT INTO canal_liquidaciones (store_id, canal_id, periodo_desde, periodo_hasta, monto_bruto, comision, monto_neto)
    VALUES (s, 'rappi', '2026-09-01', '2026-09-15', 5000, 0, 5000);
    RAISE EXCEPTION 'N2 FALLÓ: una liquidación duplicada del mismo período debía rechazarse';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  -- Otro canal u otro período sí se permiten.
  INSERT INTO canal_liquidaciones (store_id, canal_id, periodo_desde, periodo_hasta, monto_bruto, comision, monto_neto)
  VALUES (s, 'rappi', '2026-09-16', '2026-09-30', 5000, 0, 5000),
         (s, 'pedidosya', '2026-09-01', '2026-09-15', 5000, 5000, 0);

  -- ── N3 invariantes de montos y período → CHECK ─────────────────────────
  BEGIN
    INSERT INTO canal_liquidaciones (store_id, canal_id, periodo_desde, periodo_hasta, monto_bruto, comision, monto_neto)
    VALUES (s, 'ubereats', '2026-09-01', '2026-09-02', 100000, 23800, 80000);
    RAISE EXCEPTION 'N3 FALLÓ: monto_neto distinto de bruto − comisión debía rechazarse';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO canal_liquidaciones (store_id, canal_id, periodo_desde, periodo_hasta, monto_bruto, comision, monto_neto)
    VALUES (s, 'ubereats', '2026-09-03', '2026-09-04', 100, 150, -50);
    RAISE EXCEPTION 'N3 FALLÓ: comisión mayor que el bruto debía rechazarse';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO canal_liquidaciones (store_id, canal_id, periodo_desde, periodo_hasta, monto_bruto, comision, monto_neto)
    VALUES (s, 'ubereats', '2026-09-05', '2026-09-06', 0, 0, 0);
    RAISE EXCEPTION 'N3 FALLÓ: monto_bruto 0 debía rechazarse';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO canal_liquidaciones (store_id, canal_id, periodo_desde, periodo_hasta, monto_bruto, comision, monto_neto)
    VALUES (s, 'ubereats', '2026-09-10', '2026-09-09', 100, 0, 100);
    RAISE EXCEPTION 'N3 FALLÓ: periodo_desde > periodo_hasta debía rechazarse';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── N4 canal_config.menu_estado ────────────────────────────────────────
  UPDATE canal_config SET activo = TRUE WHERE store_id = s AND canal_id = 'rappi';
  IF NOT FOUND THEN
    INSERT INTO canal_config (store_id, canal_id, activo) VALUES (s, 'rappi', TRUE);
  END IF;
  UPDATE canal_config
     SET menu_estado = 'rechazado', menu_detalle = 'Faltan imágenes', menu_estado_at = NOW()
   WHERE store_id = s AND canal_id = 'rappi';
  IF NOT FOUND THEN RAISE EXCEPTION 'N4 FALLÓ: no se pudo registrar menu_estado'; END IF;
  BEGIN
    UPDATE canal_config SET menu_estado = 'otro' WHERE store_id = s AND canal_id = 'rappi';
    RAISE EXCEPTION 'N4 FALLÓ: un menu_estado fuera de enviado/aprobado/rechazado debía rechazarse';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE canal_config SET menu_estado = NULL WHERE store_id = s AND canal_id = 'rappi';
END $$;

ROLLBACK;

SELECT 'FASE 5: TODAS LAS VERIFICACIONES OK' AS resultado;
