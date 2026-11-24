-- 097: las funciones SECURITY DEFINER solo las ejecuta service_role.
--
-- Problema (detectado en mascotaspetshop, 2026-11-24): en un proyecto Supabase
-- nuevo, ALTER DEFAULT PRIVILEGES da EXECUTE directo a anon y authenticated en
-- cada función creada. 000_baseline.sql solo hace REVOKE ... FROM PUBLIC (es lo
-- que emite pg_dump desde el demo, donde esos permisos ya estaban quitados), que
-- no toca los permisos directos. Resultado en una tienda instalada con el
-- baseline: funciones que se saltan RLS (stock, saldos a favor, citas)
-- ejecutables por la API REST con la clave pública.
--
-- Cambio: para toda función SECURITY DEFINER de public creada hasta aquí,
-- revoca a PUBLIC/anon/authenticated y asegura service_role (único rol que usa
-- la app). No toca las SECURITY INVOKER (get_user_store_id, is_system_admin…:
-- las usan políticas RLS) ni funciones de extensiones. Los triggers no
-- comprueban EXECUTE al dispararse.
--
-- No cambia filas ni código. En el demo no cambia nada (ya estaba así).
-- Idempotente. Toda función nueva debe seguir revocando explícitamente
-- FROM PUBLIC, anon, authenticated.

DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prosecdef
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role', f);
  END LOOP;
END
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('097', '097_revocar_execute_anon')
ON CONFLICT (version) DO NOTHING;
