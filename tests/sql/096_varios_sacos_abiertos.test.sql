-- Pruebas de la migración 096 (varios sacos abiertos del mismo producto)
-- contra las funciones reales. Solo Postgres local desechable: ver
-- tests/sql/README.md. IDs VSA-SQL-01…13 (docs/spec-registry.md).
\set ON_ERROR_STOP on
BEGIN;

CREATE SCHEMA t;

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
-- p1: granel sin lotes, 5 sacos de 20 kg. p2 (tienda B): granel con un solo
-- saco abierto. p3: granel con lotes (3 sacos en un lote vigente).
INSERT INTO businesses (id, name) VALUES ('40000000-0000-0000-0000-0000000000b1', 'Negocio S');
INSERT INTO stores (id, name, business_id) VALUES
  ('40000000-0000-0000-0000-00000000000a', 'Tienda A', '40000000-0000-0000-0000-0000000000b1'),
  ('40000000-0000-0000-0000-00000000000b', 'Tienda B', '40000000-0000-0000-0000-0000000000b1');
INSERT INTO productos (id, store_id, sku, nombre, precio, stock, peso_gramos, precio_venta_kg) VALUES
  ('40000000-0000-0000-0000-0000000000f1', '40000000-0000-0000-0000-00000000000a', 'G1', 'Granel 20 kg', 60000, 5, 20000, 4000),
  ('40000000-0000-0000-0000-0000000000f2', '40000000-0000-0000-0000-00000000000b', 'G2', 'Granel B', 60000, 2, 20000, 4000),
  ('40000000-0000-0000-0000-0000000000f3', '40000000-0000-0000-0000-00000000000a', 'G3', 'Granel lotes', 60000, 0, 20000, 4000);
INSERT INTO lotes_producto (store_id, producto_id, cantidad_inicial, cantidad_actual, fecha_vencimiento) VALUES
  ('40000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000f3', 3, 3, public.hoy_negocio() + 200);

