-- 048_cuentas_pagar_monto_check.sql
-- Ensure cuentas_pagar.monto has an explicit CHECK (monto > 0) constraint
-- at the DB level to prevent zero-amount payables from being stored.

ALTER TABLE cuentas_pagar
  ADD CONSTRAINT IF NOT EXISTS cuentas_pagar_monto_check
  CHECK (monto > 0);
