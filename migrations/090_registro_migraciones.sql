-- 090: registro en la base de las migraciones aplicadas.
--
-- Hasta ahora la única fuente era la tabla §10 de docs/INSTALACION_TIENDA.md
-- (mascotaspetshop no tenía supabase_migrations: las migraciones se pegaban
-- en el SQL Editor). Se usa la misma tabla que crea Supabase
-- (supabase_migrations.schema_migrations), con columnas compatibles, para
-- que apply_migration / la CLI la reutilicen sin conflicto.
--
-- Convención desde aquí (ver migrations/README.md): version = número de la
-- migración ('090'), name = nombre del archivo sin .sql. Cada migración nueva
-- termina con su propio INSERT de registro, así queda anotada aunque se pegue
-- a mano. Lo aplicado antes de la 090 se registra a mano una sola vez por
-- base (paso documentado en migrations/README.md).
--
-- RLS habilitado sin políticas: anon/authenticated no la ven (el esquema
-- tampoco está expuesto por la API). Idempotente.
-- Reversible: DROP SCHEMA supabase_migrations CASCADE (solo si no la creó
-- Supabase: en el demo ya existía).

CREATE SCHEMA IF NOT EXISTS supabase_migrations;

CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text NOT NULL PRIMARY KEY
);
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS statements text[];
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE supabase_migrations.schema_migrations ENABLE ROW LEVEL SECURITY;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('090', '090_registro_migraciones')
ON CONFLICT (version) DO NOTHING;
