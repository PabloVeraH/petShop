-- migrations/062_rls_policies_tables_sin_cobertura.sql
-- Agrega políticas RLS a tablas que ya tienen RLS habilitado (relrowsecurity
-- = true) pero cero políticas creadas — verificado contra el schema real
-- (wnxrdbnvreofrrmhcybc, pg_policies): sin políticas, cualquier acceso que no
-- sea vía service role (que bypassea RLS por completo, AGENTS.md §0.2) queda
-- bloqueado por defecto. Esto es defensa en profundidad, no la protección
-- real: todas las rutas de la app usan createServiceClient() (service role).
--
-- Historial de este archivo: la versión original (creada fuera de este
-- tracking, sin commit) incluía además `chart_of_accounts` y
-- `movimientos_automaticos`. Verificado contra el schema real: ninguna de
-- las dos existe — fueron eliminadas deliberadamente en
-- migrations/030_drop_chart_of_accounts.sql ("tablas contables sin uso real
-- en el sistema"; el generador de asientos usa la constante CUENTAS
-- hardcodeada en src/lib/contabilidad/types.ts, no una tabla). Se quitaron
-- de este archivo.
--
-- También se corrigió `CREATE POLICY IF NOT EXISTS`: verificado contra
-- Postgres 17.6 real (transacción de prueba con ROLLBACK) que esa cláusula
-- NO existe para CREATE POLICY — error de sintaxis. Se usa el mismo patrón
-- ya establecido en este proyecto para DDL sin IF NOT EXISTS nativo (ver
-- AGENTS.md §11.1): DO block + EXCEPTION WHEN duplicate_object, verificado
-- también con una prueba real (ejecutar el mismo CREATE POLICY dos veces
-- dentro de ese bloque no falla).
--
-- Patrón de política: se usa get_user_store_id() + is_system_admin() (el
-- patrón vigente en las políticas más recientes de este proyecto — clientes,
-- cuentas_pagar, consumo_alertas, consumo_configs — verificado vía
-- pg_get_functiondef contra las funciones reales), no el patrón antiguo de
-- subquery inline sobre clerk_users usado por tablas más viejas (categorias,
-- canal_config, etc.). El patrón antiguo no incluye la excepción de
-- systemAdmin que AGENTS.md §5.2 documenta como invariante del sistema
-- ("el sistema de licencia nunca debe bloquear a un systemAdmin"); el
-- patrón _v2 sí la incluye.
--
-- Tablas auditadas y descartadas de este archivo (ya tienen RLS + políticas
-- aplicadas manualmente, verificado vía pg_policies):
--   notas_credito, saldos_a_favor, journal_entries, journal_detail,
--   ventas_historico, categorias, auth_failures

-- =============================================================================
-- 1. ai_vencimientos_analisis
-- =============================================================================
DO $$ BEGIN
  CREATE POLICY "ai_vencimientos_analisis_select" ON ai_vencimientos_analisis
    FOR SELECT USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "ai_vencimientos_analisis_insert" ON ai_vencimientos_analisis
    FOR INSERT WITH CHECK (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "ai_vencimientos_analisis_update" ON ai_vencimientos_analisis
    FOR UPDATE USING (store_id = get_user_store_id() OR is_system_admin())
    WITH CHECK (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "ai_vencimientos_analisis_delete" ON ai_vencimientos_analisis
    FOR DELETE USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- 2. ai_pos_cache
-- =============================================================================
DO $$ BEGIN
  CREATE POLICY "ai_pos_cache_select" ON ai_pos_cache
    FOR SELECT USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "ai_pos_cache_insert" ON ai_pos_cache
    FOR INSERT WITH CHECK (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "ai_pos_cache_update" ON ai_pos_cache
    FOR UPDATE USING (store_id = get_user_store_id() OR is_system_admin())
    WITH CHECK (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "ai_pos_cache_delete" ON ai_pos_cache
    FOR DELETE USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
