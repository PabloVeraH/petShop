-- migrations/077_granel_sacos_abiertos.sql
-- Fase 1b del plan docs/canales-stock/stock_canales_externos.md — granel
-- (§4.6, D18–D20, riesgos G1–G11). Primera de dos migraciones que se aplican
-- JUNTAS y EN ORDEN:
--   077_granel_sacos_abiertos.sql      ← esta (modelo + primitivas + RPCs de saco)
--   078_granel_ventas_devoluciones.sql (crear_venta_tx / anular_venta_tx /
--                                       crear_nota_credito_tx)
-- Requiere 074–076 aplicadas.
--
-- Estado: APLICADA el 2026-09-24 (execute_sql vía MCP, con confirmación explícita
-- del usuario) y verificada con docs/canales-stock/stock_canales_fase1b_verificacion.sql (G1–G17 OK).
-- Antes: requería confirmación explícita del usuario
-- (AGENTS.md §0.1 / §11.2 — wnxrdbnvreofrrmhcybc es el único entorno).
--
-- ─── Hallazgos que corrige (re-verificados contra la BD real 2026-09-24) ──
-- S9/V12  crear_venta_tx castea (v_item->>'cantidad')::INTEGER: toda venta a
--         granel ('0.5' kg) falla desde la 059; antes de la 059 descontaba kg
--         como si fueran sacos. (Se corrige en 078 usando este modelo.)
-- V20     venta_items no tiene es_granel ni gramos (la ruta los envía y la
--         función los ignora).
-- V16     nota_credito_items.cantidad_devuelta es INTEGER → no se puede
--         devolver granel (kg con decimales).
--
-- ─── Modelo (D20, §4.6) ──────────────────────────────────────────────────
-- peso(p)              = productos.peso_gramos (> 0 obligatorio para granel, G8)
-- gramos_abiertos(p)   = sacos_abiertos.gramos_restantes del saco abierto
--                        (cerrado_at IS NULL; a lo más uno por producto, G9).
--                        ENTEROS: son la fuente de verdad.
-- fraccion(p)          = ROUND(gramos_abiertos / peso, 3)   (fraccion_gramos)
-- productos.stock      = sacos_cerrados + fraccion(p)
--     con lotes activos: sacos_cerrados = Σ lotes activos (trigger)
--     sin lotes:         sacos_cerrados = productos.stock − fraccion(p)
-- Invariante I4: toda función que cambia gramos_restantes recalcula stock con
-- la MISMA fórmula (ajustar_stock_por_saco): el stock nunca acumula restas de
-- 0,0333; 30 ventas de 500 g de un saco de 15 000 g dejan exactamente 1 saco
-- menos. Abrir un saco no cambia el stock total (1 cerrado → 1,000 abierto).
-- Invariante I5: toda deducción de unidades enteras (venta por unidad,
-- apertura) opera sobre los sacos CERRADOS: decrement_stock descuenta del
-- stock sin lotes solo si stock − fraccion(p) alcanza; con lotes, FIFO sobre
-- los lotes (que son los cerrados).
--
-- ─── Bloqueos ────────────────────────────────────────────────────────────
-- Toda función que toca sacos_abiertos bloquea PRIMERO la fila del producto
-- (FOR UPDATE, tenant-scoped); los lotes y el saco se acceden después (orden
-- producto → lote → saco, igual que 074). Todos los escritores de un saco
-- pasan por el bloqueo del producto → dos cajas que abren saco a la vez se
-- serializan (G9); el índice único parcial es la red de seguridad.
--
-- ─── Grants ──────────────────────────────────────────────────────────────
-- Patrón 069: toda función creada o reemplazada repite el REVOKE de
-- PUBLIC/anon/authenticated en esta misma migración.

BEGIN;

-- ── 1. Esquema ───────────────────────────────────────────────────────────

-- 1a. Saco abierto por producto (§4.6). origen: 'apertura' = salió de un saco
--     cerrado (abrir_saco); 'devolucion' / 'conteo' = gramos que volvieron
--     (NC/anulación) o se contaron sin haber un saco abierto — no salieron de
--     un saco cerrado, por eso no se pueden "deshacer".
CREATE TABLE IF NOT EXISTS sacos_abiertos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID        NOT NULL REFERENCES stores(id),
  producto_id      UUID        NOT NULL REFERENCES productos(id),
  lote_id          UUID        NULL REFERENCES lotes_producto(id),
  origen           TEXT        NOT NULL DEFAULT 'apertura'
                               CHECK (origen IN ('apertura', 'devolucion', 'conteo')),
  gramos_iniciales INTEGER     NOT NULL CHECK (gramos_iniciales > 0),
  gramos_restantes INTEGER     NOT NULL CHECK (gramos_restantes >= 0),
  abierto_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  abierto_por      TEXT        NULL,          -- clerk user id
  cerrado_at       TIMESTAMPTZ NULL,
  cerrado_por      TEXT        NULL,          -- clerk user id (G6)
  motivo_cierre    TEXT        NULL
                               CHECK (motivo_cierre IS NULL
                                      OR motivo_cierre IN ('agotado', 'merma', 'deshecho', 'conteo')),
  gramos_merma     INTEGER     NULL CHECK (gramos_merma IS NULL OR gramos_merma >= 0),
  nota             TEXT        NULL,
  CONSTRAINT sacos_abiertos_cierre_coherente
    CHECK ((cerrado_at IS NULL) = (motivo_cierre IS NULL))
);

