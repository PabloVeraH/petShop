-- Migración 018: Tabla de historial de ventas por producto
-- Objetivo: Almacenar ventas diarias agregadas para análisis de demanda y predicción

CREATE TABLE IF NOT EXISTS ventas_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  producto_id UUID NOT NULL REFERENCES productos(id),
  fecha DATE NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 0,
  revenue NUMERIC(12, 2) DEFAULT 0,
  canal VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, producto_id, fecha, canal)
);

CREATE INDEX IF NOT EXISTS idx_ventas_historico_fecha ON ventas_historico(store_id, fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_historico_producto ON ventas_historico(producto_id, fecha);

-- Función para sincronizar ventas del día anterior al historial
-- Puede ejecutarse vía pg_cron o Edge Function scheduleable
CREATE OR REPLACE FUNCTION sync_ventas_historico()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO ventas_historico (store_id, producto_id, fecha, cantidad, revenue, canal)
  SELECT
    v.store_id,
    vi.producto_id,
    DATE(v.created_at) AS fecha,
    SUM(vi.cantidad) AS cantidad,
    SUM(vi.subtotal) AS revenue,
    v.canal
  FROM ventas v
  JOIN venta_items vi ON v.id = vi.venta_id
  WHERE DATE(v.created_at) = CURRENT_DATE - 1
  ON CONFLICT (store_id, producto_id, fecha, canal)
  DO UPDATE SET
    cantidad = EXCLUDED.cantidad,
    revenue = EXCLUDED.revenue;
END;
$$;

-- Configurar pg_cron para ejecutar diariamente a las 1:00 AM
-- SELECT cron.schedule('sync-historico', '0 1 * * *', 'SELECT sync_ventas_historico()');
