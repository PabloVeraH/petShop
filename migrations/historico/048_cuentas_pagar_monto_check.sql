-- 048_cuentas_pagar_monto_check.sql
-- Ensure cuentas_pagar.monto has an explicit CHECK (monto > 0) constraint
-- at the DB level to prevent zero-amount payables from being stored.
--
-- NOTA: "ADD CONSTRAINT IF NOT EXISTS" no es sintaxis válida de PostgreSQL
-- (solo ADD COLUMN IF NOT EXISTS y CREATE INDEX IF NOT EXISTS la soportan).
-- Se usa un DO block con manejo de duplicate_object para lograr idempotencia.

DO $$
BEGIN
  ALTER TABLE cuentas_pagar
    ADD CONSTRAINT cuentas_pagar_monto_check
    CHECK (monto > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
