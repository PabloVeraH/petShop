-- Nota de Crédito como voucher imprimible con vigencia de 30 días
-- y registro de NC usada en pagos

ALTER TABLE notas_credito
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;

-- Backfill: NCs existentes vencen 30 días después de su creación
UPDATE notas_credito
SET fecha_vencimiento = (created_at::date + INTERVAL '30 days')
WHERE fecha_vencimiento IS NULL;

-- Columna en pagos para referenciar la NC usada (pago con voucher)
ALTER TABLE pagos
  ADD COLUMN IF NOT EXISTS nota_credito_id UUID REFERENCES notas_credito(id);
