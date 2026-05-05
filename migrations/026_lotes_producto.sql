-- ============================================================
-- 026_lotes_producto.sql
-- Sistema de lotes por producto:
--   - Tracking de vencimientos por lote
--   - productos.stock mantenido automáticamente por trigger
--   - productos.fecha_vencimiento mantenido automáticamente por trigger
--   - Función FIFO deducir_stock_fifo() para ventas
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. Tabla principal de lotes
-- ─────────────────────────────────────────────
CREATE TABLE lotes_producto (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  producto_id      UUID        NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  numero_lote      TEXT,
  cantidad_inicial INTEGER     NOT NULL CHECK (cantidad_inicial > 0),
  cantidad_actual  INTEGER     NOT NULL CHECK (cantidad_actual >= 0),
  fecha_vencimiento DATE       NOT NULL,
  fecha_ingreso    DATE        NOT NULL DEFAULT CURRENT_DATE,
  orden_compra_id  UUID        REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  notas            TEXT,
  activo           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 2. Tabla de trazabilidad: qué lotes se usaron por ítem vendido
-- ─────────────────────────────────────────────
CREATE TABLE venta_item_lotes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_item_id UUID        NOT NULL REFERENCES venta_items(id) ON DELETE CASCADE,
  lote_id       UUID        NOT NULL REFERENCES lotes_producto(id),
  cantidad      INTEGER     NOT NULL CHECK (cantidad > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 3. Índices
-- ─────────────────────────────────────────────
CREATE INDEX idx_lotes_producto_id    ON lotes_producto(producto_id);
CREATE INDEX idx_lotes_store_id       ON lotes_producto(store_id);
CREATE INDEX idx_lotes_vencimiento    ON lotes_producto(fecha_vencimiento)
  WHERE activo = TRUE AND cantidad_actual > 0;
CREATE INDEX idx_lotes_fifo           ON lotes_producto(producto_id, store_id, fecha_ingreso, created_at)
  WHERE activo = TRUE AND cantidad_actual > 0;
CREATE INDEX idx_venta_item_lotes_item ON venta_item_lotes(venta_item_id);
CREATE INDEX idx_venta_item_lotes_lote ON venta_item_lotes(lote_id);

-- ─────────────────────────────────────────────
-- 4. Row Level Security
-- ─────────────────────────────────────────────
ALTER TABLE lotes_producto ENABLE ROW LEVEL SECURITY;
ALTER TABLE venta_item_lotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lotes_store_isolation" ON lotes_producto
  FOR ALL USING (
    store_id = (
      SELECT store_id FROM clerk_users
      WHERE clerk_id = auth.uid()::TEXT
      LIMIT 1
    )
  );

CREATE POLICY "venta_item_lotes_via_lote" ON venta_item_lotes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM lotes_producto l
      JOIN clerk_users cu ON cu.store_id = l.store_id
      WHERE l.id = venta_item_lotes.lote_id
        AND cu.clerk_id = auth.uid()::TEXT
    )
  );

-- ─────────────────────────────────────────────
-- 5. Trigger: updated_at automático
-- ─────────────────────────────────────────────
CREATE TRIGGER lotes_producto_updated_at
  BEFORE UPDATE ON lotes_producto
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────
-- 6. Función + Trigger: sincronizar productos.stock
--    stock = SUM(cantidad_actual) de todos los lotes activos
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_producto_stock_from_lotes()
RETURNS TRIGGER AS $$
DECLARE
  v_producto_id UUID := COALESCE(NEW.producto_id, OLD.producto_id);
  v_store_id    UUID := COALESCE(NEW.store_id,    OLD.store_id);
BEGIN
  UPDATE productos
  SET stock = (
    SELECT COALESCE(SUM(cantidad_actual), 0)
    FROM lotes_producto
    WHERE producto_id = v_producto_id
      AND store_id    = v_store_id
      AND activo      = TRUE
  )
  WHERE id       = v_producto_id
    AND store_id = v_store_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER sync_stock_on_lote
  AFTER INSERT OR UPDATE OR DELETE ON lotes_producto
  FOR EACH ROW
  EXECUTE FUNCTION sync_producto_stock_from_lotes();

-- ─────────────────────────────────────────────
-- 7. Función + Trigger: sincronizar productos.fecha_vencimiento
--    = MIN(fecha_vencimiento) de lotes activos con stock y no vencidos
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_producto_fecha_vencimiento()
RETURNS TRIGGER AS $$
DECLARE
  v_producto_id UUID := COALESCE(NEW.producto_id, OLD.producto_id);
  v_store_id    UUID := COALESCE(NEW.store_id,    OLD.store_id);
