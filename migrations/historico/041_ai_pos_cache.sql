-- migrations/041_ai_pos_cache.sql
CREATE TABLE IF NOT EXISTS ai_pos_cache (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cache_key  TEXT        NOT NULL,
  recomendaciones JSONB  NOT NULL,
  temporada  TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_pos_cache_store_key
  ON ai_pos_cache(store_id, cache_key);