-- ============================================================
-- 028_oc_mejoras.sql
-- Mejoras al flujo de órdenes de compra:
--   1. Columna tiene_vencimiento en productos
--   2. nombre_nuevo en ordenes_compra_items (productos que aún no existen)
--   3. precio_unitario y subtotal opcionales en items
--   4. total/subtotal/impuesto opcionales en ordenes_compra (calculan al recibir)
-- ============================================================

-- 1. Columna tiene_vencimiento en productos
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS tiene_vencimiento BOOLEAN NOT NULL DEFAULT FALSE;

-- precio (venta al público) nullable para productos nuevos creados al recibir OC
ALTER TABLE productos
  ALTER COLUMN precio DROP NOT NULL;

UPDATE productos
  SET tiene_vencimiento = TRUE
  WHERE fecha_vencimiento IS NOT NULL;

COMMENT ON COLUMN productos.tiene_vencimiento IS
  'Si TRUE, este producto requiere fecha_vencimiento al recibir cualquier OC.
   Se activa automáticamente la primera vez que se recibe con fecha_vencimiento.';

-- 2. nombre_nuevo en items de OC
ALTER TABLE ordenes_compra_items
  ADD COLUMN IF NOT EXISTS nombre_nuevo TEXT;

-- 3. producto_id nullable (puede ser NULL si nombre_nuevo está presente)
ALTER TABLE ordenes_compra_items
  ALTER COLUMN producto_id DROP NOT NULL;

ALTER TABLE ordenes_compra_items
  ADD CONSTRAINT oc_item_tiene_producto
    CHECK (producto_id IS NOT NULL OR (nombre_nuevo IS NOT NULL AND nombre_nuevo <> ''));

-- 4. precio_unitario y subtotal opcionales en items
ALTER TABLE ordenes_compra_items
  ALTER COLUMN precio_unitario DROP NOT NULL,
  ALTER COLUMN precio_unitario SET DEFAULT NULL,
  ALTER COLUMN subtotal DROP NOT NULL,
  ALTER COLUMN subtotal SET DEFAULT NULL;

-- 5. total/subtotal/impuesto opcionales en la OC
ALTER TABLE ordenes_compra
  ALTER COLUMN subtotal DROP NOT NULL,
  ALTER COLUMN subtotal SET DEFAULT NULL,
  ALTER COLUMN impuesto DROP NOT NULL,
  ALTER COLUMN impuesto SET DEFAULT NULL,
  ALTER COLUMN total DROP NOT NULL,
  ALTER COLUMN total SET DEFAULT NULL;

COMMENT ON COLUMN ordenes_compra.total IS
  'Calculado y persistido al recibir la OC (action=recibir). NULL mientras pendiente/enviada.';
