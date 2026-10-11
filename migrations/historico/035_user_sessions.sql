-- migrations/035_user_sessions.sql
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  clerk_session_id TEXT,
  event_type VARCHAR(30) NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_store_time ON user_sessions(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, created_at DESC);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Only service role can insert user_sessions" ON user_sessions;
CREATE POLICY "Only service role can insert user_sessions" ON user_sessions
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admins see own store user_sessions" ON user_sessions;
CREATE POLICY "Admins see own store user_sessions" ON user_sessions
  FOR SELECT USING (
    store_id IN (
      SELECT store_id FROM clerk_users
      WHERE (clerk_id)::text = (auth.uid())::text
    )
  );
