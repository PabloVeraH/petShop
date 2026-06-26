-- 046_add_metodo_pago_to_cuentas_pagar.sql
-- Agrega columna metodo_pago a cuentas_pagar para registrar el método de pago
-- (efectivo, debito, credito, transferencia) al marcar una cuenta como pagada.

ALTER TABLE cuentas_pagar
  ADD COLUMN IF NOT EXISTS metodo_pago TEXT
  CHECK (metodo_pago IN ('efectivo', 'debito', 'credito', 'transferencia'));
