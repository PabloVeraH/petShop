-- Tabla de pagos para registrar métodos de pago con número de transacción
CREATE TABLE IF NOT EXISTS pagos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  venta_id UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  metodo VARCHAR(50) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  numero_transaccion VARCHAR(100),
  comprobante VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_pagos_venta_id ON pagos(venta_id);
CREATE INDEX IF NOT EXISTS idx_pagos_store_id ON pagos(store_id);
CREATE INDEX IF NOT EXISTS idx_pagos_created_at ON pagos(created_at);

-- RLS: usuarios solo ven pagos de su tienda
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pagos_select_by_store" ON pagos
  FOR SELECT USING (store_id IN (
    SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
  ));

CREATE POLICY "pagos_insert_by_store" ON pagos
  FOR INSERT WITH CHECK (store_id IN (
    SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
  ));

CREATE POLICY "pagos_update_by_store" ON pagos
  FOR UPDATE USING (store_id IN (
    SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
  ));
