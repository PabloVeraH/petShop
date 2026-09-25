-- migrations/082_canales_catalogo_disponibilidad.sql
-- Fase 4 (pasos 4.1 y 4.2) del plan docs/canales-stock/stock_canales_externos.md
-- — catálogo por canal, precio con override (D7) y disponibilidad (D4, §4.4).
--
-- Estado: APLICADA el 2026-09-25 (execute_sql vía MCP, con confirmación explícita
-- del usuario) y verificada con docs/canales-stock/stock_canales_fase4_verificacion.sql (M1–M14 OK).
-- Antes: requería confirmación explícita del usuario
-- (AGENTS.md §0.1 / §11.2 — wnxrdbnvreofrrmhcybc es el único entorno).
-- Verificación: docs/canales-stock/stock_canales_fase4_verificacion.sql.
--
-- Estado previo verificado (2026-09-25, SELECT sobre la BD real):
--   canal_producto_config: 0 filas; precio NUMERIC NOT NULL con
--   canal_producto_config_precio_check CHECK (precio > 0); activo NOT NULL
--   DEFAULT true; UNIQUE (canal_id, producto_id); índice (store_id, canal_id);
--   sin triggers. productos: sin triggers de disponibilidad.
--
-- ─── Qué hace ─────────────────────────────────────────────────────────────
-- 1. canal_producto_config:
--    - precio → precio_override, nullable (D7: el precio por defecto sale del
--      recargo del canal; el CHECK > 0 se conserva y ahora permite NULL).
--    - activo se mantiene con el significado "habilitado en este canal".
--    - publicado_at: el producto va en el ÚLTIMO catálogo publicado (NULL →
--      la plataforma no lo conoce y no se le envía disponibilidad).
--    - ultimo_disponible_publicado / ultima_cantidad_publicada /
--      disponibilidad_publicada_at: lo último que se informó a la plataforma.
--      ultima_cantidad_publicada queda NULL en canales "toggle" (Rappi).
-- 2. unidades_vendibles_canal(producto): unidades ENTERAS vendibles por un
--    canal externo — con lotes: Σ lotes activos vigentes (D23; el saco
--    abierto ya salió de los lotes, 077); sin lotes: stock − saco abierto
--    (D18). Truncado: los canales venden solo unidades/sacos enteros.
-- 3. estado_disponibilidad_canal(store, canal?, producto?): fuente ÚNICA del
--    estado publicable (lo usan el trigger y el worker, que lee el estado
--    actual al procesar — level-triggered, §4.4):
--      disponible = licencia vigente (D15) ∧ producto activo ∧ habilitado en
--                   canal ∧ canal activo ∧ cupo > 0
--      cupo       = max(0, unidades_vendibles − stock_minimo)          (D4)
--    Solo productos con publicado_at (los que la plataforma conoce).
-- 4. encolar_disponibilidad_canal(store, canal?, producto?): encola UN trabajo
--    'availability' por (tienda, canal) cuando el estado difiere de lo
--    publicado; dedupe_key 'avail:{store}:{canal}' → coalescente (índice
--    único parcial canal_outbox_dedupe_vivo, 079). Diferencia con el texto
--    del plan (clave por producto): una sola llamada por tienda/canal con
--    todos los cambios — Rappi recibe listas turn_on/turn_off.
-- 5. Triggers: productos AFTER UPDATE OF stock, stock_minimo, activo y
--    canal_producto_config AFTER UPDATE OF activo. Cubren toda fuente de
--    cambio de stock (POS, canal, NC, anulación, OC, lotes vía
--    sync_producto_stock_from_lotes, conteo, saco). NO cubren cambios que
--    ocurren solo por el paso del tiempo (un lote que vence, una licencia que
--    vence) ni la reactivación de canal_config: los cubre la reconciliación
--    diaria (/api/cron/canales-reconciliar, paso 4.6).
--
-- Concurrencia: el trigger solo LEE productos/lotes (no bloquea filas nuevas;
-- el orden producto → lote de las transacciones de venta no cambia) e
-- inserta en canal_outbox. Dos ventas simultáneas que cambian la
-- disponibilidad de la misma tienda/canal compiten por la misma dedupe_key:
-- la segunda espera el COMMIT de la primera y luego no inserta (DO NOTHING).
--
-- Grants: patrón 069 (solo service_role) en todas las funciones nuevas.

