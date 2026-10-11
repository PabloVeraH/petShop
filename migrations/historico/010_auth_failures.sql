-- Migration: Create auth_failures table for tracking failed login attempts

CREATE TABLE IF NOT EXISTS auth_failures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  store_id UUID REFERENCES stores(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_failures_ip ON auth_failures(ip_address);
CREATE INDEX IF NOT EXISTS idx_auth_failures_attempted_at ON auth_failures(attempted_at);
CREATE INDEX IF NOT EXISTS idx_auth_failures_store ON auth_failures(store_id);