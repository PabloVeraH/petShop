-- 017_codigo_barra.sql
-- Add barcode field to productos for pistola scanner support in POS

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS codigo_barra VARCHAR(100);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'productos_codigo_barra_store_unique'
  ) THEN
    ALTER TABLE productos
      ADD CONSTRAINT productos_codigo_barra_store_unique UNIQUE (store_id, codigo_barra);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_productos_codigo_barra ON productos(store_id, codigo_barra)
  WHERE codigo_barra IS NOT NULL;
