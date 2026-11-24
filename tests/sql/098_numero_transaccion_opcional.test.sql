-- Pruebas de la migración 098 (Nro. Transacción en ventas) contra las RPC
-- reales. Solo Postgres local desechable: ver tests/sql/README.md. IDs
-- NTX-SQL-01…08 (docs/spec-registry.md). Transacción con ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;

CREATE SCHEMA t;

CREATE FUNCTION t.falla(p_id text, p_sql text, p_code text, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION '% — se esperaba un error y no falló', p_id USING ERRCODE = 'ZZ999';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_code OR position(p_msg IN SQLERRM) = 0 THEN
    RAISE EXCEPTION '% — se esperaba %: "%" y llegó %: "%"', p_id, p_code, p_msg, SQLSTATE, SQLERRM;
  END IF;
END;
$$;

-- Tienda A: la de las pruebas. Tienda B: siempre opcional (no debe afectar a A).
INSERT INTO businesses (id, name) VALUES ('40000000-0000-0000-0000-0000000000b1', 'Negocio N');
INSERT INTO stores (id, name, business_id) VALUES
  ('40000000-0000-0000-0000-00000000000a', 'Tienda A', '40000000-0000-0000-0000-0000000000b1'),
  ('40000000-0000-0000-0000-00000000000b', 'Tienda B', '40000000-0000-0000-0000-0000000000b1');
UPDATE stores SET numero_transaccion_obligatorio = false WHERE id = '40000000-0000-0000-0000-00000000000b';
INSERT INTO clientes (id, store_id, rut, nombre) VALUES
  ('40000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-00000000000a', '44444444-4', 'Cliente N');
INSERT INTO productos (id, store_id, sku, nombre, precio, stock) VALUES
  ('40000000-0000-0000-0000-0000000000f1', '40000000-0000-0000-0000-00000000000a', 'N1', 'Producto N', 1000, 100);
INSERT INTO servicios (id, store_id, nombre, duracion_minutos) VALUES
  ('40000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-00000000000a', 'Baño', 60);
INSERT INTO citas (id, store_id, servicio_id, cliente_id, fecha, hora_inicio, hora_fin, duracion_minutos, created_by, estado, precio) VALUES
  ('40000000-0000-0000-0000-0000000000d2', '40000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-0000000000c1', public.hoy_negocio(), '10:00', '11:00', 60, 'test', 'confirmada', 15000);

CREATE FUNCTION t.venta(p_pagos jsonb, p_metodo text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.crear_venta_tx(
    p_store_id => '40000000-0000-0000-0000-00000000000a',
    p_items => '[{"producto_id":"40000000-0000-0000-0000-0000000000f1","cantidad":2,"precio_unitario":1000,"subtotal":2000,"es_granel":false}]',
    p_cliente_id => NULL, p_worker_clerk_id => NULL,
    p_subtotal => 2000, p_descuento_pct => 0, p_impuesto => 319, p_total => 2000,
    p_metodo_pago => p_metodo, p_canal => 'pos', p_procedencia => 'presencial',
    p_numero_comprobante => 'N-' || substr(md5(random()::text), 1, 8),
    p_pago_nc => NULL, p_numero_transaccion => NULL,
    p_fidelizacion_niveles => '[]', p_dias_aviso => 5, p_idempotency_key => NULL, p_user_id => NULL,
    p_pagos => p_pagos)
$$;
CREATE FUNCTION t.cita(p_pagos jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.completar_cita_tx(
    p_cita_id => '40000000-0000-0000-0000-0000000000d2', p_store_id => '40000000-0000-0000-0000-00000000000a',
    p_metodo_pago => NULL, p_numero_transaccion => NULL, p_impuesto => 2395,
    p_pago_nc => NULL, p_fidelizacion_niveles => '[]', p_completado_por => NULL, p_pagos => p_pagos)
$$;

DO $$
DECLARE
  m text;
  r jsonb;
BEGIN
  -- NTX-SQL-01: columna NOT NULL default true (ninguna tienda cambia al aplicar)
  -- y una sola firma de validar_pagos.
  ASSERT (SELECT is_nullable || ':' || column_default FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'numero_transaccion_obligatorio')
         = 'NO:true', 'NTX-SQL-01 columna';
  ASSERT (SELECT numero_transaccion_obligatorio FROM stores WHERE id = '40000000-0000-0000-0000-00000000000a'), 'NTX-SQL-01 default';
  ASSERT (SELECT count(*) FROM pg_proc WHERE proname = 'validar_pagos') = 1, 'NTX-SQL-01 una firma';

  -- NTX-SQL-02: habilitada → los 3 medios exigen número (vacío o espacios no
  -- cuentan), sin venta, aunque la tienda B lo tenga opcional.
  FOREACH m IN ARRAY ARRAY['debito', 'credito', 'transferencia'] LOOP
    PERFORM t.falla('NTX-SQL-02 ' || m, format($q$SELECT t.venta('[{"metodo":"%s","monto":2000}]')$q$, m), 'PV001', 'falta el número de transacción');
    PERFORM t.falla('NTX-SQL-02 ' || m, format($q$SELECT t.venta('[{"metodo":"%s","monto":2000,"numero_transaccion":"  "}]')$q$, m), 'PV001', 'falta el número de transacción');
    PERFORM t.falla('NTX-SQL-02 legado ' || m, format($q$SELECT t.venta(NULL, '%s')$q$, m), 'PV001', 'falta el número de transacción');
  END LOOP;

  -- NTX-SQL-03: la cita también la exige y queda intacta.
  PERFORM t.falla('NTX-SQL-03', $q$SELECT t.cita('[{"metodo":"debito","monto":15000}]')$q$, 'PV001', 'falta el número de transacción');
  ASSERT (SELECT estado FROM citas WHERE id = '40000000-0000-0000-0000-0000000000d2') = 'confirmada', 'NTX-SQL-03 cita intacta';
  ASSERT (SELECT count(*) FROM ventas WHERE store_id = '40000000-0000-0000-0000-00000000000a') = 0, 'NTX-SQL-02/03 sin ventas';

  UPDATE stores SET numero_transaccion_obligatorio = false WHERE id = '40000000-0000-0000-0000-00000000000a';

  -- NTX-SQL-04: deshabilitada → los 3 medios se venden sin número; queda NULL.
  FOREACH m IN ARRAY ARRAY['debito', 'credito', 'transferencia'] LOOP
    r := t.venta(format('[{"metodo":"%s","monto":2000,"numero_transaccion":" "}]', m)::jsonb);
    ASSERT (SELECT count(*) FROM pagos WHERE venta_id = (r->'venta'->>'id')::uuid AND metodo = m AND monto = 2000 AND numero_transaccion IS NULL) = 1, 'NTX-SQL-04 ' || m;
  END LOOP;

  -- NTX-SQL-05: si igual se escribe, se guarda recortado (también en pago mixto).
  r := t.venta('[{"metodo":"efectivo","monto":500},{"metodo":"debito","monto":1500,"numero_transaccion":" T9 "}]');
  ASSERT (SELECT numero_transaccion FROM pagos WHERE venta_id = (r->'venta'->>'id')::uuid AND metodo = 'debito') = 'T9', 'NTX-SQL-05';
  ASSERT r->'venta'->>'metodo_pago' = 'mixto', 'NTX-SQL-05 mixto';

  -- NTX-SQL-06: deshabilitarla no relaja ninguna otra regla.
  PERFORM t.falla('NTX-SQL-06 suma', $q$SELECT t.venta('[{"metodo":"debito","monto":1999}]')$q$, 'PV001', 'no coincide con el total');
  PERFORM t.falla('NTX-SQL-06 NC', $q$SELECT t.venta('[{"metodo":"nota_credito","monto":2000}]')$q$, 'PV001', 'nota de crédito');
  PERFORM t.falla('NTX-SQL-06 saldo', $q$SELECT t.venta('[{"metodo":"saldo_a_favor","monto":2000}]')$q$, 'PV007', 'requiere un cliente');
  PERFORM t.falla('NTX-SQL-06 método', $q$SELECT t.venta('[{"metodo":"plataforma","monto":2000}]')$q$, 'PV001', 'no permitido');

  -- NTX-SQL-07: cita cobrada con débito sin número.
  r := t.cita('[{"metodo":"debito","monto":15000}]');
  ASSERT (SELECT numero_transaccion IS NULL FROM pagos WHERE venta_id = (r->'venta'->>'id')::uuid), 'NTX-SQL-07';
  ASSERT (SELECT estado FROM citas WHERE id = '40000000-0000-0000-0000-0000000000d2') = 'completada', 'NTX-SQL-07 cita';

  -- NTX-SQL-08: sin configuración legible (NULL) se exige; volver a habilitarla
  -- la exige de nuevo.
  PERFORM t.falla('NTX-SQL-08 null', $q$SELECT public.validar_pagos('[{"metodo":"debito","monto":10}]', 10, NULL, false, NULL)$q$, 'PV001', 'falta el número de transacción');
  UPDATE stores SET numero_transaccion_obligatorio = true WHERE id = '40000000-0000-0000-0000-00000000000a';
  PERFORM t.falla('NTX-SQL-08', $q$SELECT t.venta('[{"metodo":"credito","monto":2000}]')$q$, 'PV001', 'falta el número de transacción');
END $$;

\echo 'NTX-SQL: todas las pruebas pasaron'
ROLLBACK;
