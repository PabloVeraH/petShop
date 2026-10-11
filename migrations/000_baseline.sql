-- =============================================================================
-- 000_baseline.sql — esquema base de petShop
--
-- Generado con pg_dump 17.11 (--schema-only --schema=public --no-owner) desde
-- el proyecto demo (PostgreSQL 17.6) el 2026-10-11. Incluye hasta la
-- migración 086_sucursales_negocios. Reemplaza al historial anterior, que
-- queda en migrations/historico/ solo como referencia.
--
-- Ajustes manuales sobre el dump:
--   - quitadas las líneas \restrict / \unrestrict (meta-comandos de psql que
--     el SQL Editor de Supabase no entiende);
--   - CREATE SCHEMA public -> IF NOT EXISTS (ya existe en un proyecto nuevo);
--   - agregadas al inicio las extensiones y al final el bucket de Storage
--     instagram-media con sus políticas (fuera de public, el dump no los trae).
--
-- Fuera de este archivo: pg_cron de canales (085, después de desplegar) y las
-- Edge Functions del hub (supabase/functions/).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: abrir_saco(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.abrir_saco(p_store_id uuid, p_producto_id uuid, p_user_id text, p_nota text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_saco JSONB;
BEGIN
  v_saco := abrir_saco_interno(p_store_id, p_producto_id, p_user_id, p_nota);
  RETURN jsonb_build_object(
    'saco',  v_saco,
    'stock', (SELECT stock FROM productos WHERE id = p_producto_id AND store_id = p_store_id)
  );
END;
$$;


--
-- Name: abrir_saco_interno(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.abrir_saco_interno(p_store_id uuid, p_producto_id uuid, p_user_id text, p_nota text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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

  PERFORM ajustar_stock_por_saco(p_producto_id, p_store_id, 0, fraccion_gramos(v_peso, v_peso));

  INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
  VALUES (
    p_producto_id, 'apertura_saco', 0, v_saco.id,
    'Apertura de saco (' || v_peso || ' g)' || COALESCE(': ' || NULLIF(trim(p_nota), ''), ''),
    p_user_id
  );

  RETURN to_jsonb(v_saco);
END;
$$;


--
-- Name: ajustar_stock_conteo(uuid, uuid, uuid, numeric, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ajustar_stock_conteo(p_store_id uuid, p_producto_id uuid, p_lote_id uuid, p_stock_contado numeric, p_motivo text, p_user_id text, p_gramos_saco_abierto integer DEFAULT NULL::integer) RETURNS jsonb
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
    v_anterior := v_stock_anterior - v_frac_antes;
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
$$;


--
-- Name: ajustar_stock_por_saco(uuid, uuid, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ajustar_stock_por_saco(p_producto_id uuid, p_store_id uuid, p_frac_anterior numeric, p_frac_nueva numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
$$;


--
-- Name: anular_venta_tx(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.anular_venta_tx(p_store_id uuid, p_venta_id uuid, p_user_id text) RETURNS jsonb
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
  FOR v_nc IN
    SELECT id, tipo_reembolso, monto_total
      FROM notas_credito
     WHERE venta_id = p_venta_id AND estado = 'activa'
  LOOP
    IF v_nc.tipo_reembolso = 'saldo_a_favor' AND v_venta.cliente_id IS NOT NULL THEN
      PERFORM revertir_saldo_a_favor(p_store_id, v_venta.cliente_id, v_nc.monto_total);
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
    v_cliente_destino := NULL;
    IF v_pago.metodo = 'nota_credito' AND v_pago.nota_credito_id IS NOT NULL THEN
      SELECT v2.cliente_id INTO v_cliente_destino
        FROM notas_credito nc
        JOIN ventas v2 ON v2.id = nc.venta_id
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


--
-- Name: businesses_propagar_licencia(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.businesses_propagar_licencia() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE stores
     SET license_start_date   = NEW.license_start_date,
         license_end_date     = NEW.license_end_date,
         license_warning_days = NEW.license_warning_days
   WHERE business_id = NEW.id
     AND (license_start_date   IS DISTINCT FROM NEW.license_start_date
       OR license_end_date     IS DISTINCT FROM NEW.license_end_date
       OR license_warning_days IS DISTINCT FROM NEW.license_warning_days);
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: citas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.citas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    servicio_id uuid NOT NULL,
    cliente_id uuid NOT NULL,
    mascota_id uuid,
    fecha date NOT NULL,
    hora_inicio time without time zone NOT NULL,
    hora_fin time without time zone NOT NULL,
    duracion_minutos integer NOT NULL,
    estado text DEFAULT 'confirmada'::text NOT NULL,
    notas text,
    motivo_cancelacion text,
    cancelado_at timestamp with time zone,
    cancelado_por text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    encargado_id uuid,
    precio numeric(10,2),
    venta_id uuid,
    CONSTRAINT citas_check CHECK ((hora_inicio < hora_fin)),
    CONSTRAINT citas_estado_check CHECK ((estado = ANY (ARRAY['confirmada'::text, 'cancelada'::text, 'completada'::text, 'no_show'::text]))),
    CONSTRAINT citas_motivo_cancelacion_check CHECK ((char_length(motivo_cancelacion) <= 500)),
    CONSTRAINT citas_notas_check CHECK ((char_length(notas) <= 500))
);


--
-- Name: cancelar_cita_tx(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancelar_cita_tx(p_cita_id uuid, p_store_id uuid, p_motivo text, p_cancelado_por text) RETURNS public.citas
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_cita   citas;
  v_estado TEXT;
BEGIN
  UPDATE citas
     SET estado = 'cancelada',
         motivo_cancelacion = p_motivo,
         cancelado_at = NOW(),
         cancelado_por = p_cancelado_por
   WHERE id = p_cita_id AND store_id = p_store_id
     AND estado NOT IN ('cancelada', 'completada')
  RETURNING * INTO v_cita;

  IF NOT FOUND THEN
    SELECT estado INTO v_estado FROM citas WHERE id = p_cita_id AND store_id = p_store_id;
    IF v_estado IS NULL THEN
      RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'P0002';
    ELSE
      RAISE EXCEPTION 'No se puede cancelar una cita en estado %', v_estado USING ERRCODE = 'PS003';
    END IF;
  END IF;

  RETURN v_cita;
END;
$$;


--
-- Name: cerrar_saco_merma(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cerrar_saco_merma(p_store_id uuid, p_producto_id uuid, p_motivo text, p_user_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
$$;


--
-- Name: canal_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canal_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    canal_id text NOT NULL,
    tipo text NOT NULL,
    canal_orden_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text,
    estado text DEFAULT 'pending'::text NOT NULL,
    intentos integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT canal_outbox_estado_check CHECK ((estado = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'dead'::text]))),
    CONSTRAINT canal_outbox_intentos_check CHECK ((intentos >= 0)),
    CONSTRAINT canal_outbox_tipo_check CHECK ((tipo = ANY (ARRAY['confirm'::text, 'reject'::text, 'ready'::text, 'availability'::text, 'catalog'::text])))
);


--
-- Name: claim_canal_outbox(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_canal_outbox(p_limit integer DEFAULT 20, p_reclamo_vencido_seg integer DEFAULT 300) RETURNS SETOF public.canal_outbox
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Límite inválido para reclamar la outbox: %', p_limit;
  END IF;

  RETURN QUERY
  UPDATE canal_outbox o
     SET estado          = 'processing',
         intentos        = o.intentos + 1,
         updated_at      = NOW()
   WHERE o.id IN (
     SELECT c.id
       FROM canal_outbox c
      WHERE (c.estado = 'pending' AND c.next_attempt_at <= NOW())
         OR (c.estado = 'processing'
             AND c.updated_at < NOW() - make_interval(secs => COALESCE(p_reclamo_vencido_seg, 300)))
      ORDER BY c.next_attempt_at ASC, c.created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o.*;
END;
$$;


--
-- Name: clean_old_audit_logs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clean_old_audit_logs() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '365 days';
  DELETE FROM error_logs WHERE resolved = true AND resolved_at < NOW() - INTERVAL '90 days';
  DELETE FROM user_sessions WHERE created_at < NOW() - INTERVAL '180 days';
END;
$$;


--
-- Name: completar_cita_tx(uuid, uuid, text, text, numeric, jsonb, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.completar_cita_tx(p_cita_id uuid, p_store_id uuid, p_metodo_pago text, p_numero_transaccion text, p_impuesto numeric, p_pago_nc jsonb, p_fidelizacion_niveles jsonb, p_completado_por text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_cita               RECORD;
  v_venta              RECORD;
  v_numero_comprobante TEXT;
  v_metodo_pago_final  TEXT;
  v_monto_nc           NUMERIC;
  v_monto_resto        NUMERIC;
  v_estado             TEXT;
  v_nc_cliente_id      UUID;
  v_saldo_disp         NUMERIC;
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

  IF p_pago_nc IS NOT NULL THEN
    v_monto_nc          := (p_pago_nc->>'monto')::NUMERIC;

    IF v_monto_nc > v_cita.precio THEN
      RAISE EXCEPTION 'El monto de la nota de crédito no puede exceder el total a cobrar' USING ERRCODE = 'PS007';
    END IF;

    v_monto_resto       := ROUND((v_cita.precio - v_monto_nc) * 100) / 100;
    v_metodo_pago_final := CASE WHEN v_monto_nc >= v_cita.precio THEN 'nota_credito' ELSE 'mixto' END;
  ELSE
    v_metodo_pago_final := p_metodo_pago;
  END IF;

  v_numero_comprobante := to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

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

  IF p_pago_nc IS NOT NULL THEN
    INSERT INTO pagos (store_id, venta_id, metodo, monto, nota_credito_id, numero_transaccion)
    VALUES (
      p_store_id, v_venta.id, 'nota_credito',
      v_monto_nc, (p_pago_nc->>'nota_credito_id')::UUID, p_pago_nc->>'numero_nc'
    );

    IF v_monto_resto > 0 THEN
      INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
      VALUES (p_store_id, v_venta.id, p_metodo_pago, v_monto_resto, p_numero_transaccion);
    END IF;

    UPDATE notas_credito
       SET estado = 'usada'
     WHERE id = (p_pago_nc->>'nota_credito_id')::UUID
       AND store_id = p_store_id
       AND estado = 'activa';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La nota de crédito ya no está disponible (fue usada por otra operación)' USING ERRCODE = 'PS006';
    END IF;

    SELECT v2.cliente_id INTO v_nc_cliente_id
      FROM notas_credito nc
      JOIN ventas v2 ON v2.id = nc.venta_id
     WHERE nc.id = (p_pago_nc->>'nota_credito_id')::UUID
       AND nc.venta_id IS NOT NULL;

    IF v_nc_cliente_id IS NOT NULL THEN
      SELECT saldo_disponible INTO v_saldo_disp
        FROM saldos_a_favor
       WHERE cliente_id = v_nc_cliente_id AND store_id = p_store_id;

      IF FOUND THEN
        UPDATE saldos_a_favor
           SET saldo_disponible = GREATEST(0, v_saldo_disp - v_monto_nc),
               updated_at       = NOW()
         WHERE cliente_id = v_nc_cliente_id AND store_id = p_store_id;
      END IF;
    END IF;
  ELSE
    INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
    VALUES (p_store_id, v_venta.id, p_metodo_pago, v_cita.precio, p_numero_transaccion);
  END IF;

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


--
-- Name: consumir_granel(uuid, uuid, uuid, integer, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consumir_granel(p_store_id uuid, p_producto_id uuid, p_venta_item_id uuid, p_gramos integer, p_permitir_abrir boolean, p_user_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
$$;


--
-- Name: convertir_stock_suelto_a_lote(uuid, uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convertir_stock_suelto_a_lote(p_store_id uuid, p_producto_id uuid, p_fecha_vencimiento date, p_fecha_ingreso_max date DEFAULT CURRENT_DATE) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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

  UPDATE productos SET tiene_vencimiento = TRUE
   WHERE id = p_producto_id AND store_id = p_store_id AND tiene_vencimiento IS DISTINCT FROM TRUE;

  RETURN to_jsonb(v_lote);
END;
$$;


--
-- Name: crear_cita_tx(uuid, uuid, uuid, uuid, uuid, date, time without time zone, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crear_cita_tx(p_store_id uuid, p_servicio_id uuid, p_cliente_id uuid, p_mascota_id uuid, p_encargado_id uuid, p_fecha date, p_hora_inicio time without time zone, p_notas text, p_created_by text) RETURNS public.citas
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_duracion       INTEGER;
  v_precio         NUMERIC;
  v_hora_fin       TIME;
  v_dia_semana     INTEGER;
  v_ventana_inicio TIME;
  v_ventana_fin    TIME;
  v_excepcion      RECORD;
  v_cita           citas;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_servicio_id::text || p_fecha::text, 0));
  IF p_encargado_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_encargado_id::text || p_fecha::text, 1));
  END IF;

  SELECT duracion_minutos, precio INTO v_duracion, v_precio
  FROM servicios WHERE id = p_servicio_id AND store_id = p_store_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Servicio no encontrado o inactivo' USING ERRCODE = 'P0002';
  END IF;

  IF v_precio IS NULL THEN
    RAISE EXCEPTION 'El servicio no tiene precio configurado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clientes WHERE id = p_cliente_id AND store_id = p_store_id) THEN
    RAISE EXCEPTION 'Cliente no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF p_mascota_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM mascotas WHERE id = p_mascota_id AND cliente_id = p_cliente_id
  ) THEN
    RAISE EXCEPTION 'La mascota no pertenece al cliente indicado' USING ERRCODE = 'P0002';
  END IF;

  IF p_encargado_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM encargados WHERE id = p_encargado_id AND store_id = p_store_id AND activo = true
  ) THEN
    RAISE EXCEPTION 'Encargado no encontrado o inactivo' USING ERRCODE = 'P0002';
  END IF;

  v_hora_fin := p_hora_inicio + (v_duracion || ' minutes')::INTERVAL;
  v_dia_semana := EXTRACT(ISODOW FROM p_fecha)::INTEGER;

  SELECT * INTO v_excepcion FROM servicio_excepciones
   WHERE servicio_id = p_servicio_id AND store_id = p_store_id AND fecha = p_fecha;

  IF FOUND AND v_excepcion.cerrado THEN
    RAISE EXCEPTION 'El servicio no atiende ese día (excepción/feriado)' USING ERRCODE = 'PS001';
  ELSIF FOUND THEN
    v_ventana_inicio := v_excepcion.hora_inicio;
    v_ventana_fin    := v_excepcion.hora_fin;
  ELSE
    SELECT hora_inicio, hora_fin INTO v_ventana_inicio, v_ventana_fin
    FROM servicio_horarios
    WHERE servicio_id = p_servicio_id AND store_id = p_store_id AND dia_semana = v_dia_semana;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El servicio no atiende ese día de la semana' USING ERRCODE = 'PS001';
    END IF;
  END IF;

  IF p_hora_inicio < v_ventana_inicio OR v_hora_fin > v_ventana_fin THEN
    RAISE EXCEPTION 'El horario solicitado está fuera del rango habilitado' USING ERRCODE = 'PS001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM citas
     WHERE servicio_id = p_servicio_id AND store_id = p_store_id AND fecha = p_fecha
       AND estado != 'cancelada'
       AND hora_inicio < v_hora_fin AND hora_fin > p_hora_inicio
  ) THEN
    RAISE EXCEPTION 'El horario solicitado ya está reservado' USING ERRCODE = 'PS002';
  END IF;

  IF p_encargado_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM citas
     WHERE encargado_id = p_encargado_id AND store_id = p_store_id AND fecha = p_fecha
       AND estado != 'cancelada'
       AND hora_inicio < v_hora_fin AND hora_fin > p_hora_inicio
  ) THEN
    RAISE EXCEPTION 'El encargado ya tiene otra cita en ese horario' USING ERRCODE = 'PS004';
  END IF;

  INSERT INTO citas (store_id, servicio_id, cliente_id, mascota_id, encargado_id, fecha, hora_inicio, hora_fin, duracion_minutos, precio, notas, created_by)
  VALUES (p_store_id, p_servicio_id, p_cliente_id, p_mascota_id, p_encargado_id, p_fecha, p_hora_inicio, v_hora_fin, v_duracion, v_precio, p_notas, p_created_by)
  RETURNING * INTO v_cita;

  RETURN v_cita;
END;
$$;


--
-- Name: crear_nota_credito_tx(uuid, text, uuid, jsonb, text, text, text, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crear_nota_credito_tx(p_store_id uuid, p_user_id text, p_venta_id uuid, p_items jsonb, p_numero_nc text, p_motivo text, p_tipo_reembolso text, p_metodo_reembolso text, p_fecha_vencimiento date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
    estado, fecha_vencimiento
  ) VALUES (
    p_store_id, p_venta_id, p_numero_nc, p_motivo,
    p_tipo_reembolso, p_metodo_reembolso, v_monto_total,
    'activa', p_fecha_vencimiento
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
  IF p_tipo_reembolso = 'saldo_a_favor' AND v_venta.cliente_id IS NOT NULL THEN
    PERFORM incrementar_saldo_a_favor(p_store_id, v_venta.cliente_id, v_monto_total);
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


--
-- Name: crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crear_venta_tx(p_store_id uuid, p_items jsonb, p_cliente_id uuid, p_worker_clerk_id text, p_subtotal numeric, p_descuento_pct numeric, p_impuesto numeric, p_total numeric, p_metodo_pago text, p_canal text, p_procedencia text, p_numero_comprobante text, p_pago_nc jsonb, p_numero_transaccion text, p_fidelizacion_niveles jsonb, p_dias_aviso integer, p_idempotency_key text DEFAULT NULL::text, p_user_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
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
  v_monto_nc           NUMERIC;
  v_monto_resto        NUMERIC;
  v_nc_cliente_id      UUID;
  v_saldo_disp         NUMERIC;
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

  -- ── 1. Determinar método de pago final ────────────────────────────────────
  IF p_pago_nc IS NOT NULL THEN
    v_monto_nc          := (p_pago_nc->>'monto')::NUMERIC;
    v_monto_resto       := ROUND((p_total - v_monto_nc) * 100) / 100;
    v_metodo_pago_final := CASE WHEN v_monto_nc >= p_total THEN 'nota_credito' ELSE 'mixto' END;
  ELSE
    v_metodo_pago_final := p_metodo_pago;
  END IF;

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
          v_fecha_termino  := CURRENT_DATE + v_dias_estimados;

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

  -- ── 4. Registrar pagos ────────────────────────────────────────────────────
  IF p_pago_nc IS NOT NULL THEN
    -- Pago con nota de crédito (puede ser total o parcial)
    INSERT INTO pagos (store_id, venta_id, metodo, monto, nota_credito_id, numero_transaccion)
    VALUES (
      p_store_id, v_venta.id, 'nota_credito',
      v_monto_nc, (p_pago_nc->>'nota_credito_id')::UUID, p_pago_nc->>'numero_nc'
    );

    IF v_monto_resto > 0 THEN
      INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
      VALUES (p_store_id, v_venta.id, p_metodo_pago, v_monto_resto, p_numero_transaccion);
    END IF;

    -- Marcar NC como usada
    UPDATE notas_credito
       SET estado = 'usada'
     WHERE id = (p_pago_nc->>'nota_credito_id')::UUID;

    -- Deducir saldo_a_favor si la NC tiene venta de origen con cliente
    SELECT v2.cliente_id INTO v_nc_cliente_id
      FROM notas_credito nc
      JOIN ventas v2 ON v2.id = nc.venta_id
     WHERE nc.id = (p_pago_nc->>'nota_credito_id')::UUID
       AND nc.venta_id IS NOT NULL;

    IF v_nc_cliente_id IS NOT NULL THEN
      SELECT saldo_disponible INTO v_saldo_disp
        FROM saldos_a_favor
       WHERE cliente_id = v_nc_cliente_id AND store_id = p_store_id;

      IF FOUND THEN
        UPDATE saldos_a_favor
           SET saldo_disponible = GREATEST(0, v_saldo_disp - v_monto_nc),
               updated_at       = NOW()
         WHERE cliente_id = v_nc_cliente_id AND store_id = p_store_id;
      END IF;
    END IF;
  ELSE
    INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
    VALUES (p_store_id, v_venta.id, p_metodo_pago, p_total, p_numero_transaccion);
  END IF;

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


--
-- Name: cupos_canal_tienda(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cupos_canal_tienda(p_store_id uuid) RETURNS TABLE(producto_id uuid, unidades_vendibles integer, cupo integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT p.id,
         unidades_vendibles_canal(p.id),
         GREATEST(0, unidades_vendibles_canal(p.id) - GREATEST(0, COALESCE(p.stock_minimo, 0)))
    FROM productos p
   WHERE p.store_id = p_store_id;
$$;


--
-- Name: decrement_stock(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decrement_stock(p_producto_id uuid, p_cantidad numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
$$;


--
-- Name: deducir_stock_fifo(uuid, uuid, numeric, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deducir_stock_fifo(p_producto_id uuid, p_store_id uuid, p_cantidad numeric, p_venta_item_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_restante         NUMERIC := p_cantidad;
  v_lote             RECORD;
  v_deducir          NUMERIC;
  v_stock_disponible NUMERIC;
  v_resultado        JSONB := '[]'::JSONB;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida para descontar stock: %', p_cantidad;
  END IF;

  -- Bloqueo del producto (tenant-scoped): serializa ventas concurrentes del
  -- mismo producto — la segunda espera y luego ve los lotes ya descontados.
  PERFORM 1 FROM productos
    WHERE id = p_producto_id AND store_id = p_store_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  SELECT COALESCE(SUM(cantidad_actual), 0)
    INTO v_stock_disponible
    FROM lotes_producto
   WHERE producto_id        = p_producto_id
     AND store_id           = p_store_id
     AND activo             = TRUE
     AND cantidad_actual    > 0
     AND fecha_vencimiento >= CURRENT_DATE;

  IF v_stock_disponible < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente: disponible % unidades vigentes, requerido %',
      v_stock_disponible, p_cantidad;
  END IF;

  FOR v_lote IN
    SELECT id, cantidad_actual, fecha_ingreso
      FROM lotes_producto
     WHERE producto_id        = p_producto_id
       AND store_id           = p_store_id
       AND activo             = TRUE
       AND cantidad_actual    > 0
       AND fecha_vencimiento >= CURRENT_DATE
     ORDER BY fecha_ingreso ASC, created_at ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;

    v_deducir := LEAST(v_lote.cantidad_actual, v_restante);

    UPDATE lotes_producto
       SET cantidad_actual = cantidad_actual - v_deducir,
           updated_at      = NOW()
     WHERE id = v_lote.id;

    IF p_venta_item_id IS NOT NULL THEN
      INSERT INTO venta_item_lotes (venta_item_id, lote_id, cantidad)
      VALUES (p_venta_item_id, v_lote.id, v_deducir);
    END IF;

    v_resultado := v_resultado || jsonb_build_array(
      jsonb_build_object(
        'lote_id',           v_lote.id,
        'cantidad_deducida', v_deducir,
        'fecha_ingreso',     v_lote.fecha_ingreso
      )
    );

    v_restante := v_restante - v_deducir;
  END LOOP;

  RETURN v_resultado;
END;
$$;


--
-- Name: deshacer_apertura_saco(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deshacer_apertura_saco(p_store_id uuid, p_producto_id uuid, p_user_id text) RETURNS jsonb
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


--
-- Name: devolver_a_lotes_venta_item(uuid, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.devolver_a_lotes_venta_item(p_venta_item_id uuid, p_ya_devuelto numeric, p_cantidad numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_vil       RECORD;
  v_desde     NUMERIC := GREATEST(COALESCE(p_ya_devuelto, 0), 0);
  v_hasta     NUMERIC := GREATEST(COALESCE(p_ya_devuelto, 0), 0) + COALESCE(p_cantidad, 0);
  v_acumulado NUMERIC := 0;
  v_porcion   NUMERIC;
  v_colocado  NUMERIC := 0;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RETURN 0;
  END IF;

  -- Orden de bloqueo producto → lote, igual que deducir_stock_fifo (el
  -- trigger sync_stock_on_lote actualiza productos al tocar un lote): evita
  -- un deadlock con una venta concurrente del mismo producto.
  PERFORM 1
     FROM productos p
     JOIN venta_items vi ON vi.producto_id = p.id
    WHERE vi.id = p_venta_item_id
      FOR UPDATE OF p;

  FOR v_vil IN
    SELECT vil.lote_id, vil.cantidad
      FROM venta_item_lotes vil
     WHERE vil.venta_item_id = p_venta_item_id
     ORDER BY vil.created_at ASC, vil.id ASC
  LOOP
    v_porcion := LEAST(v_acumulado + v_vil.cantidad, v_hasta) - GREATEST(v_acumulado, v_desde);
    IF v_porcion > 0 THEN
      UPDATE lotes_producto
         SET cantidad_actual = cantidad_actual + v_porcion,
             updated_at      = NOW()
       WHERE id = v_vil.lote_id;
      v_colocado := v_colocado + v_porcion;
    END IF;
    v_acumulado := v_acumulado + v_vil.cantidad;
    EXIT WHEN v_acumulado >= v_hasta;
  END LOOP;

  RETURN v_colocado;
END;
$$;


--
-- Name: devolver_granel(uuid, uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.devolver_granel(p_store_id uuid, p_producto_id uuid, p_gramos integer, p_user_id text) RETURNS numeric
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


--
-- Name: devolver_stock_producto(uuid, uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.devolver_stock_producto(p_producto_id uuid, p_store_id uuid, p_cantidad numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_lote_id UUID;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RETURN;
  END IF;

  PERFORM 1 FROM productos
    WHERE id = p_producto_id AND store_id = p_store_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  SELECT id INTO v_lote_id
    FROM lotes_producto
   WHERE producto_id = p_producto_id
     AND store_id    = p_store_id
     AND activo      = TRUE
   ORDER BY (fecha_vencimiento >= CURRENT_DATE) DESC, fecha_ingreso ASC, created_at ASC, id ASC
   LIMIT 1
   FOR UPDATE;

  IF v_lote_id IS NOT NULL THEN
    UPDATE lotes_producto
       SET cantidad_actual = cantidad_actual + p_cantidad,
           updated_at      = NOW()
     WHERE id = v_lote_id;
  ELSE
    UPDATE productos SET stock = COALESCE(stock, 0) + p_cantidad WHERE id = p_producto_id;
  END IF;
END;
$$;


--
-- Name: encolar_disponibilidad_canal(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.encolar_disponibilidad_canal(p_store_id uuid, p_canal_id text DEFAULT NULL::text, p_producto_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
$$;


--
-- Name: estado_cron_canales(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estado_cron_canales() RETURNS TABLE(jobname text, schedule text, active boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE
    'SELECT j.jobname::text, j.schedule::text, j.active
       FROM cron.job j
      WHERE j.jobname LIKE ''petshop-canales-%''
      ORDER BY j.jobname';
END;
$$;


--
-- Name: estado_disponibilidad_canal(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estado_disponibilidad_canal(p_store_id uuid, p_canal_id text DEFAULT NULL::text, p_producto_id uuid DEFAULT NULL::uuid) RETURNS TABLE(store_id uuid, canal_id text, producto_id uuid, sku text, disponible boolean, cupo integer, ultimo_disponible_publicado boolean, ultima_cantidad_publicada integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
$$;


--
-- Name: fraccion_gramos(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fraccion_gramos(p_gramos integer, p_peso_gramos integer) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN p_gramos IS NULL OR p_peso_gramos IS NULL OR p_peso_gramos <= 0 THEN 0::numeric
    ELSE ROUND(p_gramos::numeric / p_peso_gramos, 3)
  END;
$$;


--
-- Name: fraccion_saco_abierto(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fraccion_saco_abierto(p_producto_id uuid) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE((
    SELECT fraccion_gramos(s.gramos_restantes, p.peso_gramos)
      FROM sacos_abiertos s
      JOIN productos p ON p.id = s.producto_id
     WHERE s.producto_id = p_producto_id
       AND s.cerrado_at IS NULL
  ), 0::numeric);
$$;


--
-- Name: gastar_saldo_a_favor_pago(uuid, uuid, uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gastar_saldo_a_favor_pago(p_store_id uuid, p_cliente_id uuid, p_venta_id uuid, p_monto numeric) RETURNS TABLE(pago_id uuid, saldo_nuevo numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_saldo_nuevo NUMERIC;
  v_pago_id UUID;
BEGIN
  UPDATE saldos_a_favor
     SET saldo_disponible = saldo_disponible - p_monto,
         updated_at = NOW()
   WHERE store_id = p_store_id
     AND cliente_id = p_cliente_id
     AND saldo_disponible >= p_monto
  RETURNING saldo_disponible INTO v_saldo_nuevo;

  IF v_saldo_nuevo IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
  VALUES (p_store_id, p_venta_id, 'saldo_a_favor', p_monto, NULL)
  RETURNING id INTO v_pago_id;

  RETURN QUERY SELECT v_pago_id, v_saldo_nuevo;
END;
$$;


--
-- Name: get_user_store_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_store_id() RETURNS uuid
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  SELECT store_id FROM clerk_users
  WHERE clerk_id = auth.jwt() ->> 'sub'
  LIMIT 1;
$$;


--
-- Name: increment_stock(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_stock(p_producto_id uuid, p_cantidad numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida para incrementar stock: %', p_cantidad;
  END IF;

  PERFORM 1 FROM productos WHERE id = p_producto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  -- Con lotes activos, productos.stock lo recalcula el trigger
  -- sync_stock_on_lote como Σ lotes: sumar aquí se perdería en el próximo
  -- cambio de lote. El llamador debe registrar un lote (registrar_lote) o
  -- devolver a un lote (devolver_stock_producto).
  IF EXISTS (SELECT 1 FROM lotes_producto
              WHERE producto_id = p_producto_id AND activo = TRUE) THEN
    RAISE EXCEPTION 'Producto con lotes activos: el ingreso de stock requiere un lote con fecha de vencimiento (producto=%)',
      p_producto_id;
  END IF;

  UPDATE productos SET stock = COALESCE(stock, 0) + p_cantidad WHERE id = p_producto_id;
END;
$$;


--
-- Name: incrementar_saldo_a_favor(uuid, uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.incrementar_saldo_a_favor(p_store_id uuid, p_cliente_id uuid, p_monto numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_nuevo_saldo NUMERIC;
BEGIN
  INSERT INTO saldos_a_favor (store_id, cliente_id, saldo_disponible, updated_at)
  VALUES (p_store_id, p_cliente_id, p_monto, NOW())
  ON CONFLICT (store_id, cliente_id) DO UPDATE
    SET saldo_disponible = saldos_a_favor.saldo_disponible + EXCLUDED.saldo_disponible,
        updated_at = NOW()
  RETURNING saldo_disponible INTO v_nuevo_saldo;

  RETURN v_nuevo_saldo;
END;
$$;


--
-- Name: is_system_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_system_admin() RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN (auth.jwt() ->> 'public_metadata')::jsonb ->> 'systemAdmin' = 'true';
END;
$$;


--
-- Name: merma_lote_vencido(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merma_lote_vencido(p_store_id uuid, p_lote_id uuid, p_motivo text, p_user_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_producto_id UUID;
  v_lote        lotes_producto%ROWTYPE;
  v_cantidad    NUMERIC;
BEGIN
  SELECT producto_id INTO v_producto_id
    FROM lotes_producto
   WHERE id = p_lote_id AND store_id = p_store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote no encontrado: %', p_lote_id;
  END IF;

  -- Orden de bloqueo producto → lote (igual que deducir_stock_fifo).
  PERFORM 1 FROM productos WHERE id = v_producto_id AND store_id = p_store_id FOR UPDATE;

  SELECT * INTO v_lote
    FROM lotes_producto
   WHERE id = p_lote_id AND store_id = p_store_id
   FOR UPDATE;

  IF NOT v_lote.activo THEN
    RAISE EXCEPTION 'El lote ya está dado de baja';
  END IF;
  IF v_lote.fecha_vencimiento >= CURRENT_DATE THEN
    RAISE EXCEPTION 'El lote no está vencido (vence %)', v_lote.fecha_vencimiento;
  END IF;

  v_cantidad := v_lote.cantidad_actual;

  -- Baja, nunca DELETE: venta_item_lotes conserva la trazabilidad.
  UPDATE lotes_producto
     SET activo     = FALSE,
         notas      = COALESCE(notas || ' | ', '') || 'Baja por vencimiento ' || CURRENT_DATE,
         updated_at = NOW()
   WHERE id = p_lote_id
  RETURNING * INTO v_lote;

  IF v_cantidad > 0 THEN
    INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
    VALUES (
      v_producto_id,
      'merma',
      -v_cantidad,
      p_lote_id,
      'Merma por vencimiento lote ' || COALESCE(v_lote.numero_lote, LEFT(p_lote_id::TEXT, 8))
        || CASE WHEN p_motivo IS NOT NULL AND length(trim(p_motivo)) > 0 THEN ': ' || trim(p_motivo) ELSE '' END,
      p_user_id
    );
  END IF;

  RETURN jsonb_build_object('lote', to_jsonb(v_lote), 'cantidad_baja', v_cantidad);
END;
$$;


--
-- Name: proteger_peso_con_saco_abierto(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proteger_peso_con_saco_abierto() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.peso_gramos IS DISTINCT FROM OLD.peso_gramos
     AND EXISTS (SELECT 1 FROM sacos_abiertos
                  WHERE producto_id = NEW.id AND cerrado_at IS NULL) THEN
    RAISE EXCEPTION 'No se puede cambiar el peso del saco con un saco abierto: registre la merma o termine el saco primero';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: registrar_lote(uuid, uuid, numeric, date, text, numeric, text, date, uuid, text, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_lote(p_store_id uuid, p_producto_id uuid, p_cantidad_inicial numeric, p_fecha_vencimiento date, p_user_id text, p_cantidad_actual numeric DEFAULT NULL::numeric, p_numero_lote text DEFAULT NULL::text, p_fecha_ingreso date DEFAULT NULL::date, p_orden_compra_id uuid DEFAULT NULL::uuid, p_notas text DEFAULT NULL::text, p_fecha_venc_stock_existente date DEFAULT NULL::date, p_movimiento_notas text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_lote_inicial JSONB;
  v_lote         lotes_producto%ROWTYPE;
  v_actual       NUMERIC := COALESCE(p_cantidad_actual, p_cantidad_inicial);
  v_ingreso      DATE    := COALESCE(p_fecha_ingreso, CURRENT_DATE);
BEGIN
  IF p_cantidad_inicial IS NULL OR p_cantidad_inicial <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida para el lote: %', p_cantidad_inicial;
  END IF;
  IF v_actual < 0 OR v_actual > p_cantidad_inicial THEN
    RAISE EXCEPTION 'Cantidad actual inválida para el lote: %', v_actual;
  END IF;
  IF p_fecha_vencimiento IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha de vencimiento del lote';
  END IF;

  -- Bloquea el producto (tenant-scoped) y convierte el stock suelto en
  -- LOTE-0 si corresponde — en la misma transacción que el lote nuevo.
  v_lote_inicial := convertir_stock_suelto_a_lote(
    p_store_id, p_producto_id, p_fecha_venc_stock_existente, v_ingreso
  );

  INSERT INTO lotes_producto (
    store_id, producto_id, numero_lote, cantidad_inicial, cantidad_actual,
    fecha_vencimiento, fecha_ingreso, orden_compra_id, notas
  ) VALUES (
    p_store_id, p_producto_id, p_numero_lote, p_cantidad_inicial, v_actual,
    p_fecha_vencimiento, v_ingreso, p_orden_compra_id, p_notas
  )
  RETURNING * INTO v_lote;
  -- El trigger sync_stock_on_lote deja productos.stock = Σ lotes activos.

  UPDATE productos SET tiene_vencimiento = TRUE
   WHERE id = p_producto_id AND store_id = p_store_id AND tiene_vencimiento IS DISTINCT FROM TRUE;

  -- Movimiento solo de la entrada física (el LOTE-0 no es una entrada).
  IF v_actual > 0 THEN
    INSERT INTO stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
    VALUES (
      p_producto_id,
      'entrada',
      v_actual,
      COALESCE(p_orden_compra_id, v_lote.id),
      COALESCE(p_movimiento_notas, 'Ingreso lote ' || COALESCE(p_numero_lote, LEFT(v_lote.id::TEXT, 8))),
      p_user_id
    );
  END IF;

  RETURN jsonb_build_object('lote', to_jsonb(v_lote), 'lote_inicial', v_lote_inicial);
END;
$$;


--
-- Name: servicio_horarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.servicio_horarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    servicio_id uuid NOT NULL,
    dia_semana integer NOT NULL,
    hora_inicio time without time zone NOT NULL,
    hora_fin time without time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT servicio_horarios_check CHECK ((hora_inicio < hora_fin)),
    CONSTRAINT servicio_horarios_dia_semana_check CHECK (((dia_semana >= 1) AND (dia_semana <= 7)))
);


--
-- Name: replace_servicio_horarios(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_servicio_horarios(p_servicio_id uuid, p_store_id uuid, p_horarios jsonb) RETURNS SETOF public.servicio_horarios
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM servicios WHERE id = p_servicio_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Servicio % no encontrado para la tienda %', p_servicio_id, p_store_id
      USING ERRCODE = 'P0002'; -- la API mapea este código a 404
  END IF;

  DELETE FROM servicio_horarios
  WHERE servicio_id = p_servicio_id AND store_id = p_store_id;

  RETURN QUERY
  INSERT INTO servicio_horarios (store_id, servicio_id, dia_semana, hora_inicio, hora_fin)
  SELECT p_store_id, p_servicio_id,
         (elem->>'dia_semana')::INTEGER,
         (elem->>'hora_inicio')::TIME,
         (elem->>'hora_fin')::TIME
  FROM jsonb_array_elements(p_horarios) AS elem
  RETURNING *;
END;
$$;


--
-- Name: revertir_saldo_a_favor(uuid, uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revertir_saldo_a_favor(p_store_id uuid, p_cliente_id uuid, p_monto numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_nuevo_saldo NUMERIC;
BEGIN
  UPDATE saldos_a_favor
     SET saldo_disponible = GREATEST(0, saldo_disponible - p_monto),
         updated_at = NOW()
   WHERE store_id = p_store_id AND cliente_id = p_cliente_id
  RETURNING saldo_disponible INTO v_nuevo_saldo;

  RETURN v_nuevo_saldo;
END;
$$;


--
-- Name: stores_asignar_negocio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stores_asignar_negocio() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_negocio businesses%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.business_id IS NULL THEN
    INSERT INTO businesses (name, license_start_date, license_end_date, license_warning_days)
    VALUES (NEW.name, NEW.license_start_date, NEW.license_end_date, COALESCE(NEW.license_warning_days, 7))
    RETURNING * INTO v_negocio;
    NEW.business_id := v_negocio.id;
  ELSIF NEW.business_id IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW.business_id IS DISTINCT FROM OLD.business_id) THEN
    SELECT * INTO v_negocio FROM businesses WHERE id = NEW.business_id;
    IF FOUND THEN
      NEW.license_start_date   := v_negocio.license_start_date;
      NEW.license_end_date     := v_negocio.license_end_date;
      NEW.license_warning_days := v_negocio.license_warning_days;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: sync_producto_fecha_vencimiento(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_producto_fecha_vencimiento() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_producto_id UUID := COALESCE(NEW.producto_id, OLD.producto_id);
  v_store_id    UUID := COALESCE(NEW.store_id,    OLD.store_id);
BEGIN
  UPDATE productos
  SET fecha_vencimiento = (
    SELECT MIN(fecha_vencimiento)
    FROM lotes_producto
    WHERE producto_id = v_producto_id
      AND store_id    = v_store_id
      AND activo      = TRUE
      AND cantidad_actual > 0
      AND fecha_vencimiento >= CURRENT_DATE
  )
  WHERE id       = v_producto_id
    AND store_id = v_store_id;
  RETURN NEW;
END;
$$;


--
-- Name: sync_producto_stock_from_lotes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_producto_stock_from_lotes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
$$;


--
-- Name: sync_ventas_historico(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_ventas_historico() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO ventas_historico (store_id, producto_id, fecha, cantidad, revenue, canal)
  SELECT
    v.store_id,
    vi.producto_id,
    DATE(v.created_at) AS fecha,
    SUM(vi.cantidad) AS cantidad,
    SUM(vi.subtotal) AS revenue,
    v.canal
  FROM ventas v
  JOIN venta_items vi ON v.id = vi.venta_id
  WHERE DATE(v.created_at) = CURRENT_DATE - 1
  ON CONFLICT (store_id, producto_id, fecha, canal)
  DO UPDATE SET
    cantidad = EXCLUDED.cantidad,
    revenue = EXCLUDED.revenue;
END;
$$;


--
-- Name: trg_canal_producto_config_disponibilidad(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_canal_producto_config_disponibilidad() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM encolar_disponibilidad_canal(NEW.store_id, NEW.canal_id, NEW.producto_id);
  RETURN NULL;
END;
$$;


--
-- Name: trg_productos_disponibilidad_canal(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_productos_disponibilidad_canal() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM encolar_disponibilidad_canal(NEW.store_id, NULL, NEW.id);
  RETURN NULL;
END;
$$;


--
-- Name: unidades_vendibles_canal(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unidades_vendibles_canal(p_producto_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: ai_pos_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_pos_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    cache_key text NOT NULL,
    recomendaciones jsonb NOT NULL,
    temporada text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_vencimientos_analisis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_vencimientos_analisis (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    modelo_usado text NOT NULL,
    dias_alerta integer DEFAULT 30 NOT NULL,
    productos_analizados integer NOT NULL,
    recomendaciones jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    user_id text NOT NULL,
    action character varying(50) NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id uuid,
    old_values jsonb,
    new_values jsonb,
    change_description text,
    ip_address inet,
    user_agent text,
    result character varying(20) DEFAULT 'success'::character varying,
    error_message text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: auth_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_failures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    ip_address text NOT NULL,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL,
    store_id uuid
);


--
-- Name: businesses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.businesses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    license_start_date date,
    license_end_date date,
    license_warning_days integer DEFAULT 7 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT businesses_license_warning_days_check CHECK ((license_warning_days >= 0)),
    CONSTRAINT businesses_name_check CHECK (((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 100)))
);


--
-- Name: canal_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canal_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    canal_id text NOT NULL,
    external_store_id text,
    credentials jsonb,
    webhook_secret text,
    token text,
    token_expires_at timestamp with time zone,
    comision_pct numeric(5,2) DEFAULT 0 NOT NULL,
    activo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    credenciales_encriptada text,
    credenciales_iv text,
    credenciales_auth_tag text,
    recargo_pct numeric(5,2) DEFAULT 0 NOT NULL,
    menu_estado text,
    menu_detalle text,
    menu_estado_at timestamp with time zone,
    ultimo_evento_at timestamp with time zone,
    ultimo_evento_tipo text,
    CONSTRAINT canal_config_menu_estado_check CHECK (((menu_estado IS NULL) OR (menu_estado = ANY (ARRAY['enviado'::text, 'aprobado'::text, 'rechazado'::text])))),
    CONSTRAINT canal_config_recargo_pct_no_negativo CHECK ((recargo_pct >= (0)::numeric))
);


--
-- Name: canal_liquidaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canal_liquidaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    canal_id text NOT NULL,
    periodo_desde date NOT NULL,
    periodo_hasta date NOT NULL,
    monto_bruto numeric(10,2) NOT NULL,
    comision numeric(10,2) NOT NULL,
    monto_neto numeric(10,2) NOT NULL,
    referencia text,
    journal_entry_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT canal_liquidaciones_montos_check CHECK (((monto_bruto > (0)::numeric) AND (comision >= (0)::numeric) AND (comision <= monto_bruto) AND (monto_neto = (monto_bruto - comision)))),
    CONSTRAINT canal_liquidaciones_periodo_check CHECK ((periodo_desde <= periodo_hasta))
);


--
-- Name: canal_ordenes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canal_ordenes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    canal_id text NOT NULL,
    external_order_id text NOT NULL,
    estado text DEFAULT 'pending'::text NOT NULL,
    payload jsonb NOT NULL,
    venta_id uuid,
    aceptar_antes_de timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    items jsonb NOT NULL,
    total_externo numeric(12,2),
    accepted_at timestamp with time zone,
    rejected_at timestamp with time zone,
    ready_at timestamp with time zone,
    motivo_rechazo text,
    intentos integer DEFAULT 0 NOT NULL,
    ultimo_error text,
    CONSTRAINT canal_ordenes_estado_check CHECK ((estado = ANY (ARRAY['pending'::text, 'processing'::text, 'accepted'::text, 'ready'::text, 'picked_up'::text, 'delivered'::text, 'rejected'::text, 'failed'::text, 'cancelled'::text, 'expired'::text]))),
    CONSTRAINT canal_ordenes_intentos_no_negativo CHECK ((intentos >= 0)),
    CONSTRAINT canal_ordenes_items_es_array CHECK ((jsonb_typeof(items) = 'array'::text))
);


--
-- Name: canal_producto_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canal_producto_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    canal_id text NOT NULL,
    producto_id uuid NOT NULL,
    precio_override numeric(10,2),
    activo boolean DEFAULT true NOT NULL,
    categoria_canal text,
    descripcion_canal text,
    external_product_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    publicado_at timestamp with time zone,
    ultimo_disponible_publicado boolean,
    ultima_cantidad_publicada integer,
    disponibilidad_publicada_at timestamp with time zone,
    CONSTRAINT canal_producto_config_precio_override_check CHECK ((precio_override > (0)::numeric))
);


--
-- Name: canales_externos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canales_externos (
    id text NOT NULL,
    nombre text NOT NULL,
    es_externo boolean DEFAULT true NOT NULL,
    habilitado boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: categorias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categorias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    es_alimento boolean DEFAULT false NOT NULL
);


--
-- Name: cierre_mes_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cierre_mes_backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    periodo text NOT NULL,
    fecha_respaldo timestamp with time zone DEFAULT now() NOT NULL,
    asientos_count integer DEFAULT 0 NOT NULL,
    total_debitos numeric(15,2) DEFAULT 0 NOT NULL,
    total_creditos numeric(15,2) DEFAULT 0 NOT NULL,
    cogs_estimado numeric(15,2) DEFAULT 0 NOT NULL,
    snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    cierre_asiento_id uuid
);


--
-- Name: clerk_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clerk_users (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    clerk_id character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    system_admin boolean DEFAULT false,
    store_admin boolean DEFAULT false,
    store_worker boolean DEFAULT false,
    store_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    is_disabled boolean DEFAULT false NOT NULL,
    nombre character varying(255),
    rut character varying(20),
    meta_ventas numeric,
    business_id uuid,
    business_admin boolean DEFAULT false NOT NULL,
    CONSTRAINT clerk_users_business_admin_requiere_negocio CHECK (((NOT business_admin) OR (business_id IS NOT NULL)))
);


--
-- Name: COLUMN clerk_users.is_disabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clerk_users.is_disabled IS 'Usuario deshabilitado manualmente por systemAdmin vía Clerk ban';


--
-- Name: clientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clientes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    store_id uuid NOT NULL,
    rut character varying(12) NOT NULL,
    nombre character varying(255) NOT NULL,
    email character varying(255),
    telefono character varying(20),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: consumo_alertas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumo_alertas (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    cliente_id uuid NOT NULL,
    mascota_id uuid NOT NULL,
    producto_id uuid NOT NULL,
    fecha_estimada_termino date,
    dias_aviso integer DEFAULT 7,
    enviado boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    store_id uuid
);


--
-- Name: consumo_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumo_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mascota_id uuid NOT NULL,
    cliente_id uuid NOT NULL,
    producto_id uuid NOT NULL,
    gramos_porcion numeric(8,2) NOT NULL,
    veces_dia integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consumo_configs_gramos_porcion_check CHECK ((gramos_porcion > (0)::numeric)),
    CONSTRAINT consumo_configs_veces_dia_check CHECK ((veces_dia > 0))
);


--
-- Name: cuentas_pagar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cuentas_pagar (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    store_id uuid NOT NULL,
    orden_id uuid,
    proveedor_id uuid NOT NULL,
    monto numeric(12,2) NOT NULL,
    fecha_emision date DEFAULT CURRENT_DATE,
    fecha_vencimiento date NOT NULL,
    estado character varying(50) DEFAULT 'pendiente'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    metodo_pago text,
    CONSTRAINT cuentas_pagar_metodo_pago_check CHECK ((metodo_pago = ANY (ARRAY['efectivo'::text, 'debito'::text, 'credito'::text, 'transferencia'::text]))),
    CONSTRAINT cuentas_pagar_monto_check CHECK ((monto > (0)::numeric))
);


--
-- Name: encargados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encargados (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    nombre text NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT encargados_nombre_check CHECK (((char_length(nombre) >= 2) AND (char_length(nombre) <= 100)))
);


--
-- Name: error_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.error_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid,
    user_id text,
    error_code character varying(100),
    error_message text NOT NULL,
    stack_trace text,
    context jsonb,
    severity character varying(20) DEFAULT 'ERROR'::character varying,
    endpoint character varying(200),
    ip_address inet,
    user_agent text,
    resolved boolean DEFAULT false,
    resolved_at timestamp without time zone,
    resolved_by text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: fidelizacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fidelizacion (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    cliente_id uuid NOT NULL,
    total_historico numeric(12,2) DEFAULT 0,
    frecuencia_compras integer DEFAULT 0,
    descuento_actual numeric(5,2) DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: instagram_post_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instagram_post_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    media_url text NOT NULL,
    media_type text DEFAULT 'image'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: instagram_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instagram_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    content_type text NOT NULL,
    caption text,
    image_url text,
    product_tags jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'draft'::text NOT NULL,
    scheduled_for timestamp with time zone,
    published_at timestamp with time zone,
    external_post_id text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instagram_posts_content_type_check CHECK ((content_type = ANY (ARRAY['post'::text, 'story'::text, 'carousel'::text]))),
    CONSTRAINT instagram_posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'published'::text, 'failed'::text])))
);


--
-- Name: journal_detail; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_detail (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    journal_entry_id uuid NOT NULL,
    numero_linea integer NOT NULL,
    cuenta_codigo character varying(20) NOT NULL,
    cuenta_nombre character varying(255) NOT NULL,
    cuenta_tipo character varying(20),
    debito numeric(12,2) DEFAULT 0 NOT NULL,
    credito numeric(12,2) DEFAULT 0 NOT NULL,
    descripcion_linea character varying(255),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    store_id uuid NOT NULL,
    numero_asiento bigint NOT NULL,
    fecha date NOT NULL,
    tipo_movimiento character varying(50),
    referencia_id uuid,
    referencia_numero character varying(50),
    descripcion text NOT NULL,
    total_debito numeric(12,2) DEFAULT 0 NOT NULL,
    total_credito numeric(12,2) DEFAULT 0 NOT NULL,
    esta_balanceado boolean DEFAULT false NOT NULL,
    usuario_id text,
    creado_por character varying(100),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    canal text DEFAULT 'pos'::text
);


--
-- Name: lotes_producto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lotes_producto (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    producto_id uuid NOT NULL,
    numero_lote text,
    cantidad_inicial numeric(10,3) NOT NULL,
    cantidad_actual numeric(10,3) NOT NULL,
    fecha_vencimiento date NOT NULL,
    fecha_ingreso date DEFAULT CURRENT_DATE NOT NULL,
    orden_compra_id uuid,
    notas text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lotes_producto_cantidad_actual_check CHECK ((cantidad_actual >= (0)::numeric)),
    CONSTRAINT lotes_producto_cantidad_inicial_check CHECK ((cantidad_inicial > (0)::numeric))
);


--
-- Name: TABLE lotes_producto; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.lotes_producto IS 'Lotes de productos con fecha de vencimiento individual.
   INSERT aquí (ej. al recibir una OC) actualiza automáticamente
   productos.stock y productos.fecha_vencimiento via triggers.
   Para crear lotes al recibir una OC, usar PATCH /api/ordenes-compra/[id]
   con action="recibir" y lotes=[...] en el body.';


--
-- Name: COLUMN lotes_producto.orden_compra_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lotes_producto.orden_compra_id IS 'Referencia a la orden de compra que originó este lote.
   Útil para trazabilidad: de qué OC proviene cada lote.';


--
-- Name: mascotas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mascotas (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    cliente_id uuid NOT NULL,
    nombre character varying(255) NOT NULL,
    tipo character varying(50),
    raza character varying(255),
    peso_kg numeric(5,2),
    alimento_habitual_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    gramos_porcion numeric(8,2),
    veces_dia integer,
    CONSTRAINT mascotas_gramos_porcion_check CHECK ((gramos_porcion > (0)::numeric)),
    CONSTRAINT mascotas_veces_dia_check CHECK ((veces_dia > 0))
);


--
-- Name: nota_credito_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nota_credito_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    nota_credito_id uuid NOT NULL,
    venta_item_id uuid NOT NULL,
    producto_id uuid,
    cantidad_devuelta numeric(10,3) NOT NULL,
    precio_unitario numeric(10,2) NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    restituir_stock boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    servicio_id uuid,
    CONSTRAINT nc_items_producto_xor_servicio CHECK (((producto_id IS NOT NULL) <> (servicio_id IS NOT NULL)))
);


--
-- Name: notas_credito; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notas_credito (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    store_id uuid NOT NULL,
    venta_id uuid NOT NULL,
    numero_nc character varying(25),
    motivo text,
    tipo_reembolso character varying(30) NOT NULL,
    metodo_reembolso character varying(50),
    monto_total numeric(12,2) NOT NULL,
    estado character varying(30) DEFAULT 'activa'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    fecha_vencimiento date
);


--
-- Name: ordenes_compra; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ordenes_compra (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    store_id uuid NOT NULL,
    proveedor_id uuid NOT NULL,
    numero character varying(20),
    estado character varying(50) DEFAULT 'pendiente'::character varying,
    subtotal numeric(12,2) DEFAULT NULL::numeric,
    impuesto numeric(12,2) DEFAULT NULL::numeric,
    total numeric(12,2) DEFAULT NULL::numeric,
    fecha_estimada date,
    fecha_recibida date,
    notas text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: COLUMN ordenes_compra.total; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ordenes_compra.total IS 'Calculado y persistido al recibir la OC (action=recibir). NULL mientras pendiente/enviada.';


--
-- Name: ordenes_compra_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ordenes_compra_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    orden_id uuid NOT NULL,
    producto_id uuid,
    cantidad_solicitada integer NOT NULL,
    cantidad_recibida integer DEFAULT 0,
    precio_unitario numeric(10,2) DEFAULT NULL::numeric,
    subtotal numeric(12,2) DEFAULT NULL::numeric,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    nombre_nuevo text,
    CONSTRAINT oc_item_tiene_producto CHECK (((producto_id IS NOT NULL) OR ((nombre_nuevo IS NOT NULL) AND (nombre_nuevo <> ''::text))))
);


--
-- Name: pagos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pagos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    venta_id uuid NOT NULL,
    metodo character varying(50) NOT NULL,
    monto numeric(12,2) NOT NULL,
    numero_transaccion character varying(100),
    comprobante character varying(100),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    nota_credito_id uuid
);


--
-- Name: productos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.productos (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    store_id uuid NOT NULL,
    sku character varying(50) NOT NULL,
    nombre character varying(255) NOT NULL,
    marca character varying(255),
    tipo_animal character varying(50),
    peso_gramos integer,
    precio numeric(10,2),
    costo numeric(10,2),
    stock numeric(10,3) DEFAULT 0,
    stock_minimo integer DEFAULT 5,
    activo boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    fecha_vencimiento date,
    dias_alerta_expira integer DEFAULT 30,
    precio_oferta numeric(10,2),
    en_oferta boolean DEFAULT false,
    categoria_id uuid,
    codigo_barra character varying(100),
    demanda_promedio_diaria numeric(10,2) DEFAULT 0,
    dias_seguridad integer DEFAULT 7,
    tendencia_ventas character varying(20) DEFAULT 'estable'::character varying,
    ultimo_consumo timestamp with time zone,
    tiene_vencimiento boolean DEFAULT false NOT NULL,
    imagen_url text,
    precio_venta_kg numeric(10,2) DEFAULT NULL::numeric,
    imagen_url_2 text,
    CONSTRAINT productos_granel_requiere_peso CHECK (((precio_venta_kg IS NULL) OR ((peso_gramos IS NOT NULL) AND (peso_gramos > 0)))),
    CONSTRAINT productos_precio_venta_kg_check CHECK (((precio_venta_kg > (0)::numeric) OR (precio_venta_kg IS NULL))),
    CONSTRAINT productos_stock_no_negativo CHECK ((stock >= (0)::numeric))
);


--
-- Name: COLUMN productos.tiene_vencimiento; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.productos.tiene_vencimiento IS 'Si TRUE, este producto requiere fecha_vencimiento al recibir cualquier OC.
   Se activa automáticamente la primera vez que se recibe con fecha_vencimiento.';


--
-- Name: COLUMN productos.precio_venta_kg; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.productos.precio_venta_kg IS 'Si es mayor a 0, el producto puede venderse a granel. Precio por 1 kg (con IVA).';


--
-- Name: proveedor_productos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proveedor_productos (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    proveedor_id uuid NOT NULL,
    producto_id uuid NOT NULL,
    costo numeric(10,2),
    tiempo_entrega_dias integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: proveedores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proveedores (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    store_id uuid NOT NULL,
    nombre character varying(255) NOT NULL,
    rut character varying(12),
    contacto character varying(255),
    telefono character varying(20),
    email character varying(255),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: sacos_abiertos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sacos_abiertos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    producto_id uuid NOT NULL,
    lote_id uuid,
    origen text DEFAULT 'apertura'::text NOT NULL,
    gramos_iniciales integer NOT NULL,
    gramos_restantes integer NOT NULL,
    abierto_at timestamp with time zone DEFAULT now() NOT NULL,
    abierto_por text,
    cerrado_at timestamp with time zone,
    cerrado_por text,
    motivo_cierre text,
    gramos_merma integer,
    nota text,
    CONSTRAINT sacos_abiertos_cierre_coherente CHECK (((cerrado_at IS NULL) = (motivo_cierre IS NULL))),
    CONSTRAINT sacos_abiertos_gramos_iniciales_check CHECK ((gramos_iniciales > 0)),
    CONSTRAINT sacos_abiertos_gramos_merma_check CHECK (((gramos_merma IS NULL) OR (gramos_merma >= 0))),
    CONSTRAINT sacos_abiertos_gramos_restantes_check CHECK ((gramos_restantes >= 0)),
    CONSTRAINT sacos_abiertos_motivo_cierre_check CHECK (((motivo_cierre IS NULL) OR (motivo_cierre = ANY (ARRAY['agotado'::text, 'merma'::text, 'deshecho'::text, 'conteo'::text])))),
    CONSTRAINT sacos_abiertos_origen_check CHECK ((origen = ANY (ARRAY['apertura'::text, 'devolucion'::text, 'conteo'::text])))
);


--
-- Name: saldos_a_favor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saldos_a_favor (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    store_id uuid NOT NULL,
    cliente_id uuid NOT NULL,
    saldo_disponible numeric(12,2) DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: servicio_excepciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.servicio_excepciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    servicio_id uuid NOT NULL,
    fecha date NOT NULL,
    cerrado boolean DEFAULT true NOT NULL,
    hora_inicio time without time zone,
    hora_fin time without time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT servicio_excepciones_check CHECK ((((cerrado = true) AND (hora_inicio IS NULL) AND (hora_fin IS NULL)) OR ((cerrado = false) AND (hora_inicio IS NOT NULL) AND (hora_fin IS NOT NULL) AND (hora_inicio < hora_fin))))
);


--
-- Name: servicios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.servicios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    nombre text NOT NULL,
    descripcion text,
    duracion_minutos integer NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    precio numeric(10,2),
    CONSTRAINT servicios_descripcion_check CHECK ((char_length(descripcion) <= 500)),
    CONSTRAINT servicios_duracion_minutos_check CHECK ((duracion_minutos = ANY (ARRAY[30, 60, 90]))),
    CONSTRAINT servicios_nombre_check CHECK (((char_length(nombre) >= 2) AND (char_length(nombre) <= 100))),
    CONSTRAINT servicios_precio_check CHECK (((precio IS NULL) OR (precio > (0)::numeric)))
);


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movements (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    producto_id uuid NOT NULL,
    tipo character varying(50),
    cantidad numeric(10,3) NOT NULL,
    referencia_id uuid,
    notas text,
    created_at timestamp without time zone DEFAULT now(),
    user_id text
);


--
-- Name: stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stores (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    rut character varying(12),
    address character varying(500),
    phone character varying(20),
    email character varying(255),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    whatsapp_enabled boolean DEFAULT false,
    whatsapp_phone_number_id character varying,
    whatsapp_access_token character varying,
    whatsapp_webhook_verify_token character varying,
    email_reminder_enabled boolean DEFAULT false NOT NULL,
    email_reminder_dias_aviso integer DEFAULT 5 NOT NULL,
    resend_from_email text,
    license_start_date date,
    license_end_date date,
    license_warning_days integer DEFAULT 7 NOT NULL,
    fidelizacion_niveles jsonb DEFAULT '[{"monto": 50000, "descuento": 5}, {"monto": 150000, "descuento": 10}, {"monto": 300000, "descuento": 20}]'::jsonb,
    openrouter_model text DEFAULT 'z-ai/glm-4.5-air:free'::text,
    ciudad text DEFAULT 'Santiago'::text,
    lat double precision,
    lon double precision,
    direccion text,
    business_id uuid NOT NULL
);


--
-- Name: COLUMN stores.license_start_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stores.license_start_date IS 'Fecha de inicio del período de licencia';


--
-- Name: COLUMN stores.license_end_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stores.license_end_date IS 'Fecha de fin. Si hoy > este valor el middleware bloquea acceso';


--
-- Name: COLUMN stores.license_warning_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stores.license_warning_days IS 'Días antes de license_end_date para mostrar banner de aviso';


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid,
    user_id text NOT NULL,
    clerk_session_id text,
    event_type character varying(30) NOT NULL,
    ip_address inet,
    user_agent text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: venta_item_lotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venta_item_lotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    venta_item_id uuid NOT NULL,
    lote_id uuid NOT NULL,
    cantidad numeric(10,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT venta_item_lotes_cantidad_check CHECK ((cantidad > (0)::numeric))
);


--
-- Name: venta_item_sacos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venta_item_sacos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    venta_item_id uuid NOT NULL,
    saco_id uuid NOT NULL,
    gramos integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT venta_item_sacos_gramos_check CHECK ((gramos > 0))
);


--
-- Name: venta_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venta_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    venta_id uuid NOT NULL,
    producto_id uuid,
    mascota_id uuid,
    cantidad numeric(10,3) NOT NULL,
    precio_unitario numeric(10,2) NOT NULL,
    descuento numeric(10,2) DEFAULT 0,
    subtotal numeric(12,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    servicio_id uuid,
    es_granel boolean DEFAULT false NOT NULL,
    gramos integer,
    CONSTRAINT venta_items_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT venta_items_granel_gramos CHECK (((es_granel AND (gramos IS NOT NULL) AND (gramos > 0)) OR ((NOT es_granel) AND (gramos IS NULL)))),
    CONSTRAINT venta_items_producto_xor_servicio CHECK (((producto_id IS NOT NULL) <> (servicio_id IS NOT NULL)))
);


--
-- Name: ventas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ventas (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    store_id uuid NOT NULL,
    cliente_id uuid,
    mascota_id uuid,
    numero_comprobante character varying(20),
    subtotal numeric(12,2),
    impuesto numeric(12,2),
    descuento numeric(12,2) DEFAULT 0,
    total numeric(12,2) NOT NULL,
    metodo_pago character varying(50),
    estado character varying(50) DEFAULT 'completada'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    canal text DEFAULT 'pos'::text NOT NULL,
    procedencia text DEFAULT 'presencial'::text NOT NULL,
    worker_clerk_id character varying(255),
    idempotency_key text,
    CONSTRAINT ventas_procedencia_check CHECK ((procedencia = ANY (ARRAY['presencial'::text, 'instagram'::text, 'whatsapp'::text, 'facebook'::text, 'tiktok'::text, 'telefonico'::text, 'rappi'::text, 'pedidosya'::text, 'ubereats'::text])))
);


--
-- Name: ventas_historico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ventas_historico (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    producto_id uuid NOT NULL,
    fecha date NOT NULL,
    cantidad integer DEFAULT 0 NOT NULL,
    revenue numeric(12,2) DEFAULT 0,
    canal character varying(50),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ai_pos_cache ai_pos_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_pos_cache
    ADD CONSTRAINT ai_pos_cache_pkey PRIMARY KEY (id);


--
-- Name: ai_pos_cache ai_pos_cache_store_id_cache_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_pos_cache
    ADD CONSTRAINT ai_pos_cache_store_id_cache_key_key UNIQUE (store_id, cache_key);


--
-- Name: ai_vencimientos_analisis ai_vencimientos_analisis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_vencimientos_analisis
    ADD CONSTRAINT ai_vencimientos_analisis_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: auth_failures auth_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_failures
    ADD CONSTRAINT auth_failures_pkey PRIMARY KEY (id);


--
-- Name: businesses businesses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_pkey PRIMARY KEY (id);


--
-- Name: canal_config canal_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_config
    ADD CONSTRAINT canal_config_pkey PRIMARY KEY (id);


--
-- Name: canal_config canal_config_store_id_canal_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_config
    ADD CONSTRAINT canal_config_store_id_canal_id_key UNIQUE (store_id, canal_id);


--
-- Name: canal_liquidaciones canal_liquidaciones_periodo_unico; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_liquidaciones
    ADD CONSTRAINT canal_liquidaciones_periodo_unico UNIQUE (store_id, canal_id, periodo_desde, periodo_hasta);


--
-- Name: canal_liquidaciones canal_liquidaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_liquidaciones
    ADD CONSTRAINT canal_liquidaciones_pkey PRIMARY KEY (id);


--
-- Name: canal_ordenes canal_ordenes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_ordenes
    ADD CONSTRAINT canal_ordenes_pkey PRIMARY KEY (id);


--
-- Name: canal_ordenes canal_ordenes_store_canal_external_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_ordenes
    ADD CONSTRAINT canal_ordenes_store_canal_external_key UNIQUE (store_id, canal_id, external_order_id);


--
-- Name: canal_outbox canal_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_outbox
    ADD CONSTRAINT canal_outbox_pkey PRIMARY KEY (id);


--
-- Name: canal_producto_config canal_producto_config_canal_id_producto_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_producto_config
    ADD CONSTRAINT canal_producto_config_canal_id_producto_id_key UNIQUE (canal_id, producto_id);


--
-- Name: canal_producto_config canal_producto_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_producto_config
    ADD CONSTRAINT canal_producto_config_pkey PRIMARY KEY (id);


--
-- Name: canales_externos canales_externos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canales_externos
    ADD CONSTRAINT canales_externos_pkey PRIMARY KEY (id);


--
-- Name: categorias categorias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_pkey PRIMARY KEY (id);


--
-- Name: categorias categorias_store_id_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_store_id_nombre_key UNIQUE (store_id, nombre);


--
-- Name: cierre_mes_backups cierre_mes_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cierre_mes_backups
    ADD CONSTRAINT cierre_mes_backups_pkey PRIMARY KEY (id);


--
-- Name: citas citas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.citas
    ADD CONSTRAINT citas_pkey PRIMARY KEY (id);


--
-- Name: clerk_users clerk_users_clerk_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clerk_users
    ADD CONSTRAINT clerk_users_clerk_id_key UNIQUE (clerk_id);


--
-- Name: clerk_users clerk_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clerk_users
    ADD CONSTRAINT clerk_users_pkey PRIMARY KEY (id);


--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- Name: clientes clientes_store_id_rut_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_store_id_rut_key UNIQUE (store_id, rut);


--
-- Name: consumo_alertas consumo_alertas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_alertas
    ADD CONSTRAINT consumo_alertas_pkey PRIMARY KEY (id);


--
-- Name: consumo_configs consumo_configs_mascota_id_producto_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_configs
    ADD CONSTRAINT consumo_configs_mascota_id_producto_id_key UNIQUE (mascota_id, producto_id);


--
-- Name: consumo_configs consumo_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_configs
    ADD CONSTRAINT consumo_configs_pkey PRIMARY KEY (id);


--
-- Name: cuentas_pagar cuentas_pagar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_pagar
    ADD CONSTRAINT cuentas_pagar_pkey PRIMARY KEY (id);


--
-- Name: encargados encargados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encargados
    ADD CONSTRAINT encargados_pkey PRIMARY KEY (id);


--
-- Name: encargados encargados_store_id_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encargados
    ADD CONSTRAINT encargados_store_id_nombre_key UNIQUE (store_id, nombre);


--
-- Name: error_logs error_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_pkey PRIMARY KEY (id);


--
-- Name: fidelizacion fidelizacion_cliente_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fidelizacion
    ADD CONSTRAINT fidelizacion_cliente_id_key UNIQUE (cliente_id);


--
-- Name: fidelizacion fidelizacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fidelizacion
    ADD CONSTRAINT fidelizacion_pkey PRIMARY KEY (id);


--
-- Name: instagram_post_media instagram_post_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram_post_media
    ADD CONSTRAINT instagram_post_media_pkey PRIMARY KEY (id);


--
-- Name: instagram_posts instagram_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram_posts
    ADD CONSTRAINT instagram_posts_pkey PRIMARY KEY (id);


--
-- Name: journal_detail journal_detail_journal_entry_id_numero_linea_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_detail
    ADD CONSTRAINT journal_detail_journal_entry_id_numero_linea_key UNIQUE (journal_entry_id, numero_linea);


--
-- Name: journal_detail journal_detail_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_detail
    ADD CONSTRAINT journal_detail_pkey PRIMARY KEY (id);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: journal_entries journal_entries_store_id_numero_asiento_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_store_id_numero_asiento_key UNIQUE (store_id, numero_asiento);


--
-- Name: lotes_producto lotes_producto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_producto
    ADD CONSTRAINT lotes_producto_pkey PRIMARY KEY (id);


--
-- Name: mascotas mascotas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mascotas
    ADD CONSTRAINT mascotas_pkey PRIMARY KEY (id);


--
-- Name: nota_credito_items nota_credito_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_credito_items
    ADD CONSTRAINT nota_credito_items_pkey PRIMARY KEY (id);


--
-- Name: notas_credito notas_credito_numero_nc_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_credito
    ADD CONSTRAINT notas_credito_numero_nc_key UNIQUE (numero_nc);


--
-- Name: notas_credito notas_credito_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_credito
    ADD CONSTRAINT notas_credito_pkey PRIMARY KEY (id);


--
-- Name: ordenes_compra_items ordenes_compra_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordenes_compra_items
    ADD CONSTRAINT ordenes_compra_items_pkey PRIMARY KEY (id);


--
-- Name: ordenes_compra ordenes_compra_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_pkey PRIMARY KEY (id);


--
-- Name: pagos pagos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_pkey PRIMARY KEY (id);


--
-- Name: productos productos_codigo_barra_store_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_codigo_barra_store_unique UNIQUE (store_id, codigo_barra);


--
-- Name: productos productos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_pkey PRIMARY KEY (id);


--
-- Name: productos productos_store_id_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_store_id_sku_key UNIQUE (store_id, sku);


--
-- Name: proveedor_productos proveedor_productos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor_productos
    ADD CONSTRAINT proveedor_productos_pkey PRIMARY KEY (id);


--
-- Name: proveedor_productos proveedor_productos_proveedor_id_producto_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor_productos
    ADD CONSTRAINT proveedor_productos_proveedor_id_producto_id_key UNIQUE (proveedor_id, producto_id);


--
-- Name: proveedores proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);


--
-- Name: sacos_abiertos sacos_abiertos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sacos_abiertos
    ADD CONSTRAINT sacos_abiertos_pkey PRIMARY KEY (id);


--
-- Name: saldos_a_favor saldos_a_favor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saldos_a_favor
    ADD CONSTRAINT saldos_a_favor_pkey PRIMARY KEY (id);


--
-- Name: saldos_a_favor saldos_a_favor_store_id_cliente_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saldos_a_favor
    ADD CONSTRAINT saldos_a_favor_store_id_cliente_id_key UNIQUE (store_id, cliente_id);


--
-- Name: servicio_excepciones servicio_excepciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicio_excepciones
    ADD CONSTRAINT servicio_excepciones_pkey PRIMARY KEY (id);


--
-- Name: servicio_excepciones servicio_excepciones_servicio_id_fecha_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicio_excepciones
    ADD CONSTRAINT servicio_excepciones_servicio_id_fecha_key UNIQUE (servicio_id, fecha);


--
-- Name: servicio_horarios servicio_horarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicio_horarios
    ADD CONSTRAINT servicio_horarios_pkey PRIMARY KEY (id);


--
-- Name: servicio_horarios servicio_horarios_servicio_id_dia_semana_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicio_horarios
    ADD CONSTRAINT servicio_horarios_servicio_id_dia_semana_key UNIQUE (servicio_id, dia_semana);


--
-- Name: servicios servicios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_pkey PRIMARY KEY (id);


--
-- Name: servicios servicios_store_id_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_store_id_nombre_key UNIQUE (store_id, nombre);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: stores stores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);


--
-- Name: stores stores_rut_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_rut_key UNIQUE (rut);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: venta_item_lotes venta_item_lotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_item_lotes
    ADD CONSTRAINT venta_item_lotes_pkey PRIMARY KEY (id);


--
-- Name: venta_item_sacos venta_item_sacos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_item_sacos
    ADD CONSTRAINT venta_item_sacos_pkey PRIMARY KEY (id);


--
-- Name: venta_items venta_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_items
    ADD CONSTRAINT venta_items_pkey PRIMARY KEY (id);


--
-- Name: ventas_historico ventas_historico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas_historico
    ADD CONSTRAINT ventas_historico_pkey PRIMARY KEY (id);


--
-- Name: ventas_historico ventas_historico_store_id_producto_id_fecha_canal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas_historico
    ADD CONSTRAINT ventas_historico_store_id_producto_id_fecha_canal_key UNIQUE (store_id, producto_id, fecha, canal);


--
-- Name: ventas ventas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_pkey PRIMARY KEY (id);


--
-- Name: canal_outbox_dedupe_vivo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX canal_outbox_dedupe_vivo ON public.canal_outbox USING btree (dedupe_key) WHERE ((dedupe_key IS NOT NULL) AND (estado = ANY (ARRAY['pending'::text, 'processing'::text])));


--
-- Name: canal_outbox_pendientes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX canal_outbox_pendientes ON public.canal_outbox USING btree (estado, next_attempt_at);


--
-- Name: canal_outbox_store_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX canal_outbox_store_created ON public.canal_outbox USING btree (store_id, created_at DESC);


--
-- Name: idx_ai_pos_cache_store_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_pos_cache_store_key ON public.ai_pos_cache USING btree (store_id, cache_key);


--
-- Name: idx_ai_vencimientos_store_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_vencimientos_store_created ON public.ai_vencimientos_analisis USING btree (store_id, created_at DESC);


--
-- Name: idx_audit_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_action ON public.audit_logs USING btree (action, created_at DESC);


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_entity ON public.audit_logs USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: idx_audit_store_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_store_time ON public.audit_logs USING btree (store_id, created_at DESC);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.audit_logs USING btree (user_id, created_at DESC);


--
-- Name: idx_auth_failures_attempted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_failures_attempted_at ON public.auth_failures USING btree (attempted_at);


--
-- Name: idx_auth_failures_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_failures_ip ON public.auth_failures USING btree (ip_address);


--
-- Name: idx_auth_failures_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_failures_store ON public.auth_failures USING btree (store_id);


--
-- Name: idx_canal_ordenes_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canal_ordenes_expiry ON public.canal_ordenes USING btree (aceptar_antes_de) WHERE (estado = 'pending'::text);


--
-- Name: idx_canal_ordenes_store_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canal_ordenes_store_estado ON public.canal_ordenes USING btree (store_id, estado, created_at DESC);


--
-- Name: idx_canal_producto_config_producto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canal_producto_config_producto ON public.canal_producto_config USING btree (producto_id);


--
-- Name: idx_canal_producto_config_store_canal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canal_producto_config_store_canal ON public.canal_producto_config USING btree (store_id, canal_id);


--
-- Name: idx_categorias_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categorias_store_id ON public.categorias USING btree (store_id);


--
-- Name: idx_cierre_mes_backups_store_periodo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cierre_mes_backups_store_periodo ON public.cierre_mes_backups USING btree (store_id, periodo);


--
-- Name: idx_citas_cliente_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_citas_cliente_id ON public.citas USING btree (cliente_id);


--
-- Name: idx_citas_encargado_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_citas_encargado_id ON public.citas USING btree (encargado_id);


--
-- Name: idx_citas_servicio_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_citas_servicio_fecha ON public.citas USING btree (servicio_id, fecha);


--
-- Name: idx_citas_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_citas_store_id ON public.citas USING btree (store_id);


--
-- Name: idx_citas_venta_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_citas_venta_id ON public.citas USING btree (venta_id);


--
-- Name: idx_clerk_users_business_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clerk_users_business_id ON public.clerk_users USING btree (business_id);


--
-- Name: idx_clerk_users_clerk_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clerk_users_clerk_id ON public.clerk_users USING btree (clerk_id);


--
-- Name: idx_clerk_users_is_disabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clerk_users_is_disabled ON public.clerk_users USING btree (store_id, is_disabled);


--
-- Name: idx_clerk_users_nombre; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clerk_users_nombre ON public.clerk_users USING btree (store_id, nombre);


--
-- Name: idx_clerk_users_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clerk_users_store_id ON public.clerk_users USING btree (store_id);


--
-- Name: idx_clientes_rut; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clientes_rut ON public.clientes USING btree (rut);


--
-- Name: idx_clientes_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clientes_store_id ON public.clientes USING btree (store_id);


--
-- Name: idx_consumo_alertas_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumo_alertas_store_id ON public.consumo_alertas USING btree (store_id);


--
-- Name: idx_consumo_configs_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumo_configs_cliente ON public.consumo_configs USING btree (cliente_id);


--
-- Name: idx_cuentas_pagar_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cuentas_pagar_store_id ON public.cuentas_pagar USING btree (store_id);


--
-- Name: idx_encargados_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_encargados_store_id ON public.encargados USING btree (store_id);


--
-- Name: idx_error_logs_endpoint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_endpoint ON public.error_logs USING btree (endpoint, created_at DESC);


--
-- Name: idx_error_logs_resolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_resolved ON public.error_logs USING btree (resolved, created_at DESC);


--
-- Name: idx_error_logs_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_severity ON public.error_logs USING btree (severity, created_at DESC);


--
-- Name: idx_error_logs_store_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_store_time ON public.error_logs USING btree (store_id, created_at DESC);


--
-- Name: idx_fidelizacion_cliente_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fidelizacion_cliente_id ON public.fidelizacion USING btree (cliente_id);


--
-- Name: idx_instagram_post_media_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instagram_post_media_post ON public.instagram_post_media USING btree (post_id);


--
-- Name: idx_instagram_posts_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instagram_posts_scheduled ON public.instagram_posts USING btree (scheduled_for) WHERE (status = 'scheduled'::text);


--
-- Name: idx_instagram_posts_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instagram_posts_store ON public.instagram_posts USING btree (store_id, status);


--
-- Name: idx_instagram_posts_store_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instagram_posts_store_status ON public.instagram_posts USING btree (store_id, status);


--
-- Name: idx_journal_detail_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_detail_cuenta ON public.journal_detail USING btree (cuenta_codigo);


--
-- Name: idx_journal_detail_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_detail_entry ON public.journal_detail USING btree (journal_entry_id);


--
-- Name: idx_journal_entries_cierre_mes_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_journal_entries_cierre_mes_unique ON public.journal_entries USING btree (store_id, referencia_numero) WHERE ((tipo_movimiento)::text = 'CIERRE_MES'::text);


--
-- Name: idx_journal_entries_referencia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_referencia ON public.journal_entries USING btree (store_id, referencia_id);


--
-- Name: idx_journal_entries_store_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_store_fecha ON public.journal_entries USING btree (store_id, fecha DESC);


--
-- Name: idx_journal_entries_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_tipo ON public.journal_entries USING btree (store_id, tipo_movimiento);


--
-- Name: idx_lotes_fifo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_fifo ON public.lotes_producto USING btree (producto_id, store_id, fecha_ingreso, created_at) WHERE ((activo = true) AND (cantidad_actual > (0)::numeric));


--
-- Name: idx_lotes_producto_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_producto_id ON public.lotes_producto USING btree (producto_id);


--
-- Name: idx_lotes_producto_orden_compra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_producto_orden_compra ON public.lotes_producto USING btree (orden_compra_id) WHERE (orden_compra_id IS NOT NULL);


--
-- Name: idx_lotes_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_store_id ON public.lotes_producto USING btree (store_id);


--
-- Name: idx_lotes_vencimiento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_vencimiento ON public.lotes_producto USING btree (fecha_vencimiento) WHERE ((activo = true) AND (cantidad_actual > (0)::numeric));


--
-- Name: idx_mascotas_cliente_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mascotas_cliente_id ON public.mascotas USING btree (cliente_id);


--
-- Name: idx_mascotas_unique_name_per_client; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mascotas_unique_name_per_client ON public.mascotas USING btree (cliente_id, lower((nombre)::text));


--
-- Name: idx_nota_credito_items_nc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nota_credito_items_nc ON public.nota_credito_items USING btree (nota_credito_id);


--
-- Name: idx_notas_credito_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_credito_cliente ON public.notas_credito USING btree (store_id) WHERE ((estado)::text = 'activa'::text);


--
-- Name: idx_notas_credito_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_credito_store ON public.notas_credito USING btree (store_id);


--
-- Name: idx_notas_credito_venta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_credito_venta ON public.notas_credito USING btree (venta_id);


--
-- Name: idx_ordenes_compra_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ordenes_compra_store_id ON public.ordenes_compra USING btree (store_id);


--
-- Name: idx_pagos_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_created_at ON public.pagos USING btree (created_at);


--
-- Name: idx_pagos_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_store_id ON public.pagos USING btree (store_id);


--
-- Name: idx_pagos_venta_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_venta_id ON public.pagos USING btree (venta_id);


--
-- Name: idx_productos_categoria_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productos_categoria_id ON public.productos USING btree (categoria_id);


--
-- Name: idx_productos_codigo_barra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productos_codigo_barra ON public.productos USING btree (store_id, codigo_barra) WHERE (codigo_barra IS NOT NULL);


--
-- Name: idx_productos_nombre; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productos_nombre ON public.productos USING gin (to_tsvector('spanish'::regconfig, (nombre)::text));


--
-- Name: idx_productos_reorder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productos_reorder ON public.productos USING btree (store_id, demanda_promedio_diaria, stock) WHERE (activo = true);


--
-- Name: idx_productos_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productos_sku ON public.productos USING btree (sku);


--
-- Name: idx_productos_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productos_store_id ON public.productos USING btree (store_id);


--
-- Name: idx_productos_vencimiento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productos_vencimiento ON public.productos USING btree (fecha_vencimiento) WHERE ((fecha_vencimiento IS NOT NULL) AND (activo = true));


--
-- Name: idx_saldos_a_favor_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saldos_a_favor_cliente ON public.saldos_a_favor USING btree (cliente_id, store_id);


--
-- Name: idx_servicio_excepciones_servicio_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicio_excepciones_servicio_fecha ON public.servicio_excepciones USING btree (servicio_id, fecha);


--
-- Name: idx_servicio_excepciones_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicio_excepciones_store_id ON public.servicio_excepciones USING btree (store_id);


--
-- Name: idx_servicio_horarios_servicio_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicio_horarios_servicio_id ON public.servicio_horarios USING btree (servicio_id);


--
-- Name: idx_servicio_horarios_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicio_horarios_store_id ON public.servicio_horarios USING btree (store_id);


--
-- Name: idx_servicios_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_store_id ON public.servicios USING btree (store_id);


--
-- Name: idx_stock_movements_producto_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_producto_id ON public.stock_movements USING btree (producto_id);


--
-- Name: idx_stores_business_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stores_business_id ON public.stores USING btree (business_id);


--
-- Name: idx_user_sessions_store_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_store_time ON public.user_sessions USING btree (store_id, created_at DESC);


--
-- Name: idx_user_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_user ON public.user_sessions USING btree (user_id, created_at DESC);


--
-- Name: idx_venta_item_lotes_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venta_item_lotes_item ON public.venta_item_lotes USING btree (venta_item_id);


--
-- Name: idx_venta_item_lotes_lote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venta_item_lotes_lote ON public.venta_item_lotes USING btree (lote_id);


--
-- Name: idx_venta_items_venta_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venta_items_venta_id ON public.venta_items USING btree (venta_id);


--
-- Name: idx_ventas_canal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ventas_canal ON public.ventas USING btree (store_id, canal, created_at DESC);


--
-- Name: idx_ventas_cliente_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ventas_cliente_id ON public.ventas USING btree (cliente_id);


--
-- Name: idx_ventas_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ventas_created_at ON public.ventas USING btree (created_at);


--
-- Name: idx_ventas_historico_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ventas_historico_fecha ON public.ventas_historico USING btree (store_id, fecha);


--
-- Name: idx_ventas_historico_producto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ventas_historico_producto ON public.ventas_historico USING btree (producto_id, fecha);


--
-- Name: idx_ventas_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ventas_store_id ON public.ventas USING btree (store_id);


--
-- Name: idx_ventas_worker_clerk_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ventas_worker_clerk_id ON public.ventas USING btree (store_id, worker_clerk_id);


--
-- Name: idx_ventas_worker_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ventas_worker_date ON public.ventas USING btree (store_id, worker_clerk_id, created_at);


--
-- Name: sacos_abiertos_store_producto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sacos_abiertos_store_producto ON public.sacos_abiertos USING btree (store_id, producto_id);


--
-- Name: sacos_abiertos_uno_abierto_por_producto; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sacos_abiertos_uno_abierto_por_producto ON public.sacos_abiertos USING btree (producto_id) WHERE (cerrado_at IS NULL);


--
-- Name: venta_item_sacos_saco; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX venta_item_sacos_saco ON public.venta_item_sacos USING btree (saco_id);


--
-- Name: venta_item_sacos_venta_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX venta_item_sacos_venta_item ON public.venta_item_sacos USING btree (venta_item_id);


--
-- Name: ventas_store_idempotency_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ventas_store_idempotency_key_idx ON public.ventas USING btree (store_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: businesses businesses_propagar_licencia; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER businesses_propagar_licencia AFTER UPDATE OF license_start_date, license_end_date, license_warning_days ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.businesses_propagar_licencia();


--
-- Name: businesses businesses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: canal_outbox canal_outbox_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER canal_outbox_updated_at BEFORE UPDATE ON public.canal_outbox FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: lotes_producto lotes_producto_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lotes_producto_updated_at BEFORE UPDATE ON public.lotes_producto FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: stores stores_asignar_negocio; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stores_asignar_negocio BEFORE INSERT OR UPDATE OF business_id ON public.stores FOR EACH ROW EXECUTE FUNCTION public.stores_asignar_negocio();


--
-- Name: lotes_producto sync_fecha_vencimiento_on_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_fecha_vencimiento_on_lote AFTER INSERT OR DELETE OR UPDATE ON public.lotes_producto FOR EACH ROW EXECUTE FUNCTION public.sync_producto_fecha_vencimiento();


--
-- Name: lotes_producto sync_stock_on_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_stock_on_lote AFTER INSERT OR DELETE OR UPDATE ON public.lotes_producto FOR EACH ROW EXECUTE FUNCTION public.sync_producto_stock_from_lotes();


--
-- Name: canal_producto_config trg_canal_producto_config_disponibilidad; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_canal_producto_config_disponibilidad AFTER UPDATE OF activo ON public.canal_producto_config FOR EACH ROW WHEN ((old.activo IS DISTINCT FROM new.activo)) EXECUTE FUNCTION public.trg_canal_producto_config_disponibilidad();


--
-- Name: citas trg_citas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_citas_updated_at BEFORE UPDATE ON public.citas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: clerk_users trg_clerk_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clerk_users_updated_at BEFORE UPDATE ON public.clerk_users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: clientes trg_clientes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clientes_updated_at BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: consumo_alertas trg_consumo_alertas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_consumo_alertas_updated_at BEFORE UPDATE ON public.consumo_alertas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: cuentas_pagar trg_cuentas_pagar_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cuentas_pagar_updated_at BEFORE UPDATE ON public.cuentas_pagar FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: encargados trg_encargados_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_encargados_updated_at BEFORE UPDATE ON public.encargados FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: instagram_posts trg_instagram_posts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_instagram_posts_updated_at BEFORE UPDATE ON public.instagram_posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: mascotas trg_mascotas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mascotas_updated_at BEFORE UPDATE ON public.mascotas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: ordenes_compra_items trg_ordenes_compra_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ordenes_compra_items_updated_at BEFORE UPDATE ON public.ordenes_compra_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: ordenes_compra trg_ordenes_compra_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ordenes_compra_updated_at BEFORE UPDATE ON public.ordenes_compra FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: productos trg_productos_disponibilidad_canal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_productos_disponibilidad_canal AFTER UPDATE OF stock, stock_minimo, activo ON public.productos FOR EACH ROW WHEN (((old.stock IS DISTINCT FROM new.stock) OR (old.stock_minimo IS DISTINCT FROM new.stock_minimo) OR (old.activo IS DISTINCT FROM new.activo))) EXECUTE FUNCTION public.trg_productos_disponibilidad_canal();


--
-- Name: productos trg_productos_peso_saco_abierto; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_productos_peso_saco_abierto BEFORE UPDATE OF peso_gramos ON public.productos FOR EACH ROW EXECUTE FUNCTION public.proteger_peso_con_saco_abierto();


--
-- Name: productos trg_productos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_productos_updated_at BEFORE UPDATE ON public.productos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: servicio_excepciones trg_servicio_excepciones_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_servicio_excepciones_updated_at BEFORE UPDATE ON public.servicio_excepciones FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: servicio_horarios trg_servicio_horarios_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_servicio_horarios_updated_at BEFORE UPDATE ON public.servicio_horarios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: servicios trg_servicios_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_servicios_updated_at BEFORE UPDATE ON public.servicios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: stores trg_stores_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stores_updated_at BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: ventas trg_ventas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ventas_updated_at BEFORE UPDATE ON public.ventas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: ai_pos_cache ai_pos_cache_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_pos_cache
    ADD CONSTRAINT ai_pos_cache_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: ai_vencimientos_analisis ai_vencimientos_analisis_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_vencimientos_analisis
    ADD CONSTRAINT ai_vencimientos_analisis_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: auth_failures auth_failures_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_failures
    ADD CONSTRAINT auth_failures_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: canal_config canal_config_canal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_config
    ADD CONSTRAINT canal_config_canal_id_fkey FOREIGN KEY (canal_id) REFERENCES public.canales_externos(id);


--
-- Name: canal_config canal_config_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_config
    ADD CONSTRAINT canal_config_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: canal_liquidaciones canal_liquidaciones_canal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_liquidaciones
    ADD CONSTRAINT canal_liquidaciones_canal_id_fkey FOREIGN KEY (canal_id) REFERENCES public.canales_externos(id);


--
-- Name: canal_liquidaciones canal_liquidaciones_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_liquidaciones
    ADD CONSTRAINT canal_liquidaciones_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id);


--
-- Name: canal_liquidaciones canal_liquidaciones_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_liquidaciones
    ADD CONSTRAINT canal_liquidaciones_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: canal_ordenes canal_ordenes_canal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_ordenes
    ADD CONSTRAINT canal_ordenes_canal_id_fkey FOREIGN KEY (canal_id) REFERENCES public.canales_externos(id);


--
-- Name: canal_ordenes canal_ordenes_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_ordenes
    ADD CONSTRAINT canal_ordenes_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: canal_ordenes canal_ordenes_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_ordenes
    ADD CONSTRAINT canal_ordenes_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id);


--
-- Name: canal_outbox canal_outbox_canal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_outbox
    ADD CONSTRAINT canal_outbox_canal_id_fkey FOREIGN KEY (canal_id) REFERENCES public.canales_externos(id);


--
-- Name: canal_outbox canal_outbox_canal_orden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_outbox
    ADD CONSTRAINT canal_outbox_canal_orden_id_fkey FOREIGN KEY (canal_orden_id) REFERENCES public.canal_ordenes(id) ON DELETE CASCADE;


--
-- Name: canal_outbox canal_outbox_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_outbox
    ADD CONSTRAINT canal_outbox_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: canal_producto_config canal_producto_config_canal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_producto_config
    ADD CONSTRAINT canal_producto_config_canal_id_fkey FOREIGN KEY (canal_id) REFERENCES public.canales_externos(id);


--
-- Name: canal_producto_config canal_producto_config_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_producto_config
    ADD CONSTRAINT canal_producto_config_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;


--
-- Name: canal_producto_config canal_producto_config_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canal_producto_config
    ADD CONSTRAINT canal_producto_config_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: categorias categorias_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: cierre_mes_backups cierre_mes_backups_cierre_asiento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cierre_mes_backups
    ADD CONSTRAINT cierre_mes_backups_cierre_asiento_id_fkey FOREIGN KEY (cierre_asiento_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL;


--
-- Name: cierre_mes_backups cierre_mes_backups_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cierre_mes_backups
    ADD CONSTRAINT cierre_mes_backups_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: citas citas_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.citas
    ADD CONSTRAINT citas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE RESTRICT;


--
-- Name: citas citas_encargado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.citas
    ADD CONSTRAINT citas_encargado_id_fkey FOREIGN KEY (encargado_id) REFERENCES public.encargados(id) ON DELETE RESTRICT;


--
-- Name: citas citas_mascota_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.citas
    ADD CONSTRAINT citas_mascota_id_fkey FOREIGN KEY (mascota_id) REFERENCES public.mascotas(id) ON DELETE SET NULL;


--
-- Name: citas citas_servicio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.citas
    ADD CONSTRAINT citas_servicio_id_fkey FOREIGN KEY (servicio_id) REFERENCES public.servicios(id) ON DELETE RESTRICT;


--
-- Name: citas citas_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.citas
    ADD CONSTRAINT citas_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: citas citas_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.citas
    ADD CONSTRAINT citas_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id) ON DELETE SET NULL;


--
-- Name: clerk_users clerk_users_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clerk_users
    ADD CONSTRAINT clerk_users_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE SET NULL;


--
-- Name: clerk_users clerk_users_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clerk_users
    ADD CONSTRAINT clerk_users_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: clientes clientes_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: consumo_alertas consumo_alertas_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_alertas
    ADD CONSTRAINT consumo_alertas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: consumo_alertas consumo_alertas_mascota_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_alertas
    ADD CONSTRAINT consumo_alertas_mascota_id_fkey FOREIGN KEY (mascota_id) REFERENCES public.mascotas(id);


--
-- Name: consumo_alertas consumo_alertas_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_alertas
    ADD CONSTRAINT consumo_alertas_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: consumo_alertas consumo_alertas_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_alertas
    ADD CONSTRAINT consumo_alertas_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: consumo_configs consumo_configs_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_configs
    ADD CONSTRAINT consumo_configs_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;


--
-- Name: consumo_configs consumo_configs_mascota_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_configs
    ADD CONSTRAINT consumo_configs_mascota_id_fkey FOREIGN KEY (mascota_id) REFERENCES public.mascotas(id) ON DELETE CASCADE;


--
-- Name: consumo_configs consumo_configs_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_configs
    ADD CONSTRAINT consumo_configs_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;


--
-- Name: cuentas_pagar cuentas_pagar_orden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_pagar
    ADD CONSTRAINT cuentas_pagar_orden_id_fkey FOREIGN KEY (orden_id) REFERENCES public.ordenes_compra(id);


--
-- Name: cuentas_pagar cuentas_pagar_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_pagar
    ADD CONSTRAINT cuentas_pagar_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: cuentas_pagar cuentas_pagar_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_pagar
    ADD CONSTRAINT cuentas_pagar_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: encargados encargados_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encargados
    ADD CONSTRAINT encargados_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: error_logs error_logs_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: fidelizacion fidelizacion_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fidelizacion
    ADD CONSTRAINT fidelizacion_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: mascotas fk_mascotas_alimento; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mascotas
    ADD CONSTRAINT fk_mascotas_alimento FOREIGN KEY (alimento_habitual_id) REFERENCES public.productos(id) ON DELETE SET NULL;


--
-- Name: instagram_post_media instagram_post_media_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram_post_media
    ADD CONSTRAINT instagram_post_media_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.instagram_posts(id) ON DELETE CASCADE;


--
-- Name: instagram_posts instagram_posts_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram_posts
    ADD CONSTRAINT instagram_posts_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: journal_detail journal_detail_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_detail
    ADD CONSTRAINT journal_detail_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;


--
-- Name: journal_entries journal_entries_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: lotes_producto lotes_producto_orden_compra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_producto
    ADD CONSTRAINT lotes_producto_orden_compra_id_fkey FOREIGN KEY (orden_compra_id) REFERENCES public.ordenes_compra(id) ON DELETE SET NULL;


--
-- Name: lotes_producto lotes_producto_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_producto
    ADD CONSTRAINT lotes_producto_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;


--
-- Name: lotes_producto lotes_producto_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_producto
    ADD CONSTRAINT lotes_producto_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: mascotas mascotas_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mascotas
    ADD CONSTRAINT mascotas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;


--
-- Name: nota_credito_items nota_credito_items_nota_credito_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_credito_items
    ADD CONSTRAINT nota_credito_items_nota_credito_id_fkey FOREIGN KEY (nota_credito_id) REFERENCES public.notas_credito(id) ON DELETE CASCADE;


--
-- Name: nota_credito_items nota_credito_items_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_credito_items
    ADD CONSTRAINT nota_credito_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: nota_credito_items nota_credito_items_servicio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_credito_items
    ADD CONSTRAINT nota_credito_items_servicio_id_fkey FOREIGN KEY (servicio_id) REFERENCES public.servicios(id);


--
-- Name: nota_credito_items nota_credito_items_venta_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_credito_items
    ADD CONSTRAINT nota_credito_items_venta_item_id_fkey FOREIGN KEY (venta_item_id) REFERENCES public.venta_items(id);


--
-- Name: notas_credito notas_credito_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_credito
    ADD CONSTRAINT notas_credito_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: notas_credito notas_credito_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_credito
    ADD CONSTRAINT notas_credito_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id) ON DELETE CASCADE;


--
-- Name: ordenes_compra_items ordenes_compra_items_orden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordenes_compra_items
    ADD CONSTRAINT ordenes_compra_items_orden_id_fkey FOREIGN KEY (orden_id) REFERENCES public.ordenes_compra(id) ON DELETE CASCADE;


--
-- Name: ordenes_compra_items ordenes_compra_items_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordenes_compra_items
    ADD CONSTRAINT ordenes_compra_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: ordenes_compra ordenes_compra_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: ordenes_compra ordenes_compra_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: pagos pagos_nota_credito_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_nota_credito_id_fkey FOREIGN KEY (nota_credito_id) REFERENCES public.notas_credito(id);


--
-- Name: pagos pagos_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: pagos pagos_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id) ON DELETE CASCADE;


--
-- Name: productos productos_categoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.categorias(id) ON DELETE SET NULL;


--
-- Name: productos productos_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: proveedor_productos proveedor_productos_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor_productos
    ADD CONSTRAINT proveedor_productos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: proveedor_productos proveedor_productos_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor_productos
    ADD CONSTRAINT proveedor_productos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: proveedores proveedores_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: sacos_abiertos sacos_abiertos_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sacos_abiertos
    ADD CONSTRAINT sacos_abiertos_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes_producto(id);


--
-- Name: sacos_abiertos sacos_abiertos_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sacos_abiertos
    ADD CONSTRAINT sacos_abiertos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: sacos_abiertos sacos_abiertos_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sacos_abiertos
    ADD CONSTRAINT sacos_abiertos_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: saldos_a_favor saldos_a_favor_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saldos_a_favor
    ADD CONSTRAINT saldos_a_favor_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;


--
-- Name: saldos_a_favor saldos_a_favor_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saldos_a_favor
    ADD CONSTRAINT saldos_a_favor_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: servicio_excepciones servicio_excepciones_servicio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicio_excepciones
    ADD CONSTRAINT servicio_excepciones_servicio_id_fkey FOREIGN KEY (servicio_id) REFERENCES public.servicios(id) ON DELETE CASCADE;


--
-- Name: servicio_excepciones servicio_excepciones_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicio_excepciones
    ADD CONSTRAINT servicio_excepciones_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: servicio_horarios servicio_horarios_servicio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicio_horarios
    ADD CONSTRAINT servicio_horarios_servicio_id_fkey FOREIGN KEY (servicio_id) REFERENCES public.servicios(id) ON DELETE CASCADE;


--
-- Name: servicio_horarios servicio_horarios_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicio_horarios
    ADD CONSTRAINT servicio_horarios_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: servicios servicios_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: stock_movements stock_movements_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: stores stores_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: user_sessions user_sessions_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: venta_item_lotes venta_item_lotes_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_item_lotes
    ADD CONSTRAINT venta_item_lotes_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes_producto(id);


--
-- Name: venta_item_lotes venta_item_lotes_venta_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_item_lotes
    ADD CONSTRAINT venta_item_lotes_venta_item_id_fkey FOREIGN KEY (venta_item_id) REFERENCES public.venta_items(id) ON DELETE CASCADE;


--
-- Name: venta_item_sacos venta_item_sacos_saco_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_item_sacos
    ADD CONSTRAINT venta_item_sacos_saco_id_fkey FOREIGN KEY (saco_id) REFERENCES public.sacos_abiertos(id);


--
-- Name: venta_item_sacos venta_item_sacos_venta_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_item_sacos
    ADD CONSTRAINT venta_item_sacos_venta_item_id_fkey FOREIGN KEY (venta_item_id) REFERENCES public.venta_items(id) ON DELETE CASCADE;


--
-- Name: venta_items venta_items_mascota_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_items
    ADD CONSTRAINT venta_items_mascota_id_fkey FOREIGN KEY (mascota_id) REFERENCES public.mascotas(id);


--
-- Name: venta_items venta_items_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_items
    ADD CONSTRAINT venta_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: venta_items venta_items_servicio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_items
    ADD CONSTRAINT venta_items_servicio_id_fkey FOREIGN KEY (servicio_id) REFERENCES public.servicios(id);


--
-- Name: venta_items venta_items_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_items
    ADD CONSTRAINT venta_items_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id) ON DELETE CASCADE;


--
-- Name: ventas ventas_canal_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_canal_fkey FOREIGN KEY (canal) REFERENCES public.canales_externos(id);


--
-- Name: ventas ventas_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: ventas_historico ventas_historico_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas_historico
    ADD CONSTRAINT ventas_historico_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: ventas_historico ventas_historico_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas_historico
    ADD CONSTRAINT ventas_historico_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: ventas ventas_mascota_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_mascota_id_fkey FOREIGN KEY (mascota_id) REFERENCES public.mascotas(id);


--
-- Name: ventas ventas_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: ventas ventas_worker_clerk_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_worker_clerk_id_fkey FOREIGN KEY (worker_clerk_id) REFERENCES public.clerk_users(clerk_id) ON DELETE SET NULL;


--
-- Name: error_logs Admins see own store error_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins see own store error_logs" ON public.error_logs FOR SELECT USING (((store_id IS NULL) OR (store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text)))));


--
-- Name: user_sessions Admins see own store user_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins see own store user_sessions" ON public.user_sessions FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: error_logs Only service role can insert error_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only service role can insert error_logs" ON public.error_logs FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: user_sessions Only service role can insert user_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only service role can insert user_sessions" ON public.user_sessions FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: audit_logs Users see own store audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own store audit" ON public.audit_logs FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: ai_pos_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_pos_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_pos_cache ai_pos_cache_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_pos_cache_delete ON public.ai_pos_cache FOR DELETE USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: ai_pos_cache ai_pos_cache_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_pos_cache_insert ON public.ai_pos_cache FOR INSERT WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: ai_pos_cache ai_pos_cache_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_pos_cache_select ON public.ai_pos_cache FOR SELECT USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: ai_pos_cache ai_pos_cache_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_pos_cache_update ON public.ai_pos_cache FOR UPDATE USING (((store_id = public.get_user_store_id()) OR public.is_system_admin())) WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: ai_vencimientos_analisis; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_vencimientos_analisis ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_vencimientos_analisis ai_vencimientos_analisis_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_vencimientos_analisis_delete ON public.ai_vencimientos_analisis FOR DELETE USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: ai_vencimientos_analisis ai_vencimientos_analisis_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_vencimientos_analisis_insert ON public.ai_vencimientos_analisis FOR INSERT WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: ai_vencimientos_analisis ai_vencimientos_analisis_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_vencimientos_analisis_select ON public.ai_vencimientos_analisis FOR SELECT USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: ai_vencimientos_analisis ai_vencimientos_analisis_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_vencimientos_analisis_update ON public.ai_vencimientos_analisis FOR UPDATE USING (((store_id = public.get_user_store_id()) OR public.is_system_admin())) WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_failures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_failures ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_failures auth_failures_service_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_failures_service_only ON public.auth_failures TO service_role USING (true) WITH CHECK (true);


--
-- Name: businesses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

--
-- Name: businesses businesses_select_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY businesses_select_propio ON public.businesses FOR SELECT USING ((public.is_system_admin() OR (id = ( SELECT s.business_id
   FROM public.stores s
  WHERE (s.id = public.get_user_store_id()))) OR (id = ( SELECT cu.business_id
   FROM public.clerk_users cu
  WHERE ((cu.clerk_id)::text = (auth.uid())::text)
 LIMIT 1))));


--
-- Name: canal_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canal_config ENABLE ROW LEVEL SECURITY;

--
-- Name: canal_config canal_config_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_config_delete ON public.canal_config FOR DELETE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_config canal_config_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_config_insert ON public.canal_config FOR INSERT WITH CHECK ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_config canal_config_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_config_select ON public.canal_config FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_config canal_config_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_config_update ON public.canal_config FOR UPDATE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_liquidaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canal_liquidaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: canal_liquidaciones canal_liquidaciones_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_liquidaciones_delete ON public.canal_liquidaciones FOR DELETE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_liquidaciones canal_liquidaciones_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_liquidaciones_insert ON public.canal_liquidaciones FOR INSERT WITH CHECK ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_liquidaciones canal_liquidaciones_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_liquidaciones_select ON public.canal_liquidaciones FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_liquidaciones canal_liquidaciones_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_liquidaciones_update ON public.canal_liquidaciones FOR UPDATE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_ordenes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canal_ordenes ENABLE ROW LEVEL SECURITY;

--
-- Name: canal_ordenes canal_ordenes_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_ordenes_delete ON public.canal_ordenes FOR DELETE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_ordenes canal_ordenes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_ordenes_insert ON public.canal_ordenes FOR INSERT WITH CHECK ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_ordenes canal_ordenes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_ordenes_select ON public.canal_ordenes FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_ordenes canal_ordenes_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_ordenes_update ON public.canal_ordenes FOR UPDATE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canal_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: canal_outbox canal_outbox_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_outbox_select ON public.canal_outbox FOR SELECT USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: canal_producto_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canal_producto_config ENABLE ROW LEVEL SECURITY;

--
-- Name: canal_producto_config canal_producto_config_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_producto_config_delete ON public.canal_producto_config FOR DELETE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_producto_config canal_producto_config_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_producto_config_insert ON public.canal_producto_config FOR INSERT WITH CHECK ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_producto_config canal_producto_config_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_producto_config_select ON public.canal_producto_config FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canal_producto_config canal_producto_config_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canal_producto_config_update ON public.canal_producto_config FOR UPDATE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: canales_externos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canales_externos ENABLE ROW LEVEL SECURITY;

--
-- Name: canales_externos canales_externos_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canales_externos_select ON public.canales_externos FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: categorias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;

--
-- Name: categorias categorias_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categorias_delete ON public.categorias FOR DELETE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: categorias categorias_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categorias_insert ON public.categorias FOR INSERT WITH CHECK ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: categorias categorias_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categorias_select ON public.categorias FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: categorias categorias_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categorias_update ON public.categorias FOR UPDATE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: cierre_mes_backups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cierre_mes_backups ENABLE ROW LEVEL SECURITY;

--
-- Name: citas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.citas ENABLE ROW LEVEL SECURITY;

--
-- Name: citas citas_store_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY citas_store_isolation ON public.citas USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: clerk_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clerk_users ENABLE ROW LEVEL SECURITY;

--
-- Name: clerk_users clerk_users_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clerk_users_select ON public.clerk_users FOR SELECT USING ((public.is_system_admin() OR ((clerk_id)::text = (auth.jwt() ->> 'sub'::text))));


--
-- Name: clerk_users clerk_users_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clerk_users_update ON public.clerk_users FOR UPDATE USING ((public.is_system_admin() OR ((clerk_id)::text = (auth.jwt() ->> 'sub'::text)))) WITH CHECK ((public.is_system_admin() OR ((clerk_id)::text = (auth.jwt() ->> 'sub'::text))));


--
-- Name: clientes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

--
-- Name: clientes clientes_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clientes_delete ON public.clientes FOR DELETE USING ((store_id = public.get_user_store_id()));


--
-- Name: clientes clientes_insert_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clientes_insert_v2 ON public.clientes FOR INSERT WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: clientes clientes_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clientes_select_v2 ON public.clientes FOR SELECT USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: clientes clientes_update_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clientes_update_v2 ON public.clientes FOR UPDATE USING (((store_id = public.get_user_store_id()) OR public.is_system_admin())) WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: consumo_alertas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consumo_alertas ENABLE ROW LEVEL SECURITY;

--
-- Name: consumo_alertas consumo_alertas_insert_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consumo_alertas_insert_v2 ON public.consumo_alertas FOR INSERT WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: consumo_alertas consumo_alertas_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consumo_alertas_select_v2 ON public.consumo_alertas FOR SELECT USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: consumo_alertas consumo_alertas_update_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consumo_alertas_update_v2 ON public.consumo_alertas FOR UPDATE USING (((store_id = public.get_user_store_id()) OR public.is_system_admin())) WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: consumo_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consumo_configs ENABLE ROW LEVEL SECURITY;

--
-- Name: consumo_configs consumo_configs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consumo_configs_insert ON public.consumo_configs FOR INSERT WITH CHECK ((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.store_id = public.get_user_store_id()))));


--
-- Name: consumo_configs consumo_configs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consumo_configs_select ON public.consumo_configs FOR SELECT USING ((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.store_id = public.get_user_store_id()))));


--
-- Name: consumo_configs consumo_configs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consumo_configs_update ON public.consumo_configs FOR UPDATE USING ((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.store_id = public.get_user_store_id())))) WITH CHECK ((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.store_id = public.get_user_store_id()))));


--
-- Name: cuentas_pagar; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cuentas_pagar ENABLE ROW LEVEL SECURITY;

--
-- Name: cuentas_pagar cuentas_pagar_insert_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cuentas_pagar_insert_v2 ON public.cuentas_pagar FOR INSERT WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: cuentas_pagar cuentas_pagar_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cuentas_pagar_select_v2 ON public.cuentas_pagar FOR SELECT USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: cuentas_pagar cuentas_pagar_update_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cuentas_pagar_update_v2 ON public.cuentas_pagar FOR UPDATE USING (((store_id = public.get_user_store_id()) OR public.is_system_admin())) WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: encargados; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.encargados ENABLE ROW LEVEL SECURITY;

--
-- Name: encargados encargados_store_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encargados_store_isolation ON public.encargados USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: error_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: fidelizacion; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fidelizacion ENABLE ROW LEVEL SECURITY;

--
-- Name: fidelizacion fidelizacion_insert_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fidelizacion_insert_v2 ON public.fidelizacion FOR INSERT WITH CHECK (((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.store_id = public.get_user_store_id()))) OR public.is_system_admin()));


--
-- Name: fidelizacion fidelizacion_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fidelizacion_select_v2 ON public.fidelizacion FOR SELECT USING (((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.store_id = public.get_user_store_id()))) OR public.is_system_admin()));


--
-- Name: fidelizacion fidelizacion_update_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fidelizacion_update_v2 ON public.fidelizacion FOR UPDATE USING (((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.store_id = public.get_user_store_id()))) OR public.is_system_admin())) WITH CHECK (((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.store_id = public.get_user_store_id()))) OR public.is_system_admin()));


--
-- Name: instagram_post_media instagram_media_delete_by_store; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instagram_media_delete_by_store ON public.instagram_post_media FOR DELETE USING ((post_id IN ( SELECT instagram_posts.id
   FROM public.instagram_posts
  WHERE (instagram_posts.store_id IN ( SELECT clerk_users.store_id
           FROM public.clerk_users
          WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))))));


--
-- Name: instagram_post_media instagram_media_insert_by_store; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instagram_media_insert_by_store ON public.instagram_post_media FOR INSERT WITH CHECK ((post_id IN ( SELECT instagram_posts.id
   FROM public.instagram_posts
  WHERE (instagram_posts.store_id IN ( SELECT clerk_users.store_id
           FROM public.clerk_users
          WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))))));


--
-- Name: instagram_post_media instagram_media_select_by_store; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instagram_media_select_by_store ON public.instagram_post_media FOR SELECT USING ((post_id IN ( SELECT instagram_posts.id
   FROM public.instagram_posts
  WHERE (instagram_posts.store_id IN ( SELECT clerk_users.store_id
           FROM public.clerk_users
          WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))))));


--
-- Name: instagram_post_media; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.instagram_post_media ENABLE ROW LEVEL SECURITY;

--
-- Name: instagram_post_media instagram_post_media_via_post; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instagram_post_media_via_post ON public.instagram_post_media USING ((post_id IN ( SELECT instagram_posts.id
   FROM public.instagram_posts
  WHERE (instagram_posts.store_id = ( SELECT clerk_users.store_id
           FROM public.clerk_users
          WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text)
         LIMIT 1)))));


--
-- Name: instagram_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.instagram_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: instagram_posts instagram_posts_delete_by_store; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instagram_posts_delete_by_store ON public.instagram_posts FOR DELETE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: instagram_posts instagram_posts_insert_by_store; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instagram_posts_insert_by_store ON public.instagram_posts FOR INSERT WITH CHECK ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: instagram_posts instagram_posts_select_by_store; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instagram_posts_select_by_store ON public.instagram_posts FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: instagram_posts instagram_posts_store_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instagram_posts_store_isolation ON public.instagram_posts USING ((store_id = ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text)
 LIMIT 1)));


--
-- Name: instagram_posts instagram_posts_update_by_store; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instagram_posts_update_by_store ON public.instagram_posts FOR UPDATE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: journal_detail; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_detail ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_detail journal_detail_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_detail_delete ON public.journal_detail FOR DELETE USING ((journal_entry_id IN ( SELECT je.id
   FROM public.journal_entries je
  WHERE (je.store_id IN ( SELECT clerk_users.store_id
           FROM public.clerk_users
          WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))))));


--
-- Name: journal_detail journal_detail_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_detail_insert ON public.journal_detail FOR INSERT WITH CHECK ((journal_entry_id IN ( SELECT je.id
   FROM public.journal_entries je
  WHERE (je.store_id IN ( SELECT clerk_users.store_id
           FROM public.clerk_users
          WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))))));


--
-- Name: journal_detail journal_detail_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_detail_select ON public.journal_detail FOR SELECT USING ((journal_entry_id IN ( SELECT je.id
   FROM public.journal_entries je
  WHERE (je.store_id IN ( SELECT clerk_users.store_id
           FROM public.clerk_users
          WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))))));


--
-- Name: journal_detail journal_detail_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_detail_update ON public.journal_detail FOR UPDATE USING ((journal_entry_id IN ( SELECT je.id
   FROM public.journal_entries je
  WHERE (je.store_id IN ( SELECT clerk_users.store_id
           FROM public.clerk_users
          WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))))));


--
-- Name: journal_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_entries journal_entries_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entries_delete ON public.journal_entries FOR DELETE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: journal_entries journal_entries_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entries_insert ON public.journal_entries FOR INSERT WITH CHECK ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: journal_entries journal_entries_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entries_select ON public.journal_entries FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: journal_entries journal_entries_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entries_update ON public.journal_entries FOR UPDATE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: lotes_producto; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lotes_producto ENABLE ROW LEVEL SECURITY;

--
-- Name: lotes_producto lotes_store_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lotes_store_isolation ON public.lotes_producto USING ((store_id = ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text)
 LIMIT 1)));


--
-- Name: mascotas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mascotas ENABLE ROW LEVEL SECURITY;

--
-- Name: mascotas mascotas_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mascotas_insert ON public.mascotas FOR INSERT WITH CHECK ((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.store_id = public.get_user_store_id()))));


