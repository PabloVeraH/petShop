-- Migration 040: ciudad de la tienda para contexto climático en recomendaciones IA
ALTER TABLE stores ADD COLUMN IF NOT EXISTS ciudad TEXT DEFAULT 'Santiago';
