-- 093: pago mixto (una venta o cita pagada con 1 a 5 medios) + endurecimiento
-- del consumo de crédito interno + umbral configurable de 135 UF.
--
-- Diseño: docs/pago_complementario.md y docs/plan_pago_mixto.md.
--
-- Contenido:
--   1. stores.umbral_identificacion_comprador (pesos; NULL = sin aviso). El POS
--      avisa que la boleta debe identificar al comprador (Ley 21.713) cuando el
--      total lo supera. No bloquea.
--   2. Funciones internas del cobro, compartidas por venta y cita:
--      - pagos_desde_legado(): convierte los parámetros antiguos
--        (p_metodo_pago + p_pago_nc + p_numero_transaccion) a la lista p_pagos.
--      - validar_pagos(): forma, suma exacta contra el total, cardinalidad;
--        devuelve ventas.metodo_pago (método único o 'mixto'). ÚNICO lugar
--        donde se decide esa etiqueta.
--      - aplicar_pagos(): inserta las filas de pagos y consume el crédito.
--   3. crear_venta_tx y completar_cita_tx: idénticas a la 092 salvo el bloque
--      de pagos, que pasa a las funciones de (2), y un parámetro nuevo
--      p_pagos jsonb DEFAULT NULL. Sin p_pagos se usan los parámetros
--      antiguos, así que el código desplegado antes de esta migración sigue
--      funcionando. Se hace DROP + CREATE porque cambia la firma (un CREATE OR
--      REPLACE con otra firma dejaría dos sobrecargas y PostgREST no sabría
--      cuál llamar). crear_venta_tx conserva el search_path de la 087.
--
-- Cambios de comportamiento (decisiones D7/D8 del plan):
--   - Una NC con tipo_reembolso = 'reembolso_directo' ya no sirve como pago (el
--     dinero ya se devolvió; antes se aceptaba y se cobraba dos veces).
--   - Pagar con una NC tipo 'saldo_a_favor' exige que el saldo del cliente de
--     origen alcance (antes: GREATEST(0, saldo - monto), que dejaba usar una NC
--     cuyo saldo ya se había gastado).
--   - El reclamo de la NC exige store_id, estado 'activa' y que no esté vencida
--     también en crear_venta_tx (antes solo lo validaba la ruta; el UPDATE de
--     la RPC no filtraba por tienda ni estado).
--   - Métodos 'saldo_favor' y 'mixto' ya no se aceptan como método de un pago
--     (registraban un pago "con crédito" sin consumirlo). 'plataforma' solo en
--     ventas de canal externo (procesar-orden.ts), nunca en el POS.
--   - NC y saldo a favor siempre por un monto > 0 (una NC por $0 quedaba
--     'usada' sin pagar nada).
--   - completar_cita_tx pasa a search_path 'public', 'pg_temp' (igual que
--     crear_venta_tx).
--   - Montos en pesos enteros; la suma de los pagos debe ser exactamente el
--     total.
--
--   - Dueño de la NC (decisión 2026-11-12): notas_credito.cliente_id. Toda NC
--     nueva exige cliente (el de la venta o el que registra el cajero) y solo
--     ese cliente la usa como pago; la anulación devuelve el crédito a él.
--
-- Errores (ERRCODE estable, la API los mapea a HTTP):
--   PV001 pagos inválidos (400) · PV002 NC no encontrada (404) ·
--   PV003 NC no disponible (409) · PV004 NC vencida (410) ·
--   PV005 NC con reembolso directo (409) · PV006 saldo insuficiente (409) ·
--   PV007 saldo a favor sin cliente (400) · PV008 NC de otro cliente o sin
--   dueño (409) · PV009 NC sin cliente al crearla / cliente inválido (400).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, constraint en bloque DO, DROP
-- FUNCTION IF EXISTS + CREATE. Reversible: volver a crear crear_venta_tx y
-- completar_cita_tx desde la 092 (+ el ALTER de la 087), DROP de las tres
-- funciones nuevas y de la columna. Requiere la 092 (hoy_negocio) y la 090.

-- ── 0. Guarda de datos ──────────────────────────────────────────────────────
-- Aborta la migración (sin aplicar nada) si hay datos que la 093 no puede
-- cobrar: los pagos se validan en pesos enteros, así que una cita confirmada
-- con precio decimal ya no se podría completar. Antes de migrar una tienda
-- correr migrations/093_pago_mixto_preflight.sql (solo lectura) y resolver lo
-- que reporte. Ver migrations/README.md.
DO $$
DECLARE
  v_citas    INTEGER;
  v_servicios INTEGER;
BEGIN
  -- La 093 usa public.hoy_negocio() (092) dentro de funciones plpgsql: sin la
  -- 092 se crearía igual (Postgres no valida esas llamadas al crear) y
  -- fallaría recién al cobrar con una NC. Visto en mascotaspetshop 2026-11-12.
  IF to_regprocedure('public.hoy_negocio()') IS NULL THEN
    RAISE EXCEPTION '093 abortada: falta la migración 092 (public.hoy_negocio()). Aplique 092_fechas_hora_chile.sql y vuelva a ejecutar.';
  END IF;

  SELECT count(*) INTO v_citas FROM public.citas
   WHERE estado = 'confirmada' AND precio IS NOT NULL AND precio <> trunc(precio);
  SELECT count(*) INTO v_servicios FROM public.servicios
   WHERE precio IS NOT NULL AND precio <> trunc(precio);
  IF v_citas > 0 OR v_servicios > 0 THEN
    RAISE EXCEPTION '093 abortada: % cita(s) confirmada(s) y % servicio(s) con precio con decimales. Los pagos son en pesos enteros: redondee esos precios y vuelva a ejecutar (detalle en 093_pago_mixto_preflight.sql).',
      v_citas, v_servicios;
  END IF;
END $$;

-- ── 1. Umbral de identificación del comprador ───────────────────────────────
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS umbral_identificacion_comprador integer;