--
-- Name: mascotas mascotas_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mascotas_select ON public.mascotas FOR SELECT USING ((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.store_id = public.get_user_store_id()))));


--
-- Name: mascotas mascotas_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mascotas_update ON public.mascotas FOR UPDATE USING ((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.store_id = public.get_user_store_id())))) WITH CHECK ((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.store_id = public.get_user_store_id()))));


--
-- Name: nota_credito_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nota_credito_items ENABLE ROW LEVEL SECURITY;

--
-- Name: nota_credito_items nota_credito_items_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY nota_credito_items_delete ON public.nota_credito_items FOR DELETE USING ((nota_credito_id IN ( SELECT nc.id
   FROM public.notas_credito nc
  WHERE (nc.store_id IN ( SELECT clerk_users.store_id
           FROM public.clerk_users
          WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))))));


--
-- Name: nota_credito_items nota_credito_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY nota_credito_items_insert ON public.nota_credito_items FOR INSERT WITH CHECK ((nota_credito_id IN ( SELECT nc.id
   FROM public.notas_credito nc
  WHERE (nc.store_id IN ( SELECT clerk_users.store_id
           FROM public.clerk_users
          WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))))));


--
-- Name: nota_credito_items nota_credito_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY nota_credito_items_select ON public.nota_credito_items FOR SELECT USING ((nota_credito_id IN ( SELECT nc.id
   FROM public.notas_credito nc
  WHERE (nc.store_id IN ( SELECT clerk_users.store_id
           FROM public.clerk_users
          WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))))));


