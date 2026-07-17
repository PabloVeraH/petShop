CREATE TABLE IF NOT EXISTS cierre_mes_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  periodo TEXT NOT NULL,
  fecha_respaldo TIMESTAMPTZ NOT NULL DEFAULT now(),
  asientos_count INTEGER NOT NULL DEFAULT 0,
  total_debitos NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_creditos NUMERIC(15,2) NOT NULL DEFAULT 0,
  cogs_estimado NUMERIC(15,2) NOT NULL DEFAULT 0,
  snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  cierre_asiento_id UUID
);

CREATE INDEX IF NOT EXISTS idx_cierre_mes_backups_store_periodo
  ON cierre_mes_backups(store_id, periodo);
