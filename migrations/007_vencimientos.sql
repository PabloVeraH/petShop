-- Sistema de Vencimientos para Productos
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE         NULL,
  ADD COLUMN IF NOT EXISTS dias_alerta       INTEGER      DEFAULT 30,
  ADD COLUMN IF NOT EXISTS precio_oferta     DECIMAL(10,2) NULL,
  ADD COLUMN IF NOT EXISTS en_oferta         BOOLEAN       DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_productos_vencimiento ON productos(fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL AND activo = TRUE;