--
-- Name: nota_credito_items nota_credito_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY nota_credito_items_update ON public.nota_credito_items FOR UPDATE USING ((nota_credito_id IN ( SELECT nc.id
   FROM public.notas_credito nc
  WHERE (nc.store_id IN ( SELECT clerk_users.store_id
           FROM public.clerk_users
          WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))))));


--
-- Name: notas_credito; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notas_credito ENABLE ROW LEVEL SECURITY;

--
-- Name: notas_credito notas_credito_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_credito_delete ON public.notas_credito FOR DELETE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: notas_credito notas_credito_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_credito_insert ON public.notas_credito FOR INSERT WITH CHECK ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: notas_credito notas_credito_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_credito_select ON public.notas_credito FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: notas_credito notas_credito_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_credito_update ON public.notas_credito FOR UPDATE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: ordenes_compra; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ordenes_compra ENABLE ROW LEVEL SECURITY;

--
-- Name: ordenes_compra ordenes_compra_insert_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ordenes_compra_insert_v2 ON public.ordenes_compra FOR INSERT WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: ordenes_compra_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ordenes_compra_items ENABLE ROW LEVEL SECURITY;

--
-- Name: ordenes_compra_items ordenes_compra_items_insert_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ordenes_compra_items_insert_v2 ON public.ordenes_compra_items FOR INSERT WITH CHECK (((orden_id IN ( SELECT ordenes_compra.id
   FROM public.ordenes_compra
  WHERE (ordenes_compra.store_id = public.get_user_store_id()))) OR public.is_system_admin()));


