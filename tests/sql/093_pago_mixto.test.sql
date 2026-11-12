-- Pruebas de comportamiento de la migración 093 (pago mixto) contra la RPC real.
--
-- SOLO para un Postgres local desechable con 000_baseline + 087…093 aplicadas.
-- Nunca contra Supabase: siembra datos (todo dentro de una transacción que
-- termina en ROLLBACK, pero igual). Cómo correrlo: tests/sql/README.md.
--
-- IDs: PMX-SQL-01…20 (docs/spec-registry.md). Cada ASSERT falla con su ID.

\set ON_ERROR_STOP on
BEGIN;

CREATE SCHEMA t;

-- Ejecuta una sentencia y exige que falle con el SQLSTATE indicado. El bloque
-- EXCEPTION revierte lo que la sentencia alcanzó a hacer (subtransacción).
CREATE FUNCTION t.falla(p_id text, p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION '% — se esperaba el error % y no falló', p_id, p_code;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_code THEN
    RAISE EXCEPTION '% — se esperaba % y llegó % (%)', p_id, p_code, SQLSTATE, SQLERRM;
  END IF;
END;
$$;

-- ── Datos ───────────────────────────────────────────────────────────────────
INSERT INTO businesses (id, name) VALUES ('00000000-0000-0000-0000-0000000000b1', 'Negocio test');
INSERT INTO stores (id, name, business_id) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'Tienda A', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000000b', 'Tienda B', '00000000-0000-0000-0000-0000000000b1');
INSERT INTO clientes (id, store_id, rut, nombre) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', '11111111-1', 'Cliente A'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000b', '22222222-2', 'Cliente B');
INSERT INTO productos (id, store_id, sku, nombre, precio, stock) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 'SKU1', 'Saco 15 kg', 17000, 100);

-- Ventas de origen para las NC (una por tienda).
INSERT INTO ventas (id, store_id, cliente_id, total, metodo_pago, estado, canal) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 50000, 'efectivo', 'pagada', 'pos'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c2', 50000, 'efectivo', 'pagada', 'pos');

INSERT INTO notas_credito (id, store_id, venta_id, numero_nc, tipo_reembolso, monto_total, estado, fecha_vencimiento) VALUES
  -- saldo_a_favor vigente, cliente A (su saldo se siembra abajo)
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'NC-SALDO', 'saldo_a_favor', 3000, 'activa', public.hoy_negocio() + 30),
  -- reembolso directo (el dinero ya se devolvió)
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'NC-DIRECTO', 'reembolso_directo', 3000, 'activa', public.hoy_negocio() + 30),
  -- vencida
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'NC-VENCIDA', 'saldo_a_favor', 3000, 'activa', public.hoy_negocio() - 1),
  -- ya usada
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'NC-USADA', 'saldo_a_favor', 3000, 'usada', public.hoy_negocio() + 30),
  -- de la tienda B
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a2', 'NC-OTRA', 'saldo_a_favor', 3000, 'activa', public.hoy_negocio() + 30);

INSERT INTO saldos_a_favor (store_id, cliente_id, saldo_disponible) VALUES
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 10000),
  -- saldo del cliente de la tienda B: una venta de la tienda A no debe poder usarlo
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c2', 10000);

