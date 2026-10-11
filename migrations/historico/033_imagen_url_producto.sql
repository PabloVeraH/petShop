-- 033_imagen_url_producto.sql
-- Agrega imagen_url a productos para sincronización al Hub Central
-- y visualización en la app móvil.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS imagen_url TEXT;