--
-- Name: ordenes_compra_items ordenes_compra_items_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ordenes_compra_items_select_v2 ON public.ordenes_compra_items FOR SELECT USING (((orden_id IN ( SELECT ordenes_compra.id
   FROM public.ordenes_compra
  WHERE (ordenes_compra.store_id = public.get_user_store_id()))) OR public.is_system_admin()));


--
-- Name: ordenes_compra ordenes_compra_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ordenes_compra_select_v2 ON public.ordenes_compra FOR SELECT USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: ordenes_compra ordenes_compra_update_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ordenes_compra_update_v2 ON public.ordenes_compra FOR UPDATE USING (((store_id = public.get_user_store_id()) OR public.is_system_admin())) WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: pagos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

--
-- Name: pagos pagos_insert_by_store; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pagos_insert_by_store ON public.pagos FOR INSERT WITH CHECK ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: pagos pagos_select_by_store; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pagos_select_by_store ON public.pagos FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: pagos pagos_update_by_store; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pagos_update_by_store ON public.pagos FOR UPDATE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: productos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;

--
-- Name: productos productos_insert_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY productos_insert_v2 ON public.productos FOR INSERT WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: productos productos_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY productos_select_v2 ON public.productos FOR SELECT USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: productos productos_update_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY productos_update_v2 ON public.productos FOR UPDATE USING (((store_id = public.get_user_store_id()) OR public.is_system_admin())) WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: proveedor_productos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proveedor_productos ENABLE ROW LEVEL SECURITY;

