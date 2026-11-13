-- Pruebas de la migración 094 (ventas.notas). Solo Postgres local desechable:
-- ver tests/sql/README.md. IDs NOT-SQL-01…02.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  -- NOT-SQL-01: la columna existe, es varchar(255) y admite NULL.
  ASSERT (SELECT data_type || ':' || character_maximum_length || ':' || is_nullable
            FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'ventas' AND column_name = 'notas')
         = 'character varying:255:YES', 'NOT-SQL-01 columna';

  -- NOT-SQL-02: el mismo UPDATE que hace POST /api/ventas guarda la nota.
  INSERT INTO businesses (id, name) VALUES ('20000000-0000-0000-0000-0000000000b1', 'Negocio N');
  INSERT INTO stores (id, name, business_id) VALUES ('20000000-0000-0000-0000-00000000000a', 'T', '20000000-0000-0000-0000-0000000000b1');
  INSERT INTO ventas (id, store_id, total, metodo_pago, estado, canal)
  VALUES ('20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000000a', 1000, 'efectivo', 'pagada', 'pos');
  UPDATE ventas SET notas = 'Cliente retira mañana'
   WHERE id = '20000000-0000-0000-0000-0000000000a1' AND store_id = '20000000-0000-0000-0000-00000000000a';
  ASSERT (SELECT notas FROM ventas WHERE id = '20000000-0000-0000-0000-0000000000a1') = 'Cliente retira mañana', 'NOT-SQL-02 guarda';
END $$;

\echo 'NOT-SQL: todas las pruebas pasaron'
ROLLBACK;
