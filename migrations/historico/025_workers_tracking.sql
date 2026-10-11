-- Fase 1: Reemplazar vendedores por tracking de usuarios reales (workers)
-- Autor: LLM execution
-- Fecha: 2026-05-04

-- 1. Agregar campos de trabajador a clerk_users
ALTER TABLE clerk_users
  ADD COLUMN IF NOT EXISTS nombre VARCHAR(255),
  ADD COLUMN IF NOT EXISTS rut VARCHAR(20),
  ADD COLUMN IF NOT EXISTS meta_ventas NUMERIC;

-- 2. Agregar nueva columna para tracking real en ventas
--    Usamos clerk_id (string) para evitar lookups extra; sin FK para simplicidad
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS worker_clerk_id VARCHAR(255) REFERENCES clerk_users(clerk_id) ON DELETE SET NULL;

-- 3. Eliminar FK viejo y columna vendedor_id (apuntaba a vendedores.id, siempre null)
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_vendedor_id_fkey;
ALTER TABLE ventas DROP COLUMN IF EXISTS vendedor_id;

-- 4. Eliminar FK y columna vendedor_id de clientes (dependencia descubierta en ejecución,
--    campo siempre null — 0 registros con datos)
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_vendedor_id_fkey;
ALTER TABLE clientes DROP COLUMN IF EXISTS vendedor_id;

-- 5. Eliminar tabla vendedores (vacía, ya no se usa)
DROP TABLE IF EXISTS vendedores;

-- 6. Índices para queries de performance
CREATE INDEX IF NOT EXISTS idx_ventas_worker_clerk_id ON ventas(store_id, worker_clerk_id);
CREATE INDEX IF NOT EXISTS idx_ventas_worker_date ON ventas(store_id, worker_clerk_id, created_at);
CREATE INDEX IF NOT EXISTS idx_clerk_users_nombre ON clerk_users(store_id, nombre);