--
-- Name: proveedor_productos proveedor_productos_insert_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY proveedor_productos_insert_v2 ON public.proveedor_productos FOR INSERT WITH CHECK (((proveedor_id IN ( SELECT proveedores.id
   FROM public.proveedores
  WHERE (proveedores.store_id = public.get_user_store_id()))) OR public.is_system_admin()));


--
-- Name: proveedor_productos proveedor_productos_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY proveedor_productos_select_v2 ON public.proveedor_productos FOR SELECT USING (((proveedor_id IN ( SELECT proveedores.id
   FROM public.proveedores
  WHERE (proveedores.store_id = public.get_user_store_id()))) OR public.is_system_admin()));


--
-- Name: proveedores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;

--
-- Name: proveedores proveedores_insert_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY proveedores_insert_v2 ON public.proveedores FOR INSERT WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: proveedores proveedores_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY proveedores_select_v2 ON public.proveedores FOR SELECT USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: proveedores proveedores_update_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY proveedores_update_v2 ON public.proveedores FOR UPDATE USING (((store_id = public.get_user_store_id()) OR public.is_system_admin())) WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: sacos_abiertos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sacos_abiertos ENABLE ROW LEVEL SECURITY;

--
-- Name: sacos_abiertos sacos_abiertos_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sacos_abiertos_select ON public.sacos_abiertos FOR SELECT USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: saldos_a_favor; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saldos_a_favor ENABLE ROW LEVEL SECURITY;

