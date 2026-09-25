-- migrations/080_canales_outbox_claim.sql
-- Fase 3 del plan docs/canales-stock/stock_canales_externos.md — worker de la
-- outbox de canales (paso 3.4, §5.3).
--
-- Estado: APLICADA el 2026-09-25 (execute_sql vía MCP, con confirmación explícita
-- del usuario) y verificada con docs/canales-stock/stock_canales_fase3_verificacion.sql (L1–L7 OK).
-- Antes: requería confirmación explícita del usuario
-- (AGENTS.md §0.1 / §11.2 — wnxrdbnvreofrrmhcybc es el único entorno).
--
-- claim_canal_outbox(p_limit, p_reclamo_vencido_seg):
--   Reclama hasta p_limit trabajos listos para ejecutarse, marcándolos
--   'processing' e incrementando intentos, en una sola sentencia con
--   FOR UPDATE SKIP LOCKED: dos invocaciones concurrentes del cron (pg_net +
--   after()) nunca reciben el mismo trabajo. También recupera trabajos que
--   quedaron 'processing' más de p_reclamo_vencido_seg (el proceso que los
--   tomó murió a mitad de camino — serverless).
--   El despacho HTTP a la plataforma lo hace la app (necesita ENCRYPTION_KEY
--   para descifrar credenciales, §7.1): esta función solo reparte trabajo.
--
-- Grants: patrón 069 (solo service_role).

BEGIN;

CREATE OR REPLACE FUNCTION claim_canal_outbox(
  p_limit               integer DEFAULT 20,
  p_reclamo_vencido_seg integer DEFAULT 300
)
RETURNS SETOF canal_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Límite inválido para reclamar la outbox: %', p_limit;
  END IF;

  RETURN QUERY
  UPDATE canal_outbox o
     SET estado          = 'processing',
         intentos        = o.intentos + 1,
         updated_at      = NOW()
   WHERE o.id IN (
     SELECT c.id
       FROM canal_outbox c
      WHERE (c.estado = 'pending' AND c.next_attempt_at <= NOW())
         OR (c.estado = 'processing'
             AND c.updated_at < NOW() - make_interval(secs => COALESCE(p_reclamo_vencido_seg, 300)))
      ORDER BY c.next_attempt_at ASC, c.created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o.*;
END;
$function$;

REVOKE EXECUTE ON FUNCTION claim_canal_outbox(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_canal_outbox(integer, integer) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION claim_canal_outbox(integer, integer) TO service_role;

COMMIT;
