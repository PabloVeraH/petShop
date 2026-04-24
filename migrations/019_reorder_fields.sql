-- Migración 019: Agregar campos para reorder point y análisis de demanda
-- Objetivo: Permitir persistir métricas de demanda y configurar parámetros de reorder

ALTER TABLE productos ADD COLUMN IF NOT EXISTS demanda_promedio_diaria NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS dias_seguridad INTEGER DEFAULT 7;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS tendencia_ventas VARCHAR(20) DEFAULT 'estable';
ALTER TABLE productos ADD COLUMN IF NOT EXISTS ultimo_consumo TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_productos_reorder
  ON productos(store_id, demanda_promedio_diaria, stock)
  WHERE activo = true;

-- Los campos demanda_promedio_diaria y tendencia_ventas pueden actualizarse
-- periódicamente mediante un job que ejecute predictDemand() para cada producto
