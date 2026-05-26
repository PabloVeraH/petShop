-- Migration 038: campo openrouter_model por tienda (configurable por systemAdmin)
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS openrouter_model TEXT DEFAULT 'z-ai/glm-4.5-air:free';