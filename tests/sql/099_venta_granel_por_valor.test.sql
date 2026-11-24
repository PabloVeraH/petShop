-- Pruebas de la migración 099 (venta a granel por valor) contra las funciones
-- reales. Solo Postgres local desechable: ver tests/sql/README.md. IDs
-- VGV-SQL-01…10 (docs/spec-registry.md). Transacción con ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;

CREATE SCHEMA t;

INSERT INTO businesses (id, name) VALUES ('50000000-0000-0000-0000-0000000000b1', 'Negocio G');
INSERT INTO stores (id, name, business_id) VALUES
  ('50000000-0000-0000-0000-00000000000a', 'Tienda A', '50000000-0000-0000-0000-0000000000b1');
INSERT INTO clientes (id, store_id, rut, nombre) VALUES
  ('50000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-00000000000a', '55555555-5', 'Cliente G');
INSERT INTO productos (id, store_id, sku, nombre, precio, stock, peso_gramos, precio_venta_kg) VALUES
  ('50000000-0000-0000-0000-0000000000f1', '50000000-0000-0000-0000-00000000000a', 'G1', 'Granel', 60000, 5, 20000, 11000),
  ('50000000-0000-0000-0000-0000000000f2', '50000000-0000-0000-0000-00000000000a', 'U1', 'Unidad', 3333, 10, NULL, NULL);

-- Venta a granel como la registra POST /api/ventas.
CREATE FUNCTION t.venta(p_gramos int, p_subtotal numeric, p_desc numeric DEFAULT 0) RETURNS uuid LANGUAGE sql AS $$
  SELECT (public.crear_venta_tx(
    p_store_id => '50000000-0000-0000-0000-00000000000a',
    p_items => jsonb_build_array(jsonb_build_object(
      'producto_id', '50000000-0000-0000-0000-0000000000f1', 'cantidad', p_gramos / 1000.0, 'precio_unitario', 11000,
      'subtotal', p_subtotal, 'es_granel', true, 'gramos', p_gramos, 'abrir_saco', true)),
    p_cliente_id => '50000000-0000-0000-0000-0000000000c1', p_worker_clerk_id => NULL,
    p_subtotal => p_subtotal, p_descuento_pct => p_desc, p_impuesto => 0, p_total => ROUND(p_subtotal * (100 - p_desc) / 100),
    p_metodo_pago => NULL, p_canal => 'pos', p_procedencia => 'presencial',
    p_numero_comprobante => 'G-' || substr(md5(random()::text), 1, 8),
    p_pago_nc => NULL, p_numero_transaccion => NULL,
    p_fidelizacion_niveles => '[]', p_dias_aviso => 5, p_idempotency_key => NULL, p_user_id => 'u-test',
    p_pagos => jsonb_build_array(jsonb_build_object('metodo', 'efectivo', 'monto', ROUND(p_subtotal * (100 - p_desc) / 100))))
  ->'venta'->>'id')::uuid
$$;

CREATE FUNCTION t.devolver(p_venta uuid, p_kg numeric) RETURNS int LANGUAGE sql AS $$
  SELECT (public.crear_nota_credito_tx(
    p_store_id => '50000000-0000-0000-0000-00000000000a', p_user_id => 'u-test', p_venta_id => p_venta,
    p_items => jsonb_build_array(jsonb_build_object(
      'venta_item_id', (SELECT id FROM venta_items WHERE venta_id = p_venta), 'cantidad_devuelta', p_kg, 'restituir_stock', true)),
    p_numero_nc => 'NC-' || substr(md5(random()::text), 1, 10), p_motivo => NULL,
    p_tipo_reembolso => 'saldo_a_favor', p_metodo_reembolso => NULL, p_fecha_vencimiento => public.hoy_negocio() + 30)
  ->>'monto_total')::int
$$;

DO $$
DECLARE
  v uuid;
  a int; b int; c int;
  g0 int; g1 int;
