-- migrations/084_canales_preparacion.sql
-- Fase 6 (paso 6.2) del plan docs/canales-stock/stock_canales_externos.md —
-- checklist de salida a producción verificable desde la app.
--
-- Estado: APLICADA el 2026-09-25 (execute_sql vía MCP, con confirmación explícita
-- del usuario). Verificado: 2 columnas nuevas; estado_cron_canales() devuelve 0
-- filas sin pg_cron (sin error); solo service_role puede ejecutarla.
-- Antes: requería confirmación explícita del usuario
-- (AGENTS.md §0.1 / §11.2 — wnxrdbnvreofrrmhcybc es el único entorno).
--
-- ─── Qué hace ─────────────────────────────────────────────────────────────
-- 1. canal_config.ultimo_evento_at / ultimo_evento_tipo: último evento
--    AUTENTICADO (firma válida) recibido de la plataforma. Es la única forma
--    de comprobar que el webhook quedó registrado con la URL y el secreto
--    correctos (Rappi envía PING cada 3 minutos).
-- 2. estado_cron_canales(): lee cron.job (pg_cron) SI la extensión está
--    instalada y devuelve los jobs 'petshop-canales-%' (nombre, horario,
--    activo). Sin pg_cron devuelve 0 filas (no falla). Solo lectura; no
--    expone el comando (que referencia secretos de Vault por nombre).
--
-- Grants: patrón 069 (solo service_role).

BEGIN;

ALTER TABLE canal_config ADD COLUMN IF NOT EXISTS ultimo_evento_at   TIMESTAMPTZ NULL;
ALTER TABLE canal_config ADD COLUMN IF NOT EXISTS ultimo_evento_tipo TEXT        NULL;

CREATE OR REPLACE FUNCTION estado_cron_canales()
RETURNS TABLE (jobname text, schedule text, active boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE
    'SELECT j.jobname::text, j.schedule::text, j.active
       FROM cron.job j
      WHERE j.jobname LIKE ''petshop-canales-%''
      ORDER BY j.jobname';
END;
$function$;

REVOKE EXECUTE ON FUNCTION estado_cron_canales() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION estado_cron_canales() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION estado_cron_canales() TO service_role;

COMMIT;