BEGIN;

-- ── 1. canal_producto_config ─────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'canal_producto_config'
                AND column_name = 'precio')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'canal_producto_config'
                AND column_name = 'precio_override') THEN
    ALTER TABLE canal_producto_config RENAME COLUMN precio TO precio_override;
  END IF;
END $$;

ALTER TABLE canal_producto_config ALTER COLUMN precio_override DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE canal_producto_config
    RENAME CONSTRAINT canal_producto_config_precio_check TO canal_producto_config_precio_override_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

ALTER TABLE canal_producto_config ADD COLUMN IF NOT EXISTS publicado_at                TIMESTAMPTZ NULL;
ALTER TABLE canal_producto_config ADD COLUMN IF NOT EXISTS ultimo_disponible_publicado BOOLEAN     NULL;
ALTER TABLE canal_producto_config ADD COLUMN IF NOT EXISTS ultima_cantidad_publicada   INTEGER     NULL;
ALTER TABLE canal_producto_config ADD COLUMN IF NOT EXISTS disponibilidad_publicada_at TIMESTAMPTZ NULL;

-- El trigger de productos busca por producto_id.
CREATE INDEX IF NOT EXISTS idx_canal_producto_config_producto
  ON canal_producto_config (producto_id);

-- ── 2. unidades_vendibles_canal ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION unidades_vendibles_canal(p_producto_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM lotes_producto l
                  WHERE l.producto_id = p.id AND l.activo = TRUE)
    THEN FLOOR(COALESCE((
           SELECT SUM(l.cantidad_actual)
             FROM lotes_producto l
            WHERE l.producto_id        = p.id
              AND l.activo             = TRUE
              AND l.cantidad_actual    > 0
              AND l.fecha_vencimiento >= CURRENT_DATE), 0))::integer
    ELSE FLOOR(GREATEST(0, COALESCE(p.stock, 0) - fraccion_saco_abierto(p.id)))::integer
  END
  FROM productos p
  WHERE p.id = p_producto_id;
$function$;

