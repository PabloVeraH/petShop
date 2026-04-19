-- Fase 0: Multi-Channel Architecture — Step 4
-- Row Level Security (RLS) Policies

-- ============================================================
-- Paso 6: RLS Policies
-- ============================================================

-- Habilitar RLS en canal_config
ALTER TABLE canal_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS canal_config_store_isolation ON canal_config
  FOR SELECT USING (store_id = (SELECT store_id FROM auth.users WHERE id = auth.uid()));

CREATE POLICY IF NOT EXISTS canal_config_store_insert ON canal_config
  FOR INSERT WITH CHECK (store_id = (SELECT store_id FROM auth.users WHERE id = auth.uid()));

CREATE POLICY IF NOT EXISTS canal_config_store_update ON canal_config
  FOR UPDATE USING (store_id = (SELECT store_id FROM auth.users WHERE id = auth.uid()));

CREATE POLICY IF NOT EXISTS canal_config_store_delete ON canal_config
  FOR DELETE USING (store_id = (SELECT store_id FROM auth.users WHERE id = auth.uid()));

-- Habilitar RLS en canal_producto_config
ALTER TABLE canal_producto_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS canal_producto_config_store ON canal_producto_config
  FOR ALL USING (store_id = (SELECT store_id FROM auth.users WHERE id = auth.uid()));

-- Habilitar RLS en canal_ordenes
ALTER TABLE canal_ordenes ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS canal_ordenes_store ON canal_ordenes
  FOR ALL USING (store_id = (SELECT store_id FROM auth.users WHERE id = auth.uid()));

-- Habilitar RLS en canal_liquidaciones
ALTER TABLE canal_liquidaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS canal_liquidaciones_store ON canal_liquidaciones
  FOR ALL USING (store_id = (SELECT store_id FROM auth.users WHERE id = auth.uid()));

-- Habilitar RLS en stock_reservas
ALTER TABLE stock_reservas ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS stock_reservas_order_access ON stock_reservas
  FOR ALL USING (
    canal_orden_id IN (
      SELECT id FROM canal_ordenes
      WHERE store_id = (SELECT store_id FROM auth.users WHERE id = auth.uid())
    )
  );

COMMIT;
