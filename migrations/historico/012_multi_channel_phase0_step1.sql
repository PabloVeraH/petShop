-- Fase 0: Multi-Channel Architecture — Step 1
-- Crear tablas base del Hub de Canales
-- Ejecutar en orden: 012, 013, 014, 015, 016

-- ============================================================
-- Paso 2: Tablas del Hub de Canales
-- ============================================================

-- Catálogo de canales soportados
-- habilitado: systemAdmin puede togglear sin redeploy
-- es_externo: false = canal interno (POS), true = plataforma externa
CREATE TABLE IF NOT EXISTS canales_externos (
  id           TEXT PRIMARY KEY,        -- 'pos', 'rappi', 'pedidosya', 'ubereats'
  nombre       TEXT        NOT NULL,
  es_externo   BOOLEAN     NOT NULL DEFAULT true,
  habilitado   BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inicializar canales base
INSERT INTO canales_externos (id, nombre, es_externo, habilitado) VALUES
  ('pos',       'Presencial (POS)', false, true),
  ('rappi',     'Rappi',            true,  false),
  ('pedidosya', 'PedidosYa',        true,  false),
  ('ubereats',  'UberEats',         true,  false)
ON CONFLICT (id) DO NOTHING;

-- Credenciales y configuración por tienda × canal externo
CREATE TABLE IF NOT EXISTS canal_config (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  canal_id          TEXT        NOT NULL REFERENCES canales_externos(id),
  external_store_id TEXT,
  -- credentials: JSONB cifrado con AES-256-GCM via encryption.ts
  -- estructura desencriptada: { client_id, client_secret, ... }
  credentials       JSONB,
  webhook_secret    TEXT,       -- cifrado
  token             TEXT,       -- JWT actual, cifrado
  token_expires_at  TIMESTAMPTZ,
  comision_pct      NUMERIC(5,2) NOT NULL DEFAULT 0, -- ej: 30.00 = 30%
  activo            BOOLEAN     NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, canal_id)
);

-- Precio y disponibilidad de cada producto en cada canal (incluye POS)
-- Esta tabla reemplaza productos.precio
CREATE TABLE IF NOT EXISTS canal_producto_config (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  canal_id            TEXT         NOT NULL REFERENCES canales_externos(id),
  producto_id         UUID         NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  precio              NUMERIC(10,2) NOT NULL CHECK (precio > 0),
  activo              BOOLEAN      NOT NULL DEFAULT true,
  categoria_canal     TEXT,
  descripcion_canal   TEXT,
  external_product_id TEXT,        -- ID asignado por la plataforma al sincronizar
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(canal_id, producto_id)
);

-- Órdenes recibidas de cualquier canal externo
CREATE TABLE IF NOT EXISTS canal_ordenes (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  canal_id          TEXT         NOT NULL REFERENCES canales_externos(id),
  external_order_id TEXT         NOT NULL,
  estado            TEXT         NOT NULL DEFAULT 'pending',
  -- CONSTRAINT: estado IN ('pending','reserved','accepted','ready',
  --   'picked_up','delivered','rejected','cancelled','expired')
  payload           JSONB        NOT NULL,
  venta_id          UUID         REFERENCES ventas(id),
  aceptar_antes_de  TIMESTAMPTZ, -- deadline calculado al recibir la orden
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(canal_id, external_order_id)
);

-- Reserva temporal de stock entre recepción y aceptación de orden externa
CREATE TABLE IF NOT EXISTS stock_reservas (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id   UUID         NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  canal_orden_id UUID        NOT NULL REFERENCES canal_ordenes(id) ON DELETE CASCADE,
  cantidad      INT          NOT NULL CHECK (cantidad > 0),
  expira_at     TIMESTAMPTZ  NOT NULL, -- now() + 10 min (mayor que la ventana más larga)
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(canal_orden_id, producto_id)
);

-- Liquidaciones recibidas de plataformas externas
CREATE TABLE IF NOT EXISTS canal_liquidaciones (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  canal_id      TEXT         NOT NULL REFERENCES canales_externos(id),
  periodo_desde DATE         NOT NULL,
  periodo_hasta DATE         NOT NULL,
  monto_bruto   NUMERIC(10,2) NOT NULL, -- ventas brutas del período
  comision      NUMERIC(10,2) NOT NULL, -- monto cobrado por la plataforma
  monto_neto    NUMERIC(10,2) NOT NULL, -- lo efectivamente transferido
  referencia    TEXT,                   -- número de transferencia/referencia
  journal_entry_id UUID      REFERENCES journal_entries(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMIT;
