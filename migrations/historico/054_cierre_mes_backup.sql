CREATE TABLE IF NOT EXISTS cierre_mes_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  periodo TEXT NOT NULL,
  fecha_respaldo TIMESTAMPTZ NOT NULL DEFAULT now(),
  asientos_count INTEGER NOT NULL DEFAULT 0,
  total_debitos NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_creditos NUMERIC(15,2) NOT NULL DEFAULT 0,
  cogs_estimado NUMERIC(15,2) NOT NULL DEFAULT 0,
  snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- SET NULL (no CASCADE/RESTRICT): el respaldo es una copia independiente
  -- del estado contable, útil aunque el asiento de cierre al que estaba
  -- vinculado deje de existir. En la práctica un asiento CIERRE_MES con
  -- COGS > 0 no puede eliminarse (DELETE /api/contabilidad/asientos/[id]
  -- solo permite asientos $0/$0), pero el FK protege el caso general.
  cierre_asiento_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cierre_mes_backups_store_periodo
  ON cierre_mes_backups(store_id, periodo);

-- Sin políticas: solo service_role (usado por todas las API routes, ver
-- AGENTS.md §0.2) puede leer/escribir vía PostgREST. Consistente con el
-- patrón de tablas recientes similares (ej. ai_vencimientos_analisis).
ALTER TABLE cierre_mes_backups ENABLE ROW LEVEL SECURITY;