-- G9: un solo saco abierto por producto.
CREATE UNIQUE INDEX IF NOT EXISTS sacos_abiertos_uno_abierto_por_producto
  ON sacos_abiertos (producto_id) WHERE cerrado_at IS NULL;
CREATE INDEX IF NOT EXISTS sacos_abiertos_store_producto
  ON sacos_abiertos (store_id, producto_id);

-- 1b. Trazabilidad venta ↔ saco (análoga a venta_item_lotes). Una venta de
--     granel puede consumir el resto de un saco y parte del siguiente.
--     deshacer_apertura_saco la usa para rechazar sacos con ventas (G2).
CREATE TABLE IF NOT EXISTS venta_item_sacos (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_item_id UUID        NOT NULL REFERENCES venta_items(id) ON DELETE CASCADE,
  saco_id       UUID        NOT NULL REFERENCES sacos_abiertos(id),
  gramos        INTEGER     NOT NULL CHECK (gramos > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS venta_item_sacos_venta_item ON venta_item_sacos (venta_item_id);
CREATE INDEX IF NOT EXISTS venta_item_sacos_saco       ON venta_item_sacos (saco_id);

-- 1c. V20: venta_items registra si la línea es granel y sus gramos (enteros,
--     fuente de verdad; cantidad = gramos / 1000 kg para mostrar y precio).
ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS es_granel BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS gramos    INTEGER NULL;
DO $$
BEGIN
  ALTER TABLE venta_items
    ADD CONSTRAINT venta_items_granel_gramos
    CHECK ((es_granel AND gramos IS NOT NULL AND gramos > 0) OR (NOT es_granel AND gramos IS NULL))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
-- Filas existentes: es_granel = FALSE (default) y gramos NULL → cumplen.
ALTER TABLE venta_items VALIDATE CONSTRAINT venta_items_granel_gramos;

-- 1d. V16: devoluciones de granel en kg (3 decimales = gramos exactos).
--     Ensanchamiento INTEGER → NUMERIC(10,3): todo valor existente es
--     representable.
ALTER TABLE nota_credito_items ALTER COLUMN cantidad_devuelta TYPE NUMERIC(10,3);

-- 1e. G8: un producto con precio a granel exige peso del saco. Fase 0 (Q11)
--     y re-verificación 2026-09-24: 0 productos granel sin peso_gramos.
DO $$
BEGIN
  ALTER TABLE productos
    ADD CONSTRAINT productos_granel_requiere_peso
    CHECK (precio_venta_kg IS NULL OR (peso_gramos IS NOT NULL AND peso_gramos > 0))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
ALTER TABLE productos VALIDATE CONSTRAINT productos_granel_requiere_peso;

-- 1f. RLS (defensa adicional; las rutas usan service role — AGENTS.md §0.2).
--     Solo lectura por tienda; las escrituras pasan por las funciones de abajo
--     (service_role), así que no se crean políticas de escritura.
ALTER TABLE sacos_abiertos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE venta_item_sacos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "sacos_abiertos_select" ON sacos_abiertos
    FOR SELECT USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "venta_item_sacos_select" ON venta_item_sacos
    FOR SELECT USING (EXISTS (
      SELECT 1 FROM sacos_abiertos s
       WHERE s.id = venta_item_sacos.saco_id
         AND (s.store_id = get_user_store_id() OR is_system_admin())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Helpers de fracción (I4) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION fraccion_gramos(p_gramos integer, p_peso_gramos integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_gramos IS NULL OR p_peso_gramos IS NULL OR p_peso_gramos <= 0 THEN 0::numeric
    ELSE ROUND(p_gramos::numeric / p_peso_gramos, 3)
  END;
$function$;

-- Fracción del saco abierto actual del producto (0 si no hay saco abierto).
CREATE OR REPLACE FUNCTION fraccion_saco_abierto(p_producto_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT fraccion_gramos(s.gramos_restantes, p.peso_gramos)
      FROM sacos_abiertos s
      JOIN productos p ON p.id = s.producto_id
     WHERE s.producto_id = p_producto_id
       AND s.cerrado_at IS NULL
  ), 0::numeric);
$function$;

-- Aplica al stock el cambio de fracción del saco abierto. El llamador ya
-- bloqueó el producto y ya escribió el nuevo estado del saco.
--   con lotes activos: stock = Σ lotes activos + fracción actual (misma
--                      fórmula que el trigger de lotes)
--   sin lotes:         stock = stock − fracción anterior + fracción nueva
--                      (los sacos cerrados = stock − fracción no cambian)
CREATE OR REPLACE FUNCTION ajustar_stock_por_saco(
  p_producto_id   uuid,
  p_store_id      uuid,
  p_frac_anterior numeric,
  p_frac_nueva    numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM lotes_producto
              WHERE producto_id = p_producto_id AND store_id = p_store_id AND activo = TRUE) THEN
    UPDATE productos
       SET stock = (SELECT COALESCE(SUM(cantidad_actual), 0)
                      FROM lotes_producto
                     WHERE producto_id = p_producto_id
                       AND store_id    = p_store_id
                       AND activo      = TRUE)
                   + fraccion_saco_abierto(p_producto_id)
     WHERE id = p_producto_id AND store_id = p_store_id;
  ELSE
    UPDATE productos
       SET stock = COALESCE(stock, 0) - COALESCE(p_frac_anterior, 0) + COALESCE(p_frac_nueva, 0)
     WHERE id = p_producto_id AND store_id = p_store_id;
  END IF;
END;
$function$;

-- ── 3. Trigger de lotes: stock = Σ lotes activos + fracción abierta ───────
-- Antes: stock = Σ lotes activos. Sin saco abierto la fracción es 0 → mismo
-- resultado que hoy para todo producto que no sea granel.
CREATE OR REPLACE FUNCTION public.sync_producto_stock_from_lotes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_producto_id UUID := COALESCE(NEW.producto_id, OLD.producto_id);
  v_store_id    UUID := COALESCE(NEW.store_id,    OLD.store_id);
BEGIN
  UPDATE productos
  SET stock = (
    SELECT COALESCE(SUM(cantidad_actual), 0)
    FROM lotes_producto
    WHERE producto_id = v_producto_id
      AND store_id    = v_store_id
      AND activo      = TRUE
  ) + fraccion_saco_abierto(v_producto_id)
  WHERE id       = v_producto_id
    AND store_id = v_store_id;
  RETURN NEW;
END;
$function$;

-- ── 4. Guardia: peso_gramos no cambia con un saco abierto (I4) ───────────
-- La fracción del saco abierto está calculada con el peso vigente; cambiarlo
-- a mitad de saco descuadraría sacos_cerrados = stock − fracción.
CREATE OR REPLACE FUNCTION public.proteger_peso_con_saco_abierto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.peso_gramos IS DISTINCT FROM OLD.peso_gramos
     AND EXISTS (SELECT 1 FROM sacos_abiertos
                  WHERE producto_id = NEW.id AND cerrado_at IS NULL) THEN
    RAISE EXCEPTION 'No se puede cambiar el peso del saco con un saco abierto: registre la merma o termine el saco primero';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_productos_peso_saco_abierto ON productos;
CREATE TRIGGER trg_productos_peso_saco_abierto
  BEFORE UPDATE OF peso_gramos ON productos
  FOR EACH ROW EXECUTE FUNCTION proteger_peso_con_saco_abierto();

-- ── 5. decrement_stock: descuenta solo de los sacos cerrados (I5) ─────────
-- Único cambio respecto de 074: el disponible es stock − fracción del saco
-- abierto (0 para todo producto que no es granel).
CREATE OR REPLACE FUNCTION decrement_stock(p_producto_id uuid, p_cantidad numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stock      NUMERIC;
  v_disponible NUMERIC;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida para descontar stock: %', p_cantidad;
  END IF;

  SELECT stock INTO v_stock FROM productos WHERE id = p_producto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  IF EXISTS (SELECT 1 FROM lotes_producto
              WHERE producto_id = p_producto_id AND activo = TRUE) THEN
    RAISE EXCEPTION 'Producto con lotes activos: el stock se descuenta desde los lotes (producto=%)',
      p_producto_id;
  END IF;

  v_disponible := COALESCE(v_stock, 0) - fraccion_saco_abierto(p_producto_id);
  IF v_disponible < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente: disponible %, solicitado %',
      v_disponible, p_cantidad;
  END IF;

  UPDATE productos SET stock = stock - p_cantidad WHERE id = p_producto_id;
END;
$function$;

-- ── 6. convertir_stock_suelto_a_lote: el LOTE-0 son solo los cerrados ────
-- Único cambio respecto de 076: la cantidad del LOTE-0 es stock − fracción
-- del saco abierto (antes: stock completo, que con un saco abierto contaría
-- la fracción dos veces: en el lote y en el saco).
CREATE OR REPLACE FUNCTION convertir_stock_suelto_a_lote(
  p_store_id          uuid,
  p_producto_id       uuid,
  p_fecha_vencimiento date,
  p_fecha_ingreso_max date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prod    RECORD;
  v_fecha   DATE;
  v_cerrado NUMERIC;
  v_lote    lotes_producto%ROWTYPE;
BEGIN
  SELECT id, stock, fecha_vencimiento, created_at
    INTO v_prod
    FROM productos
   WHERE id = p_producto_id AND store_id = p_store_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  v_cerrado := COALESCE(v_prod.stock, 0) - fraccion_saco_abierto(p_producto_id);

  IF EXISTS (SELECT 1 FROM lotes_producto
              WHERE producto_id = p_producto_id AND store_id = p_store_id AND activo = TRUE)
     OR v_cerrado <= 0 THEN
    RETURN NULL;
  END IF;

  v_fecha := COALESCE(p_fecha_vencimiento, v_prod.fecha_vencimiento);
  IF v_fecha IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha de vencimiento del stock existente (% unidades)', v_cerrado;
  END IF;

  INSERT INTO lotes_producto (
    store_id, producto_id, numero_lote, cantidad_inicial, cantidad_actual,
    fecha_vencimiento, fecha_ingreso, notas
  ) VALUES (
    p_store_id, p_producto_id, 'LOTE-0', v_cerrado, v_cerrado,
    v_fecha,
    LEAST(COALESCE(v_prod.created_at::date, CURRENT_DATE), COALESCE(p_fecha_ingreso_max, CURRENT_DATE)),
    'Stock existente convertido a lote (D11)'
  )
  RETURNING * INTO v_lote;
  -- El trigger deja stock = LOTE-0 + fracción del saco abierto (sin cambio).

  UPDATE productos SET tiene_vencimiento = TRUE
   WHERE id = p_producto_id AND store_id = p_store_id AND tiene_vencimiento IS DISTINCT FROM TRUE;

  RETURN to_jsonb(v_lote);
END;
$function$;

-- ── 7. Apertura de saco (G1, G3, G4) ─────────────────────────────────────
-- Interna: el llamador ya bloqueó el producto. Rechaza si hay un saco
-- abierto con gramos (la UI exige registrar antes la merma del resto, G6).
-- Descuenta 1 saco cerrado: FIFO del lote vigente más antiguo si tiene lotes
-- (el saco guarda lote_id y hereda su vencimiento), decrement_stock estricto
-- si no. El stock total no cambia.
CREATE OR REPLACE FUNCTION abrir_saco_interno(
  p_store_id    uuid,
  p_producto_id uuid,
  p_user_id     text,
  p_nota        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_peso    INTEGER;
  v_granel  NUMERIC;
  v_actual  sacos_abiertos%ROWTYPE;
  v_fifo    JSONB;
  v_lote_id UUID;
  v_saco    sacos_abiertos%ROWTYPE;
BEGIN
  SELECT peso_gramos, precio_venta_kg INTO v_peso, v_granel
    FROM productos
   WHERE id = p_producto_id AND store_id = p_store_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;
  IF v_granel IS NULL OR v_peso IS NULL OR v_peso <= 0 THEN
    RAISE EXCEPTION 'Producto no habilitado para granel (requiere precio por kg y peso del saco)';
  END IF;

  SELECT * INTO v_actual
    FROM sacos_abiertos
   WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL
   FOR UPDATE;
  IF FOUND THEN
    IF v_actual.gramos_restantes > 0 THEN
      RAISE EXCEPTION 'Saco abierto con gramos restantes (% g): registre la merma del resto antes de abrir otro',
        v_actual.gramos_restantes;
    END IF;
    -- Saco vacío que quedó abierto (no debería ocurrir: se cierra al agotarse).
    UPDATE sacos_abiertos
       SET cerrado_at = NOW(), cerrado_por = p_user_id, motivo_cierre = 'agotado'
     WHERE id = v_actual.id;
  END IF;

  IF EXISTS (SELECT 1 FROM lotes_producto
              WHERE producto_id = p_producto_id AND store_id = p_store_id AND activo = TRUE) THEN
    v_fifo    := deducir_stock_fifo(p_producto_id, p_store_id, 1, NULL);
    v_lote_id := (v_fifo->0->>'lote_id')::UUID;
  ELSE
    PERFORM decrement_stock(p_producto_id, 1);
  END IF;

  INSERT INTO sacos_abiertos (
    store_id, producto_id, lote_id, origen, gramos_iniciales, gramos_restantes, abierto_por, nota
  ) VALUES (
    p_store_id, p_producto_id, v_lote_id, 'apertura', v_peso, v_peso, p_user_id, p_nota
  )
  RETURNING * INTO v_saco;

  -- 1 saco cerrado menos (ya descontado) + 1,000 abierto → total sin cambio.
  PERFORM ajustar_stock_por_saco(p_producto_id, p_store_id, 0, fraccion_gramos(v_peso, v_peso));

  -- Movimiento interno sin efecto en el total (G5: sin asiento contable).
  INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
  VALUES (
    p_producto_id, 'apertura_saco', 0, v_saco.id,
    'Apertura de saco (' || v_peso || ' g)' || COALESCE(': ' || NULLIF(trim(p_nota), ''), ''),
    p_user_id
  );

  RETURN to_jsonb(v_saco);
END;
$function$;

-- Pública (acción manual "Abrí un saco nuevo", D18).
CREATE OR REPLACE FUNCTION abrir_saco(
  p_store_id    uuid,
  p_producto_id uuid,
  p_user_id     text,
  p_nota        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_saco JSONB;
BEGIN
  v_saco := abrir_saco_interno(p_store_id, p_producto_id, p_user_id, p_nota);
  RETURN jsonb_build_object(
    'saco',  v_saco,
    'stock', (SELECT stock FROM productos WHERE id = p_producto_id AND store_id = p_store_id)
  );
END;
$function$;

-- ── 8. Consumo de granel en una venta (D20, G1) ──────────────────────────
-- Descuenta p_gramos del saco abierto; si no alcanzan y p_permitir_abrir
-- (el POS confirmó la apertura), consume el resto del saco actual, lo cierra
-- como 'agotado', abre el siguiente y sigue — todo en la transacción de la
-- venta. Sin confirmación → 'Saco abierto insuficiente' (la ruta responde
-- 409 para que el POS pida confirmar). Registra venta_item_sacos.
CREATE OR REPLACE FUNCTION consumir_granel(
  p_store_id        uuid,
  p_producto_id     uuid,
  p_venta_item_id   uuid,
  p_gramos          integer,
  p_permitir_abrir  boolean,
  p_user_id         text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_peso      INTEGER;
  v_granel    NUMERIC;
  v_restante  INTEGER := p_gramos;
  v_saco      sacos_abiertos%ROWTYPE;
  v_tomar     INTEGER;
  v_nuevos    INTEGER;
BEGIN
  IF p_gramos IS NULL OR p_gramos <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida para venta a granel: % g', p_gramos;
  END IF;

  SELECT peso_gramos, precio_venta_kg INTO v_peso, v_granel
    FROM productos
   WHERE id = p_producto_id AND store_id = p_store_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;
  IF v_granel IS NULL OR v_peso IS NULL OR v_peso <= 0 THEN
    RAISE EXCEPTION 'Producto no habilitado para granel (requiere precio por kg y peso del saco)';
  END IF;

  WHILE v_restante > 0 LOOP
    SELECT * INTO v_saco
      FROM sacos_abiertos
     WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL
     FOR UPDATE;

    IF NOT FOUND OR v_saco.gramos_restantes <= 0 THEN
      IF NOT COALESCE(p_permitir_abrir, FALSE) THEN
        RAISE EXCEPTION 'Saco abierto insuficiente: quedan % g, se requieren % g — confirme la apertura de un saco nuevo',
          CASE WHEN FOUND THEN v_saco.gramos_restantes ELSE 0 END, v_restante;
      END IF;
      PERFORM abrir_saco_interno(p_store_id, p_producto_id, p_user_id, 'Apertura en venta');
      CONTINUE;
    END IF;

    v_tomar  := LEAST(v_saco.gramos_restantes, v_restante);
    v_nuevos := v_saco.gramos_restantes - v_tomar;

    UPDATE sacos_abiertos
       SET gramos_restantes = v_nuevos,
           cerrado_at       = CASE WHEN v_nuevos = 0 THEN NOW()     ELSE NULL END,
           cerrado_por      = CASE WHEN v_nuevos = 0 THEN p_user_id ELSE NULL END,
           motivo_cierre    = CASE WHEN v_nuevos = 0 THEN 'agotado' ELSE NULL END
     WHERE id = v_saco.id;

    PERFORM ajustar_stock_por_saco(
      p_producto_id, p_store_id,
      fraccion_gramos(v_saco.gramos_restantes, v_peso),
      fraccion_gramos(v_nuevos, v_peso)
    );

    IF p_venta_item_id IS NOT NULL THEN
      INSERT INTO venta_item_sacos (venta_item_id, saco_id, gramos)
      VALUES (p_venta_item_id, v_saco.id, v_tomar);
    END IF;

    v_restante := v_restante - v_tomar;
  END LOOP;
END;
$function$;

-- ── 9. Devolución de gramos (G7: NC y anulación) ─────────────────────────
-- Los gramos vuelven al saco abierto del producto (el de origen si sigue
-- abierto). Si no hay saco abierto (el de origen ya se agotó/cerró), se
-- registra un saco con origen 'devolucion' con esos gramos: no sale de un
-- saco cerrado, así que el total sube exactamente gramos/peso y no se puede
-- "deshacer". Retorna la fracción agregada al stock.
CREATE OR REPLACE FUNCTION devolver_granel(
  p_store_id    uuid,
  p_producto_id uuid,
  p_gramos      integer,
  p_user_id     text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_peso  INTEGER;
  v_saco  sacos_abiertos%ROWTYPE;
  v_antes NUMERIC := 0;
  v_despues NUMERIC;
BEGIN
  IF p_gramos IS NULL OR p_gramos <= 0 THEN
    RETURN 0;
  END IF;

  SELECT peso_gramos INTO v_peso
    FROM productos
   WHERE id = p_producto_id AND store_id = p_store_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;
  IF v_peso IS NULL OR v_peso <= 0 THEN
    RAISE EXCEPTION 'Producto no habilitado para granel (requiere precio por kg y peso del saco)';
  END IF;

  SELECT * INTO v_saco
    FROM sacos_abiertos
   WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL
   FOR UPDATE;

  IF FOUND THEN
    v_antes := fraccion_gramos(v_saco.gramos_restantes, v_peso);
    UPDATE sacos_abiertos
       SET gramos_restantes = gramos_restantes + p_gramos
     WHERE id = v_saco.id;
    v_despues := fraccion_gramos(v_saco.gramos_restantes + p_gramos, v_peso);
  ELSE
    INSERT INTO sacos_abiertos (
      store_id, producto_id, origen, gramos_iniciales, gramos_restantes, abierto_por, nota
    ) VALUES (
      p_store_id, p_producto_id, 'devolucion', p_gramos, p_gramos, p_user_id,
      'Gramos devueltos sin saco abierto'
    );
    v_despues := fraccion_gramos(p_gramos, v_peso);
  END IF;

  PERFORM ajustar_stock_por_saco(p_producto_id, p_store_id, v_antes, v_despues);
  RETURN v_despues - v_antes;
END;
$function$;

-- ── 10. Merma del saco abierto (G6) ──────────────────────────────────────
-- Da de baja los gramos restantes y guarda quién la registró (cerrado_por),
-- fecha, gramos y motivo. stock_movements 'merma' con user_id.
CREATE OR REPLACE FUNCTION cerrar_saco_merma(
  p_store_id    uuid,
  p_producto_id uuid,
  p_motivo      text,
  p_user_id     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_peso  INTEGER;
  v_saco  sacos_abiertos%ROWTYPE;
  v_frac  NUMERIC;
BEGIN
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'El motivo de la merma es obligatorio (mínimo 5 caracteres)';
  END IF;

  SELECT peso_gramos INTO v_peso
    FROM productos
   WHERE id = p_producto_id AND store_id = p_store_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  SELECT * INTO v_saco
    FROM sacos_abiertos
   WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay saco abierto para este producto';
  END IF;

  v_frac := fraccion_gramos(v_saco.gramos_restantes, v_peso);

  UPDATE sacos_abiertos
     SET gramos_merma     = v_saco.gramos_restantes,
         gramos_restantes = 0,
         cerrado_at       = NOW(),
         cerrado_por      = p_user_id,
         motivo_cierre    = 'merma',
         nota             = trim(p_motivo)
   WHERE id = v_saco.id
  RETURNING * INTO v_saco;

  PERFORM ajustar_stock_por_saco(p_producto_id, p_store_id, v_frac, 0);

  IF v_saco.gramos_merma > 0 THEN
    INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
    VALUES (
      p_producto_id, 'merma', -v_frac, v_saco.id,
      'Merma saco abierto (' || v_saco.gramos_merma || ' g): ' || trim(p_motivo),
      p_user_id
    );
  END IF;

  RETURN jsonb_build_object(
    'saco',         to_jsonb(v_saco),
    'gramos_merma', v_saco.gramos_merma,
    'stock',        (SELECT stock FROM productos WHERE id = p_producto_id AND store_id = p_store_id)
  );
END;
$function$;

-- ── 11. Deshacer apertura (G2) ───────────────────────────────────────────
-- Autorización (solo storeAdmin/systemAdmin) en el endpoint. Solo un saco
-- con origen 'apertura', sin ventas asociadas y sin movimientos (gramos
-- intactos). Devuelve el saco a cerrados: a su lote si sigue activo; si no,
-- con devolver_stock_producto (lote activo más antiguo o stock sin lotes).
CREATE OR REPLACE FUNCTION deshacer_apertura_saco(
  p_store_id    uuid,
  p_producto_id uuid,
  p_user_id     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_peso INTEGER;
  v_saco sacos_abiertos%ROWTYPE;
BEGIN
  SELECT peso_gramos INTO v_peso
    FROM productos
   WHERE id = p_producto_id AND store_id = p_store_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  SELECT * INTO v_saco
    FROM sacos_abiertos
   WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay saco abierto para este producto';
  END IF;

  IF v_saco.origen <> 'apertura' THEN
    RAISE EXCEPTION 'El saco no se puede deshacer: no proviene de una apertura (origen %)', v_saco.origen;
  END IF;
  IF EXISTS (SELECT 1 FROM venta_item_sacos WHERE saco_id = v_saco.id) THEN
    RAISE EXCEPTION 'El saco no se puede deshacer: tiene ventas asociadas';
  END IF;
  IF v_saco.gramos_restantes <> v_saco.gramos_iniciales THEN
    RAISE EXCEPTION 'El saco no se puede deshacer: sus gramos cambiaron (% de % g)',
      v_saco.gramos_restantes, v_saco.gramos_iniciales;
  END IF;

  UPDATE sacos_abiertos
     SET gramos_restantes = 0,
         cerrado_at       = NOW(),
         cerrado_por      = p_user_id,
         motivo_cierre    = 'deshecho'
   WHERE id = v_saco.id
  RETURNING * INTO v_saco;

  -- Quitar la fracción abierta y devolver 1 saco a cerrados.
  PERFORM ajustar_stock_por_saco(p_producto_id, p_store_id,
                                 fraccion_gramos(v_saco.gramos_iniciales, v_peso), 0);

  IF v_saco.lote_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM lotes_producto
        WHERE id = v_saco.lote_id AND store_id = p_store_id AND activo = TRUE) THEN
    UPDATE lotes_producto
       SET cantidad_actual = cantidad_actual + 1,
           updated_at      = NOW()
     WHERE id = v_saco.lote_id;
  ELSE
    PERFORM devolver_stock_producto(p_producto_id, p_store_id, 1);
  END IF;

  INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
  VALUES (p_producto_id, 'apertura_saco', 0, v_saco.id, 'Apertura de saco deshecha', p_user_id);

  RETURN jsonb_build_object(
    'saco',  to_jsonb(v_saco),
    'stock', (SELECT stock FROM productos WHERE id = p_producto_id AND store_id = p_store_id)
  );
END;
$function$;

-- ── 12. ajustar_stock_conteo: sacos cerrados + gramos del saco abierto ───
-- Cambio respecto de 076 (D22 / paso 1.7): p_stock_contado son los sacos o
-- unidades CERRADAS (o el lote contado); para granel se puede indicar además
-- p_gramos_saco_abierto (0 cierra el saco abierto con motivo 'conteo'; > 0
-- sin saco abierto crea uno con origen 'conteo'). Sin lotes, el stock queda
-- = contado + fracción del saco abierto (antes: = contado, lo que descuadraba
-- un granel con saco abierto). Firma nueva → DROP + CREATE.
DROP FUNCTION IF EXISTS ajustar_stock_conteo(uuid, uuid, uuid, numeric, text, text);

CREATE FUNCTION ajustar_stock_conteo(
  p_store_id            uuid,
  p_producto_id         uuid,
  p_lote_id             uuid,
  p_stock_contado       numeric,
  p_motivo              text,
  p_user_id             text,
  p_gramos_saco_abierto integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stock_anterior  NUMERIC;
  v_peso            INTEGER;
  v_granel          NUMERIC;
  v_anterior        NUMERIC;
  v_delta           NUMERIC;
  v_stock_nuevo     NUMERIC;
  v_tiene_lotes     BOOLEAN;
  v_numero_lote     TEXT;
  v_saco            sacos_abiertos%ROWTYPE;
  v_hay_saco        BOOLEAN := FALSE;
  v_gramos_anterior INTEGER := 0;
  v_frac_antes      NUMERIC := 0;
  v_frac_despues    NUMERIC;
BEGIN
  IF p_stock_contado IS NULL OR p_stock_contado < 0 THEN
    RAISE EXCEPTION 'Cantidad contada inválida: %', p_stock_contado;
  END IF;
  IF p_gramos_saco_abierto IS NOT NULL AND p_gramos_saco_abierto < 0 THEN
    RAISE EXCEPTION 'Cantidad contada inválida: % g', p_gramos_saco_abierto;
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'El motivo del conteo es obligatorio (mínimo 5 caracteres)';
  END IF;

  SELECT COALESCE(stock, 0), peso_gramos, precio_venta_kg
    INTO v_stock_anterior, v_peso, v_granel
    FROM productos
   WHERE id = p_producto_id AND store_id = p_store_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  SELECT * INTO v_saco
    FROM sacos_abiertos
   WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL
   FOR UPDATE;
  IF FOUND THEN
    v_hay_saco        := TRUE;
    v_gramos_anterior := v_saco.gramos_restantes;
    v_frac_antes      := fraccion_gramos(v_saco.gramos_restantes, v_peso);
  END IF;

  SELECT EXISTS (SELECT 1 FROM lotes_producto
                  WHERE producto_id = p_producto_id AND store_id = p_store_id AND activo = TRUE)
    INTO v_tiene_lotes;

  -- 1. Sacos/unidades cerradas.
  IF v_tiene_lotes THEN
    IF p_lote_id IS NULL THEN
      RAISE EXCEPTION 'Producto con lotes: el conteo físico se registra por lote';
    END IF;
    SELECT cantidad_actual, numero_lote INTO v_anterior, v_numero_lote
      FROM lotes_producto
     WHERE id = p_lote_id AND producto_id = p_producto_id AND store_id = p_store_id AND activo = TRUE
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lote no encontrado: %', p_lote_id;
    END IF;

    UPDATE lotes_producto
       SET cantidad_actual = p_stock_contado,
           updated_at      = NOW()
     WHERE id = p_lote_id;
    -- El trigger deja stock = Σ lotes + fracción del saco abierto.
  ELSE
    IF p_lote_id IS NOT NULL THEN
      RAISE EXCEPTION 'Lote no encontrado: %', p_lote_id;
    END IF;
    v_anterior := v_stock_anterior - v_frac_antes;   -- cerrados antes del conteo
    UPDATE productos SET stock = p_stock_contado + v_frac_antes WHERE id = p_producto_id;
  END IF;

  v_delta := p_stock_contado - v_anterior;

  IF v_delta <> 0 THEN
    INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
    VALUES (
      p_producto_id,
      'ajuste_conteo',
      v_delta,
      p_lote_id,
      'Conteo físico' || CASE WHEN v_numero_lote IS NOT NULL THEN ' lote ' || v_numero_lote ELSE '' END
        || ': ' || trim(p_motivo),
      p_user_id
    );
  END IF;

  -- 2. Gramos del saco abierto (solo granel).
  IF p_gramos_saco_abierto IS NOT NULL
     AND p_gramos_saco_abierto IS DISTINCT FROM (CASE WHEN v_hay_saco THEN v_gramos_anterior ELSE 0 END) THEN
    IF v_granel IS NULL OR v_peso IS NULL OR v_peso <= 0 THEN
      RAISE EXCEPTION 'Producto no habilitado para granel (requiere precio por kg y peso del saco)';
    END IF;

    IF v_hay_saco THEN
      UPDATE sacos_abiertos
         SET gramos_restantes = p_gramos_saco_abierto,
             cerrado_at       = CASE WHEN p_gramos_saco_abierto = 0 THEN NOW()     ELSE NULL END,
             cerrado_por      = CASE WHEN p_gramos_saco_abierto = 0 THEN p_user_id ELSE NULL END,
             motivo_cierre    = CASE WHEN p_gramos_saco_abierto = 0 THEN 'conteo'  ELSE NULL END
       WHERE id = v_saco.id;
    ELSE
      INSERT INTO sacos_abiertos (
        store_id, producto_id, origen, gramos_iniciales, gramos_restantes, abierto_por, nota
      ) VALUES (
        p_store_id, p_producto_id, 'conteo', p_gramos_saco_abierto, p_gramos_saco_abierto,
        p_user_id, 'Saco abierto registrado por conteo físico'
      );
    END IF;

    v_frac_despues := fraccion_gramos(p_gramos_saco_abierto, v_peso);
    PERFORM ajustar_stock_por_saco(p_producto_id, p_store_id, v_frac_antes, v_frac_despues);

    INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
    VALUES (
      p_producto_id,
      'ajuste_conteo',
      v_frac_despues - v_frac_antes,
      v_saco.id,
      'Conteo físico saco abierto: ' || v_gramos_anterior || ' → ' || p_gramos_saco_abierto
        || ' g: ' || trim(p_motivo),
      p_user_id
    );
  END IF;

  SELECT COALESCE(stock, 0) INTO v_stock_nuevo FROM productos WHERE id = p_producto_id;

  RETURN jsonb_build_object(
    'stock_anterior',    v_stock_anterior,
    'stock_nuevo',       v_stock_nuevo,
    'cantidad_anterior', v_anterior,
    'cantidad_contada',  p_stock_contado,
    'delta',             v_delta,
    'lote_id',           p_lote_id,
    'gramos_anterior',   CASE WHEN v_hay_saco THEN v_gramos_anterior ELSE NULL END,
    'gramos_contados',   p_gramos_saco_abierto
  );
END;
$function$;

-- ── 13. Grants (patrón 069) ──────────────────────────────────────────────
-- Las funciones de trigger (sync_producto_stock_from_lotes,
-- proteger_peso_con_saco_abierto) quedan como en 069: devuelven `trigger` y
-- no son invocables por RPC.
REVOKE EXECUTE ON FUNCTION fraccion_gramos(integer, integer)                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fraccion_gramos(integer, integer)                        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION fraccion_saco_abierto(uuid)                              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fraccion_saco_abierto(uuid)                              FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION ajustar_stock_por_saco(uuid, uuid, numeric, numeric)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ajustar_stock_por_saco(uuid, uuid, numeric, numeric)     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION decrement_stock(uuid, numeric)                           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION decrement_stock(uuid, numeric)                           FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION convertir_stock_suelto_a_lote(uuid, uuid, date, date)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION convertir_stock_suelto_a_lote(uuid, uuid, date, date)    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION abrir_saco_interno(uuid, uuid, text, text)               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION abrir_saco_interno(uuid, uuid, text, text)               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION abrir_saco(uuid, uuid, text, text)                       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION abrir_saco(uuid, uuid, text, text)                       FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION consumir_granel(uuid, uuid, uuid, integer, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION consumir_granel(uuid, uuid, uuid, integer, boolean, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION devolver_granel(uuid, uuid, integer, text)               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION devolver_granel(uuid, uuid, integer, text)               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION cerrar_saco_merma(uuid, uuid, text, text)                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cerrar_saco_merma(uuid, uuid, text, text)                FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION deshacer_apertura_saco(uuid, uuid, text)                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION deshacer_apertura_saco(uuid, uuid, text)                 FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION ajustar_stock_conteo(uuid, uuid, uuid, numeric, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ajustar_stock_conteo(uuid, uuid, uuid, numeric, text, text, integer) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION fraccion_gramos(integer, integer)                        TO service_role;
GRANT EXECUTE ON FUNCTION fraccion_saco_abierto(uuid)                              TO service_role;
GRANT EXECUTE ON FUNCTION ajustar_stock_por_saco(uuid, uuid, numeric, numeric)     TO service_role;
GRANT EXECUTE ON FUNCTION decrement_stock(uuid, numeric)                           TO service_role;
GRANT EXECUTE ON FUNCTION convertir_stock_suelto_a_lote(uuid, uuid, date, date)    TO service_role;
GRANT EXECUTE ON FUNCTION abrir_saco_interno(uuid, uuid, text, text)               TO service_role;
GRANT EXECUTE ON FUNCTION abrir_saco(uuid, uuid, text, text)                       TO service_role;
GRANT EXECUTE ON FUNCTION consumir_granel(uuid, uuid, uuid, integer, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION devolver_granel(uuid, uuid, integer, text)               TO service_role;
GRANT EXECUTE ON FUNCTION cerrar_saco_merma(uuid, uuid, text, text)                TO service_role;
GRANT EXECUTE ON FUNCTION deshacer_apertura_saco(uuid, uuid, text)                 TO service_role;
GRANT EXECUTE ON FUNCTION ajustar_stock_conteo(uuid, uuid, uuid, numeric, text, text, integer) TO service_role;

COMMIT;