-- ── 3. estado_disponibilidad_canal ───────────────────────────────────────
CREATE OR REPLACE FUNCTION estado_disponibilidad_canal(
  p_store_id    uuid,
  p_canal_id    text DEFAULT NULL,
  p_producto_id uuid DEFAULT NULL
)
RETURNS TABLE (
  store_id                    uuid,
  canal_id                    text,
  producto_id                 uuid,
  sku                         text,
  disponible                  boolean,
  cupo                        integer,
  ultimo_disponible_publicado boolean,
  ultima_cantidad_publicada   integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT x.store_id, x.canal_id, x.producto_id, x.sku,
         (x.licencia_vigente AND x.producto_activo AND x.habilitado AND x.canal_activo AND x.cupo > 0),
         x.cupo, x.ultimo_disponible_publicado, x.ultima_cantidad_publicada
    FROM (
      SELECT cpc.store_id, cpc.canal_id, cpc.producto_id, p.sku::text AS sku,
             (s.license_end_date IS NULL OR s.license_end_date >= CURRENT_DATE) AS licencia_vigente,
             COALESCE(p.activo, TRUE)  AS producto_activo,
             cpc.activo                AS habilitado,
             COALESCE(cc.activo, FALSE) AS canal_activo,
             GREATEST(0, unidades_vendibles_canal(p.id) - GREATEST(0, COALESCE(p.stock_minimo, 0))) AS cupo,
             cpc.ultimo_disponible_publicado,
             cpc.ultima_cantidad_publicada
        FROM canal_producto_config cpc
        JOIN productos p      ON p.id = cpc.producto_id AND p.store_id = cpc.store_id
        JOIN stores s         ON s.id = cpc.store_id
        LEFT JOIN canal_config cc ON cc.store_id = cpc.store_id AND cc.canal_id = cpc.canal_id
       WHERE cpc.store_id = p_store_id
         AND (p_canal_id IS NULL OR cpc.canal_id = p_canal_id)
         AND (p_producto_id IS NULL OR cpc.producto_id = p_producto_id)
         AND cpc.publicado_at IS NOT NULL
    ) x;
$function$;

-- Cupo de todos los productos de una tienda (pantalla de catálogo, 4.4):
-- incluye los que aún no están habilitados ni publicados en ningún canal.
CREATE OR REPLACE FUNCTION cupos_canal_tienda(p_store_id uuid)
RETURNS TABLE (producto_id uuid, unidades_vendibles integer, cupo integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.id,
         unidades_vendibles_canal(p.id),
         GREATEST(0, unidades_vendibles_canal(p.id) - GREATEST(0, COALESCE(p.stock_minimo, 0)))
    FROM productos p
   WHERE p.store_id = p_store_id;
$function$;

-- ── 4. encolar_disponibilidad_canal ──────────────────────────────────────
-- Devuelve la cantidad de trabajos NUEVOS encolados (0 si no hubo cambios o
-- ya había uno vivo para esa tienda/canal).
CREATE OR REPLACE FUNCTION encolar_disponibilidad_canal(
  p_store_id    uuid,
  p_canal_id    text DEFAULT NULL,
  p_producto_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO canal_outbox (store_id, canal_id, tipo, payload, dedupe_key)
  SELECT DISTINCT e.store_id, e.canal_id, 'availability', '{}'::jsonb,
         'avail:' || e.store_id::text || ':' || e.canal_id
    FROM estado_disponibilidad_canal(p_store_id, p_canal_id, p_producto_id) e
   WHERE e.disponible IS DISTINCT FROM e.ultimo_disponible_publicado
      OR (e.ultima_cantidad_publicada IS NOT NULL AND e.cupo <> e.ultima_cantidad_publicada)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND estado IN ('pending', 'processing')
  DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- ── 5. Triggers ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_productos_disponibilidad_canal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM encolar_disponibilidad_canal(NEW.store_id, NULL, NEW.id);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_productos_disponibilidad_canal ON productos;
CREATE TRIGGER trg_productos_disponibilidad_canal
  AFTER UPDATE OF stock, stock_minimo, activo ON productos
  FOR EACH ROW
  WHEN (OLD.stock        IS DISTINCT FROM NEW.stock
     OR OLD.stock_minimo IS DISTINCT FROM NEW.stock_minimo
     OR OLD.activo       IS DISTINCT FROM NEW.activo)
  EXECUTE FUNCTION trg_productos_disponibilidad_canal();

CREATE OR REPLACE FUNCTION trg_canal_producto_config_disponibilidad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM encolar_disponibilidad_canal(NEW.store_id, NEW.canal_id, NEW.producto_id);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_canal_producto_config_disponibilidad ON canal_producto_config;
CREATE TRIGGER trg_canal_producto_config_disponibilidad
  AFTER UPDATE OF activo ON canal_producto_config
  FOR EACH ROW
  WHEN (OLD.activo IS DISTINCT FROM NEW.activo)
  EXECUTE FUNCTION trg_canal_producto_config_disponibilidad();

-- ── Grants (patrón 069) ──────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION unidades_vendibles_canal(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION unidades_vendibles_canal(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION unidades_vendibles_canal(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION estado_disponibilidad_canal(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION estado_disponibilidad_canal(uuid, text, uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION estado_disponibilidad_canal(uuid, text, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION cupos_canal_tienda(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cupos_canal_tienda(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION cupos_canal_tienda(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION encolar_disponibilidad_canal(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION encolar_disponibilidad_canal(uuid, text, uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION encolar_disponibilidad_canal(uuid, text, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION trg_productos_disponibilidad_canal() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_productos_disponibilidad_canal() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION trg_canal_producto_config_disponibilidad() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_canal_producto_config_disponibilidad() FROM anon, authenticated;

COMMIT;