--
-- Name: saldos_a_favor saldos_a_favor_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saldos_a_favor_delete ON public.saldos_a_favor FOR DELETE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: saldos_a_favor saldos_a_favor_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saldos_a_favor_insert ON public.saldos_a_favor FOR INSERT WITH CHECK ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: saldos_a_favor saldos_a_favor_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saldos_a_favor_select ON public.saldos_a_favor FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: saldos_a_favor saldos_a_favor_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saldos_a_favor_update ON public.saldos_a_favor FOR UPDATE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: servicio_excepciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.servicio_excepciones ENABLE ROW LEVEL SECURITY;

--
-- Name: servicio_excepciones servicio_excepciones_store_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servicio_excepciones_store_isolation ON public.servicio_excepciones USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: servicio_horarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.servicio_horarios ENABLE ROW LEVEL SECURITY;

--
-- Name: servicio_horarios servicio_horarios_store_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servicio_horarios_store_isolation ON public.servicio_horarios USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: servicios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.servicios ENABLE ROW LEVEL SECURITY;

--
-- Name: servicios servicios_store_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servicios_store_isolation ON public.servicios USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_movements stock_movements_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_movements_insert ON public.stock_movements FOR INSERT WITH CHECK ((producto_id IN ( SELECT productos.id
   FROM public.productos
  WHERE (productos.store_id = public.get_user_store_id()))));


