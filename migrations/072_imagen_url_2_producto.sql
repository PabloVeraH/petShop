-- 072_imagen_url_2_producto.sql
-- Agrega la segunda foto de producto (tope de 2 fotos por producto).
-- imagen_url ya existe desde 033_imagen_url_producto.sql pero nunca tuvo
-- un escritor real; esta migración solo agrega el segundo slot.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS imagen_url_2 TEXT;
