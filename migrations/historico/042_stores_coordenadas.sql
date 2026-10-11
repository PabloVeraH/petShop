-- Migration 042: lat/lon para contexto climático preciso en recomendaciones IA
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS lat FLOAT,
  ADD COLUMN IF NOT EXISTS lon FLOAT;
