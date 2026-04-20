-- 017_codigo_barra.sql
-- Add barcode field to productos for pistola scanner support in POS

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS codigo_barra VARCHAR(100);

ALTER TABLE productos
  ADD CONSTRAINT IF NOT EXISTS productos_codigo_barra_store_unique UNIQUE (store_id, codigo_barra);

CREATE INDEX IF NOT EXISTS idx_productos_codigo_barra ON productos(store_id, codigo_barra)
  WHERE codigo_barra IS NOT NULL;
