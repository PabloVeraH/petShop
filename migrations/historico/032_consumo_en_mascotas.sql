-- Migration 032: Mover consumo (gramos_porcion, veces_dia) de consumo_configs a mascotas
-- El consumo es un atributo de la mascota, no del producto.

-- 1. Agregar columnas a mascotas
ALTER TABLE mascotas
  ADD COLUMN IF NOT EXISTS gramos_porcion DECIMAL(8,2) CHECK (gramos_porcion > 0),
  ADD COLUMN IF NOT EXISTS veces_dia      INTEGER      CHECK (veces_dia > 0);

-- 2. Migrar datos existentes (toma el config más reciente por mascota)
UPDATE mascotas m
SET
  gramos_porcion = c.gramos_porcion,
  veces_dia      = c.veces_dia
FROM (
  SELECT DISTINCT ON (mascota_id)
    mascota_id, gramos_porcion, veces_dia
  FROM consumo_configs
  ORDER BY mascota_id, created_at DESC
) c
WHERE c.mascota_id = m.id;

-- 3. Eliminar tabla obsoleta
DROP TABLE IF EXISTS consumo_configs;
