-- Migration 039: historial de análisis IA de vencimientos por tienda
CREATE TABLE IF NOT EXISTS ai_vencimientos_analisis (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id             UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  modelo_usado         TEXT        NOT NULL,
  dias_alerta          INTEGER     NOT NULL DEFAULT 30,
  productos_analizados INTEGER     NOT NULL,
  recomendaciones      JSONB       NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_ai_vencimientos_store_created
  ON ai_vencimientos_analisis(store_id, created_at DESC);