DO $$
BEGIN
  ALTER TABLE public.stores
    ADD CONSTRAINT stores_umbral_identificacion_comprador_positivo
    CHECK (umbral_identificacion_comprador IS NULL OR umbral_identificacion_comprador > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.stores.umbral_identificacion_comprador IS
  'Monto en pesos sobre el cual la boleta debe identificar al comprador (135 UF, Ley 21.713; se fija cada año con la UF al 31-dic). NULL = sin aviso.';

-- ── 1b. Dueño de la nota de crédito (decisión de negocio 2026-11-12) ─────────
-- Toda NC es de un cliente y solo ese cliente la usa como pago. Se guarda en
-- notas_credito.cliente_id (antes se deducía de la venta de origen, que podía
-- no tener cliente: la NC era "al portador" y, al anular la venta que la usó,
-- el crédito terminaba en otro cliente — hallazgo B2 de la revisión).
ALTER TABLE public.notas_credito ADD COLUMN IF NOT EXISTS cliente_id uuid;

DO $$
BEGIN
  ALTER TABLE public.notas_credito
    ADD CONSTRAINT notas_credito_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_notas_credito_cliente_id ON public.notas_credito (cliente_id);

-- Dueño de las NC existentes: el cliente de su venta de origen (determinista,
-- solo filas sin dueño). Las NC cuya venta no tenía cliente quedan sin dueño:
-- no se pueden usar como pago hasta asignarles uno (ver
-- migrations/093_pago_mixto_preflight.sql). No se agrega CHECK NOT NULL: se
-- validaría también en UPDATE y rompería anular ventas con NC antiguas sin
-- dueño. La obligación vive en crear_nota_credito_tx.
UPDATE public.notas_credito nc
   SET cliente_id = v.cliente_id
  FROM public.ventas v
 WHERE v.id = nc.venta_id
   AND nc.cliente_id IS NULL
   AND v.cliente_id IS NOT NULL;

COMMENT ON COLUMN public.notas_credito.cliente_id IS
  'Dueño de la NC: el único cliente que puede usarla como pago. Obligatorio desde la 093 (crear_nota_credito_tx).';

DROP FUNCTION IF EXISTS public.crear_nota_credito_tx(uuid, text, uuid, jsonb, text, text, text, text, date);

CREATE FUNCTION public.crear_nota_credito_tx(p_store_id uuid, p_user_id text, p_venta_id uuid, p_items jsonb, p_numero_nc text, p_motivo text, p_tipo_reembolso text, p_metodo_reembolso text, p_fecha_vencimiento date, p_cliente_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_venta RECORD;
  v_item RECORD;
  v_venta_item RECORD;
  v_ya_devuelto NUMERIC;
  v_disponible NUMERIC;
  v_descuento_pct NUMERIC;
  v_descuento_factor NUMERIC;
  v_precio_con_descuento INTEGER;
  v_subtotal INTEGER;
  v_monto_total INTEGER := 0;
  v_costo_total INTEGER := 0;
  v_costo_unitario INTEGER;
  v_restituir BOOLEAN;
  v_nc_id UUID;
  v_has_lotes BOOLEAN;
  v_ya_devuelto_lotes NUMERIC;
  v_colocado NUMERIC;
  v_gramos_dev INTEGER;
  v_frac NUMERIC;
  v_asignado_en_nc JSONB := '{}'::JSONB;
  v_fid RECORD;
  v_niveles JSONB;
  v_nuevo_total INTEGER;
  v_nueva_frecuencia INTEGER;
  v_retorno_completo BOOLEAN;
  v_nuevo_descuento NUMERIC;
  v_nc_items JSONB := '[]'::JSONB;
  v_nc_cliente_id UUID;
BEGIN
  -- 1. Validar venta: ownership por store_id, no anulada
  SELECT id, cliente_id, total, descuento, estado
    INTO v_venta
    FROM ventas
   WHERE id = p_venta_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada en esta tienda';
  END IF;

  IF v_venta.estado = 'anulada' THEN
    RAISE EXCEPTION 'No se puede devolver una venta anulada';
  END IF;

  -- 1b. Dueño de la NC (093): toda NC es de un cliente y solo él la usa. Es el
  --     cliente de la venta; si la venta no tenía, el que registra el cajero
  --     (p_cliente_id, de esta tienda). No se puede cambiar el de una venta
  --     que ya tiene cliente. La fidelización (paso 7) sigue usando el cliente
  --     de la venta: una compra sin cliente nunca sumó a nadie.
  IF v_venta.cliente_id IS NOT NULL AND p_cliente_id IS NOT NULL AND p_cliente_id <> v_venta.cliente_id THEN
    RAISE EXCEPTION 'La venta ya tiene cliente: la nota de crédito es suya' USING ERRCODE = 'PV009';
  END IF;
  v_nc_cliente_id := COALESCE(v_venta.cliente_id, p_cliente_id);
  IF v_nc_cliente_id IS NULL THEN
    RAISE EXCEPTION 'La nota de crédito requiere un cliente: registre el cliente de la devolución' USING ERRCODE = 'PV009';
  END IF;
  IF v_venta.cliente_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM clientes WHERE id = p_cliente_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Cliente no encontrado en esta tienda' USING ERRCODE = 'PV009';
  END IF;

  v_descuento_pct := COALESCE(v_venta.descuento, 0);
  v_descuento_factor := CASE WHEN v_descuento_pct > 0
    THEN (100 - v_descuento_pct) / 100.0
    ELSE 1
  END;

  -- 2. Procesar cada item
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    venta_item_id UUID,
    cantidad_devuelta NUMERIC,
    restituir_stock BOOLEAN
  )
  LOOP
    v_restituir := COALESCE(v_item.restituir_stock, true);

    -- 2a. Leer datos del item de venta, validar pertenencia. vi.servicio_id
    --     se lee aquí (cambio 3f.1 de 068) — el LEFT JOIN a productos sigue
    --     siendo seguro con producto_id NULL y deja p.costo NULL → 0.
    SELECT vi.id, vi.cantidad, vi.precio_unitario, vi.producto_id, vi.servicio_id,
           vi.es_granel, p.peso_gramos,
           COALESCE(p.costo, 0) AS costo
      INTO v_venta_item
      FROM venta_items vi
      LEFT JOIN productos p ON p.id = vi.producto_id
     WHERE vi.id = v_item.venta_item_id AND vi.venta_id = p_venta_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % no pertenece a la venta %', v_item.venta_item_id, p_venta_id;
    END IF;

    -- 2a'. Cantidad (078): granel en kg con hasta 3 decimales (gramos
    --      exactos); por unidad, entera (antes lo imponía el tipo INTEGER).
    --      Excepción: línea legada con cantidad fraccionaria y es_granel =
    --      false (ventas a granel anteriores a 078) — se permite devolverla
    --      en su misma unidad, como antes de esta migración.
    IF v_item.cantidad_devuelta IS NULL OR v_item.cantidad_devuelta <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para devolver: %', v_item.cantidad_devuelta;
    END IF;
    IF v_venta_item.es_granel THEN
      IF v_item.cantidad_devuelta * 1000 <> trunc(v_item.cantidad_devuelta * 1000) THEN
        RAISE EXCEPTION 'Cantidad inválida para devolver: % kg (máximo 3 decimales)', v_item.cantidad_devuelta;
      END IF;
    ELSIF v_venta_item.cantidad = trunc(v_venta_item.cantidad)
      AND v_item.cantidad_devuelta <> trunc(v_item.cantidad_devuelta) THEN
      RAISE EXCEPTION 'Cantidad inválida para devolver: % (debe ser entera)', v_item.cantidad_devuelta;
    END IF;

    -- 2b. Calcular cantidad disponible
    SELECT COALESCE(SUM(nci.cantidad_devuelta), 0)
      INTO v_ya_devuelto
      FROM nota_credito_items nci
      JOIN notas_credito nc ON nc.id = nci.nota_credito_id
     WHERE nci.venta_item_id = v_item.venta_item_id
       AND nc.venta_id = p_venta_id;

    v_disponible := v_venta_item.cantidad - v_ya_devuelto;

    IF v_item.cantidad_devuelta > v_disponible THEN
      RAISE EXCEPTION 'Cantidad devuelta (%) excede el disponible (%) para el item %',
        v_item.cantidad_devuelta, v_disponible, v_item.venta_item_id;
    END IF;

    -- 2c. Calcular precios con descuento proporcional
    v_precio_con_descuento := ROUND(v_venta_item.precio_unitario * v_descuento_factor);
    v_subtotal := ROUND(v_item.cantidad_devuelta * v_venta_item.precio_unitario * v_descuento_factor);

    v_monto_total := v_monto_total + v_subtotal;

    IF v_restituir THEN
      IF v_venta_item.es_granel THEN
        -- G5: costo por saco × proporción devuelta (kg × 1000 / peso).
        v_costo_total := v_costo_total
          + COALESCE(ROUND(v_venta_item.costo * v_item.cantidad_devuelta * 1000 / NULLIF(v_venta_item.peso_gramos, 0)), 0);
      ELSE
        v_costo_total := v_costo_total + v_item.cantidad_devuelta * v_venta_item.costo;
      END IF;
    END IF;

    -- 2d. Acumular item data para insert bulk (cambio 3f.3: agrega servicio_id)
    v_nc_items := v_nc_items || jsonb_build_object(
      'venta_item_id', v_item.venta_item_id,
      'producto_id', v_venta_item.producto_id,
      'servicio_id', v_venta_item.servicio_id,
      'cantidad_devuelta', v_item.cantidad_devuelta,
      'precio_unitario', v_precio_con_descuento,
      'subtotal', v_subtotal,
      'restituir_stock', v_restituir,
      'es_granel', COALESCE(v_venta_item.es_granel, false)
    );
  END LOOP;

  IF v_monto_total <= 0 THEN
    RAISE EXCEPTION 'Monto total de la NC debe ser positivo';
  END IF;

  -- 3. INSERT notas_credito
  INSERT INTO notas_credito (
    store_id, venta_id, numero_nc, motivo,
    tipo_reembolso, metodo_reembolso, monto_total,
    estado, fecha_vencimiento, cliente_id
  ) VALUES (
    p_store_id, p_venta_id, p_numero_nc, p_motivo,
    p_tipo_reembolso, p_metodo_reembolso, v_monto_total,
    'activa', p_fecha_vencimiento, v_nc_cliente_id
  )
  RETURNING id INTO v_nc_id;

  -- 4. INSERT nota_credito_items
  INSERT INTO nota_credito_items (
    nota_credito_id, venta_item_id, producto_id, servicio_id,
    cantidad_devuelta, precio_unitario, subtotal, restituir_stock
  )
  SELECT
    v_nc_id,
    (item->>'venta_item_id')::UUID,
    (item->>'producto_id')::UUID,
    (item->>'servicio_id')::UUID,
    (item->>'cantidad_devuelta')::NUMERIC,
    (item->>'precio_unitario')::INTEGER,
    (item->>'subtotal')::INTEGER,
    (item->>'restituir_stock')::BOOLEAN
  FROM jsonb_array_elements(v_nc_items) item;

  -- 5. Restituir stock y registrar movimientos
  --    FIX (migración 070): jsonb_to_recordset con columnas tipadas. El
  --    SELECT * sobre jsonb_array_elements(...) AS item nombraba la columna
  --    `value` (OUT param de la función, no el alias `item`), y v_item.item
  --    lanzaba "record "v_item" has no field "item"" (SQLSTATE 42703) en la
  --    primera línea del loop, antes de leer restituir_stock — toda
  --    devolución con al menos un ítem fallaba con 500, no solo las de
  --    restituir_stock=true. Las líneas de servicio (producto_id NULL) se
  --    saltan completo (cambio 3f.2 de 068).
  --    FIX (migración 075, S13): devolver_stock_a_lotes devolvía la cantidad
  --    COMPLETA consumida por el ítem aunque la NC fuera parcial. Ahora cada
  --    lote recibe solo su parte del tramo
  --    [ya devuelto a lotes, ya devuelto + cantidad_devuelta), donde "ya
  --    devuelto" = NCs anteriores con restituir_stock=true + líneas previas
  --    del mismo ítem en ESTA NC. Ítems sin lotes (o producto que hoy tiene
  --    lotes pero no los tenía al vender) → devolver_stock_producto.
  --    Migración 078 (G7): una línea granel devuelve sus gramos al saco
  --    abierto (devolver_granel), no a lotes.
  FOR v_item IN SELECT * FROM jsonb_to_recordset(v_nc_items) AS x(
    venta_item_id UUID,
    producto_id UUID,
    cantidad_devuelta NUMERIC,
    restituir_stock BOOLEAN,
    es_granel BOOLEAN
  )
  LOOP
    v_restituir := COALESCE(v_item.restituir_stock, true);
    CONTINUE WHEN NOT v_restituir OR v_item.producto_id IS NULL;

    IF COALESCE(v_item.es_granel, false) THEN
      v_gramos_dev := ROUND(v_item.cantidad_devuelta * 1000)::INTEGER;
      v_frac := devolver_granel(p_store_id, v_item.producto_id, v_gramos_dev, p_user_id);

      INSERT INTO stock_movements (
        producto_id, tipo, cantidad, referencia_id, notas, user_id
      ) VALUES (
        v_item.producto_id,
        'entrada',
        v_frac,
        v_nc_id,
        'Devolución ' || p_numero_nc || ' (' || v_gramos_dev || ' g granel)',
        p_user_id
      );
      CONTINUE;
    END IF;

    -- 5a. Verificar si el item tiene lotes
    SELECT EXISTS (
      SELECT 1 FROM venta_item_lotes
      WHERE venta_item_id = v_item.venta_item_id
    ) INTO v_has_lotes;

    IF v_has_lotes THEN
      SELECT COALESCE(SUM(nci.cantidad_devuelta), 0) INTO v_ya_devuelto_lotes
        FROM nota_credito_items nci
        JOIN notas_credito nc ON nc.id = nci.nota_credito_id
       WHERE nci.venta_item_id   = v_item.venta_item_id
         AND nc.venta_id         = p_venta_id
         AND nci.restituir_stock = true
         AND nci.nota_credito_id <> v_nc_id;
      v_ya_devuelto_lotes := v_ya_devuelto_lotes
        + COALESCE((v_asignado_en_nc->>(v_item.venta_item_id::TEXT))::NUMERIC, 0);

      v_colocado := devolver_a_lotes_venta_item(
        v_item.venta_item_id, v_ya_devuelto_lotes, v_item.cantidad_devuelta
      );
      IF v_colocado < v_item.cantidad_devuelta THEN
        PERFORM devolver_stock_producto(
          v_item.producto_id, p_store_id, v_item.cantidad_devuelta - v_colocado
        );
      END IF;

      v_asignado_en_nc := v_asignado_en_nc || jsonb_build_object(
        v_item.venta_item_id::TEXT,
        COALESCE((v_asignado_en_nc->>(v_item.venta_item_id::TEXT))::NUMERIC, 0) + v_item.cantidad_devuelta
      );
    ELSE
      PERFORM devolver_stock_producto(
        v_item.producto_id,
        p_store_id,
        v_item.cantidad_devuelta
      );
    END IF;

    -- 5b. Registrar movimiento de stock
    INSERT INTO stock_movements (
      producto_id, tipo, cantidad, referencia_id, notas, user_id
    ) VALUES (
      v_item.producto_id,
      'entrada',
      v_item.cantidad_devuelta,
      v_nc_id,
      'Devolución ' || p_numero_nc,
      p_user_id
    );
  END LOOP;

  -- 6. Incrementar saldo a favor si corresponde
  -- (093) al dueño de la NC: el saldo y la NC son el mismo dinero.
  IF p_tipo_reembolso = 'saldo_a_favor' THEN
    PERFORM incrementar_saldo_a_favor(p_store_id, v_nc_cliente_id, v_monto_total);
  END IF;

  -- 7. Actualizar fidelización (decrementar total_historico, recalcular descuento)
  IF v_venta.cliente_id IS NOT NULL THEN
    SELECT total_historico, frecuencia_compras INTO v_fid
      FROM fidelizacion WHERE cliente_id = v_venta.cliente_id;

    IF FOUND THEN
      SELECT fidelizacion_niveles INTO v_niveles FROM stores WHERE id = p_store_id;
      IF v_niveles IS NULL OR jsonb_array_length(v_niveles) = 0 THEN
        v_niveles := '[{"monto":50000,"descuento":5},{"monto":150000,"descuento":10},{"monto":300000,"descuento":20}]'::JSONB;
      END IF;

      v_nuevo_total := GREATEST(0, v_fid.total_historico - v_monto_total);

      -- Ticket Trello 6a77e9d5cc6b547f60e1799b: cuando la devolución completa
      -- el retorno TOTAL de la venta (ningún item conserva cantidad sin
      -- devolver), la venta deja de contar como compra → decrementar
      -- frecuencia_compras, igual que hace anular_venta_tx al anular. Criterio
      -- por CANTIDAD (no por monto >= total) para no fallar por el redondeo
      -- por-item del paso 2c (ver encabezado de la migración). La NC recién
      -- insertada (paso 3) ya queda incluida en la suma de devoluciones.
      SELECT NOT EXISTS (
        SELECT 1
          FROM venta_items vi
         WHERE vi.venta_id = p_venta_id
           AND COALESCE((
                 SELECT SUM(nci.cantidad_devuelta)
                   FROM nota_credito_items nci
                   JOIN notas_credito nc ON nc.id = nci.nota_credito_id
                  WHERE nci.venta_item_id = vi.id
                    AND nc.venta_id = p_venta_id
               ), 0) < vi.cantidad
      ) INTO v_retorno_completo;

      v_nueva_frecuencia := CASE WHEN v_retorno_completo
        THEN GREATEST(0, v_fid.frecuencia_compras - 1)
        ELSE v_fid.frecuencia_compras
      END;

      SELECT (n->>'descuento')::NUMERIC INTO v_nuevo_descuento
        FROM jsonb_array_elements(v_niveles) n
       WHERE v_nuevo_total >= (n->>'monto')::NUMERIC
       ORDER BY (n->>'monto')::NUMERIC DESC
       LIMIT 1;
      v_nuevo_descuento := COALESCE(v_nuevo_descuento, 0);

      UPDATE fidelizacion
         SET total_historico     = v_nuevo_total,
             frecuencia_compras  = v_nueva_frecuencia,
             descuento_actual    = v_nuevo_descuento,
             updated_at          = NOW()
       WHERE cliente_id = v_venta.cliente_id;
    END IF;
  END IF;

  -- 8. Retornar datos para el llamador (contabilidad fire-and-forget en JS)
  RETURN jsonb_build_object(
    'id', v_nc_id,
    'numero_nc', p_numero_nc,
    'monto_total', v_monto_total,
    'costo_total', v_costo_total,
    'venta_cliente_id', v_venta.cliente_id
  );
