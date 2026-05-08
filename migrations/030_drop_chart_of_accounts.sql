-- ============================================================
-- 030_drop_chart_of_accounts.sql
-- Eliminar tablas contables sin uso real en el sistema.
--
-- chart_of_accounts y movimientos_automaticos nunca fueron
-- consultadas por los reportes ni por el motor de asientos.
-- El generador de asientos usa constantes CUENTAS hardcodeadas
-- en src/lib/contabilidad/types.ts; los reportes (balance,
-- estado de resultado) leen directamente de journal_detail.
-- ============================================================

DROP TABLE IF EXISTS chart_of_accounts;
DROP TABLE IF EXISTS movimientos_automaticos;