--
-- Name: stock_movements stock_movements_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_movements_select ON public.stock_movements FOR SELECT USING ((producto_id IN ( SELECT productos.id
   FROM public.productos
  WHERE (productos.store_id = public.get_user_store_id()))));


--
-- Name: stores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

--
-- Name: stores stores_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stores_select ON public.stores FOR SELECT USING ((public.is_system_admin() OR (id = public.get_user_store_id())));


--
-- Name: stores stores_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stores_update ON public.stores FOR UPDATE USING ((public.is_system_admin() OR (id = public.get_user_store_id()))) WITH CHECK ((public.is_system_admin() OR (id = public.get_user_store_id())));


--
-- Name: user_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: venta_item_lotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venta_item_lotes ENABLE ROW LEVEL SECURITY;

--
-- Name: venta_item_lotes venta_item_lotes_via_lote; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY venta_item_lotes_via_lote ON public.venta_item_lotes USING ((EXISTS ( SELECT 1
   FROM (public.lotes_producto l
     JOIN public.clerk_users cu ON ((cu.store_id = l.store_id)))
  WHERE ((l.id = venta_item_lotes.lote_id) AND ((cu.clerk_id)::text = (auth.uid())::text)))));


--
-- Name: venta_item_sacos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venta_item_sacos ENABLE ROW LEVEL SECURITY;

--
-- Name: venta_item_sacos venta_item_sacos_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY venta_item_sacos_select ON public.venta_item_sacos FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.sacos_abiertos s
  WHERE ((s.id = venta_item_sacos.saco_id) AND ((s.store_id = public.get_user_store_id()) OR public.is_system_admin())))));


--
-- Name: venta_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venta_items ENABLE ROW LEVEL SECURITY;

--
-- Name: venta_items venta_items_insert_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY venta_items_insert_v2 ON public.venta_items FOR INSERT WITH CHECK (((venta_id IN ( SELECT ventas.id
   FROM public.ventas
  WHERE (ventas.store_id = public.get_user_store_id()))) OR public.is_system_admin()));


--
-- Name: venta_items venta_items_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY venta_items_select_v2 ON public.venta_items FOR SELECT USING (((venta_id IN ( SELECT ventas.id
   FROM public.ventas
  WHERE (ventas.store_id = public.get_user_store_id()))) OR public.is_system_admin()));


--
-- Name: venta_items venta_items_update_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY venta_items_update_v2 ON public.venta_items FOR UPDATE USING (((venta_id IN ( SELECT ventas.id
   FROM public.ventas
  WHERE (ventas.store_id = public.get_user_store_id()))) OR public.is_system_admin())) WITH CHECK (((venta_id IN ( SELECT ventas.id
   FROM public.ventas
  WHERE (ventas.store_id = public.get_user_store_id()))) OR public.is_system_admin()));


--
-- Name: ventas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ventas ENABLE ROW LEVEL SECURITY;

--
-- Name: ventas_historico; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ventas_historico ENABLE ROW LEVEL SECURITY;

--
-- Name: ventas_historico ventas_historico_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ventas_historico_insert ON public.ventas_historico FOR INSERT WITH CHECK ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: ventas_historico ventas_historico_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ventas_historico_select ON public.ventas_historico FOR SELECT USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: ventas_historico ventas_historico_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ventas_historico_update ON public.ventas_historico FOR UPDATE USING ((store_id IN ( SELECT clerk_users.store_id
   FROM public.clerk_users
  WHERE ((clerk_users.clerk_id)::text = (auth.uid())::text))));


