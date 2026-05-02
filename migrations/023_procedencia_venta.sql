-- Agrega campo procedencia a ventas para rastrear el canal de captación del cliente
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS procedencia TEXT NOT NULL DEFAULT 'presencial'
    CHECK (procedencia IN ('presencial', 'instagram', 'whatsapp', 'facebook', 'tiktok', 'telefonico'));
