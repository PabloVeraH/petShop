-- ACL-SQL-01…04 — migración 097: con los permisos por defecto de Supabase
-- (00_supabase_prelude.sql), ninguna función SECURITY DEFINER queda expuesta.
DO $$
DECLARE v text;
BEGIN
  -- ACL-SQL-01: anon/authenticated no ejecutan ninguna.
  SELECT string_agg(oid::regprocedure::text, ', ') INTO v
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND prosecdef
     AND (has_function_privilege('anon', oid, 'EXECUTE') OR has_function_privilege('authenticated', oid, 'EXECUTE'));
  IF v IS NOT NULL THEN RAISE EXCEPTION 'ACL-SQL-01: expuestas a la clave pública: %', v; END IF;

  -- ACL-SQL-02: service_role (la app) las ejecuta todas.
  SELECT string_agg(oid::regprocedure::text, ', ') INTO v
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND prosecdef
     AND NOT has_function_privilege('service_role', oid, 'EXECUTE');
  IF v IS NOT NULL THEN RAISE EXCEPTION 'ACL-SQL-02: service_role perdió: %', v; END IF;

  -- ACL-SQL-03: las que usan las políticas RLS siguen disponibles.
  IF NOT has_function_privilege('authenticated', 'public.get_user_store_id()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_system_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL-SQL-03: las funciones de RLS perdieron EXECUTE de authenticated';
  END IF;
  RAISE NOTICE 'ACL-SQL-01..03 OK';
END
$$;

-- ACL-SQL-04: rechazo real como anon.
SET ROLE anon;
DO $$
BEGIN
  PERFORM public.increment_stock(gen_random_uuid(), 1);
  RAISE EXCEPTION 'ACL-SQL-04: anon pudo ejecutar increment_stock';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ACL-SQL-04 OK';
END
$$;
RESET ROLE;
