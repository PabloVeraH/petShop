-- migrations/064_revoke_public_execute_replace_servicio_horarios.sql
-- Hallazgo de get_advisors (security) tras aplicar 063_servicios: Postgres
-- otorga EXECUTE a PUBLIC por defecto al crear una función, y el
-- GRANT EXECUTE ... TO service_role de 063 no revoca ese grant implícito.
-- Resultado: replace_servicio_horarios (SECURITY DEFINER) era ejecutable
-- directamente por los roles anon/authenticated vía
-- /rest/v1/rpc/replace_servicio_horarios, saltándose Clerk, requireStoreAdmin
-- y el aislamiento por tienda — el caller controla p_store_id sin ninguna
-- verificación de identidad dentro de la función.
--
-- Mismo patrón preexistente (no introducido por este cambio) en
-- crear_venta_tx, anular_venta_tx, incrementar_saldo_a_favor,
-- revertir_saldo_a_favor, gastar_saldo_a_favor_pago, crear_nota_credito_tx
-- e increment_stock — fuera de alcance de este cambio; requiere revisión de
-- seguridad dedicada, no un fix incidental aquí.

REVOKE EXECUTE ON FUNCTION replace_servicio_horarios(UUID, UUID, JSONB) FROM PUBLIC;

-- NOTA POSTERIOR: esta REVOKE FROM PUBLIC resultó INSUFICIENTE. Verificado
-- contra pg_proc.proacl en la instancia real: Supabase otorga EXECUTE a
-- anon/authenticated como grant DIRECTO en funciones nuevas del schema
-- public (default privileges de la plataforma), no vía PUBLIC — por eso
-- get_advisors seguía marcando la función como ejecutable por anon/
-- authenticated después de aplicar esta migración. Fix real en
-- migrations/065_revoke_anon_authenticated_execute_replace_servicio_horarios.sql.
-- No se reescribe esta migración ya aplicada (AGENTS.md §11.1); se documenta
-- la secuencia real de lo ocurrido.
