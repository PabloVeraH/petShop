-- 047_unique_cierre_mes.sql
-- Previene cierres de mes duplicados a nivel BD (race condition guarantee).
-- El guard en API ya detecta duplicados, pero sin este índice dos requests
-- concurrentes pueden pasar el guard y crear dos asientos CIERRE_MES.

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_cierre_mes_unique
  ON journal_entries(store_id, referencia_numero)
  WHERE tipo_movimiento = 'CIERRE_MES';
