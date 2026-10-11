-- migrations/081_drop_stock_reservas.sql
-- Fase 3 (paso 3.7) del plan docs/canales-stock/stock_canales_externos.md.
-- D6: sin reservas de stock (la aceptación es automática, D5). La tabla
-- stock_reservas quedó sin código que la use: se eliminan reservarStock /
-- liberarReserva* / handleCancellation (src/lib/canales/hub.ts) y el cron
-- /api/cron/stock-reservas-expiry, que además fallaba por columnas
-- inexistentes (C9/V4).
--
-- Estado: APLICADA el 2026-09-25 (execute_sql vía MCP, con confirmación explícita
-- del usuario) y verificada con docs/canales-stock/stock_canales_fase3_verificacion.sql (L1–L7 OK).
-- Antes: requería confirmación explícita del usuario
-- (AGENTS.md §0.1 / §11.2). Migración separada a propósito (el plan pide
-- confirmar el DROP aparte).
--
-- Datos: 0 filas (Fase 0, V18; re-verificar con
--   SELECT count(*) FROM stock_reservas;
-- justo antes de aplicar). El guard de abajo aborta si hubiera filas.

BEGIN;

DO $$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.stock_reservas') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM stock_reservas' INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'stock_reservas tiene % filas: revisar antes de eliminar la tabla', n;
  END IF;
END $$;

DROP TABLE IF EXISTS stock_reservas;

COMMIT;
