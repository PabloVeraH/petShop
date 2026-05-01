-- Migration 020: Mascotas, Consumo, Proveedores
-- Reconstruida a partir del código fuente (2026-05-01).
-- Estas tablas fueron aplicadas directamente en Supabase sin archivo de migración.
-- Aplicar SOLO si las tablas no existen (usar IF NOT EXISTS en todos los casos).

-- ─── MASCOTAS ────────────────────────────────────────────────────────────────
-- Mascotas de cada cliente. Necesaria como base para consumo_configs y consumo_alertas.

CREATE TABLE IF NOT EXISTS mascotas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id           UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre               TEXT NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 50),
  tipo                 TEXT NOT NULL CHECK (tipo IN ('perro', 'gato', 'otro')),
  raza                 TEXT CHECK (char_length(raza) <= 50),
  peso_kg              DECIMAL(5,2) CHECK (peso_kg > 0 AND peso_kg <= 100),
  alimento_habitual_id UUID REFERENCES productos(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mascotas_cliente_id ON mascotas(cliente_id);

-- RLS: acceso vía cliente → store
ALTER TABLE mascotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "mascotas_store_isolation" ON mascotas
  FOR ALL USING (
    cliente_id IN (
      SELECT id FROM clientes
      WHERE store_id = (
        SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
      )
    )
  );

-- ─── PROVEEDORES ─────────────────────────────────────────────────────────────
-- Proveedores de cada tienda para gestión de compras.

CREATE TABLE IF NOT EXISTS proveedores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 100),
  rut        TEXT CHECK (char_length(rut) <= 20),
  contacto   TEXT CHECK (char_length(contacto) <= 100),
  telefono   TEXT CHECK (char_length(telefono) <= 20),
  email      TEXT CHECK (char_length(email) <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proveedores_store_id ON proveedores(store_id);

ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "proveedores_store_isolation" ON proveedores
  FOR ALL USING (
    store_id = (
      SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
    )
  );

-- ─── PROVEEDOR_PRODUCTOS ─────────────────────────────────────────────────────
-- Relación proveedor ↔ producto con costo y tiempo de entrega.

CREATE TABLE IF NOT EXISTS proveedor_productos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id        UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  producto_id         UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  costo               DECIMAL(12,2) CHECK (costo >= 0),
  tiempo_entrega_dias INTEGER CHECK (tiempo_entrega_dias >= 0),
  UNIQUE (proveedor_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_proveedor_productos_producto ON proveedor_productos(producto_id);

-- RLS: acceso vía proveedor → store (service_role para escritura desde API)
ALTER TABLE proveedor_productos ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "proveedor_productos_store_isolation" ON proveedor_productos
  FOR ALL USING (
    proveedor_id IN (
      SELECT id FROM proveedores
      WHERE store_id = (
        SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
      )
    )
  );

-- ─── CONSUMO_CONFIGS ─────────────────────────────────────────────────────────
-- Configuración de porción diaria de alimento por mascota y producto.
-- Permite calcular cuándo se acabará el alimento.

CREATE TABLE IF NOT EXISTS consumo_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mascota_id    UUID NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
  cliente_id    UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  producto_id   UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  gramos_porcion DECIMAL(8,2) NOT NULL CHECK (gramos_porcion > 0),
  veces_dia     INTEGER NOT NULL CHECK (veces_dia > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mascota_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_consumo_configs_cliente ON consumo_configs(cliente_id);

-- RLS: acceso vía cliente → store
ALTER TABLE consumo_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "consumo_configs_store_isolation" ON consumo_configs
  FOR ALL USING (
    cliente_id IN (
      SELECT id FROM clientes
      WHERE store_id = (
        SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
      )
    )
  );

-- ─── CONSUMO_ALERTAS ─────────────────────────────────────────────────────────
-- Alertas calculadas de cuándo se agotará el alimento.
-- Generadas automáticamente en POST /api/ventas cuando hay consumo_config.
-- Usadas por el cron /api/cron/email-alerts para enviar recordatorios.

CREATE TABLE IF NOT EXISTS consumo_alertas (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id               UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cliente_id             UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  mascota_id             UUID NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
  producto_id            UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  fecha_estimada_termino DATE NOT NULL,
  dias_aviso             INTEGER,
  enviado                BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mascota_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_consumo_alertas_store ON consumo_alertas(store_id, enviado);
CREATE INDEX IF NOT EXISTS idx_consumo_alertas_fecha  ON consumo_alertas(fecha_estimada_termino);

ALTER TABLE consumo_alertas ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "consumo_alertas_store_isolation" ON consumo_alertas
  FOR ALL USING (
    store_id = (
      SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()
    )
  );