-- Atajo: crear_venta_tx con 1 saco de $17.000 en la tienda A.
CREATE FUNCTION t.venta(p_pagos jsonb, p_cliente uuid DEFAULT NULL, p_key text DEFAULT NULL,
                        p_metodo text DEFAULT NULL, p_pago_nc jsonb DEFAULT NULL, p_trx text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.crear_venta_tx(
    p_store_id => '00000000-0000-0000-0000-00000000000a',
    p_items => '[{"producto_id":"00000000-0000-0000-0000-0000000000f1","cantidad":1,"precio_unitario":17000,"subtotal":17000,"es_granel":false}]',
    p_cliente_id => p_cliente, p_worker_clerk_id => NULL,
    p_subtotal => 17000, p_descuento_pct => 0, p_impuesto => 2714, p_total => 17000,
    p_metodo_pago => p_metodo, p_canal => 'pos', p_procedencia => 'presencial',
    p_numero_comprobante => 'T-' || substr(md5(random()::text), 1, 8),
    p_pago_nc => p_pago_nc, p_numero_transaccion => p_trx,
    p_fidelizacion_niveles => '[]', p_dias_aviso => 5,
    p_idempotency_key => p_key, p_user_id => NULL, p_pagos => p_pagos)
$$;

-- ── Pruebas ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r      jsonb;
  v_id   uuid;
  n      int;
  s      numeric;
  stock0 numeric;
BEGIN
  -- PMX-SQL-01: efectivo + débito → 'mixto', dos filas que suman el total.
  r := t.venta('[{"metodo":"efectivo","monto":5000},{"metodo":"debito","monto":12000,"numero_transaccion":"TRX1"}]');
  v_id := (r->'venta'->>'id')::uuid;
  ASSERT (r->>'created')::boolean, 'PMX-SQL-01 created';
  ASSERT r->'venta'->>'metodo_pago' = 'mixto', 'PMX-SQL-01 metodo_pago';
  SELECT count(*), sum(monto) INTO n, s FROM pagos WHERE venta_id = v_id;
  ASSERT n = 2 AND s = 17000, 'PMX-SQL-01 filas de pagos';
  ASSERT EXISTS (SELECT 1 FROM pagos WHERE venta_id = v_id AND metodo = 'debito' AND numero_transaccion = 'TRX1'), 'PMX-SQL-01 TRX';

  -- PMX-SQL-02: un solo medio → la venta guarda ese método.
  r := t.venta('[{"metodo":"credito","monto":17000,"numero_transaccion":"T2"}]');
  ASSERT r->'venta'->>'metodo_pago' = 'credito', 'PMX-SQL-02';

  -- PMX-SQL-03: NC + efectivo + crédito. La NC queda usada, el saldo del
  -- cliente de origen baja por el monto de la NC y la fila guarda el número.
  r := t.venta('[{"metodo":"nota_credito","monto":3000,"nota_credito_id":"00000000-0000-0000-0000-0000000000e1"},'
               '{"metodo":"efectivo","monto":2000},{"metodo":"credito","monto":12000,"numero_transaccion":"T3"}]');
  v_id := (r->'venta'->>'id')::uuid;
  ASSERT r->'venta'->>'metodo_pago' = 'mixto', 'PMX-SQL-03 mixto';
  ASSERT (SELECT estado FROM notas_credito WHERE numero_nc = 'NC-SALDO') = 'usada', 'PMX-SQL-03 NC usada';
  ASSERT (SELECT saldo_disponible FROM saldos_a_favor WHERE cliente_id = '00000000-0000-0000-0000-0000000000c1') = 7000, 'PMX-SQL-03 saldo';
  ASSERT EXISTS (SELECT 1 FROM pagos WHERE venta_id = v_id AND metodo = 'nota_credito' AND numero_transaccion = 'NC-SALDO'), 'PMX-SQL-03 numero NC';
  ASSERT (SELECT count(*) FROM pagos WHERE venta_id = v_id) = 3, 'PMX-SQL-03 filas';

  -- PMX-SQL-04: suma distinta del total → PV001 y nada queda escrito.
  SELECT count(*) INTO n FROM ventas;
  SELECT stock INTO stock0 FROM productos WHERE sku = 'SKU1';
  PERFORM t.falla('PMX-SQL-04a', $q$SELECT t.venta('[{"metodo":"efectivo","monto":5000},{"metodo":"debito","monto":11999,"numero_transaccion":"T"}]')$q$, 'PV001');
  PERFORM t.falla('PMX-SQL-04b', $q$SELECT t.venta('[{"metodo":"efectivo","monto":17001}]')$q$, 'PV001');
  ASSERT (SELECT count(*) FROM ventas) = n, 'PMX-SQL-04 sin venta';
  ASSERT (SELECT stock FROM productos WHERE sku = 'SKU1') = stock0, 'PMX-SQL-04 sin descontar stock';

  -- PMX-SQL-05: forma inválida → PV001 (TRX, decimales, cero, método no
  -- permitido, NC sin id, id en un pago que no es NC, más de 5 medios).
  PERFORM t.falla('PMX-SQL-05a', $q$SELECT t.venta('[{"metodo":"transferencia","monto":17000}]')$q$, 'PV001');
  PERFORM t.falla('PMX-SQL-05b', $q$SELECT t.venta('[{"metodo":"efectivo","monto":16999.5},{"metodo":"efectivo","monto":0.5}]')$q$, 'PV001');
  PERFORM t.falla('PMX-SQL-05c', $q$SELECT t.venta('[{"metodo":"efectivo","monto":0},{"metodo":"efectivo","monto":17000}]')$q$, 'PV001');
  PERFORM t.falla('PMX-SQL-05d', $q$SELECT t.venta('[{"metodo":"plataforma","monto":17000}]')$q$, 'PV001');
  PERFORM t.falla('PMX-SQL-05e', $q$SELECT t.venta('[{"metodo":"mixto","monto":17000}]')$q$, 'PV001');
  PERFORM t.falla('PMX-SQL-05f', $q$SELECT t.venta('[{"metodo":"nota_credito","monto":17000}]')$q$, 'PV001');
  PERFORM t.falla('PMX-SQL-05g', $q$SELECT t.venta('[{"metodo":"efectivo","monto":17000,"nota_credito_id":"00000000-0000-0000-0000-0000000000e1"}]')$q$, 'PV001');
  PERFORM t.falla('PMX-SQL-05h', $q$SELECT t.venta('[{"metodo":"efectivo","monto":1},{"metodo":"efectivo","monto":1},{"metodo":"efectivo","monto":1},{"metodo":"efectivo","monto":1},{"metodo":"efectivo","monto":1},{"metodo":"efectivo","monto":16995}]')$q$, 'PV001');
  PERFORM t.falla('PMX-SQL-05i', $q$SELECT t.venta('[]')$q$, 'PV001');

  -- PMX-SQL-06: NC con reembolso directo → PV005 y la NC sigue activa.
  PERFORM t.falla('PMX-SQL-06', $q$SELECT t.venta('[{"metodo":"nota_credito","monto":3000,"nota_credito_id":"00000000-0000-0000-0000-0000000000e2"},{"metodo":"efectivo","monto":14000}]')$q$, 'PV005');
  ASSERT (SELECT estado FROM notas_credito WHERE numero_nc = 'NC-DIRECTO') = 'activa', 'PMX-SQL-06 sigue activa';

  -- PMX-SQL-07: NC vencida → PV004; NC usada → PV003; NC de otra tienda → PV002.
  PERFORM t.falla('PMX-SQL-07a', $q$SELECT t.venta('[{"metodo":"nota_credito","monto":3000,"nota_credito_id":"00000000-0000-0000-0000-0000000000e3"},{"metodo":"efectivo","monto":14000}]')$q$, 'PV004');
  PERFORM t.falla('PMX-SQL-07b', $q$SELECT t.venta('[{"metodo":"nota_credito","monto":3000,"nota_credito_id":"00000000-0000-0000-0000-0000000000e4"},{"metodo":"efectivo","monto":14000}]')$q$, 'PV003');
  PERFORM t.falla('PMX-SQL-07c', $q$SELECT t.venta('[{"metodo":"nota_credito","monto":3000,"nota_credito_id":"00000000-0000-0000-0000-0000000000e5"},{"metodo":"efectivo","monto":14000}]')$q$, 'PV002');
  ASSERT (SELECT estado FROM notas_credito WHERE numero_nc = 'NC-OTRA') = 'activa', 'PMX-SQL-07c NC ajena intacta';

  -- PMX-SQL-08 (D8): NC tipo saldo cuyo saldo ya se gastó → PV006, sin cambios.
  UPDATE notas_credito SET estado = 'activa' WHERE numero_nc = 'NC-SALDO';
  UPDATE saldos_a_favor SET saldo_disponible = 1000 WHERE cliente_id = '00000000-0000-0000-0000-0000000000c1';
  PERFORM t.falla('PMX-SQL-08', $q$SELECT t.venta('[{"metodo":"nota_credito","monto":3000,"nota_credito_id":"00000000-0000-0000-0000-0000000000e1"},{"metodo":"efectivo","monto":14000}]')$q$, 'PV006');
  ASSERT (SELECT estado FROM notas_credito WHERE numero_nc = 'NC-SALDO') = 'activa', 'PMX-SQL-08 NC no reclamada';
  ASSERT (SELECT saldo_disponible FROM saldos_a_favor WHERE cliente_id = '00000000-0000-0000-0000-0000000000c1') = 1000, 'PMX-SQL-08 saldo intacto';

  -- PMX-SQL-09: saldo a favor como pago: descuenta; si no alcanza → PV006;
  -- sin cliente → PV007; NC + saldo en la misma venta → PV001.
  UPDATE saldos_a_favor SET saldo_disponible = 10000 WHERE cliente_id = '00000000-0000-0000-0000-0000000000c1';
  r := t.venta('[{"metodo":"saldo_a_favor","monto":4000},{"metodo":"efectivo","monto":13000}]', '00000000-0000-0000-0000-0000000000c1');
  v_id := (r->'venta'->>'id')::uuid;
  ASSERT (SELECT saldo_disponible FROM saldos_a_favor WHERE cliente_id = '00000000-0000-0000-0000-0000000000c1') = 6000, 'PMX-SQL-09 descuento';
  PERFORM t.falla('PMX-SQL-09b', $q$SELECT t.venta('[{"metodo":"saldo_a_favor","monto":7000},{"metodo":"efectivo","monto":10000}]', '00000000-0000-0000-0000-0000000000c1')$q$, 'PV006');
  ASSERT (SELECT saldo_disponible FROM saldos_a_favor WHERE cliente_id = '00000000-0000-0000-0000-0000000000c1') = 6000, 'PMX-SQL-09b sin cambio';
  PERFORM t.falla('PMX-SQL-09c', $q$SELECT t.venta('[{"metodo":"saldo_a_favor","monto":1000},{"metodo":"efectivo","monto":16000}]')$q$, 'PV007');
  PERFORM t.falla('PMX-SQL-09d', $q$SELECT t.venta('[{"metodo":"saldo_a_favor","monto":1000},{"metodo":"nota_credito","monto":1000,"nota_credito_id":"00000000-0000-0000-0000-0000000000e1"},{"metodo":"efectivo","monto":15000}]', '00000000-0000-0000-0000-0000000000c1')$q$, 'PV001');
  -- Saldo de un cliente de OTRA tienda: el UPDATE filtra por store_id → PV006.
  PERFORM t.falla('PMX-SQL-09e', $q$SELECT t.venta('[{"metodo":"saldo_a_favor","monto":1000},{"metodo":"efectivo","monto":16000}]', '00000000-0000-0000-0000-0000000000c2')$q$, 'PV006');

  -- PMX-SQL-10: anular la venta del paso 09 reacredita el saldo consumido
  -- (paso 6 de anular_venta_tx, sin cambios en la 093).
  PERFORM public.anular_venta_tx('00000000-0000-0000-0000-00000000000a', v_id, NULL);
  ASSERT (SELECT saldo_disponible FROM saldos_a_favor WHERE cliente_id = '00000000-0000-0000-0000-0000000000c1') = 10000, 'PMX-SQL-10 saldo restaurado';

  -- PMX-SQL-11: parámetros antiguos (código desplegado antes de la 093).
  r := t.venta(NULL, p_metodo => 'efectivo');
  ASSERT r->'venta'->>'metodo_pago' = 'efectivo', 'PMX-SQL-11a';
  ASSERT (SELECT sum(monto) FROM pagos WHERE venta_id = (r->'venta'->>'id')::uuid) = 17000, 'PMX-SQL-11a monto';
  UPDATE notas_credito SET estado = 'activa' WHERE numero_nc = 'NC-SALDO';
  r := t.venta(NULL, p_metodo => 'debito', p_trx => 'TL',
               p_pago_nc => '{"nota_credito_id":"00000000-0000-0000-0000-0000000000e1","numero_nc":"NC-SALDO","monto":3000}');
  ASSERT r->'venta'->>'metodo_pago' = 'mixto', 'PMX-SQL-11b mixto';
  ASSERT (SELECT count(*) FROM pagos WHERE venta_id = (r->'venta'->>'id')::uuid) = 2, 'PMX-SQL-11b filas';
  -- Legado con métodos que no consumen crédito → PV001.
  PERFORM t.falla('PMX-SQL-11c', $q$SELECT t.venta(NULL, p_metodo => 'saldo_favor')$q$, 'PV001');
  PERFORM t.falla('PMX-SQL-11d', $q$SELECT t.venta(NULL, p_metodo => 'debito')$q$, 'PV001');

  -- PMX-SQL-15: venta de $0 (100 % de descuento) con un pago único de $0; con
  -- dos pagos, un $0 se rechaza.
  r := public.crear_venta_tx(
    p_store_id => '00000000-0000-0000-0000-00000000000a',
    p_items => '[{"producto_id":"00000000-0000-0000-0000-0000000000f1","cantidad":1,"precio_unitario":17000,"subtotal":17000,"es_granel":false}]',
    p_cliente_id => NULL, p_worker_clerk_id => NULL, p_subtotal => 17000, p_descuento_pct => 100, p_impuesto => 0, p_total => 0,
    p_metodo_pago => NULL, p_canal => 'pos', p_procedencia => 'presencial', p_numero_comprobante => 'T-CERO',
    p_pago_nc => NULL, p_numero_transaccion => NULL, p_fidelizacion_niveles => '[]', p_dias_aviso => 5,
    p_pagos => '[{"metodo":"efectivo","monto":0}]');
  ASSERT (r->>'created')::boolean AND r->'venta'->>'metodo_pago' = 'efectivo', 'PMX-SQL-15 venta $0';
  PERFORM t.falla('PMX-SQL-15b', $q$SELECT t.venta('[{"metodo":"efectivo","monto":0},{"metodo":"efectivo","monto":17000}]')$q$, 'PV001');

  -- PMX-SQL-12: idempotencia — misma key → misma venta, sin pagos duplicados.
  r := t.venta('[{"metodo":"efectivo","monto":17000}]', p_key => 'key-1');
  v_id := (r->'venta'->>'id')::uuid;
  r := t.venta('[{"metodo":"efectivo","monto":17000}]', p_key => 'key-1');
  ASSERT NOT (r->>'created')::boolean AND (r->'venta'->>'id')::uuid = v_id, 'PMX-SQL-12 misma venta';
  ASSERT (SELECT count(*) FROM pagos WHERE venta_id = v_id) = 1, 'PMX-SQL-12 sin duplicar';
END $$;

-- ── Citas ───────────────────────────────────────────────────────────────────
INSERT INTO servicios (id, store_id, nombre, duracion_minutos) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', 'Baño', 60);
INSERT INTO citas (id, store_id, servicio_id, cliente_id, fecha, hora_inicio, hora_fin, duracion_minutos, created_by, estado, precio) VALUES
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', public.hoy_negocio(), '10:00', '11:00', 60, 'test', 'confirmada', 15000),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', public.hoy_negocio(), '12:00', '13:00', 60, 'test', 'confirmada', 15000);

