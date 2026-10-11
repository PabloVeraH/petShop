-- migrations/065_revoke_anon_authenticated_execute_replace_servicio_horarios.sql
-- Fix real del hallazgo de seguridad de 063/064: Supabase otorga EXECUTE a
-- anon y authenticated como grant DIRECTO en funciones nuevas del schema
-- public (default privileges de la plataforma) — no vía PUBLIC. La
-- REVOKE ... FROM PUBLIC de 064 no lo cubría. Verificado contra
-- pg_proc.proacl en la instancia real antes y después de este REVOKE.
--
-- Idempotente: revocar un privilegio que ya no existe no es un error en
-- Postgres.

REVOKE EXECUTE ON FUNCTION replace_servicio_horarios(UUID, UUID, JSONB) FROM anon, authenticated;
