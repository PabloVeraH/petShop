-- migrations/083_canales_liquidaciones_alertas.sql
-- Fase 5 (pasos 5.2 y 5.3) del plan docs/canales-stock/stock_canales_externos.md.
--
-- Estado: APLICADA el 2026-09-25 (execute_sql vía MCP, con confirmación explícita
-- del usuario) y verificada con docs/canales-stock/stock_canales_fase5_verificacion.sql (N1–N4 OK).
-- Antes: requería confirmación explícita del usuario
-- (AGENTS.md §0.1 / §11.2 — wnxrdbnvreofrrmhcybc es el único entorno).
-- Verificación: docs/canales-stock/stock_canales_fase5_verificacion.sql.
--
-- Estado previo verificado (2026-09-25, SELECT sobre la BD real):
--   canal_liquidaciones: 0 filas; columnas periodo_desde, periodo_hasta,
--   monto_bruto, comision, monto_neto (NOT NULL), referencia, journal_entry_id;
--   sin CHECK ni UNIQUE de negocio; RLS habilitada.
--   canal_config: sin columnas menu_*.
--
-- ─── Qué hace ─────────────────────────────────────────────────────────────
-- 1. canal_liquidaciones (5.2, D17/D24): invariantes de la liquidación que
--    la contabiliza (Dr Banco neto + Dr Comisión neta + Dr IVA crédito /
--    Cr CxC canal bruto):
--      monto_bruto > 0, 0 <= comision <= monto_bruto,
--      monto_neto = monto_bruto − comision, periodo_desde <= periodo_hasta,
--      UNIQUE (store_id, canal_id, periodo_desde, periodo_hasta): una doble
--      carga (doble clic, reintento) no duplica el asiento.
-- 2. canal_config.menu_estado / menu_detalle / menu_estado_at (5.3): último
--    estado del catálogo en la plataforma (enviado / aprobado / rechazado).
--    Antes el rechazo del menú solo se registraba en console.warn.
--
-- Sin funciones nuevas → no aplica el REVOKE del patrón 069.

BEGIN;

-- ── 1. canal_liquidaciones ───────────────────────────────────────────────
DO $$
BEGIN
  ALTER TABLE canal_liquidaciones
    ADD CONSTRAINT canal_liquidaciones_montos_check
    CHECK (monto_bruto > 0 AND comision >= 0 AND comision <= monto_bruto
           AND monto_neto = monto_bruto - comision);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE canal_liquidaciones
    ADD CONSTRAINT canal_liquidaciones_periodo_check CHECK (periodo_desde <= periodo_hasta);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE canal_liquidaciones
    ADD CONSTRAINT canal_liquidaciones_periodo_unico UNIQUE (store_id, canal_id, periodo_desde, periodo_hasta);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN
  NULL;
END $$;

-- ── 2. canal_config: estado del menú en la plataforma ───────────────────
ALTER TABLE canal_config ADD COLUMN IF NOT EXISTS menu_estado    TEXT        NULL;
ALTER TABLE canal_config ADD COLUMN IF NOT EXISTS menu_detalle   TEXT        NULL;
ALTER TABLE canal_config ADD COLUMN IF NOT EXISTS menu_estado_at TIMESTAMPTZ NULL;

DO $$
BEGIN
  ALTER TABLE canal_config
    ADD CONSTRAINT canal_config_menu_estado_check
    CHECK (menu_estado IS NULL OR menu_estado IN ('enviado', 'aprobado', 'rechazado'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

COMMIT;
