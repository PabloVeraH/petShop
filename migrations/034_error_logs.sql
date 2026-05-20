-- migrations/034_error_logs.sql
CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  user_id TEXT,
  error_code VARCHAR(100),
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  context JSONB,
  severity VARCHAR(20) DEFAULT 'ERROR',
  endpoint VARCHAR(200),
  ip_address INET,
  user_agent TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP,
  resolved_by TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_store_time ON error_logs(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON error_logs(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_resolved ON error_logs(resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_endpoint ON error_logs(endpoint, created_at DESC);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Only service role can insert error_logs" ON error_logs;
CREATE POLICY "Only service role can insert error_logs" ON error_logs
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admins see own store error_logs" ON error_logs;
CREATE POLICY "Admins see own store error_logs" ON error_logs
  FOR SELECT USING (
    store_id IS NULL OR
    store_id IN (
      SELECT store_id FROM clerk_users
      WHERE (clerk_id)::text = (auth.uid())::text
    )
  );
