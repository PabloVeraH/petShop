-- 016_categorias.sql
-- Product categories managed by storeAdmin and systemAdmin only

CREATE TABLE IF NOT EXISTS categorias (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  nombre      VARCHAR(100) NOT NULL,
  descripcion TEXT,
  activo      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(store_id, nombre)
);

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL;

ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categorias_store_isolation" ON categorias
  FOR ALL USING (true);

CREATE INDEX IF NOT EXISTS idx_categorias_store_id ON categorias(store_id);
CREATE INDEX IF NOT EXISTS idx_productos_categoria_id ON productos(categoria_id);
