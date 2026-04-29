-- 1a. Marcar categorías como alimento
ALTER TABLE categorias
  ADD COLUMN IF NOT EXISTS es_alimento BOOLEAN NOT NULL DEFAULT false;

-- 1b. Config de email por tienda
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS email_reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_reminder_dias_aviso INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS resend_from_email TEXT;