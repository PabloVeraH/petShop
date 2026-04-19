-- Migration: 012_canales_hub.sql
-- Phase 0: Base refactor - Hub de Canales
-- Based on rappi-integration-proposal.md §4

-- ============================================================
-- Paso 2: Tablas del Hub de Canales
-- ============================================================

-- Catálogo de canales soportados
CREATE TABLE IF NOT EXISTS canales_externos (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  es_externo  BOOLEAN NOT NULL DEFAULT true,
  habilitado BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default channels (POS always enabled)
INSERT INTO canales_externos (id, nombre, es_externo, habilitado) VALUES
  ('pos', 'Presencial (POS)', false, true),
  ('rappi', 'Rappi', true, false),
  ('pedidosya', 'PedidosYa', true, false),
  ('ubereats', 'UberEats', true, false)
ON CONFLICT (id) DO NOTHING;

-- Credenciales y configuración por tienda × canal externo
CREATE TABLE IF NOT EXISTS canal_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  canal_id        TEXT NOT NULL REFERENCES canales_externos(id),
  external_store_id TEXT,
  credentials    JSONB,
  webhook_secret  TEXT,
  token           TEXT,
  token_expires_at TIMESTAMPTZ,
  comision_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,
  activo          BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, canal_id)
);

-- Precio y disponibilidad de cada producto en cada canal
CREATE TABLE IF NOT EXISTS canal_producto_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  canal_id          TEXT NOT NULL REFERENCES canales_externos(id),
  producto_id       UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  precio           NUMERIC(10,2) NOT NULL CHECK (precio > 0),
  activo           BOOLEAN NOT NULL DEFAULT true,
  categoria_canal  TEXT,
  descripcion_canal TEXT,
  external_product_id TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(canal_id, producto_id)
);

-- Órdenes recibidas de cualquier canal externo
CREATE TABLE IF NOT EXISTS canal_ordenes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  canal_id          TEXT NOT NULL REFERENCES canales_externos(id),
  external_order_id TEXT NOT NULL,
  estado            TEXT NOT NULL DEFAULT 'pending',
  payload           JSONB NOT NULL,
  venta_id          UUID REFERENCES ventas(id),
  aceptar_antes_de   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(canal_id, external_order_id)
);

-- Reserva temporal de stock
CREATE TABLE IF NOT EXISTS stock_reservas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id   UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  canal_orden_id UUID NOT NULL REFERENCES canal_ordenes(id) ON DELETE CASCADE,
  cantidad      INT NOT NULL CHECK (cantidad > 0),
  expira_at     TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(canal_orden_id, producto_id)
);

-- Liquidaciones de plataformas externas
CREATE TABLE IF NOT EXISTS canal_liquidaciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  canal_id      TEXT NOT NULL REFERENCES canales_externos(id),
  periodo_desde DATE NOT NULL,
  periodo_hasta DATE NOT NULL,
  monto_bruto   NUMERIC(10,2) NOT NULL,
  comision      NUMERIC(10,2) NOT NULL,
  monto_neto    NUMERIC(10,2) NOT NULL,
  referencia   TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Paso 3: Modificar tablas existentes
-- ============================================================

-- Add canal column to ventas
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'pos';

-- Add canal column to journal_entries
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'pos';

-- ============================================================
-- Paso 4: Nuevas cuentas contables
-- ============================================================

-- Insert channel-specific accounts (will fail if already exists, that's OK)
INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, subtipo, activo) 
SELECT id, '110401', 'Cuentas por cobrar Rappi', 'ACTIVO', 'CIRCULANTE', true FROM stores
ON CONFLICT (store_id, codigo) DO NOTHING;

INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, subtipo, activo)
SELECT id, '110402', 'Cuentas por cobrar PedidosYa', 'ACTIVO', 'CIRCULANTE', true FROM stores
ON CONFLICT (store_id, codigo) DO NOTHING;

INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, subtipo, activo)
SELECT id, '110403', 'Cuentas por cobrar UberEats', 'ACTIVO', 'CIRCULANTE', true FROM stores
ON CONFLICT (store_id, codigo) DO NOTHING;

INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, subtipo, activo)
SELECT id, '510101', 'Comisión Rappi', 'GASTO', 'OPERACIONAL', true FROM stores
ON CONFLICT (store_id, codigo) DO NOTHING;

INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, subtipo, activo)
SELECT id, '510102', 'Comisión PedidosYa', 'GASTO', 'OPERACIONAL', true FROM stores
ON CONFLICT (store_id, codigo) DO NOTHING;

INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, subtipo, activo)
SELECT id, '510103', 'Comisión UberEats', 'GASTO', 'OPERACIONAL', true FROM stores
ON CONFLICT (store_id, codigo) DO NOTHING;

INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, subtipo, activo)
SELECT id, '510201', 'Devoluciones canal externo', 'GASTO', 'OPERACIONAL', true FROM stores
ON CONFLICT (store_id, codigo) DO NOTHING;

-- ============================================================
-- Paso 5: Índices para rendimiento
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_canal_producto_config_store_canal
  ON canal_producto_config(store_id, canal_id);

CREATE INDEX IF NOT EXISTS idx_canal_ordenes_store_estado
  ON canal_ordenes(store_id, estado, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_canal_ordenes_expiry
  ON canal_ordenes(aceptar_antes_de)
  WHERE estado IN ('pending', 'reserved');

CREATE INDEX IF NOT EXISTS idx_stock_reservas_expiry
  ON stock_reservas(expira_at);

CREATE INDEX IF NOT EXISTS idx_ventas_canal
  ON ventas(store_id, canal, created_at DESC);

-- ============================================================
-- Verify
-- ============================================================

SELECT 'canales_externos' as table_name, COUNT(*) as count FROM canales_externos;
SELECT 'chart_of_accounts (new)' as table_name, COUNT(*) as count FROM chart_of_accounts WHERE codigo IN ('110401', '110402', '110403', '510101', '510102', '510103', '510201');