-- 049_unique_mascota_name_per_client.sql
-- Evitar mascotas duplicadas por (cliente_id, nombre) a nivel de BD.
-- Usa LOWER() para comparación case-insensitive.
-- NOTA: si existen duplicados en la tabla, esta migración fallará.
-- Resolver antes de aplicar: DELETE y/o MERGE de duplicados manualmente.

CREATE UNIQUE INDEX IF NOT EXISTS idx_mascotas_unique_name_per_client
  ON mascotas(cliente_id, LOWER(nombre));