BEGIN
  UPDATE productos
  SET fecha_vencimiento = (
    SELECT MIN(fecha_vencimiento)
    FROM lotes_producto
    WHERE producto_id = v_producto_id
      AND store_id    = v_store_id
      AND activo      = TRUE
      AND cantidad_actual > 0
      AND fecha_vencimiento >= CURRENT_DATE
  )
  WHERE id       = v_producto_id
    AND store_id = v_store_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER sync_fecha_vencimiento_on_lote
  AFTER INSERT OR UPDATE OR DELETE ON lotes_producto
  FOR EACH ROW
  EXECUTE FUNCTION sync_producto_fecha_vencimiento();

-- ─────────────────────────────────────────────
-- 8. Función FIFO: deducir_stock_fifo()
--    Descuenta p_cantidad del producto, empezando por el lote
--    más antiguo (fecha_ingreso ASC, created_at ASC).
--    Retorna JSONB con los lotes afectados y cantidades.
--    Lanza excepción si stock es insuficiente.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION deducir_stock_fifo(
  p_producto_id  UUID,
  p_store_id     UUID,
  p_cantidad     INTEGER,
  p_venta_item_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_restante INTEGER := p_cantidad;
  v_lote     RECORD;
  v_deducir  INTEGER;
  v_stock_disponible INTEGER;
  v_resultado JSONB := '[]'::JSONB;
BEGIN
  SELECT COALESCE(SUM(cantidad_actual), 0)
  INTO v_stock_disponible
  FROM lotes_producto
  WHERE producto_id        = p_producto_id
    AND store_id           = p_store_id
    AND activo             = TRUE
    AND cantidad_actual    > 0
    AND fecha_vencimiento >= CURRENT_DATE;

  IF v_stock_disponible < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente: disponible % unidades vigentes, requerido %',
      v_stock_disponible, p_cantidad;
  END IF;

  FOR v_lote IN
    SELECT id, cantidad_actual, fecha_ingreso
    FROM lotes_producto
    WHERE producto_id        = p_producto_id
      AND store_id           = p_store_id
      AND activo             = TRUE
      AND cantidad_actual    > 0
      AND fecha_vencimiento >= CURRENT_DATE
    ORDER BY fecha_ingreso ASC, created_at ASC
  LOOP
    EXIT WHEN v_restante <= 0;

    v_deducir := LEAST(v_lote.cantidad_actual, v_restante);

    UPDATE lotes_producto
    SET cantidad_actual = cantidad_actual - v_deducir,
        updated_at      = NOW()
    WHERE id = v_lote.id;

    IF p_venta_item_id IS NOT NULL THEN
      INSERT INTO venta_item_lotes (venta_item_id, lote_id, cantidad)
      VALUES (p_venta_item_id, v_lote.id, v_deducir);
    END IF;

    v_resultado := v_resultado || jsonb_build_array(
      jsonb_build_object(
        'lote_id',          v_lote.id,
        'cantidad_deducida', v_deducir,
        'fecha_ingreso',    v_lote.fecha_ingreso
      )
    );

    v_restante := v_restante - v_deducir;
  END LOOP;

  RETURN v_resultado;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────
-- 9. Función: devolver_stock_a_lotes()
--    Usada en devoluciones/notas de crédito.
--    Reinstala las cantidades en los lotes originales.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION devolver_stock_a_lotes(
  p_venta_item_id UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE lotes_producto l
  SET cantidad_actual = l.cantidad_actual + vil.cantidad,
      updated_at      = NOW()
  FROM venta_item_lotes vil
  WHERE vil.venta_item_id = p_venta_item_id
    AND vil.lote_id       = l.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────
-- 10. Migración de datos existentes:
--     Crear un lote "legado" para productos alimentos
--     que ya tienen fecha_vencimiento cargada manualmente
-- ─────────────────────────────────────────────
INSERT INTO lotes_producto (
  store_id, producto_id,
  cantidad_inicial, cantidad_actual,
  fecha_vencimiento, fecha_ingreso,
  notas
)
SELECT
  p.store_id,
  p.id,
  GREATEST(p.stock, 0),
  GREATEST(p.stock, 0),
  p.fecha_vencimiento,
  CURRENT_DATE,
  'Lote creado automáticamente al migrar a sistema de lotes'
FROM productos p
JOIN categorias c ON c.id = p.categoria_id
WHERE p.fecha_vencimiento IS NOT NULL
  AND p.activo = TRUE
  AND c.es_alimento = TRUE
  AND p.stock > 0;

COMMENT ON TABLE lotes_producto IS
  'Lotes de productos con fecha de vencimiento individual.
   INSERT/UPDATE/DELETE aquí actualiza automáticamente
   productos.stock y productos.fecha_vencimiento via triggers.';

COMMENT ON FUNCTION deducir_stock_fifo IS
  'Deduce p_cantidad del producto usando FIFO (lote más antiguo primero).
   Si se pasa p_venta_item_id, registra trazabilidad en venta_item_lotes.
   Lanza excepción si el stock es insuficiente.';