CREATE FUNCTION t.cita(p_id uuid, p_pagos jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.completar_cita_tx(
    p_cita_id => p_id, p_store_id => '00000000-0000-0000-0000-00000000000a',
    p_metodo_pago => NULL, p_numero_transaccion => NULL, p_impuesto => 2395,
    p_pago_nc => NULL, p_fidelizacion_niveles => '[]', p_completado_por => NULL, p_pagos => p_pagos)
$$;

DO $$
DECLARE
  r jsonb;
  s numeric;
BEGIN
  -- PMX-SQL-13: cita pagada con efectivo + saldo a favor del cliente de la cita.
  SELECT saldo_disponible INTO s FROM saldos_a_favor WHERE cliente_id = '00000000-0000-0000-0000-0000000000c1';
  r := t.cita('00000000-0000-0000-0000-0000000000d2', '[{"metodo":"efectivo","monto":10000},{"metodo":"saldo_a_favor","monto":5000}]');
  ASSERT r->'venta'->>'metodo_pago' = 'mixto', 'PMX-SQL-13 mixto';
  ASSERT (SELECT estado FROM citas WHERE id = '00000000-0000-0000-0000-0000000000d2') = 'completada', 'PMX-SQL-13 completada';
  ASSERT (SELECT saldo_disponible FROM saldos_a_favor WHERE cliente_id = '00000000-0000-0000-0000-0000000000c1') = s - 5000, 'PMX-SQL-13 saldo';
  ASSERT (SELECT sum(monto) FROM pagos WHERE venta_id = (r->'venta'->>'id')::uuid) = 15000, 'PMX-SQL-13 pagos';

  -- PMX-SQL-14: suma inválida en cita → PV001 y la cita sigue confirmada.
  PERFORM t.falla('PMX-SQL-14', $q$SELECT t.cita('00000000-0000-0000-0000-0000000000d3', '[{"metodo":"efectivo","monto":14999}]')$q$, 'PV001');
  ASSERT (SELECT estado FROM citas WHERE id = '00000000-0000-0000-0000-0000000000d3') = 'confirmada', 'PMX-SQL-14 sin completar';
END $$;

\echo 'PMX-SQL: todas las pruebas pasaron'
ROLLBACK;
