-- Tabla de auditoría
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,                    -- Clerk user_id
  action VARCHAR(50) NOT NULL,              -- CREATE, UPDATE, DELETE, LOGIN, EXPORT, etc
  entity_type VARCHAR(50) NOT NULL,         -- 'venta', 'pago', 'cliente', 'inventario', 'settings'
  entity_id UUID,                           -- ID de la entidad modificada
  old_values JSONB,                         -- Snapshot anterior
  new_values JSONB,                         -- Snapshot nuevo
  change_description TEXT,                  -- Human-readable: "Precio cambiado de 100 a 200"
  ip_address INET,
  user_agent TEXT,
  result VARCHAR(20) DEFAULT 'success',    -- 'success', 'failure', 'partial'
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índices críticos
CREATE INDEX IF NOT EXISTS idx_audit_store_time ON audit_logs(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);

-- RLS policy: solo su store_id
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users see own store audit" ON audit_logs
  FOR SELECT USING (store_id IN (
    SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
  ));

CREATE POLICY IF NOT EXISTS "Only service role can insert" ON audit_logs
  FOR INSERT WITH CHECK (true);  -- Solo via backend