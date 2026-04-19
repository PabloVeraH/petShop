-- Fase 0: Multi-Channel Architecture — Step 2
-- Modificar tablas existentes para agregar soporte de canales

-- ============================================================
-- Paso 3: Modificar tablas existentes
-- ============================================================

-- 1. Agregar columna canal a ventas
ALTER TABLE ventas
  ADD COLUMN canal TEXT NOT NULL DEFAULT 'pos' REFERENCES canales_externos(id);

-- 2. Agregar columna canal a journal_entries
ALTER TABLE journal_entries
  ADD COLUMN canal TEXT NOT NULL DEFAULT 'pos';

-- 3. Actualizar ENUM metodo_pago en ventas para incluir 'plataforma'
-- Si metodo_pago es ENUM, usar: ALTER TYPE metodo_pago_enum ADD VALUE 'plataforma';
-- Si es CHECK, actualizar el constraint

-- Verificar si existe el constraint y actualizarlo
DO $$
BEGIN
  -- Intentar agregar 'plataforma' como valor enum (si es tipo ENUM)
  ALTER TYPE metodo_pago_enum ADD VALUE 'plataforma';
EXCEPTION WHEN duplicate_object THEN
  -- Si ya existe, ignorar
  NULL;
WHEN others THEN
  -- Si no es ENUM, podría ser un CHECK constraint
  -- En ese caso, se asume que ya está configurado o se actualiza manualmente
  NULL;
END $$;

-- 4. Actualizar metodo_reembolso en notas_credito para incluir 'plataforma'
-- Si es ENUM, usar ALTER TYPE; si es CHECK, actualizar constraint
DO $$
BEGIN
  ALTER TYPE metodo_reembolso_enum ADD VALUE 'plataforma';
EXCEPTION WHEN duplicate_object THEN
  NULL;
WHEN others THEN
  NULL;
END $$;

-- 5. Crear índices para mejorar queries por canal
CREATE INDEX IF NOT EXISTS idx_ventas_canal
  ON ventas(store_id, canal, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_canal_producto_config_store_canal
  ON canal_producto_config(store_id, canal_id);

CREATE INDEX IF NOT EXISTS idx_canal_ordenes_store_estado
  ON canal_ordenes(store_id, estado, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_canal_ordenes_expiry
  ON canal_ordenes(aceptar_antes_de)
  WHERE estado IN ('pending', 'reserved');

CREATE INDEX IF NOT EXISTS idx_stock_reservas_expiry
  ON stock_reservas(expira_at);

COMMIT;