--
-- Name: ventas ventas_insert_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ventas_insert_v2 ON public.ventas FOR INSERT WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: ventas ventas_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ventas_select_v2 ON public.ventas FOR SELECT USING (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: ventas ventas_update_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ventas_update_v2 ON public.ventas FOR UPDATE USING (((store_id = public.get_user_store_id()) OR public.is_system_admin())) WITH CHECK (((store_id = public.get_user_store_id()) OR public.is_system_admin()));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION abrir_saco(p_store_id uuid, p_producto_id uuid, p_user_id text, p_nota text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.abrir_saco(p_store_id uuid, p_producto_id uuid, p_user_id text, p_nota text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.abrir_saco(p_store_id uuid, p_producto_id uuid, p_user_id text, p_nota text) TO service_role;


--
-- Name: FUNCTION abrir_saco_interno(p_store_id uuid, p_producto_id uuid, p_user_id text, p_nota text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.abrir_saco_interno(p_store_id uuid, p_producto_id uuid, p_user_id text, p_nota text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.abrir_saco_interno(p_store_id uuid, p_producto_id uuid, p_user_id text, p_nota text) TO service_role;


--
-- Name: FUNCTION ajustar_stock_conteo(p_store_id uuid, p_producto_id uuid, p_lote_id uuid, p_stock_contado numeric, p_motivo text, p_user_id text, p_gramos_saco_abierto integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ajustar_stock_conteo(p_store_id uuid, p_producto_id uuid, p_lote_id uuid, p_stock_contado numeric, p_motivo text, p_user_id text, p_gramos_saco_abierto integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ajustar_stock_conteo(p_store_id uuid, p_producto_id uuid, p_lote_id uuid, p_stock_contado numeric, p_motivo text, p_user_id text, p_gramos_saco_abierto integer) TO service_role;


--
-- Name: FUNCTION ajustar_stock_por_saco(p_producto_id uuid, p_store_id uuid, p_frac_anterior numeric, p_frac_nueva numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ajustar_stock_por_saco(p_producto_id uuid, p_store_id uuid, p_frac_anterior numeric, p_frac_nueva numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ajustar_stock_por_saco(p_producto_id uuid, p_store_id uuid, p_frac_anterior numeric, p_frac_nueva numeric) TO service_role;


--
-- Name: FUNCTION anular_venta_tx(p_store_id uuid, p_venta_id uuid, p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.anular_venta_tx(p_store_id uuid, p_venta_id uuid, p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.anular_venta_tx(p_store_id uuid, p_venta_id uuid, p_user_id text) TO service_role;


--
-- Name: FUNCTION businesses_propagar_licencia(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.businesses_propagar_licencia() FROM PUBLIC;
GRANT ALL ON FUNCTION public.businesses_propagar_licencia() TO service_role;


--
-- Name: TABLE citas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.citas TO anon;
GRANT ALL ON TABLE public.citas TO authenticated;
GRANT ALL ON TABLE public.citas TO service_role;


--
-- Name: FUNCTION cancelar_cita_tx(p_cita_id uuid, p_store_id uuid, p_motivo text, p_cancelado_por text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancelar_cita_tx(p_cita_id uuid, p_store_id uuid, p_motivo text, p_cancelado_por text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancelar_cita_tx(p_cita_id uuid, p_store_id uuid, p_motivo text, p_cancelado_por text) TO service_role;


--
-- Name: FUNCTION cerrar_saco_merma(p_store_id uuid, p_producto_id uuid, p_motivo text, p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cerrar_saco_merma(p_store_id uuid, p_producto_id uuid, p_motivo text, p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cerrar_saco_merma(p_store_id uuid, p_producto_id uuid, p_motivo text, p_user_id text) TO service_role;


--
-- Name: TABLE canal_outbox; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.canal_outbox TO anon;
GRANT ALL ON TABLE public.canal_outbox TO authenticated;
GRANT ALL ON TABLE public.canal_outbox TO service_role;


--
-- Name: FUNCTION claim_canal_outbox(p_limit integer, p_reclamo_vencido_seg integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_canal_outbox(p_limit integer, p_reclamo_vencido_seg integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_canal_outbox(p_limit integer, p_reclamo_vencido_seg integer) TO service_role;


--
-- Name: FUNCTION clean_old_audit_logs(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clean_old_audit_logs() FROM PUBLIC;
GRANT ALL ON FUNCTION public.clean_old_audit_logs() TO service_role;


--
-- Name: FUNCTION completar_cita_tx(p_cita_id uuid, p_store_id uuid, p_metodo_pago text, p_numero_transaccion text, p_impuesto numeric, p_pago_nc jsonb, p_fidelizacion_niveles jsonb, p_completado_por text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.completar_cita_tx(p_cita_id uuid, p_store_id uuid, p_metodo_pago text, p_numero_transaccion text, p_impuesto numeric, p_pago_nc jsonb, p_fidelizacion_niveles jsonb, p_completado_por text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.completar_cita_tx(p_cita_id uuid, p_store_id uuid, p_metodo_pago text, p_numero_transaccion text, p_impuesto numeric, p_pago_nc jsonb, p_fidelizacion_niveles jsonb, p_completado_por text) TO service_role;


--
-- Name: FUNCTION consumir_granel(p_store_id uuid, p_producto_id uuid, p_venta_item_id uuid, p_gramos integer, p_permitir_abrir boolean, p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.consumir_granel(p_store_id uuid, p_producto_id uuid, p_venta_item_id uuid, p_gramos integer, p_permitir_abrir boolean, p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.consumir_granel(p_store_id uuid, p_producto_id uuid, p_venta_item_id uuid, p_gramos integer, p_permitir_abrir boolean, p_user_id text) TO service_role;


--
-- Name: FUNCTION convertir_stock_suelto_a_lote(p_store_id uuid, p_producto_id uuid, p_fecha_vencimiento date, p_fecha_ingreso_max date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.convertir_stock_suelto_a_lote(p_store_id uuid, p_producto_id uuid, p_fecha_vencimiento date, p_fecha_ingreso_max date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.convertir_stock_suelto_a_lote(p_store_id uuid, p_producto_id uuid, p_fecha_vencimiento date, p_fecha_ingreso_max date) TO service_role;


--
-- Name: FUNCTION crear_cita_tx(p_store_id uuid, p_servicio_id uuid, p_cliente_id uuid, p_mascota_id uuid, p_encargado_id uuid, p_fecha date, p_hora_inicio time without time zone, p_notas text, p_created_by text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.crear_cita_tx(p_store_id uuid, p_servicio_id uuid, p_cliente_id uuid, p_mascota_id uuid, p_encargado_id uuid, p_fecha date, p_hora_inicio time without time zone, p_notas text, p_created_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.crear_cita_tx(p_store_id uuid, p_servicio_id uuid, p_cliente_id uuid, p_mascota_id uuid, p_encargado_id uuid, p_fecha date, p_hora_inicio time without time zone, p_notas text, p_created_by text) TO service_role;


--
-- Name: FUNCTION crear_nota_credito_tx(p_store_id uuid, p_user_id text, p_venta_id uuid, p_items jsonb, p_numero_nc text, p_motivo text, p_tipo_reembolso text, p_metodo_reembolso text, p_fecha_vencimiento date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.crear_nota_credito_tx(p_store_id uuid, p_user_id text, p_venta_id uuid, p_items jsonb, p_numero_nc text, p_motivo text, p_tipo_reembolso text, p_metodo_reembolso text, p_fecha_vencimiento date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.crear_nota_credito_tx(p_store_id uuid, p_user_id text, p_venta_id uuid, p_items jsonb, p_numero_nc text, p_motivo text, p_tipo_reembolso text, p_metodo_reembolso text, p_fecha_vencimiento date) TO service_role;


--
-- Name: FUNCTION crear_venta_tx(p_store_id uuid, p_items jsonb, p_cliente_id uuid, p_worker_clerk_id text, p_subtotal numeric, p_descuento_pct numeric, p_impuesto numeric, p_total numeric, p_metodo_pago text, p_canal text, p_procedencia text, p_numero_comprobante text, p_pago_nc jsonb, p_numero_transaccion text, p_fidelizacion_niveles jsonb, p_dias_aviso integer, p_idempotency_key text, p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.crear_venta_tx(p_store_id uuid, p_items jsonb, p_cliente_id uuid, p_worker_clerk_id text, p_subtotal numeric, p_descuento_pct numeric, p_impuesto numeric, p_total numeric, p_metodo_pago text, p_canal text, p_procedencia text, p_numero_comprobante text, p_pago_nc jsonb, p_numero_transaccion text, p_fidelizacion_niveles jsonb, p_dias_aviso integer, p_idempotency_key text, p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.crear_venta_tx(p_store_id uuid, p_items jsonb, p_cliente_id uuid, p_worker_clerk_id text, p_subtotal numeric, p_descuento_pct numeric, p_impuesto numeric, p_total numeric, p_metodo_pago text, p_canal text, p_procedencia text, p_numero_comprobante text, p_pago_nc jsonb, p_numero_transaccion text, p_fidelizacion_niveles jsonb, p_dias_aviso integer, p_idempotency_key text, p_user_id text) TO service_role;


--
-- Name: FUNCTION cupos_canal_tienda(p_store_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cupos_canal_tienda(p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cupos_canal_tienda(p_store_id uuid) TO service_role;


--
-- Name: FUNCTION decrement_stock(p_producto_id uuid, p_cantidad numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.decrement_stock(p_producto_id uuid, p_cantidad numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decrement_stock(p_producto_id uuid, p_cantidad numeric) TO service_role;


--
-- Name: FUNCTION deducir_stock_fifo(p_producto_id uuid, p_store_id uuid, p_cantidad numeric, p_venta_item_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.deducir_stock_fifo(p_producto_id uuid, p_store_id uuid, p_cantidad numeric, p_venta_item_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.deducir_stock_fifo(p_producto_id uuid, p_store_id uuid, p_cantidad numeric, p_venta_item_id uuid) TO service_role;


--
-- Name: FUNCTION deshacer_apertura_saco(p_store_id uuid, p_producto_id uuid, p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.deshacer_apertura_saco(p_store_id uuid, p_producto_id uuid, p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.deshacer_apertura_saco(p_store_id uuid, p_producto_id uuid, p_user_id text) TO service_role;


--
-- Name: FUNCTION devolver_a_lotes_venta_item(p_venta_item_id uuid, p_ya_devuelto numeric, p_cantidad numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.devolver_a_lotes_venta_item(p_venta_item_id uuid, p_ya_devuelto numeric, p_cantidad numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.devolver_a_lotes_venta_item(p_venta_item_id uuid, p_ya_devuelto numeric, p_cantidad numeric) TO service_role;


--
-- Name: FUNCTION devolver_granel(p_store_id uuid, p_producto_id uuid, p_gramos integer, p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.devolver_granel(p_store_id uuid, p_producto_id uuid, p_gramos integer, p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.devolver_granel(p_store_id uuid, p_producto_id uuid, p_gramos integer, p_user_id text) TO service_role;


--
-- Name: FUNCTION devolver_stock_producto(p_producto_id uuid, p_store_id uuid, p_cantidad numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.devolver_stock_producto(p_producto_id uuid, p_store_id uuid, p_cantidad numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.devolver_stock_producto(p_producto_id uuid, p_store_id uuid, p_cantidad numeric) TO service_role;


--
-- Name: FUNCTION encolar_disponibilidad_canal(p_store_id uuid, p_canal_id text, p_producto_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.encolar_disponibilidad_canal(p_store_id uuid, p_canal_id text, p_producto_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.encolar_disponibilidad_canal(p_store_id uuid, p_canal_id text, p_producto_id uuid) TO service_role;


--
-- Name: FUNCTION estado_cron_canales(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estado_cron_canales() FROM PUBLIC;
GRANT ALL ON FUNCTION public.estado_cron_canales() TO service_role;


--
-- Name: FUNCTION estado_disponibilidad_canal(p_store_id uuid, p_canal_id text, p_producto_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estado_disponibilidad_canal(p_store_id uuid, p_canal_id text, p_producto_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estado_disponibilidad_canal(p_store_id uuid, p_canal_id text, p_producto_id uuid) TO service_role;


--
-- Name: FUNCTION fraccion_gramos(p_gramos integer, p_peso_gramos integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fraccion_gramos(p_gramos integer, p_peso_gramos integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fraccion_gramos(p_gramos integer, p_peso_gramos integer) TO service_role;


--
-- Name: FUNCTION fraccion_saco_abierto(p_producto_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fraccion_saco_abierto(p_producto_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fraccion_saco_abierto(p_producto_id uuid) TO service_role;


--
-- Name: FUNCTION gastar_saldo_a_favor_pago(p_store_id uuid, p_cliente_id uuid, p_venta_id uuid, p_monto numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.gastar_saldo_a_favor_pago(p_store_id uuid, p_cliente_id uuid, p_venta_id uuid, p_monto numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gastar_saldo_a_favor_pago(p_store_id uuid, p_cliente_id uuid, p_venta_id uuid, p_monto numeric) TO service_role;


--
-- Name: FUNCTION get_user_store_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_user_store_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_user_store_id() TO authenticated;
GRANT ALL ON FUNCTION public.get_user_store_id() TO service_role;


--
-- Name: FUNCTION increment_stock(p_producto_id uuid, p_cantidad numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.increment_stock(p_producto_id uuid, p_cantidad numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.increment_stock(p_producto_id uuid, p_cantidad numeric) TO service_role;


--
-- Name: FUNCTION incrementar_saldo_a_favor(p_store_id uuid, p_cliente_id uuid, p_monto numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.incrementar_saldo_a_favor(p_store_id uuid, p_cliente_id uuid, p_monto numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.incrementar_saldo_a_favor(p_store_id uuid, p_cliente_id uuid, p_monto numeric) TO service_role;


--
-- Name: FUNCTION is_system_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_system_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_system_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_system_admin() TO service_role;


--
-- Name: FUNCTION merma_lote_vencido(p_store_id uuid, p_lote_id uuid, p_motivo text, p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.merma_lote_vencido(p_store_id uuid, p_lote_id uuid, p_motivo text, p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merma_lote_vencido(p_store_id uuid, p_lote_id uuid, p_motivo text, p_user_id text) TO service_role;


--
-- Name: FUNCTION proteger_peso_con_saco_abierto(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.proteger_peso_con_saco_abierto() TO anon;
GRANT ALL ON FUNCTION public.proteger_peso_con_saco_abierto() TO authenticated;
GRANT ALL ON FUNCTION public.proteger_peso_con_saco_abierto() TO service_role;


--
-- Name: FUNCTION registrar_lote(p_store_id uuid, p_producto_id uuid, p_cantidad_inicial numeric, p_fecha_vencimiento date, p_user_id text, p_cantidad_actual numeric, p_numero_lote text, p_fecha_ingreso date, p_orden_compra_id uuid, p_notas text, p_fecha_venc_stock_existente date, p_movimiento_notas text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_lote(p_store_id uuid, p_producto_id uuid, p_cantidad_inicial numeric, p_fecha_vencimiento date, p_user_id text, p_cantidad_actual numeric, p_numero_lote text, p_fecha_ingreso date, p_orden_compra_id uuid, p_notas text, p_fecha_venc_stock_existente date, p_movimiento_notas text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_lote(p_store_id uuid, p_producto_id uuid, p_cantidad_inicial numeric, p_fecha_vencimiento date, p_user_id text, p_cantidad_actual numeric, p_numero_lote text, p_fecha_ingreso date, p_orden_compra_id uuid, p_notas text, p_fecha_venc_stock_existente date, p_movimiento_notas text) TO service_role;


--
-- Name: TABLE servicio_horarios; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.servicio_horarios TO anon;
GRANT ALL ON TABLE public.servicio_horarios TO authenticated;
GRANT ALL ON TABLE public.servicio_horarios TO service_role;


--
-- Name: FUNCTION replace_servicio_horarios(p_servicio_id uuid, p_store_id uuid, p_horarios jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.replace_servicio_horarios(p_servicio_id uuid, p_store_id uuid, p_horarios jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.replace_servicio_horarios(p_servicio_id uuid, p_store_id uuid, p_horarios jsonb) TO service_role;


--
-- Name: FUNCTION revertir_saldo_a_favor(p_store_id uuid, p_cliente_id uuid, p_monto numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.revertir_saldo_a_favor(p_store_id uuid, p_cliente_id uuid, p_monto numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revertir_saldo_a_favor(p_store_id uuid, p_cliente_id uuid, p_monto numeric) TO service_role;


--
-- Name: FUNCTION stores_asignar_negocio(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.stores_asignar_negocio() FROM PUBLIC;
GRANT ALL ON FUNCTION public.stores_asignar_negocio() TO service_role;


--
-- Name: FUNCTION sync_producto_fecha_vencimiento(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_producto_fecha_vencimiento() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_producto_fecha_vencimiento() TO service_role;


--
-- Name: FUNCTION sync_producto_stock_from_lotes(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_producto_stock_from_lotes() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_producto_stock_from_lotes() TO service_role;


--
-- Name: FUNCTION sync_ventas_historico(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_ventas_historico() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_ventas_historico() TO service_role;


--
-- Name: FUNCTION trg_canal_producto_config_disponibilidad(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.trg_canal_producto_config_disponibilidad() FROM PUBLIC;
GRANT ALL ON FUNCTION public.trg_canal_producto_config_disponibilidad() TO service_role;


--
-- Name: FUNCTION trg_productos_disponibilidad_canal(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.trg_productos_disponibilidad_canal() FROM PUBLIC;
GRANT ALL ON FUNCTION public.trg_productos_disponibilidad_canal() TO service_role;


--
-- Name: FUNCTION unidades_vendibles_canal(p_producto_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.unidades_vendibles_canal(p_producto_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.unidades_vendibles_canal(p_producto_id uuid) TO service_role;


--
-- Name: FUNCTION update_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at() TO service_role;


--
-- Name: TABLE ai_pos_cache; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_pos_cache TO anon;
GRANT ALL ON TABLE public.ai_pos_cache TO authenticated;
GRANT ALL ON TABLE public.ai_pos_cache TO service_role;


--
-- Name: TABLE ai_vencimientos_analisis; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_vencimientos_analisis TO anon;
GRANT ALL ON TABLE public.ai_vencimientos_analisis TO authenticated;
GRANT ALL ON TABLE public.ai_vencimientos_analisis TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_logs TO anon;
GRANT ALL ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE auth_failures; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.auth_failures TO anon;
GRANT ALL ON TABLE public.auth_failures TO authenticated;
GRANT ALL ON TABLE public.auth_failures TO service_role;


--
-- Name: TABLE businesses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.businesses TO anon;
GRANT ALL ON TABLE public.businesses TO authenticated;
GRANT ALL ON TABLE public.businesses TO service_role;


--
-- Name: TABLE canal_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.canal_config TO anon;
GRANT ALL ON TABLE public.canal_config TO authenticated;
GRANT ALL ON TABLE public.canal_config TO service_role;


--
-- Name: TABLE canal_liquidaciones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.canal_liquidaciones TO anon;
GRANT ALL ON TABLE public.canal_liquidaciones TO authenticated;
GRANT ALL ON TABLE public.canal_liquidaciones TO service_role;


--
-- Name: TABLE canal_ordenes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.canal_ordenes TO anon;
GRANT ALL ON TABLE public.canal_ordenes TO authenticated;
GRANT ALL ON TABLE public.canal_ordenes TO service_role;


--
-- Name: TABLE canal_producto_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.canal_producto_config TO anon;
GRANT ALL ON TABLE public.canal_producto_config TO authenticated;
GRANT ALL ON TABLE public.canal_producto_config TO service_role;


--
-- Name: TABLE canales_externos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.canales_externos TO anon;
GRANT ALL ON TABLE public.canales_externos TO authenticated;
GRANT ALL ON TABLE public.canales_externos TO service_role;


--
-- Name: TABLE categorias; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.categorias TO anon;
GRANT ALL ON TABLE public.categorias TO authenticated;
GRANT ALL ON TABLE public.categorias TO service_role;


--
-- Name: TABLE cierre_mes_backups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cierre_mes_backups TO anon;
GRANT ALL ON TABLE public.cierre_mes_backups TO authenticated;
GRANT ALL ON TABLE public.cierre_mes_backups TO service_role;


--
-- Name: TABLE clerk_users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.clerk_users TO anon;
GRANT ALL ON TABLE public.clerk_users TO authenticated;
GRANT ALL ON TABLE public.clerk_users TO service_role;


--
-- Name: TABLE clientes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.clientes TO anon;
GRANT ALL ON TABLE public.clientes TO authenticated;
GRANT ALL ON TABLE public.clientes TO service_role;


--
-- Name: TABLE consumo_alertas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consumo_alertas TO anon;
GRANT ALL ON TABLE public.consumo_alertas TO authenticated;
GRANT ALL ON TABLE public.consumo_alertas TO service_role;


--
-- Name: TABLE consumo_configs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consumo_configs TO anon;
GRANT ALL ON TABLE public.consumo_configs TO authenticated;
GRANT ALL ON TABLE public.consumo_configs TO service_role;


--
-- Name: TABLE cuentas_pagar; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cuentas_pagar TO anon;
GRANT ALL ON TABLE public.cuentas_pagar TO authenticated;
GRANT ALL ON TABLE public.cuentas_pagar TO service_role;


--
-- Name: TABLE encargados; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.encargados TO anon;
GRANT ALL ON TABLE public.encargados TO authenticated;
GRANT ALL ON TABLE public.encargados TO service_role;


--
-- Name: TABLE error_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.error_logs TO anon;
GRANT ALL ON TABLE public.error_logs TO authenticated;
GRANT ALL ON TABLE public.error_logs TO service_role;


--
-- Name: TABLE fidelizacion; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fidelizacion TO anon;
GRANT ALL ON TABLE public.fidelizacion TO authenticated;
GRANT ALL ON TABLE public.fidelizacion TO service_role;


--
-- Name: TABLE instagram_post_media; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.instagram_post_media TO anon;
GRANT ALL ON TABLE public.instagram_post_media TO authenticated;
GRANT ALL ON TABLE public.instagram_post_media TO service_role;


--
-- Name: TABLE instagram_posts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.instagram_posts TO anon;
GRANT ALL ON TABLE public.instagram_posts TO authenticated;
GRANT ALL ON TABLE public.instagram_posts TO service_role;


--
-- Name: TABLE journal_detail; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.journal_detail TO anon;
GRANT ALL ON TABLE public.journal_detail TO authenticated;
GRANT ALL ON TABLE public.journal_detail TO service_role;


--
-- Name: TABLE journal_entries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.journal_entries TO anon;
GRANT ALL ON TABLE public.journal_entries TO authenticated;
GRANT ALL ON TABLE public.journal_entries TO service_role;


--
-- Name: TABLE lotes_producto; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lotes_producto TO anon;
GRANT ALL ON TABLE public.lotes_producto TO authenticated;
GRANT ALL ON TABLE public.lotes_producto TO service_role;


--
-- Name: TABLE mascotas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mascotas TO anon;
GRANT ALL ON TABLE public.mascotas TO authenticated;
GRANT ALL ON TABLE public.mascotas TO service_role;


--
-- Name: TABLE nota_credito_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nota_credito_items TO anon;
GRANT ALL ON TABLE public.nota_credito_items TO authenticated;
GRANT ALL ON TABLE public.nota_credito_items TO service_role;


--
-- Name: TABLE notas_credito; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notas_credito TO anon;
GRANT ALL ON TABLE public.notas_credito TO authenticated;
GRANT ALL ON TABLE public.notas_credito TO service_role;


--
-- Name: TABLE ordenes_compra; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ordenes_compra TO anon;
GRANT ALL ON TABLE public.ordenes_compra TO authenticated;
GRANT ALL ON TABLE public.ordenes_compra TO service_role;


--
-- Name: TABLE ordenes_compra_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ordenes_compra_items TO anon;
GRANT ALL ON TABLE public.ordenes_compra_items TO authenticated;
GRANT ALL ON TABLE public.ordenes_compra_items TO service_role;


--
-- Name: TABLE pagos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pagos TO anon;
GRANT ALL ON TABLE public.pagos TO authenticated;
GRANT ALL ON TABLE public.pagos TO service_role;


--
-- Name: TABLE productos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.productos TO anon;
GRANT ALL ON TABLE public.productos TO authenticated;
GRANT ALL ON TABLE public.productos TO service_role;


--
-- Name: TABLE proveedor_productos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.proveedor_productos TO anon;
GRANT ALL ON TABLE public.proveedor_productos TO authenticated;
GRANT ALL ON TABLE public.proveedor_productos TO service_role;


--
-- Name: TABLE proveedores; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.proveedores TO anon;
GRANT ALL ON TABLE public.proveedores TO authenticated;
GRANT ALL ON TABLE public.proveedores TO service_role;


--
-- Name: TABLE sacos_abiertos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sacos_abiertos TO anon;
GRANT ALL ON TABLE public.sacos_abiertos TO authenticated;
GRANT ALL ON TABLE public.sacos_abiertos TO service_role;


--
-- Name: TABLE saldos_a_favor; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.saldos_a_favor TO anon;
GRANT ALL ON TABLE public.saldos_a_favor TO authenticated;
GRANT ALL ON TABLE public.saldos_a_favor TO service_role;


--
-- Name: TABLE servicio_excepciones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.servicio_excepciones TO anon;
GRANT ALL ON TABLE public.servicio_excepciones TO authenticated;
GRANT ALL ON TABLE public.servicio_excepciones TO service_role;


--
-- Name: TABLE servicios; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.servicios TO anon;
GRANT ALL ON TABLE public.servicios TO authenticated;
GRANT ALL ON TABLE public.servicios TO service_role;


--
-- Name: TABLE stock_movements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stock_movements TO anon;
GRANT ALL ON TABLE public.stock_movements TO authenticated;
GRANT ALL ON TABLE public.stock_movements TO service_role;


--
-- Name: TABLE stores; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stores TO anon;
GRANT ALL ON TABLE public.stores TO authenticated;
GRANT ALL ON TABLE public.stores TO service_role;


--
-- Name: TABLE user_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_sessions TO anon;
GRANT ALL ON TABLE public.user_sessions TO authenticated;
GRANT ALL ON TABLE public.user_sessions TO service_role;


--
-- Name: TABLE venta_item_lotes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.venta_item_lotes TO anon;
GRANT ALL ON TABLE public.venta_item_lotes TO authenticated;
GRANT ALL ON TABLE public.venta_item_lotes TO service_role;


--
-- Name: TABLE venta_item_sacos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.venta_item_sacos TO anon;
GRANT ALL ON TABLE public.venta_item_sacos TO authenticated;
GRANT ALL ON TABLE public.venta_item_sacos TO service_role;


--
-- Name: TABLE venta_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.venta_items TO anon;
GRANT ALL ON TABLE public.venta_items TO authenticated;
GRANT ALL ON TABLE public.venta_items TO service_role;


--
-- Name: TABLE ventas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ventas TO anon;
GRANT ALL ON TABLE public.ventas TO authenticated;
GRANT ALL ON TABLE public.ventas TO service_role;


--
-- Name: TABLE ventas_historico; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ventas_historico TO anon;
GRANT ALL ON TABLE public.ventas_historico TO authenticated;
GRANT ALL ON TABLE public.ventas_historico TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--


-- =============================================================================
-- Storage: bucket instagram-media (público) y sus políticas, copiadas del demo
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('instagram-media', 'instagram-media', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS instagram_media_authenticated_read ON storage.objects;
CREATE POLICY instagram_media_authenticated_read ON storage.objects
  FOR SELECT TO public
  USING ((bucket_id = 'instagram-media'::text) AND (auth.role() = 'authenticated'::text));

DROP POLICY IF EXISTS instagram_media_delete ON storage.objects;
CREATE POLICY instagram_media_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'instagram-media'::text);

DROP POLICY IF EXISTS instagram_media_upload ON storage.objects;
CREATE POLICY instagram_media_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'instagram-media'::text);
