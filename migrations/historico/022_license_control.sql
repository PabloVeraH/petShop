-- Tracking de usuarios deshabilitados manualmente por systemAdmin
ALTER TABLE clerk_users
  ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT false;

-- Configuración de período de licencia (por instalación/tienda)
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS license_start_date DATE,
  ADD COLUMN IF NOT EXISTS license_end_date DATE,
  ADD COLUMN IF NOT EXISTS license_warning_days INTEGER NOT NULL DEFAULT 7;

-- Índice para búsqueda eficiente
CREATE INDEX IF NOT EXISTS idx_clerk_users_is_disabled ON clerk_users(store_id, is_disabled);

COMMENT ON COLUMN clerk_users.is_disabled IS 'Usuario deshabilitado manualmente por systemAdmin vía Clerk ban';
COMMENT ON COLUMN stores.license_start_date IS 'Fecha de inicio del período de licencia';
COMMENT ON COLUMN stores.license_end_date IS 'Fecha de fin. Si hoy > este valor el middleware bloquea acceso';
COMMENT ON COLUMN stores.license_warning_days IS 'Días antes de license_end_date para mostrar banner de aviso';