-- Venta a granel por crear_venta_tx (como POST /api/ventas).
CREATE FUNCTION t.venta(p_store uuid, p_producto uuid, p_gramos int, p_saco uuid DEFAULT NULL, p_abrir boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.crear_venta_tx(
    p_store_id => p_store,
    p_items => jsonb_build_array(jsonb_build_object(
      'producto_id', p_producto, 'cantidad', p_gramos / 1000.0, 'precio_unitario', 4000,
      'subtotal', (p_gramos * 4) , 'es_granel', true, 'gramos', p_gramos,
      'abrir_saco', p_abrir, 'saco_id', p_saco)),
    p_cliente_id => NULL, p_worker_clerk_id => NULL,
    p_subtotal => p_gramos * 4, p_descuento_pct => 0, p_impuesto => 0, p_total => p_gramos * 4,
    p_metodo_pago => NULL, p_canal => 'pos', p_procedencia => 'presencial',
    p_numero_comprobante => 'T-' || substr(md5(random()::text), 1, 8),
    p_pago_nc => NULL, p_numero_transaccion => NULL,
    p_fidelizacion_niveles => '[]', p_dias_aviso => 5, p_idempotency_key => NULL, p_user_id => 'u-test',
    p_pagos => jsonb_build_array(jsonb_build_object('metodo', 'efectivo', 'monto', p_gramos * 4)))
$$;

CREATE FUNCTION t.stock(p uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT stock FROM productos WHERE id = p $$;
CREATE FUNCTION t.gramos(s uuid) RETURNS int LANGUAGE sql AS $$ SELECT gramos_restantes FROM sacos_abiertos WHERE id = s $$;

DO $$
DECLARE
  P  constant uuid := '40000000-0000-0000-0000-0000000000f1';
  SA constant uuid := '40000000-0000-0000-0000-00000000000a';
  a uuid; b uuid; d uuid; e uuid; q uuid; r jsonb; v_id uuid;
BEGIN
  -- VSA-SQL-01: el índice único ya no existe y la fracción suma todos los sacos.
  ASSERT NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'sacos_abiertos_uno_abierto_por_producto'), 'VSA-SQL-01 índice';

  a := (public.abrir_saco(SA, P, 'u-test')->'saco'->>'id')::uuid;
  ASSERT t.stock(P) = 5, 'VSA-SQL-01 abrir conserva el stock';

  -- VSA-SQL-02: sin confirmar, abrir otro con gramos en el abierto sigue
  -- rechazándose (mismo mensaje de siempre: el POS pide la confirmación).
  PERFORM t.falla_msg('VSA-SQL-02',
    format($q$SELECT public.abrir_saco(%L, %L, 'u-test')$q$, SA, P),
    'Saco abierto con gramos restantes (20000 g): registre la merma del resto antes de abrir otro');

  -- VSA-SQL-03 (REGRESIÓN mascotaspetshop 2026-11-23): confirmado, se abre un
  -- segundo saco con su nombre; descuenta un saco cerrado y el total no cambia.
  b := (public.abrir_saco(SA, P, 'u-test', '  Mesón 2 ', true)->'saco'->>'id')::uuid;
  ASSERT (SELECT count(*) FROM sacos_abiertos WHERE producto_id = P AND cerrado_at IS NULL) = 2, 'VSA-SQL-03 dos abiertos';
  ASSERT (SELECT nota FROM sacos_abiertos WHERE id = b) = 'Mesón 2', 'VSA-SQL-03 nombre';
  ASSERT public.fraccion_saco_abierto(P) = 2, 'VSA-SQL-03 fracción suma';
  ASSERT t.stock(P) = 5, 'VSA-SQL-03 stock total igual (3 cerrados + 2 abiertos)';

  -- VSA-SQL-04: con 2 sacos, una venta a granel sin saco elegido se rechaza.
  PERFORM t.falla_msg('VSA-SQL-04', format($q$SELECT t.venta(%L, %L, 500)$q$, SA, P),
    'Varios sacos abiertos (2) de este producto: indique de cuál se vende');
  ASSERT t.stock(P) = 5, 'VSA-SQL-04 sin cambios';

  -- VSA-SQL-05: la venta descuenta SOLO del saco elegido y queda trazada.
  r := t.venta(SA, P, 500, b);
  v_id := (r->'venta'->>'id')::uuid;
  ASSERT t.gramos(b) = 19500 AND t.gramos(a) = 20000, 'VSA-SQL-05 solo el elegido';
  ASSERT t.stock(P) = 4.975, 'VSA-SQL-05 stock';
  ASSERT (SELECT saco_id FROM venta_item_sacos vis JOIN venta_items vi ON vi.id = vis.venta_item_id WHERE vi.venta_id = v_id) = b, 'VSA-SQL-05 trazabilidad';

  -- VSA-SQL-06: saco inexistente o de otro producto/tienda → rechazo sin cambios.
  q := (public.abrir_saco('40000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000f2', 'u-b')->'saco'->>'id')::uuid;
  PERFORM t.falla_msg('VSA-SQL-06a', format($q$SELECT t.venta(%L, %L, 500, %L)$q$, SA, P, gen_random_uuid()),
    'Saco no disponible: el saco elegido ya no está abierto');
  PERFORM t.falla_msg('VSA-SQL-06b', format($q$SELECT t.venta(%L, %L, 500, %L)$q$, SA, P, q),
    'Saco no disponible: el saco elegido ya no está abierto');
  ASSERT t.gramos(q) = 20000 AND t.stock(P) = 4.975, 'VSA-SQL-06 sin cambios';

  -- VSA-SQL-07: conteo con 2 sacos exige indicar cuál; con el saco, ajusta solo
  -- ese y los cerrados se calculan con la fracción de todos.
  PERFORM t.falla_msg('VSA-SQL-07',
    format($q$SELECT public.ajustar_stock_conteo(%L, %L, NULL, 3, 'Conteo de prueba', 'u-test', 19000)$q$, SA, P),
    'Varios sacos abiertos (2) de este producto: indique cuál se contó');
  r := public.ajustar_stock_conteo(SA, P, NULL, 3, 'Conteo de prueba', 'u-test', 19000, b);
  ASSERT (r->>'delta')::numeric = 0, 'VSA-SQL-07 cerrados sin cambio';
  ASSERT t.gramos(b) = 19000 AND t.gramos(a) = 20000, 'VSA-SQL-07 solo el contado';
  ASSERT t.stock(P) = 4.95, 'VSA-SQL-07 stock';

  -- VSA-SQL-08: deshacer sin saco deshace la apertura MÁS RECIENTE.
  d := (public.abrir_saco(SA, P, 'u-test', NULL, true)->'saco'->>'id')::uuid;
  ASSERT t.stock(P) = 4.95, 'VSA-SQL-08 abrir conserva';
  r := public.deshacer_apertura_saco(SA, P, 'u-test');
  ASSERT (r->'saco'->>'id')::uuid = d, 'VSA-SQL-08 la más reciente';
  ASSERT (SELECT motivo_cierre FROM sacos_abiertos WHERE id = d) = 'deshecho', 'VSA-SQL-08 deshecho';
  ASSERT t.stock(P) = 4.95 AND (SELECT count(*) FROM sacos_abiertos WHERE producto_id = P AND cerrado_at IS NULL) = 2, 'VSA-SQL-08 stock';

  -- VSA-SQL-09: merma con 2 sacos exige indicar cuál; con el saco, solo ese.
  PERFORM t.falla_msg('VSA-SQL-09',
    format($q$SELECT public.cerrar_saco_merma(%L, %L, 'Saco roto', 'u-test')$q$, SA, P),
    'Varios sacos abiertos (2) de este producto: indique cuál se da de baja');
  r := public.cerrar_saco_merma(SA, P, 'Saco roto', 'u-test', a);
  ASSERT (r->>'gramos_merma')::int = 20000 AND t.gramos(b) = 19000, 'VSA-SQL-09 solo el elegido';
  ASSERT t.stock(P) = 3.95, 'VSA-SQL-09 stock';

  -- VSA-SQL-10: el saco elegido no alcanza → sin confirmar se rechaza; con
  -- confirmación se agota y la venta sigue en un saco nuevo.
  -- (Igual que antes de la 096: agota el saco y avisa lo que falta; la
  -- excepción revierte todo lo que alcanzó a descontar.)
  PERFORM t.falla_msg('VSA-SQL-10', format($q$SELECT t.venta(%L, %L, 20000, %L)$q$, SA, P, b),
    'Saco abierto insuficiente: quedan 0 g, se requieren 1000 g — confirme la apertura de un saco nuevo');
  ASSERT t.gramos(b) = 19000 AND t.stock(P) = 3.95, 'VSA-SQL-10 rechazo sin escritura';
  r := t.venta(SA, P, 20000, b, true);
  v_id := (r->'venta'->>'id')::uuid;
  ASSERT (SELECT motivo_cierre FROM sacos_abiertos WHERE id = b) = 'agotado', 'VSA-SQL-10 agotado';
  SELECT vis.saco_id INTO e FROM venta_item_sacos vis JOIN venta_items vi ON vi.id = vis.venta_item_id
   WHERE vi.venta_id = v_id AND vis.saco_id <> b;
  ASSERT t.gramos(e) = 19000, 'VSA-SQL-10 saco nuevo';
  ASSERT (SELECT sum(vis.gramos) FROM venta_item_sacos vis JOIN venta_items vi ON vi.id = vis.venta_item_id WHERE vi.venta_id = v_id) = 20000, 'VSA-SQL-10 gramos trazados';
  ASSERT t.stock(P) = 2.95, 'VSA-SQL-10 stock';

  -- VSA-SQL-11: devolución con 2 sacos abiertos → al más antiguo, total cuadra.
  PERFORM public.abrir_saco(SA, P, 'u-test', 'Mesón 1', true);
  ASSERT t.stock(P) = 2.95, 'VSA-SQL-11 abrir conserva';
  PERFORM public.devolver_granel(SA, P, 1000, 'u-test');
  ASSERT t.gramos(e) = 20000, 'VSA-SQL-11 al más antiguo';
  ASSERT t.stock(P) = 3.0, 'VSA-SQL-11 stock';

  -- VSA-SQL-12: con UN solo saco (todas las tiendas hoy) todo sigue igual:
  -- venta sin saco elegido, merma sin saco.
  r := t.venta('40000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000f2', 500);
  ASSERT t.gramos(q) = 19500, 'VSA-SQL-12 venta sin saco';
  PERFORM public.cerrar_saco_merma('40000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000f2', 'Fin de día', 'u-b');
  ASSERT t.stock('40000000-0000-0000-0000-0000000000f2') = 1, 'VSA-SQL-12 merma sin saco';

  -- VSA-SQL-13: producto con lotes: 2 sacos abiertos desde el lote y el stock
  -- (lote + fracción de todos) cuadra al vender de uno.
  a := (public.abrir_saco(SA, '40000000-0000-0000-0000-0000000000f3', 'u-test')->'saco'->>'id')::uuid;
  b := (public.abrir_saco(SA, '40000000-0000-0000-0000-0000000000f3', 'u-test', NULL, true)->'saco'->>'id')::uuid;
  ASSERT t.stock('40000000-0000-0000-0000-0000000000f3') = 3, 'VSA-SQL-13 lote 1 + 2 abiertos';
  r := t.venta(SA, '40000000-0000-0000-0000-0000000000f3', 500, a);
  ASSERT t.stock('40000000-0000-0000-0000-0000000000f3') = 2.975 AND t.gramos(b) = 20000, 'VSA-SQL-13 stock con lotes';
END $$;

\echo 'VSA-SQL: todas las pruebas pasaron'
ROLLBACK;
