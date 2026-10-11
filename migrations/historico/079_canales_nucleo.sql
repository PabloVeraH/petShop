-- migrations/079_canales_nucleo.sql
-- Fase 2 del plan docs/canales-stock/stock_canales_externos.md — núcleo común
-- de canales externos (paso 2.1, §4.3, §5.3).
--
-- Estado: APLICADA el 2026-09-25 (execute_sql vía MCP, con confirmación explícita
-- del usuario) y verificada con docs/canales-stock/stock_canales_fase2_verificacion.sql (K1–K7 OK).
-- Antes: requería confirmación explícita del usuario
-- (AGENTS.md §0.1 / §11.2 — wnxrdbnvreofrrmhcybc es el único entorno).
--
-- ─── Estado real verificado (2026-09-25, solo lectura) ────────────────────
-- canal_config:   4 filas; columnas cifradas credenciales_* ya existen (V1,
--                 aplicadas a mano sin migración); external_store_id NULL en
--                 las 4 (C4); sin recargo_pct.
-- canal_ordenes:  0 filas; UNIQUE global (canal_id, external_order_id) (C16);
--                 sin CHECK de estado; sin items/total_externo/accepted_at/
--                 rejected_at/motivo_rechazo (V2); índice de expiración con
--                 'reserved' (V3).
-- canal_outbox:   no existe.
--
-- ─── Qué hace ─────────────────────────────────────────────────────────────
-- 1. canal_config: versiona las columnas cifradas (IF NOT EXISTS, no-op en la
--    BD actual) y agrega recargo_pct (D7) con CHECK >= 0.
-- 2. canal_ordenes: UNIQUE por tienda (store_id, canal_id, external_order_id)
--    en reemplazo del global; columnas del ciclo de vida; CHECK de estados
--    (§4.3, sin 'reserved' — D6); índice de expiración sin 'reserved'.
-- 3. canal_outbox (§5.3): cola de llamadas salientes a las plataformas, con
--    deduplicación de trabajos pendientes. El worker (claim con
--    FOR UPDATE SKIP LOCKED) llega en la Fase 3.
-- 4. RLS de lectura por tienda en canal_outbox (patrón 062).
--
-- Sin funciones nuevas → no aplica el REVOKE del patrón 069.
-- Tablas con 0 filas (canal_ordenes) o columnas nuevas con default: no hay
-- datos existentes que puedan violar los CHECK.

BEGIN;

-- ── 1. canal_config ──────────────────────────────────────────────────────
ALTER TABLE canal_config ADD COLUMN IF NOT EXISTS credenciales_encriptada TEXT;
ALTER TABLE canal_config ADD COLUMN IF NOT EXISTS credenciales_iv         TEXT;
ALTER TABLE canal_config ADD COLUMN IF NOT EXISTS credenciales_auth_tag   TEXT;
ALTER TABLE canal_config ADD COLUMN IF NOT EXISTS recargo_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE canal_config
    ADD CONSTRAINT canal_config_recargo_pct_no_negativo CHECK (recargo_pct >= 0);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ── 2. canal_ordenes ─────────────────────────────────────────────────────
-- 2a. Idempotencia por tienda (C16): dos tiendas pueden recibir el mismo
--     external_order_id de la misma plataforma (no es una clave global).
ALTER TABLE canal_ordenes DROP CONSTRAINT IF EXISTS canal_ordenes_canal_id_external_order_id_key;
DO $$
BEGIN
  ALTER TABLE canal_ordenes
    ADD CONSTRAINT canal_ordenes_store_canal_external_key UNIQUE (store_id, canal_id, external_order_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN
  NULL;
END $$;

-- 2b. Ciclo de vida (V2). items = orden normalizada por el adaptador
--     ([{sku, nombre, cantidad, precio_unitario_bruto}]); payload sigue
--     guardando el evento crudo de la plataforma.
ALTER TABLE canal_ordenes ADD COLUMN IF NOT EXISTS items          JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE canal_ordenes ALTER COLUMN items DROP DEFAULT;
ALTER TABLE canal_ordenes ADD COLUMN IF NOT EXISTS total_externo  NUMERIC(12,2);
ALTER TABLE canal_ordenes ADD COLUMN IF NOT EXISTS accepted_at    TIMESTAMPTZ;
ALTER TABLE canal_ordenes ADD COLUMN IF NOT EXISTS rejected_at    TIMESTAMPTZ;
ALTER TABLE canal_ordenes ADD COLUMN IF NOT EXISTS ready_at       TIMESTAMPTZ;
ALTER TABLE canal_ordenes ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;
ALTER TABLE canal_ordenes ADD COLUMN IF NOT EXISTS intentos       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canal_ordenes ADD COLUMN IF NOT EXISTS ultimo_error   TEXT;

-- 2c. Estados §4.3 (sin 'reserved': D6 elimina las reservas). 0 filas hoy;
--     por las dudas, una fila 'reserved' vuelve a 'pending'.
UPDATE canal_ordenes SET estado = 'pending' WHERE estado = 'reserved';
DO $$
BEGIN
  ALTER TABLE canal_ordenes
    ADD CONSTRAINT canal_ordenes_estado_check CHECK (estado IN (
      'pending', 'processing', 'accepted', 'ready', 'picked_up', 'delivered',
      'rejected', 'failed', 'cancelled', 'expired'
    )) NOT VALID;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
ALTER TABLE canal_ordenes VALIDATE CONSTRAINT canal_ordenes_estado_check;

DO $$
BEGIN
  ALTER TABLE canal_ordenes
    ADD CONSTRAINT canal_ordenes_items_es_array CHECK (jsonb_typeof(items) = 'array');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE canal_ordenes
    ADD CONSTRAINT canal_ordenes_intentos_no_negativo CHECK (intentos >= 0);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- 2d. Índice de expiración sin 'reserved' (V3).
DROP INDEX IF EXISTS idx_canal_ordenes_expiry;
CREATE INDEX IF NOT EXISTS idx_canal_ordenes_expiry
  ON canal_ordenes (aceptar_antes_de) WHERE estado = 'pending';

-- ── 3. canal_outbox (§5.3) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS canal_outbox (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  canal_id        TEXT        NOT NULL REFERENCES canales_externos(id),
  tipo            TEXT        NOT NULL
                              CHECK (tipo IN ('confirm', 'reject', 'ready', 'availability', 'catalog')),
  canal_orden_id  UUID        NULL REFERENCES canal_ordenes(id) ON DELETE CASCADE,
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key      TEXT        NULL,
  estado          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (estado IN ('pending', 'processing', 'done', 'dead')),
  intentos        INTEGER     NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error      TEXT        NULL,          -- sin secretos ni payloads de clientes
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS canal_outbox_pendientes
  ON canal_outbox (estado, next_attempt_at);
CREATE INDEX IF NOT EXISTS canal_outbox_store_created
  ON canal_outbox (store_id, created_at DESC);
-- Coalescencia (§4.4): un solo trabajo vivo por dedupe_key.
CREATE UNIQUE INDEX IF NOT EXISTS canal_outbox_dedupe_vivo
  ON canal_outbox (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND estado IN ('pending', 'processing');

DROP TRIGGER IF EXISTS canal_outbox_updated_at ON canal_outbox;
CREATE TRIGGER canal_outbox_updated_at
  BEFORE UPDATE ON canal_outbox
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 4. RLS (defensa adicional; las rutas usan service role — AGENTS.md §0.2)
ALTER TABLE canal_outbox ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "canal_outbox_select" ON canal_outbox
    FOR SELECT USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
