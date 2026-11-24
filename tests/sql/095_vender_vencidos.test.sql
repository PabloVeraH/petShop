-- Pruebas de la migración 095 (vender productos vencidos) contra la RPC real.
-- Solo Postgres local desechable: ver tests/sql/README.md. IDs VENC-SQL-01…09
-- (docs/spec-registry.md). Todo dentro de una transacción con ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;

CREATE SCHEMA t;

-- Ejecuta una sentencia y exige que falle con EXACTAMENTE ese mensaje. El
-- bloque EXCEPTION revierte lo que la sentencia alcanzó a hacer.
CREATE FUNCTION t.falla_msg(p_id text, p_sql text, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION '% — se esperaba el error "%" y no falló', p_id, p_msg;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> p_msg THEN
    RAISE EXCEPTION '% — se esperaba "%" y llegó "%"', p_id, p_msg, SQLERRM;
  END IF;
END;
$$;

-- ── Datos ───────────────────────────────────────────────────────────────────
-- Tienda A: vender_vencidos según cada prueba. Tienda B: siempre true (no debe
-- afectar a A).
INSERT INTO businesses (id, name) VALUES ('30000000-0000-0000-0000-0000000000b1', 'Negocio V');
INSERT INTO stores (id, name, business_id) VALUES
  ('30000000-0000-0000-0000-00000000000a', 'Tienda A', '30000000-0000-0000-0000-0000000000b1'),
  ('30000000-0000-0000-0000-00000000000b', 'Tienda B', '30000000-0000-0000-0000-0000000000b1');
UPDATE stores SET vender_vencidos = true WHERE id = '30000000-0000-0000-0000-00000000000b';

-- f1: solo un lote vencido (el caso BOKATO). f2: un lote vencido (ingresó
-- antes) + uno vigente.
INSERT INTO productos (id, store_id, sku, nombre, precio, stock) VALUES
  ('30000000-0000-0000-0000-0000000000f1', '30000000-0000-0000-0000-00000000000a', 'V1', 'Saco 20 kg', 20000, 0),
  ('30000000-0000-0000-0000-0000000000f2', '30000000-0000-0000-0000-00000000000a', 'V2', 'Saco 10 kg', 10000, 0);
INSERT INTO lotes_producto (id, store_id, producto_id, cantidad_inicial, cantidad_actual, fecha_vencimiento, fecha_ingreso) VALUES
  ('30000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000f1', 1, 1, public.hoy_negocio() - 23, public.hoy_negocio() - 34),
  ('30000000-0000-0000-0000-0000000000d2', '30000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000f2', 1, 1, public.hoy_negocio() - 1,  public.hoy_negocio() - 60),
  ('30000000-0000-0000-0000-0000000000d3', '30000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000f2', 1, 1, public.hoy_negocio() + 90, public.hoy_negocio() - 5);

-- Atajo: crear_venta_tx de N unidades en la tienda A por el canal indicado.
CREATE FUNCTION t.venta(p_producto uuid, p_cantidad int, p_canal text DEFAULT 'pos') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.crear_venta_tx(
    p_store_id => '30000000-0000-0000-0000-00000000000a',
    p_items => jsonb_build_array(jsonb_build_object(
      'producto_id', p_producto, 'cantidad', p_cantidad,
      'precio_unitario', 1000, 'subtotal', 1000 * p_cantidad, 'es_granel', false)),
    p_cliente_id => NULL, p_worker_clerk_id => NULL,
    p_subtotal => 1000 * p_cantidad, p_descuento_pct => 0, p_impuesto => 0, p_total => 1000 * p_cantidad,
    p_metodo_pago => CASE WHEN p_canal = 'pos' THEN NULL ELSE 'plataforma' END,
    p_canal => p_canal, p_procedencia => CASE WHEN p_canal = 'pos' THEN 'presencial' ELSE p_canal END,
    p_numero_comprobante => 'T-' || substr(md5(random()::text), 1, 8),
    p_pago_nc => NULL, p_numero_transaccion => CASE WHEN p_canal = 'pos' THEN NULL ELSE 'X-1' END,
    p_fidelizacion_niveles => '[]', p_dias_aviso => 5, p_idempotency_key => NULL, p_user_id => NULL,
    p_pagos => CASE WHEN p_canal = 'pos'
                    THEN jsonb_build_array(jsonb_build_object('metodo', 'efectivo', 'monto', 1000 * p_cantidad))
                    ELSE NULL END)
$$;

DO $$
DECLARE
  r    jsonb;
  v_id uuid;
BEGIN
  -- VENC-SQL-01: la columna existe, NOT NULL, default false (ninguna tienda
  -- cambia de comportamiento al aplicar la migración).
  ASSERT (SELECT is_nullable || ':' || column_default FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'vender_vencidos')
         = 'NO:false', 'VENC-SQL-01 columna';
  ASSERT (SELECT vender_vencidos FROM stores WHERE id = '30000000-0000-0000-0000-00000000000a') = false, 'VENC-SQL-01 default';

  -- VENC-SQL-02: una sola firma de deducir_stock_fifo (sin sobrecarga vieja).
  ASSERT (SELECT count(*) FROM pg_proc WHERE proname = 'deducir_stock_fifo') = 1, 'VENC-SQL-02 una firma';

  -- VENC-SQL-03 (REGRESIÓN BOKATO): stock 1 en un lote vencido y la opción
  -- desactivada → no vende, con el producto y el desglose en el mensaje (antes:
  -- "disponible 0 unidades vigentes" y la ruta lo ocultaba). Aunque la tienda B
  -- tenga la opción activada.
  ASSERT (SELECT stock FROM productos WHERE id = '30000000-0000-0000-0000-0000000000f1') = 1, 'VENC-SQL-03 stock visible 1';
  PERFORM t.falla_msg('VENC-SQL-03',
    $q$SELECT t.venta('30000000-0000-0000-0000-0000000000f1', 1)$q$,
    'Stock insuficiente para "Saco 20 kg": vigentes 0, en lotes vencidos 1, solicitado 1');
  ASSERT (SELECT count(*) FROM ventas WHERE store_id = '30000000-0000-0000-0000-00000000000a') = 0, 'VENC-SQL-03 sin venta';
  ASSERT (SELECT cantidad_actual FROM lotes_producto WHERE id = '30000000-0000-0000-0000-0000000000d1') = 1, 'VENC-SQL-03 lote intacto';

  -- VENC-SQL-04: el descuento manual (4 argumentos, PATCH /api/inventario/[id])
  -- sigue sin tocar lotes vencidos aunque la tienda tenga la opción activada.
  UPDATE stores SET vender_vencidos = true WHERE id = '30000000-0000-0000-0000-00000000000a';
  PERFORM t.falla_msg('VENC-SQL-04',
    $q$SELECT public.deducir_stock_fifo('30000000-0000-0000-0000-0000000000f1', '30000000-0000-0000-0000-00000000000a', 1)$q$,
    'Stock insuficiente para "Saco 20 kg": vigentes 0, en lotes vencidos 1, solicitado 1');

  -- VENC-SQL-05: canal externo nunca vende vencidos, aunque la opción esté activa.
  PERFORM t.falla_msg('VENC-SQL-05',
    $q$SELECT t.venta('30000000-0000-0000-0000-0000000000f1', 1, 'rappi')$q$,
    'Stock insuficiente para "Saco 20 kg": vigentes 0, en lotes vencidos 1, solicitado 1');

  -- VENC-SQL-06: opción activa + POS → la venta se completa desde el lote
  -- vencido; el stock queda en 0 y el lote usado queda trazado.
  r := t.venta('30000000-0000-0000-0000-0000000000f1', 1);
  v_id := (r->'venta'->>'id')::uuid;
  ASSERT (r->>'created')::boolean, 'VENC-SQL-06 venta creada';
  ASSERT (SELECT cantidad_actual FROM lotes_producto WHERE id = '30000000-0000-0000-0000-0000000000d1') = 0, 'VENC-SQL-06 lote descontado';
  ASSERT (SELECT stock FROM productos WHERE id = '30000000-0000-0000-0000-0000000000f1') = 0, 'VENC-SQL-06 stock 0';
  ASSERT (SELECT count(*) FROM venta_item_lotes vil JOIN venta_items vi ON vi.id = vil.venta_item_id
           WHERE vi.venta_id = v_id AND vil.lote_id = '30000000-0000-0000-0000-0000000000d1') = 1, 'VENC-SQL-06 trazabilidad';

  -- VENC-SQL-07: opción activa → primero el lote vigente aunque el vencido
  -- haya ingresado antes. El vencido se vende solo si no queda vigente.
  r := t.venta('30000000-0000-0000-0000-0000000000f2', 1);
  ASSERT (SELECT cantidad_actual FROM lotes_producto WHERE id = '30000000-0000-0000-0000-0000000000d3') = 0, 'VENC-SQL-07 vigente primero';
  ASSERT (SELECT cantidad_actual FROM lotes_producto WHERE id = '30000000-0000-0000-0000-0000000000d2') = 1, 'VENC-SQL-07 vencido intacto';

  -- VENC-SQL-08: pedir más que vigentes + vencidos → error con el total
  -- disponible (aquí queda 1 vencido; se piden 2).
  PERFORM t.falla_msg('VENC-SQL-08',
    $q$SELECT t.venta('30000000-0000-0000-0000-0000000000f2', 2)$q$,
    'Stock insuficiente para "Saco 10 kg": disponible 1, solicitado 2');

  -- VENC-SQL-09: opción desactivada de nuevo → vuelve a bloquear el vencido.
  UPDATE stores SET vender_vencidos = false WHERE id = '30000000-0000-0000-0000-00000000000a';
  PERFORM t.falla_msg('VENC-SQL-09',
    $q$SELECT t.venta('30000000-0000-0000-0000-0000000000f2', 1)$q$,
    'Stock insuficiente para "Saco 10 kg": vigentes 0, en lotes vencidos 1, solicitado 1');
END $$;

\echo 'VENC-SQL: todas las pruebas pasaron'
ROLLBACK;