BEGIN
  -- VGV-SQL-01: columna NOT NULL default 'gramos' (ninguna tienda cambia) y solo
  -- acepta gramos/valor.
  ASSERT (SELECT is_nullable || ':' || column_default FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'venta_granel_por')
         = 'NO:''gramos''::text', 'VGV-SQL-01 columna';
  ASSERT (SELECT venta_granel_por FROM stores WHERE id = '50000000-0000-0000-0000-00000000000a') = 'gramos', 'VGV-SQL-01 default';
  BEGIN
    UPDATE stores SET venta_granel_por = 'kilos';
    RAISE EXCEPTION 'VGV-SQL-01 — aceptó un modo desconocido';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- VGV-SQL-02: por valor, la línea guarda el monto exacto y los gramos; el saco
  -- baja justo esos gramos.
  v := t.venta(182, 2000);
  ASSERT (SELECT subtotal = 2000 AND gramos = 182 AND cantidad = 0.182 AND precio_unitario = 11000 FROM venta_items WHERE venta_id = v), 'VGV-SQL-02 línea';
  ASSERT (SELECT total FROM ventas WHERE id = v) = 2000, 'VGV-SQL-02 total';
  SELECT SUM(gramos_restantes) INTO g0 FROM sacos_abiertos WHERE cerrado_at IS NULL;
  ASSERT g0 = 20000 - 182, 'VGV-SQL-02 saco';

  -- VGV-SQL-03 (REGRESIÓN): la devolución completa devuelve lo cobrado ($2.000;
  -- antes 0,182 × 11.000 = $2.002) y los gramos vuelven al saco.
  ASSERT t.devolver(v, 0.182) = 2000, 'VGV-SQL-03 monto';
  SELECT SUM(gramos_restantes) INTO g1 FROM sacos_abiertos WHERE cerrado_at IS NULL;
  ASSERT g1 = 20000, 'VGV-SQL-03 saco';
  ASSERT (SELECT saldo_disponible FROM saldos_a_favor WHERE cliente_id = '50000000-0000-0000-0000-0000000000c1') = 2000, 'VGV-SQL-03 saldo';

  -- VGV-SQL-04: en tres parciales, la suma es exactamente lo cobrado.
  v := t.venta(182, 2000);
  a := t.devolver(v, 0.061);
  b := t.devolver(v, 0.061);
  c := t.devolver(v, 0.060);
  ASSERT a > 0 AND b > 0 AND c > 0 AND a + b + c = 2000, format('VGV-SQL-04 %s+%s+%s', a, b, c);

  -- VGV-SQL-05: con descuento devuelve la parte del monto con descuento.
  v := t.venta(182, 2000, 10);
  ASSERT (SELECT total FROM ventas WHERE id = v) = 1800, 'VGV-SQL-05 total';
  ASSERT t.devolver(v, 0.182) = 1800, 'VGV-SQL-05 devolución';

  -- VGV-SQL-06: venta por gramos (subtotal = gramos × precio): igual que antes.
  v := t.venta(500, 5500);
  ASSERT t.devolver(v, 0.200) = 2200, 'VGV-SQL-06 parcial';
  ASSERT t.devolver(v, 0.300) = 3300, 'VGV-SQL-06 resto';

  -- VGV-SQL-07: no se puede devolver más de lo vendido.
  v := t.venta(182, 2000);
  BEGIN
    PERFORM t.devolver(v, 0.183);
    RAISE EXCEPTION 'VGV-SQL-07 — devolvió más de lo vendido' USING ERRCODE = 'ZZ999';
  EXCEPTION WHEN raise_exception THEN
    ASSERT position('excede el disponible' IN SQLERRM) > 0, 'VGV-SQL-07 ' || SQLERRM;
  END;
END $$;

-- VGV-SQL-08: la línea por unidad no cambia (2 × 3.333 con 10 % = 5.999,4 → 5.999).
DO $$
DECLARE
  v uuid;
  r jsonb;
BEGIN
  v := (public.crear_venta_tx(
    p_store_id => '50000000-0000-0000-0000-00000000000a',
    p_items => '[{"producto_id":"50000000-0000-0000-0000-0000000000f2","cantidad":3,"precio_unitario":3333,"subtotal":9999,"es_granel":false}]',
    p_cliente_id => '50000000-0000-0000-0000-0000000000c1', p_worker_clerk_id => NULL,
    p_subtotal => 9999, p_descuento_pct => 10, p_impuesto => 0, p_total => 8999,
    p_metodo_pago => NULL, p_canal => 'pos', p_procedencia => 'presencial', p_numero_comprobante => 'G-U',
    p_pago_nc => NULL, p_numero_transaccion => NULL, p_fidelizacion_niveles => '[]', p_dias_aviso => 5,
    p_idempotency_key => NULL, p_user_id => NULL, p_pagos => '[{"metodo":"efectivo","monto":8999}]')->'venta'->>'id')::uuid;
  ASSERT t.devolver(v, 2) = 5999, 'VGV-SQL-08';
END $$;

-- VGV-SQL-09 (REGRESIÓN): la misma línea repetida se rechaza y no deja nada
-- (antes: venta de $1.000 → nota de crédito de $2.000).
DO $$
DECLARE
  v uuid;
  i uuid;
  n int;
BEGIN
  v := t.venta(500, 5500);
  SELECT id INTO i FROM venta_items WHERE venta_id = v;
  SELECT count(*) INTO n FROM notas_credito;
  BEGIN
    PERFORM public.crear_nota_credito_tx('50000000-0000-0000-0000-00000000000a', 'u-test', v,
      jsonb_build_array(jsonb_build_object('venta_item_id', i, 'cantidad_devuelta', 0.5), jsonb_build_object('venta_item_id', upper(i::text), 'cantidad_devuelta', 0.5)),
      'NC-DUP', NULL, 'saldo_a_favor', NULL, public.hoy_negocio() + 30);
    RAISE EXCEPTION 'VGV-SQL-09 — aceptó la línea repetida' USING ERRCODE = 'ZZ999';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE 'Cantidad inválida%repetido%', 'VGV-SQL-09 ' || SQLERRM;
  END;
  ASSERT (SELECT count(*) FROM notas_credito) = n, 'VGV-SQL-09 sin NC';

  -- VGV-SQL-10: la venta se bloquea (dos devoluciones simultáneas). La carrera
  -- real se comprobó con dos sesiones; aquí, que el bloqueo no desaparezca.
  ASSERT (SELECT prosrc FROM pg_proc WHERE proname = 'crear_nota_credito_tx') ~ 'FROM ventas\s+WHERE id = p_venta_id AND store_id = p_store_id\s+FOR UPDATE', 'VGV-SQL-10';
END $$;

\echo 'VGV-SQL: todas las pruebas pasaron'
ROLLBACK;
