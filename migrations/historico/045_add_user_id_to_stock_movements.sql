-- 045_add_user_id_to_stock_movements.sql
-- Agrega columna user_id a stock_movements para registrar qué usuario realizó cada movimiento.

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS user_id TEXT;
