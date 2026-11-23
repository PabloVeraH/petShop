-- 096: varios sacos abiertos del mismo producto (granel en varios puntos de
-- venta de una misma tienda).
--
-- Problema (mascotaspetshop, 2026-11-23): con un saco abierto en un mesón no
-- se podía abrir otro en el segundo punto de venta: abrir_saco_interno exigía
-- registrar la merma del resto ("Saco abierto con gramos restantes...") y el
-- índice único sacos_abiertos_uno_abierto_por_producto lo impedía en la BD.
--
-- Decisión (usuario, 2026-11-23): cualquier usuario puede abrir otro saco con
-- confirmación; en la venta a granel el cajero ELIGE de qué saco descuenta.
--
-- Cambios:
--   1. Se elimina el índice único; queda un índice de búsqueda de abiertos.
--   2. fraccion_saco_abierto suma la fracción de TODOS los sacos abiertos
--      (antes una subconsulta escalar, que fallaría con dos filas). Mismo
--      redondeo por saco que ajustar_stock_por_saco.
--   3. abrir_saco / abrir_saco_interno: p_permitir_otro (default false =
--      comportamiento anterior). Con true se abre otro aunque haya sacos con
--      gramos. Abrir sigue descontando 1 saco cerrado (stock total igual).
--   4. consumir_granel: p_saco_id (el saco que eligió el cajero). Sin saco y
--      con 2+ sacos con gramos → error "Varios sacos abiertos...". Si el saco
--      elegido no alcanza y la línea confirmó abrir, se abre uno nuevo.
--   5. cerrar_saco_merma / ajustar_stock_conteo: p_saco_id; sin él y con 2+
--      sacos abiertos → error que pide indicarlo. deshacer_apertura_saco: sin
--      saco, deshace la apertura más reciente.
--   6. devolver_granel (NC y anulación): devuelve los gramos al saco abierto
--      más antiguo.
--   7. crear_venta_tx: pasa item.saco_id a consumir_granel. El resto es
--      idéntico a la 095.
--
-- Compatibilidad: todos los parámetros nuevos tienen default; con un solo
-- saco abierto (todas las tiendas hoy) el comportamiento no cambia, así que el
-- código anterior sigue funcionando. Aplicar ANTES de desplegar el código que
-- envía permitir_otro / saco_id. No cambia filas. Requiere 090, 092, 093, 095.
-- Reversible mientras ningún producto tenga 2 sacos abiertos: volver a crear
-- el índice único y las funciones de 000_baseline/095.

DROP INDEX IF EXISTS public.sacos_abiertos_uno_abierto_por_producto;
CREATE INDEX IF NOT EXISTS sacos_abiertos_abiertos_por_producto
  ON public.sacos_abiertos USING btree (producto_id, abierto_at) WHERE (cerrado_at IS NULL);

-- ── 2. Fracción de todos los sacos abiertos ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.fraccion_saco_abierto(p_producto_id uuid) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(SUM(fraccion_gramos(s.gramos_restantes, p.peso_gramos)), 0::numeric)
    FROM sacos_abiertos s
    JOIN productos p ON p.id = s.producto_id
   WHERE s.producto_id = p_producto_id
     AND s.cerrado_at IS NULL;
$$;