END;
$$;


REVOKE ALL ON FUNCTION public.crear_nota_credito_tx(uuid, text, uuid, jsonb, text, text, text, text, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.crear_nota_credito_tx(uuid, text, uuid, jsonb, text, text, text, text, date, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.anular_venta_tx(p_store_id uuid, p_venta_id uuid, p_user_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_venta            RECORD;
  v_item             RECORD;
  v_nc               RECORD;
  v_pago             RECORD;
  v_cliente_destino  UUID;
  v_ya_devuelto      NUMERIC;
  v_pendiente        NUMERIC;
  v_gramos_pend      INTEGER;
  v_frac             NUMERIC;
  v_colocado         NUMERIC;
  v_producto         RECORD;
  v_costo_total      NUMERIC := 0;
  v_total_nc_monto   NUMERIC := 0;
  v_fid              RECORD;
  v_niveles          JSONB;
  v_neto_venta       NUMERIC;
  v_nuevo_total      NUMERIC;
  v_nueva_frecuencia INTEGER;
  v_retorno_completo BOOLEAN;
  v_nuevo_descuento  NUMERIC;
BEGIN
  -- 1. Reclamo atómico: única operación que puede transicionar la venta a
  --    'anulada'. Si otra request concurrente ya ganó la carrera, 0 filas
  --    afectadas y esta ejecución aborta ANTES de tocar stock/fidelización/
  --    saldo — cierra la race condition del bug de doble crédito.
  UPDATE ventas
     SET estado = 'anulada'
   WHERE id = p_venta_id
     AND store_id = p_store_id
     AND estado != 'anulada'
  RETURNING * INTO v_venta;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM ventas WHERE id = p_venta_id AND store_id = p_store_id) THEN
      RAISE EXCEPTION 'La venta ya está anulada';
    ELSE
      RAISE EXCEPTION 'Venta no encontrada';
    END IF;
  END IF;

  -- 2. Monto total de TODAS las NCs de esta venta (cualquier estado) — cada
  --    una ya descontó su propio monto_total de fidelizacion.total_historico
  --    al crearse; se necesita para calcular el neto remanente en el paso 4.
  SELECT COALESCE(SUM(monto_total), 0) INTO v_total_nc_monto
    FROM notas_credito
   WHERE venta_id = p_venta_id;

  -- 3. Restaurar stock: solo la cantidad AÚN NO devuelta vía NC con
  --    restituir_stock=true (esa porción ya volvió al stock cuando se creó
  --    la NC — restaurar la cantidad completa la duplicaría).
  --    Migración 075 (S12): las unidades vuelven a los LOTES de los que
  --    salieron (tramo [ya devuelto, ya devuelto + pendiente) de sus
  --    venta_item_lotes), no a productos.stock — el trigger
  --    sync_stock_on_lote las borraba en el próximo cambio de lote.
  --    Migración 078 (G7): una línea granel devuelve sus GRAMOS netos
  --    pendientes al saco abierto (devolver_granel); costo proporcional.
  FOR v_item IN
    SELECT id, producto_id, cantidad, es_granel, gramos
      FROM venta_items
     WHERE venta_id = p_venta_id
  LOOP
    SELECT COALESCE(SUM(nci.cantidad_devuelta), 0) INTO v_ya_devuelto
      FROM nota_credito_items nci
      JOIN notas_credito nc ON nc.id = nci.nota_credito_id
     WHERE nci.venta_item_id = v_item.id
       AND nc.venta_id = p_venta_id
       AND nci.restituir_stock = true;

    v_pendiente := GREATEST(0, v_item.cantidad - v_ya_devuelto);
    CONTINUE WHEN v_pendiente <= 0;

    SELECT stock, costo, peso_gramos INTO v_producto FROM productos WHERE id = v_item.producto_id;
    IF FOUND THEN
      IF v_item.es_granel THEN
        -- cantidad y cantidad_devuelta están en kg (3 decimales = gramos exactos).
        v_gramos_pend := GREATEST(0, v_item.gramos - ROUND(v_ya_devuelto * 1000)::INTEGER);
        CONTINUE WHEN v_gramos_pend <= 0;
        v_frac := devolver_granel(p_store_id, v_item.producto_id, v_gramos_pend, p_user_id);
        v_costo_total := v_costo_total
          + COALESCE(COALESCE(v_producto.costo, 0) * v_gramos_pend / NULLIF(v_producto.peso_gramos, 0), 0);

        INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
        VALUES (
          v_item.producto_id,
          'entrada',
          v_frac,
          p_venta_id,
          'Anulación ' || COALESCE(v_venta.numero_comprobante, LEFT(p_venta_id::TEXT, 8))
            || ' (' || v_gramos_pend || ' g granel)',
          p_user_id
        );
        CONTINUE;
      END IF;

      v_costo_total := v_costo_total + COALESCE(v_producto.costo, 0) * v_pendiente;

      IF EXISTS (SELECT 1 FROM venta_item_lotes WHERE venta_item_id = v_item.id) THEN
        v_colocado := devolver_a_lotes_venta_item(v_item.id, v_ya_devuelto, v_pendiente);
        IF v_colocado < v_pendiente THEN
          PERFORM devolver_stock_producto(v_item.producto_id, p_store_id, v_pendiente - v_colocado);
        END IF;
      ELSE
        PERFORM devolver_stock_producto(v_item.producto_id, p_store_id, v_pendiente);
      END IF;

      INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
      VALUES (
        v_item.producto_id,
        'entrada',
        v_pendiente,
        p_venta_id,
        'Anulación ' || COALESCE(v_venta.numero_comprobante, LEFT(p_venta_id::TEXT, 8)),
        p_user_id
      );
    END IF;
  END LOOP;

  -- 4. Fidelización: descontar solo el NETO (venta.total − NCs ya restadas
  --    al crearse). Descontar venta.total completo duplicaría esa resta.
  IF v_venta.cliente_id IS NOT NULL THEN
    SELECT total_historico, frecuencia_compras INTO v_fid
      FROM fidelizacion WHERE cliente_id = v_venta.cliente_id;

    IF FOUND THEN
      SELECT fidelizacion_niveles INTO v_niveles FROM stores WHERE id = p_store_id;
      IF v_niveles IS NULL OR jsonb_array_length(v_niveles) = 0 THEN
        v_niveles := '[{"monto":50000,"descuento":5},{"monto":150000,"descuento":10},{"monto":300000,"descuento":20}]'::JSONB;
      END IF;

      v_neto_venta  := GREATEST(0, COALESCE(v_venta.total, 0) - v_total_nc_monto);
      v_nuevo_total := GREATEST(0, v_fid.total_historico - v_neto_venta);

      -- Ticket Trello 6a77e9d5cc6b547f60e1799b: solo decrementar frecuencia si
      -- la venta aún contaba como compra. Una venta devuelta al 100% vía NC ya
      -- la decrementó al completarse el retorno (crear_nota_credito_tx v3) —
      -- restarla de nuevo aquí duplicaría el efecto (contador infravalorado).
      -- Mismo criterio por cantidad que la NC (todas las NCs, cualquier estado)
      -- para no depender del redondeo por-item del monto.
      SELECT NOT EXISTS (
        SELECT 1
          FROM venta_items vi
         WHERE vi.venta_id = p_venta_id
           AND COALESCE((
                 SELECT SUM(nci.cantidad_devuelta)
                   FROM nota_credito_items nci
                   JOIN notas_credito nc ON nc.id = nci.nota_credito_id
                  WHERE nci.venta_item_id = vi.id
                    AND nc.venta_id = p_venta_id
               ), 0) < vi.cantidad
      ) INTO v_retorno_completo;

      v_nueva_frecuencia := CASE WHEN v_retorno_completo
        THEN v_fid.frecuencia_compras
        ELSE GREATEST(0, v_fid.frecuencia_compras - 1)
      END;

      -- Mismo criterio que el JS reemplazado: niveles ordenados DESC por
      -- monto, se toma el descuento del primer nivel (mayor monto) cuyo
      -- umbral el nuevo total todavía alcanza.
      SELECT (n->>'descuento')::NUMERIC INTO v_nuevo_descuento
        FROM jsonb_array_elements(v_niveles) n
       WHERE v_nuevo_total >= (n->>'monto')::NUMERIC
       ORDER BY (n->>'monto')::NUMERIC DESC
       LIMIT 1;
      v_nuevo_descuento := COALESCE(v_nuevo_descuento, 0);

      UPDATE fidelizacion
         SET total_historico    = v_nuevo_total,
             frecuencia_compras = v_nueva_frecuencia,
             descuento_actual   = v_nuevo_descuento,
             updated_at         = NOW()
       WHERE cliente_id = v_venta.cliente_id;
    END IF;
  END IF;

  -- 5. Cancelar NCs activas y revertir su saldo_a_favor. Solo estado='activa':
  --    una NC "usada" ya fue consumida como pago de otra venta (crear_venta_tx
  --    ya decrementó su saldo en ese momento) — revertirla de nuevo sería un
  --    tercer descuento sobre el mismo crédito.
  --    (093) El saldo se revierte al DUEÑO de la NC (notas_credito.cliente_id),
  --    que puede no ser el de la venta si esta no tenía cliente; las NC
  --    anteriores a la 093 sin dueño caen al cliente de la venta, como antes.
  FOR v_nc IN
    SELECT id, tipo_reembolso, monto_total, COALESCE(cliente_id, v_venta.cliente_id) AS dueno
      FROM notas_credito
     WHERE venta_id = p_venta_id AND estado = 'activa'
  LOOP
    IF v_nc.tipo_reembolso = 'saldo_a_favor' AND v_nc.dueno IS NOT NULL THEN
      PERFORM revertir_saldo_a_favor(p_store_id, v_nc.dueno, v_nc.monto_total);
    END IF;

    UPDATE notas_credito SET estado = 'anulada' WHERE id = v_nc.id;
  END LOOP;

  -- 6. Restaurar el saldo_a_favor CONSUMIDO como pago de ESTA venta (espejo
  --    de crear_venta_tx paso 4 y de gastar_saldo_a_favor_pago): al anularse
  --    la venta, los productos vuelven al stock (paso 3) y el cliente
  --    recupera el crédito que usó. Sin este paso el cliente perdía el
  --    crédito consumido y el pasivo Saldos a Favor (que el contra-asiento
  --    reacredita) quedaba sin respaldo en el subledger.
  FOR v_pago IN
    SELECT metodo, monto, nota_credito_id
      FROM pagos
     WHERE venta_id = p_venta_id
       AND metodo IN ('nota_credito', 'saldo_a_favor')
  LOOP
    -- Mismo destinatario que el decremento original: para 'nota_credito',
    -- el cliente de la venta ORIGEN de la NC (crear_venta_tx decrementa a
    -- ese cliente); para 'saldo_a_favor', el cliente de esta venta.
    --    (093) Para 'nota_credito', el dueño de la NC (aplicar_pagos le
    --    descontó a él); NC anteriores sin dueño: el cliente de su venta origen.
    v_cliente_destino := NULL;
    IF v_pago.metodo = 'nota_credito' AND v_pago.nota_credito_id IS NOT NULL THEN
      SELECT COALESCE(nc.cliente_id, v2.cliente_id) INTO v_cliente_destino
        FROM notas_credito nc
        LEFT JOIN ventas v2 ON v2.id = nc.venta_id
       WHERE nc.id = v_pago.nota_credito_id;
    END IF;
    v_cliente_destino := COALESCE(v_cliente_destino, v_venta.cliente_id);

    IF v_cliente_destino IS NOT NULL AND v_pago.monto > 0 THEN
      PERFORM incrementar_saldo_a_favor(p_store_id, v_cliente_destino, v_pago.monto);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('venta', to_jsonb(v_venta), 'costo_total', v_costo_total);
END;
$$;


REVOKE ALL ON FUNCTION public.anular_venta_tx(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.anular_venta_tx(uuid, uuid, text) TO service_role;

-- ── 2. Funciones internas del cobro ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pagos_desde_legado(p_metodo_pago text, p_pago_nc jsonb, p_numero_transaccion text, p_total numeric) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_monto_nc NUMERIC;
  v_resto    NUMERIC;
  v_trx      TEXT := NULLIF(btrim(p_numero_transaccion), '');
  v_pagos    JSONB;
BEGIN
  IF p_pago_nc IS NULL THEN
    RETURN jsonb_build_array(jsonb_build_object(
      'metodo', p_metodo_pago, 'monto', p_total,
      'numero_transaccion', v_trx, 'nota_credito_id', NULL));
  END IF;

  v_monto_nc := (p_pago_nc->>'monto')::NUMERIC;
  v_pagos := jsonb_build_array(jsonb_build_object(
    'metodo', 'nota_credito', 'monto', v_monto_nc,
    'numero_transaccion', NULL, 'nota_credito_id', p_pago_nc->>'nota_credito_id'));

  -- Un resto negativo (NC mayor al total) no se descarta: queda como suma
  -- distinta del total y validar_pagos lo rechaza.
  v_resto := p_total - v_monto_nc;
  IF v_resto <> 0 THEN
    v_pagos := v_pagos || jsonb_build_array(jsonb_build_object(
      'metodo', p_metodo_pago, 'monto', v_resto,
      'numero_transaccion', v_trx, 'nota_credito_id', NULL));
  END IF;
  RETURN v_pagos;
END;
$$;

-- p_permitir_plataforma: las ventas de canal externo (Rappi, PedidosYa,
-- UberEats; procesar-orden.ts) se registran con un único pago 'plataforma'
-- (los cobra la plataforma). crear_venta_tx lo habilita solo si p_canal <> 'pos'.
CREATE OR REPLACE FUNCTION public.validar_pagos(p_pagos jsonb, p_total numeric, p_cliente_id uuid, p_permitir_plataforma boolean DEFAULT false) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_pago  RECORD;
  v_n     INTEGER;
  v_nc    INTEGER := 0;
  v_saldo INTEGER := 0;
  v_suma  NUMERIC := 0;
BEGIN
  IF p_pagos IS NULL OR jsonb_typeof(p_pagos) <> 'array' THEN
    RAISE EXCEPTION 'Pagos inválidos: se esperaba una lista de pagos' USING ERRCODE = 'PV001';
  END IF;
  v_n := jsonb_array_length(p_pagos);
  IF v_n = 0 OR v_n > 5 THEN
    RAISE EXCEPTION 'Pagos inválidos: se permiten de 1 a 5 medios de pago' USING ERRCODE = 'PV001';
  END IF;

  FOR v_pago IN
    SELECT * FROM jsonb_to_recordset(p_pagos)
      AS x(metodo text, monto numeric, numero_transaccion text, nota_credito_id uuid)
  LOOP
    IF v_pago.metodo IS NULL OR (v_pago.metodo NOT IN
       ('efectivo', 'debito', 'credito', 'transferencia', 'nota_credito', 'saldo_a_favor')
       AND NOT (p_permitir_plataforma AND v_pago.metodo = 'plataforma')) THEN
      RAISE EXCEPTION 'Pagos inválidos: método de pago no permitido (%)', COALESCE(v_pago.metodo, 'vacío')
        USING ERRCODE = 'PV001';
    END IF;
    -- $0 solo como pago único de una venta de $0 (100 % de descuento); la suma
    -- exacta contra el total lo garantiza.
    -- Un crédito interno por $0 no paga nada pero igual reclamaría la NC
    -- (quedaría 'usada' sin descontar): siempre > 0.
    IF v_pago.monto IS NULL OR v_pago.monto < 0 OR v_pago.monto <> trunc(v_pago.monto)
       OR (v_pago.monto = 0 AND (v_n > 1 OR v_pago.metodo IN ('nota_credito', 'saldo_a_favor'))) THEN
      RAISE EXCEPTION 'Pagos inválidos: cada monto debe ser un entero mayor a 0' USING ERRCODE = 'PV001';
    END IF;
    IF v_pago.metodo IN ('debito', 'credito', 'transferencia')
       AND NULLIF(btrim(v_pago.numero_transaccion), '') IS NULL THEN
      RAISE EXCEPTION 'Pagos inválidos: falta el número de transacción del pago con %', v_pago.metodo
        USING ERRCODE = 'PV001';
    END IF;
    IF (v_pago.metodo = 'nota_credito') <> (v_pago.nota_credito_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Pagos inválidos: la nota de crédito solo va en un pago con nota de crédito'
        USING ERRCODE = 'PV001';
    END IF;
    IF v_pago.metodo = 'nota_credito' THEN v_nc := v_nc + 1; END IF;
    IF v_pago.metodo = 'saldo_a_favor' THEN v_saldo := v_saldo + 1; END IF;
    v_suma := v_suma + v_pago.monto;
  END LOOP;

  -- Una NC tipo saldo_a_favor y el saldo del cliente son el mismo dinero:
  -- combinarlos en una venta abre un doble consumo (decisión D8).
  IF v_nc > 1 OR v_saldo > 1 OR (v_nc > 0 AND v_saldo > 0) THEN
    RAISE EXCEPTION 'Pagos inválidos: máximo una nota de crédito o un pago con saldo a favor por venta, no ambos'
      USING ERRCODE = 'PV001';
  END IF;
  IF v_saldo > 0 AND p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'El saldo a favor requiere un cliente asociado a la venta' USING ERRCODE = 'PV007';
  END IF;
  IF v_suma <> p_total THEN
    RAISE EXCEPTION 'Pagos inválidos: la suma de los pagos (%) no coincide con el total (%)', v_suma, p_total
      USING ERRCODE = 'PV001';
  END IF;

  RETURN CASE WHEN v_n = 1 THEN p_pagos->0->>'metodo' ELSE 'mixto' END;
END;
$$;

-- Requiere p_pagos ya validado por validar_pagos (misma transacción).
CREATE OR REPLACE FUNCTION public.aplicar_pagos(p_store_id uuid, p_venta_id uuid, p_cliente_id uuid, p_pagos jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_pago          RECORD;
  v_nc            RECORD;
BEGIN
  FOR v_pago IN
    SELECT * FROM jsonb_to_recordset(p_pagos)
      AS x(metodo text, monto numeric, numero_transaccion text, nota_credito_id uuid)
  LOOP
    IF v_pago.metodo = 'nota_credito' THEN
      -- FOR UPDATE: dos cobros concurrentes con la misma NC se serializan
      -- aquí; el segundo ve estado 'usada' y falla con PV003.
      SELECT id, numero_nc, monto_total, estado, fecha_vencimiento, tipo_reembolso, venta_id, cliente_id
        INTO v_nc
        FROM notas_credito
       WHERE id = v_pago.nota_credito_id AND store_id = p_store_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Nota de crédito no encontrada' USING ERRCODE = 'PV002';
      END IF;
      IF v_nc.tipo_reembolso IS DISTINCT FROM 'saldo_a_favor' THEN
        RAISE EXCEPTION 'Esta nota de crédito ya se reembolsó directamente al cliente y no se puede usar como pago'
          USING ERRCODE = 'PV005';
      END IF;
      IF v_nc.estado <> 'activa' THEN
        RAISE EXCEPTION 'La nota de crédito ya no está disponible (fue usada por otra operación)'
          USING ERRCODE = 'PV003';
      END IF;
      IF v_nc.fecha_vencimiento IS NOT NULL AND v_nc.fecha_vencimiento < public.hoy_negocio() THEN
        RAISE EXCEPTION 'La nota de crédito está vencida' USING ERRCODE = 'PV004';
      END IF;
      IF v_pago.monto > v_nc.monto_total THEN
        RAISE EXCEPTION 'Pagos inválidos: el monto de la nota de crédito supera su valor' USING ERRCODE = 'PV001';
      END IF;
      -- Solo el dueño de la NC la usa (decisión 2026-11-12): la venta debe ser
      -- de ese cliente. Una NC antigua sin dueño no paga hasta asignarle uno.
      IF v_nc.cliente_id IS NULL THEN
        RAISE EXCEPTION 'Esta nota de crédito no tiene cliente asignado: asígnele su dueño antes de usarla'
          USING ERRCODE = 'PV008';
      END IF;
      IF p_cliente_id IS DISTINCT FROM v_nc.cliente_id THEN
        RAISE EXCEPTION 'La nota de crédito pertenece a otro cliente' USING ERRCODE = 'PV008';
      END IF;

      UPDATE notas_credito SET estado = 'usada' WHERE id = v_nc.id AND store_id = p_store_id;

      -- La NC tipo saldo_a_favor sumó su monto al saldo de su dueño al crearse:
      -- usarla descuenta ese mismo saldo. Condicional, sin piso 0 (D8): si el
      -- saldo ya se gastó, la NC no paga nada.
      UPDATE saldos_a_favor
         SET saldo_disponible = saldo_disponible - v_pago.monto,
             updated_at       = NOW()
       WHERE cliente_id = v_nc.cliente_id
         AND store_id = p_store_id
         AND saldo_disponible >= v_pago.monto;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Saldo insuficiente: el saldo a favor de esta nota de crédito ya fue utilizado'
          USING ERRCODE = 'PV006';
      END IF;

      INSERT INTO pagos (store_id, venta_id, metodo, monto, nota_credito_id, numero_transaccion)
      VALUES (p_store_id, p_venta_id, 'nota_credito', v_pago.monto, v_nc.id, v_nc.numero_nc);

    ELSIF v_pago.metodo = 'saldo_a_favor' THEN
      -- Mismo descuento atómico y condicional que gastar_saldo_a_favor_pago
      -- (AGENTS.md §23.6), dentro de la transacción del cobro.
      UPDATE saldos_a_favor
         SET saldo_disponible = saldo_disponible - v_pago.monto,
             updated_at       = NOW()
       WHERE cliente_id = p_cliente_id
         AND store_id = p_store_id
         AND saldo_disponible >= v_pago.monto;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Saldo a favor insuficiente para este pago' USING ERRCODE = 'PV006';
      END IF;

      INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
      VALUES (p_store_id, p_venta_id, 'saldo_a_favor', v_pago.monto, NULL);

    ELSE
      INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
      VALUES (p_store_id, p_venta_id, v_pago.metodo, v_pago.monto, NULLIF(btrim(v_pago.numero_transaccion), ''));
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.pagos_desde_legado(text, jsonb, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_pagos(jsonb, numeric, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aplicar_pagos(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pagos_desde_legado(text, jsonb, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.validar_pagos(jsonb, numeric, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.aplicar_pagos(uuid, uuid, uuid, jsonb) TO service_role;

-- ── 3. RPC de cobro ─────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.completar_cita_tx(uuid, uuid, text, text, numeric, jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION public.completar_cita_tx(p_cita_id uuid, p_store_id uuid, p_metodo_pago text, p_numero_transaccion text, p_impuesto numeric, p_pago_nc jsonb, p_fidelizacion_niveles jsonb, p_completado_por text, p_pagos jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_cita               RECORD;
  v_venta              RECORD;
  v_numero_comprobante TEXT;
  v_metodo_pago_final  TEXT;
  v_pagos              JSONB;
  v_estado             TEXT;
  v_fid_total          NUMERIC;
  v_fid_frecuencia     INTEGER;
  v_nuevo_descuento    NUMERIC;
  v_nivel              JSONB;
  v_nivel_idx          INTEGER;
BEGIN
  UPDATE citas
     SET estado = 'completada'
   WHERE id = p_cita_id AND store_id = p_store_id AND estado = 'confirmada'
  RETURNING * INTO v_cita;

  IF NOT FOUND THEN
    SELECT estado INTO v_estado FROM citas WHERE id = p_cita_id AND store_id = p_store_id;
    IF v_estado IS NULL THEN
      RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'P0002';
    ELSE
      RAISE EXCEPTION 'No se puede completar una cita en estado %', v_estado USING ERRCODE = 'PS003';
    END IF;
  END IF;

  IF v_cita.precio IS NULL THEN
    RAISE EXCEPTION 'Esta cita no tiene un precio asociado (creada antes de esta funcionalidad) — complétala sin cobro' USING ERRCODE = 'PS005';
  END IF;

  -- Pagos (093): lista nueva o parámetros antiguos convertidos. validar_pagos
  -- rechaza suma distinta del precio (incluye la NC mayor al total, antes PS007).
  v_pagos := COALESCE(p_pagos, public.pagos_desde_legado(p_metodo_pago, p_pago_nc, p_numero_transaccion, v_cita.precio));
  v_metodo_pago_final := public.validar_pagos(v_pagos, v_cita.precio, v_cita.cliente_id);

  v_numero_comprobante := to_char(public.hoy_negocio(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  INSERT INTO ventas (
    store_id, cliente_id, worker_clerk_id,
    subtotal, descuento, impuesto, total,
    metodo_pago, canal, procedencia, estado, numero_comprobante
  ) VALUES (
    p_store_id, v_cita.cliente_id, p_completado_por,
    v_cita.precio, 0, p_impuesto, v_cita.precio,
    v_metodo_pago_final, 'pos', 'presencial', 'pagada', v_numero_comprobante
  ) RETURNING * INTO v_venta;

  INSERT INTO venta_items (venta_id, servicio_id, mascota_id, cantidad, precio_unitario, subtotal)
  VALUES (v_venta.id, v_cita.servicio_id, v_cita.mascota_id, 1, v_cita.precio, v_cita.precio);

  PERFORM public.aplicar_pagos(p_store_id, v_venta.id, v_cita.cliente_id, v_pagos);

  IF v_cita.cliente_id IS NOT NULL THEN
    SELECT total_historico, frecuencia_compras
      INTO v_fid_total, v_fid_frecuencia
      FROM fidelizacion
     WHERE cliente_id = v_cita.cliente_id;

    v_fid_total      := COALESCE(v_fid_total, 0) + v_cita.precio;
    v_fid_frecuencia := COALESCE(v_fid_frecuencia, 0) + 1;
    v_nuevo_descuento := 0;

    FOR v_nivel_idx IN REVERSE jsonb_array_length(p_fidelizacion_niveles) - 1..0 LOOP
      v_nivel := p_fidelizacion_niveles->v_nivel_idx;
      IF v_fid_total >= (v_nivel->>'monto')::NUMERIC THEN
        v_nuevo_descuento := (v_nivel->>'descuento')::NUMERIC;
        EXIT;
      END IF;
    END LOOP;

    INSERT INTO fidelizacion (cliente_id, total_historico, frecuencia_compras, descuento_actual, updated_at)
    VALUES (v_cita.cliente_id, v_fid_total, v_fid_frecuencia, v_nuevo_descuento, NOW())
    ON CONFLICT (cliente_id) DO UPDATE SET
      total_historico    = EXCLUDED.total_historico,
      frecuencia_compras = EXCLUDED.frecuencia_compras,
      descuento_actual   = EXCLUDED.descuento_actual,
      updated_at         = EXCLUDED.updated_at;
  END IF;

  UPDATE citas SET venta_id = v_venta.id WHERE id = p_cita_id;

  RETURN jsonb_build_object('cita', to_jsonb(v_cita) || jsonb_build_object('venta_id', v_venta.id), 'venta', to_jsonb(v_venta));
END;
$$;

DROP FUNCTION IF EXISTS public.crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text, text);

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
    --     Granel (078): gramos del saco abierto (consumir_granel valida que el
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
        COALESCE(p_user_id, p_worker_clerk_id)
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
          v_venta_item_id
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

REVOKE ALL ON FUNCTION public.completar_cita_tx(uuid, uuid, text, text, numeric, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.completar_cita_tx(uuid, uuid, text, text, numeric, jsonb, jsonb, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text, text, jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('093', '093_pago_mixto')
ON CONFLICT (version) DO NOTHING;
