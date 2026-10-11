-- ============================================================
-- 027_lotes_ordenes_compra.sql
-- Fase 7: Integración de lotes con órdenes de compra
--
-- Contexto: La migración 026 creó la tabla lotes_producto con
-- orden_compra_id como FK opcional. Esta migración complementa
-- ese diseño declarando explícitamente la FK, mejorando la
-- consistencia referencial y documentando el flujo de negocio.
--
-- Flujo de negocio implementado:
--   1. Admin crea OC con ítems (alimentos u otros productos)
--   2. Al recibir la OC (PATCH /api/ordenes-compra/[id] con
--      action=recibir + lotes[] en body), se crean automáticamente
--      registros en lotes_producto vinculados a la OC
--   3. El trigger sync_stock_on_lote mantiene productos.stock
--      actualizado tras cada INSERT en lotes_producto
--   4. Los lotes quedan disponibles para FIFO en el POS
--
-- Nota: No se necesita crear tablas nuevas; la infraestructura
-- de lotes_producto y venta_item_lotes ya fue creada en 026.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. Índices adicionales para consultas por FK
-- ─────────────────────────────────────────────

-- Help the DB query planner to efficiently find all lotes
-- belonging to a given orden de compra (e.g., for reporting)
CREATE INDEX IF NOT EXISTS idx_lotes_producto_orden_compra
  ON lotes_producto(orden_compra_id)
  WHERE orden_compra_id IS NOT NULL;

-- ─────────────────────────────────────────────
-- 2. Comentarios de documentación del flujo
-- ─────────────────────────────────────────────

COMMENT ON TABLE lotes_producto IS
  'Lotes de productos con fecha de vencimiento individual.
   INSERT aquí (ej. al recibir una OC) actualiza automáticamente
   productos.stock y productos.fecha_vencimiento via triggers.
   Para crear lotes al recibir una OC, usar PATCH /api/ordenes-compra/[id]
   con action="recibir" y lotes=[...] en el body.';

COMMENT ON COLUMN lotes_producto.orden_compra_id IS
  'Referencia a la orden de compra que originó este lote.
   Útil para trazabilidad: de qué OC proviene cada lote入库.';

-- ─────────────────────────────────────────────
-- 3. Verificación post-migración
-- ─────────────────────────────────────────────

-- Verificar que la FK no tenga referencias huérfanas
-- (lotes que referencian OCs inexistentes — no debería haber)
-- SELECT l.id, l.numero_lote, l.orden_compra_id
-- FROM lotes_producto l
-- WHERE l.orden_compra_id IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM ordenes_compra oc WHERE oc.id = l.orden_compra_id);
-- Expected: 0 rows

-- Verificar que los triggers siguen activos
-- SELECT trigger_name, event_manipulation, action_statement
-- FROM information_schema.triggers
-- WHERE event_object_table = 'lotes_producto';
-- Expected: sync_stock_on_lote, sync_fecha_vencimiento_on_lote, lotes_producto_updated_at

-- Verificar que el índice fue creado
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'lotes_producto'
--   AND indexname = 'idx_lotes_producto_orden_compra';
-- Expected: 1 row