-- ── 3. Abrir saco ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.abrir_saco(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.abrir_saco_interno(uuid, uuid, text, text);

CREATE FUNCTION public.abrir_saco_interno(p_store_id uuid, p_producto_id uuid, p_user_id text, p_nota text DEFAULT NULL::text, p_permitir_otro boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_peso     INTEGER;
  v_granel   NUMERIC;
  v_abiertos INTEGER;
  v_gramos   INTEGER;
  v_fifo     JSONB;
  v_lote_id  UUID;
  v_saco     sacos_abiertos%ROWTYPE;
BEGIN
  -- Bloqueo del producto: serializa todas las operaciones sobre sus sacos.
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

  -- Sacos abiertos ya vacíos: se cierran como agotados (igual que antes).
  UPDATE sacos_abiertos
     SET cerrado_at = NOW(), cerrado_por = p_user_id, motivo_cierre = 'agotado'
   WHERE producto_id = p_producto_id AND store_id = p_store_id
     AND cerrado_at IS NULL AND gramos_restantes = 0;

  SELECT count(*), COALESCE(SUM(gramos_restantes), 0) INTO v_abiertos, v_gramos
    FROM sacos_abiertos
   WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL;
  IF v_abiertos > 0 AND NOT COALESCE(p_permitir_otro, FALSE) THEN
    RAISE EXCEPTION 'Saco abierto con gramos restantes (% g): registre la merma del resto antes de abrir otro',
      v_gramos;
  END IF;

  IF EXISTS (SELECT 1 FROM lotes_producto
              WHERE producto_id = p_producto_id AND store_id = p_store_id AND activo = TRUE) THEN
    v_fifo    := deducir_stock_fifo(p_producto_id, p_store_id, 1, NULL);
    v_lote_id := (v_fifo->0->>'lote_id')::UUID;
  ELSE
    PERFORM decrement_stock(p_producto_id, 1);
  END IF;

  -- clock_timestamp(), no now(): dos aperturas en la misma transacción (venta
  -- que abre saco) quedan ordenadas; "deshacer la más reciente" depende de eso.
  INSERT INTO sacos_abiertos (
    store_id, producto_id, lote_id, origen, gramos_iniciales, gramos_restantes, abierto_por, nota, abierto_at
  ) VALUES (
    p_store_id, p_producto_id, v_lote_id, 'apertura', v_peso, v_peso, p_user_id, NULLIF(trim(p_nota), ''), clock_timestamp()
  )
  RETURNING * INTO v_saco;

  PERFORM ajustar_stock_por_saco(p_producto_id, p_store_id, 0, fraccion_gramos(v_peso, v_peso));

  INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
  VALUES (
    p_producto_id, 'apertura_saco', 0, v_saco.id,
    'Apertura de saco (' || v_peso || ' g)'
      || CASE WHEN v_abiertos > 0 THEN ' con ' || v_abiertos || ' saco(s) ya abierto(s)' ELSE '' END
      || COALESCE(': ' || NULLIF(trim(p_nota), ''), ''),
    p_user_id
  );

  RETURN to_jsonb(v_saco);
END;
$$;

CREATE FUNCTION public.abrir_saco(p_store_id uuid, p_producto_id uuid, p_user_id text, p_nota text DEFAULT NULL::text, p_permitir_otro boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_saco JSONB;
BEGIN
  v_saco := abrir_saco_interno(p_store_id, p_producto_id, p_user_id, p_nota, p_permitir_otro);
  RETURN jsonb_build_object(
    'saco',  v_saco,
    'stock', (SELECT stock FROM productos WHERE id = p_producto_id AND store_id = p_store_id)
  );
END;
$$;

-- ── 4. Venta a granel desde el saco elegido ───────────────────────────────────
DROP FUNCTION IF EXISTS public.consumir_granel(uuid, uuid, uuid, integer, boolean, text);

CREATE FUNCTION public.consumir_granel(p_store_id uuid, p_producto_id uuid, p_venta_item_id uuid, p_gramos integer, p_permitir_abrir boolean, p_user_id text, p_saco_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_peso      INTEGER;
  v_granel    NUMERIC;
  v_restante  INTEGER := p_gramos;
  v_saco_id   UUID := p_saco_id;
  v_abiertos  INTEGER;
  v_saco      sacos_abiertos%ROWTYPE;
  v_nuevo     JSONB;
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

  IF v_saco_id IS NULL THEN
    SELECT count(*) INTO v_abiertos
      FROM sacos_abiertos
     WHERE producto_id = p_producto_id AND store_id = p_store_id
       AND cerrado_at IS NULL AND gramos_restantes > 0;
    IF v_abiertos > 1 THEN
      RAISE EXCEPTION 'Varios sacos abiertos (%) de este producto: indique de cuál se vende', v_abiertos;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM sacos_abiertos
                     WHERE id = v_saco_id AND producto_id = p_producto_id
                       AND store_id = p_store_id AND cerrado_at IS NULL) THEN
    RAISE EXCEPTION 'Saco no disponible: el saco elegido ya no está abierto';
  END IF;

  WHILE v_restante > 0 LOOP
    IF v_saco_id IS NOT NULL THEN
      SELECT * INTO v_saco
        FROM sacos_abiertos
       WHERE id = v_saco_id AND cerrado_at IS NULL
       FOR UPDATE;
    ELSE
      SELECT * INTO v_saco
        FROM sacos_abiertos
       WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL
       ORDER BY (gramos_restantes > 0) DESC, abierto_at ASC, id ASC
       LIMIT 1
       FOR UPDATE;
    END IF;

    IF NOT FOUND OR v_saco.gramos_restantes <= 0 THEN
      IF NOT COALESCE(p_permitir_abrir, FALSE) THEN
        RAISE EXCEPTION 'Saco abierto insuficiente: quedan % g, se requieren % g — confirme la apertura de un saco nuevo',
          CASE WHEN FOUND THEN v_saco.gramos_restantes ELSE 0 END, v_restante;
      END IF;
      -- La línea confirmó abrir: el saco nuevo pasa a ser el de esta venta.
      v_nuevo   := abrir_saco_interno(p_store_id, p_producto_id, p_user_id, 'Apertura en venta', TRUE);
      v_saco_id := (v_nuevo->>'id')::UUID;
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

    v_saco_id  := v_saco.id;
    v_restante := v_restante - v_tomar;
  END LOOP;
END;
$$;

-- ── 5. Merma, deshacer y conteo de UN saco ───────────────────────────────────
DROP FUNCTION IF EXISTS public.cerrar_saco_merma(uuid, uuid, text, text);

CREATE FUNCTION public.cerrar_saco_merma(p_store_id uuid, p_producto_id uuid, p_motivo text, p_user_id text, p_saco_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_peso     INTEGER;
  v_saco     sacos_abiertos%ROWTYPE;
  v_frac     NUMERIC;
  v_abiertos INTEGER;
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

  IF p_saco_id IS NULL THEN
    SELECT count(*) INTO v_abiertos
      FROM sacos_abiertos
     WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL;
    IF v_abiertos > 1 THEN
      RAISE EXCEPTION 'Varios sacos abiertos (%) de este producto: indique cuál se da de baja', v_abiertos;
    END IF;
  END IF;

  SELECT * INTO v_saco
    FROM sacos_abiertos
   WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL
     AND (p_saco_id IS NULL OR id = p_saco_id)
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
$$;

DROP FUNCTION IF EXISTS public.deshacer_apertura_saco(uuid, uuid, text);

CREATE FUNCTION public.deshacer_apertura_saco(p_store_id uuid, p_producto_id uuid, p_user_id text, p_saco_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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

  -- Sin saco indicado: la apertura más reciente (la que se suele deshacer).
  SELECT * INTO v_saco
    FROM sacos_abiertos
   WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL
     AND (p_saco_id IS NULL OR id = p_saco_id)
   ORDER BY abierto_at DESC, id DESC
   LIMIT 1
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
$$;

DROP FUNCTION IF EXISTS public.ajustar_stock_conteo(uuid, uuid, uuid, numeric, text, text, integer);

CREATE FUNCTION public.ajustar_stock_conteo(p_store_id uuid, p_producto_id uuid, p_lote_id uuid, p_stock_contado numeric, p_motivo text, p_user_id text, p_gramos_saco_abierto integer DEFAULT NULL::integer, p_saco_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
  v_abiertos        INTEGER;
  v_gramos_anterior INTEGER := 0;
  v_frac_total      NUMERIC := 0;
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

  -- Fracción de TODOS los sacos abiertos: separa los cerrados del stock.
  v_frac_total := fraccion_saco_abierto(p_producto_id);

  -- Saco cuyos gramos se contaron (096): el indicado, o el único abierto.
  IF p_gramos_saco_abierto IS NOT NULL THEN
    IF p_saco_id IS NULL THEN
      SELECT count(*) INTO v_abiertos
        FROM sacos_abiertos
       WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL;
      IF v_abiertos > 1 THEN
        RAISE EXCEPTION 'Varios sacos abiertos (%) de este producto: indique cuál se contó', v_abiertos;
      END IF;
    END IF;
    SELECT * INTO v_saco
      FROM sacos_abiertos
     WHERE producto_id = p_producto_id AND store_id = p_store_id AND cerrado_at IS NULL
       AND (p_saco_id IS NULL OR id = p_saco_id)
     FOR UPDATE;
    IF FOUND THEN
      v_hay_saco        := TRUE;
      v_gramos_anterior := v_saco.gramos_restantes;
      v_frac_antes      := fraccion_gramos(v_saco.gramos_restantes, v_peso);
    ELSIF p_saco_id IS NOT NULL THEN
      RAISE EXCEPTION 'No hay saco abierto para este producto';
    END IF;
  END IF;

  SELECT EXISTS (SELECT 1 FROM lotes_producto
                  WHERE producto_id = p_producto_id AND store_id = p_store_id AND activo = TRUE)
    INTO v_tiene_lotes;

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
  ELSE
    IF p_lote_id IS NOT NULL THEN
      RAISE EXCEPTION 'Lote no encontrado: %', p_lote_id;
    END IF;
    v_anterior := v_stock_anterior - v_frac_total;
    UPDATE productos SET stock = p_stock_contado + v_frac_total WHERE id = p_producto_id;
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

  IF p_gramos_saco_abierto IS NOT NULL
     AND p_gramos_saco_abierto IS DISTINCT FROM v_gramos_anterior THEN
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
      )
      RETURNING * INTO v_saco;
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
$$;

-- ── 6. Devolución de gramos (NC / anulación) ─────────────────────────────────
-- ponytail: va al saco abierto más antiguo, no al de origen de la venta (la
-- RPC no recibe la venta). El total cuadra; si hace falta exactitud por saco,
-- pasar el saco de venta_item_sacos desde crear_nota_credito_tx/anular_venta_tx.
CREATE OR REPLACE FUNCTION public.devolver_granel(p_store_id uuid, p_producto_id uuid, p_gramos integer, p_user_id text) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
   ORDER BY abierto_at ASC, id ASC
   LIMIT 1
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
$$;

REVOKE ALL ON FUNCTION public.abrir_saco_interno(uuid, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.abrir_saco_interno(uuid, uuid, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.abrir_saco(uuid, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.abrir_saco(uuid, uuid, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.consumir_granel(uuid, uuid, uuid, integer, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.consumir_granel(uuid, uuid, uuid, integer, boolean, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cerrar_saco_merma(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.cerrar_saco_merma(uuid, uuid, text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.deshacer_apertura_saco(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.deshacer_apertura_saco(uuid, uuid, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ajustar_stock_conteo(uuid, uuid, uuid, numeric, text, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.ajustar_stock_conteo(uuid, uuid, uuid, numeric, text, text, integer, uuid) TO service_role;

-- crear_venta_tx: idéntica a la 095 salvo el saco elegido (item.saco_id) que
-- recibe consumir_granel.

CREATE OR REPLACE FUNCTION public.crear_venta_tx(p_store_id uuid, p_items jsonb, p_cliente_id uuid, p_worker_clerk_id text, p_subtotal numeric, p_descuento_pct numeric, p_impuesto numeric, p_total numeric, p_metodo_pago text, p_canal text, p_procedencia text, p_numero_comprobante text, p_pago_nc jsonb, p_numero_transaccion text, p_fidelizacion_niveles jsonb, p_dias_aviso integer, p_idempotency_key text DEFAULT NULL::text, p_user_id text DEFAULT NULL::text, p_pagos jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_venta              RECORD;
  v_existente          RECORD;
  v_venta_item_id      UUID;
  v_idx                INTEGER;
  v_item               JSONB;
  v_producto_id        UUID;
  v_mascota_id         UUID;
  v_tiene_lotes        BOOLEAN;
  v_es_granel          BOOLEAN;
  v_gramos             INTEGER;
  v_cantidad           NUMERIC;
  v_peso_saco          INTEGER;
  v_metodo_pago_final  TEXT;
  v_pagos              JSONB;
  v_peso_gramos        INTEGER;
  v_es_alimento        BOOLEAN;
  v_mascota_cliente_id UUID;
  v_gramos_porcion     NUMERIC;
  v_veces_dia          INTEGER;
  v_consumo_diario     NUMERIC;
  v_total_gramos       NUMERIC;
  v_dias_estimados     INTEGER;
  v_fecha_termino      DATE;
  v_fid_total          NUMERIC;
  v_fid_frecuencia     INTEGER;
  v_nuevo_descuento    NUMERIC;
  v_nivel              JSONB;
  v_nivel_idx          INTEGER;
  v_incluir_vencidos   BOOLEAN;
BEGIN
  -- ── 0. Idempotencia — reclamo temprano ────────────────────────────────────
  -- Si esta idempotency_key ya generó una venta para esta tienda, es un
  -- reintento (red, doble clic) del MISMO intento de cobro: devolver la venta
  -- ya creada sin repetir ningún efecto (stock, pagos, fidelización).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existente FROM ventas
     WHERE store_id = p_store_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      -- created=false: el caller (POST /api/ventas) usa esto para NO repetir
      -- auditoría, email/WhatsApp ni asientos contables de una venta que ya
      -- los disparó en el intento original.
      RETURN jsonb_build_object('venta', to_jsonb(v_existente), 'created', false);
    END IF;
  END IF;

  -- ── 1. Validar pagos y determinar método de pago final (093) ──────────────
  --     Lista nueva (p_pagos) o parámetros antiguos convertidos. Se valida
  --     antes de tocar nada: suma exacta contra p_total, forma y cardinalidad.
  v_pagos := COALESCE(p_pagos, public.pagos_desde_legado(p_metodo_pago, p_pago_nc, p_numero_transaccion, p_total));
  v_metodo_pago_final := public.validar_pagos(v_pagos, p_total, p_cliente_id, p_canal <> 'pos');

  -- ── 2. Crear venta ────────────────────────────────────────────────────────
  -- Envuelto en su propio bloque para capturar la carrera: dos requests
  -- concurrentes con la MISMA idempotency_key (ninguno vio el check del paso 0
  -- todavía committeado) — el segundo INSERT choca contra el índice único
  -- parcial y, en vez de fallar, devuelve la venta que ganó la carrera.
  BEGIN
    INSERT INTO ventas (
      store_id, cliente_id, worker_clerk_id,
      subtotal, descuento, impuesto, total,
      metodo_pago, canal, procedencia, estado, numero_comprobante, idempotency_key
    ) VALUES (
      p_store_id, p_cliente_id, p_worker_clerk_id,
      p_subtotal, p_descuento_pct, p_impuesto, p_total,
      v_metodo_pago_final, p_canal, p_procedencia, 'pagada', p_numero_comprobante, p_idempotency_key
    ) RETURNING * INTO v_venta;
  EXCEPTION WHEN unique_violation THEN
    IF p_idempotency_key IS NOT NULL THEN
      SELECT * INTO v_existente FROM ventas
       WHERE store_id = p_store_id AND idempotency_key = p_idempotency_key;
      IF FOUND THEN
        RETURN jsonb_build_object('venta', to_jsonb(v_existente), 'created', false);
      END IF;
    END IF;
    RAISE;
  END;

  -- ── 2b. Lotes vencidos (095): solo ventas del POS y si la tienda lo
  --       habilitó en /settings. Canales externos: nunca.
  SELECT p_canal = 'pos' AND vender_vencidos
    INTO v_incluir_vencidos
    FROM stores
   WHERE id = p_store_id;
  v_incluir_vencidos := COALESCE(v_incluir_vencidos, FALSE);

  -- ── 3. Procesar items ─────────────────────────────────────────────────────
  FOR v_idx IN 0..jsonb_array_length(p_items) - 1 LOOP
    v_item        := p_items->v_idx;
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_mascota_id  := NULLIF(v_item->>'mascota_id', '')::UUID;
    v_es_granel   := COALESCE((v_item->>'es_granel')::BOOLEAN, FALSE);

    -- 3.0 Cantidad (migración 078). Granel: gramos enteros = fuente de
    --     verdad; cantidad (kg) se deriva aquí. Por unidad: entera.
    IF v_es_granel THEN
      v_gramos := (v_item->>'gramos')::INTEGER;
      IF v_gramos IS NULL OR v_gramos <= 0 THEN
        RAISE EXCEPTION 'Cantidad inválida: una venta a granel requiere gramos (producto=%)', v_producto_id;
      END IF;
      v_cantidad := v_gramos / 1000.0;
    ELSE
      v_gramos   := NULL;
      v_cantidad := (v_item->>'cantidad')::NUMERIC;
      IF v_cantidad IS NULL OR v_cantidad <= 0 OR v_cantidad <> trunc(v_cantidad) THEN
        RAISE EXCEPTION 'Cantidad inválida: la venta por unidad requiere una cantidad entera (producto=%, cantidad=%)',
          v_producto_id, v_item->>'cantidad';
      END IF;
    END IF;

    -- 3a. Insertar venta_item
    INSERT INTO venta_items (
      venta_id, producto_id, cantidad, precio_unitario, subtotal, mascota_id, es_granel, gramos
    ) VALUES (
      v_venta.id,
      v_producto_id,
      v_cantidad,
      (v_item->>'precio_unitario')::NUMERIC,
      (v_item->>'subtotal')::NUMERIC,
      v_mascota_id,
      v_es_granel,
      v_gramos
    ) RETURNING id INTO v_venta_item_id;

    -- 3b. Descontar stock.
    --     Granel (078): gramos del saco elegido (096; consumir_granel valida que el
    --     producto sea de esta tienda y esté habilitado para granel).
    --     Por unidad: FIFO si el producto tiene CUALQUIER lote activo
    --     (074); decrement_stock estricto si no. Todas fallan con
    --     'Stock insuficiente ...' si no alcanza (D2).
    IF v_es_granel THEN
      PERFORM consumir_granel(
        p_store_id,
        v_producto_id,
        v_venta_item_id,
        v_gramos,
        COALESCE((v_item->>'abrir_saco')::BOOLEAN, FALSE),
        COALESCE(p_user_id, p_worker_clerk_id),
        NULLIF(v_item->>'saco_id', '')::UUID
      );
    ELSE
      SELECT EXISTS (
        SELECT 1
          FROM lotes_producto
         WHERE producto_id = v_producto_id
           AND store_id    = p_store_id
           AND activo      = true
      ) INTO v_tiene_lotes;

      IF v_tiene_lotes THEN
        PERFORM deducir_stock_fifo(
          v_producto_id,
          p_store_id,
          v_cantidad,
          v_venta_item_id,
          v_incluir_vencidos
        );
      ELSE
        PERFORM decrement_stock(
          v_producto_id,
          v_cantidad
        );
      END IF;
    END IF;

    -- 3c. Registrar movimiento de stock. Granel: la proporción del saco
    --     (gramos / peso), que es lo que bajó el stock total.
    IF v_es_granel THEN
      SELECT peso_gramos INTO v_peso_saco FROM productos WHERE id = v_producto_id;
      INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
      VALUES (
        v_producto_id,
        'salida',
        -fraccion_gramos(v_gramos, v_peso_saco),
        v_venta.id,
        'Venta ' || v_venta.id || ' (' || v_gramos || ' g granel)',
        p_user_id
      );
    ELSE
      INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas)
      VALUES (
        v_producto_id,
        'salida',
        -v_cantidad,
        v_venta.id,
        'Venta ' || v_venta.id
      );
    END IF;

    -- 3d. Consumo alerta si hay mascota vinculada
    IF v_mascota_id IS NOT NULL THEN
      SELECT p.peso_gramos, c.es_alimento
        INTO v_peso_gramos, v_es_alimento
        FROM productos p
        LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE p.id = v_producto_id;

      IF v_es_alimento AND v_peso_gramos IS NOT NULL THEN
        SELECT cliente_id, gramos_porcion, veces_dia
          INTO v_mascota_cliente_id, v_gramos_porcion, v_veces_dia
          FROM mascotas
         WHERE id = v_mascota_id;

        IF v_gramos_porcion > 0 AND v_veces_dia > 0 THEN
          v_consumo_diario := v_gramos_porcion * v_veces_dia;
          v_total_gramos   := CASE WHEN v_es_granel THEN v_gramos ELSE v_cantidad * v_peso_gramos END;
          v_dias_estimados := ROUND(v_total_gramos / v_consumo_diario);
          v_fecha_termino  := public.hoy_negocio() + v_dias_estimados;

          INSERT INTO consumo_alertas (
            store_id, cliente_id, mascota_id, producto_id,
            fecha_estimada_termino, dias_aviso, enviado
          ) VALUES (
            p_store_id, v_mascota_cliente_id, v_mascota_id, v_producto_id,
            v_fecha_termino, p_dias_aviso, false
          )
          ON CONFLICT (mascota_id, producto_id) DO UPDATE SET
            fecha_estimada_termino = EXCLUDED.fecha_estimada_termino,
            dias_aviso             = EXCLUDED.dias_aviso,
            enviado                = false;

          UPDATE mascotas
             SET alimento_habitual_id = v_producto_id
           WHERE id = v_mascota_id;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- ── 4. Registrar pagos y consumir crédito (093) ──────────────────────────
  PERFORM public.aplicar_pagos(p_store_id, v_venta.id, p_cliente_id, v_pagos);

  -- ── 5. Actualizar fidelización ────────────────────────────────────────────
  IF p_cliente_id IS NOT NULL THEN
    SELECT total_historico, frecuencia_compras
      INTO v_fid_total, v_fid_frecuencia
      FROM fidelizacion
     WHERE cliente_id = p_cliente_id;

    v_fid_total      := COALESCE(v_fid_total, 0) + p_total;
    v_fid_frecuencia := COALESCE(v_fid_frecuencia, 0) + 1;
    v_nuevo_descuento := 0;

    -- Recorrer niveles de mayor a menor monto para encontrar el nivel alcanzado
    FOR v_nivel_idx IN REVERSE jsonb_array_length(p_fidelizacion_niveles) - 1..0 LOOP
      v_nivel := p_fidelizacion_niveles->v_nivel_idx;
      IF v_fid_total >= (v_nivel->>'monto')::NUMERIC THEN
        v_nuevo_descuento := (v_nivel->>'descuento')::NUMERIC;
        EXIT;
      END IF;
    END LOOP;

    INSERT INTO fidelizacion (cliente_id, total_historico, frecuencia_compras, descuento_actual, updated_at)
    VALUES (p_cliente_id, v_fid_total, v_fid_frecuencia, v_nuevo_descuento, NOW())
    ON CONFLICT (cliente_id) DO UPDATE SET
      total_historico    = EXCLUDED.total_historico,
      frecuencia_compras = EXCLUDED.frecuencia_compras,
      descuento_actual   = EXCLUDED.descuento_actual,
      updated_at         = EXCLUDED.updated_at;
  END IF;

  RETURN jsonb_build_object('venta', to_jsonb(v_venta), 'created', true);
END;
$$;

REVOKE ALL ON FUNCTION public.crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text, text, jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('096', '096_varios_sacos_abiertos')
ON CONFLICT (version) DO NOTHING;
