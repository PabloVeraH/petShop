-- ============================================================
-- 000_base_schema.sql
-- Esquema base del sistema petShop.
--
-- Este archivo captura las tablas fundacionales que existían antes
-- de que se iniciara el sistema de migraciones numeradas (006+).
-- Usar SOLO en instalaciones nuevas. En una instancia existente,
-- estas tablas ya deben estar presentes.
--
-- Orden de ejecución en instalación nueva:
--   000 → 006 → 007 → 008 → ... → 028 → 029
-- ============================================================

-- ─── EXTENSIONES ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── FUNCIÓN: updated_at automático ──────────────────────────
-- Usada por todos los triggers de updated_at del sistema.
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── FUNCIÓN: store_id del usuario actual ────────────────────
-- Lee el clerk_id del JWT y devuelve el store_id asociado.
-- Usada en políticas RLS.
CREATE OR REPLACE FUNCTION get_user_store_id()
RETURNS UUID AS $$
  SELECT store_id
  FROM clerk_users
  WHERE clerk_id = auth.uid()::TEXT
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── FUNCIÓN: verificar systemAdmin ──────────────────────────
-- Lee publicMetadata del JWT de Clerk.
-- Usada en políticas RLS que requieren systemAdmin.
CREATE OR REPLACE FUNCTION is_system_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'publicMetadata' ->> 'systemAdmin')::BOOLEAN,
    false
  );
$$ LANGUAGE sql STABLE;

-- ─── FUNCIÓN: decrementar stock (legacy) ─────────────────────
-- Usada antes del sistema FIFO de lotes (migración 026).
-- Mantenida para compatibilidad.
CREATE OR REPLACE FUNCTION decrement_stock(
  p_producto_id UUID,
  p_cantidad    INTEGER
) RETURNS VOID AS $$
BEGIN
  UPDATE productos
  SET stock = GREATEST(0, stock - p_cantidad)
  WHERE id = p_producto_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── STORES ──────────────────────────────────────────────────
-- Tabla principal multi-tenant. Cada tienda es un registro aquí.
-- Columnas de licencia (license_*) añadidas en migración 022.
-- Columnas de email reminder (email_reminder_*) añadidas en migración 021.
CREATE TABLE IF NOT EXISTS stores (
  id                              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                            TEXT         NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  rut                             TEXT,
  address                         TEXT,
  phone                           TEXT,
  email                           TEXT,
  whatsapp_enabled                BOOLEAN      NOT NULL DEFAULT false,
  whatsapp_phone_number_id        TEXT,
  whatsapp_access_token           TEXT,
  whatsapp_webhook_verify_token   TEXT,
  created_at                      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "stores_store_isolation" ON stores
  FOR ALL USING (
    id = get_user_store_id()
    OR is_system_admin()
  );

CREATE TRIGGER trg_stores_updated_at
  BEFORE UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── CLERK_USERS ─────────────────────────────────────────────
-- Usuarios sincronizados desde Clerk. Mapea clerk_id → store.
-- Columna is_disabled añadida en migración 022.
-- Columnas nombre/rut/meta_ventas añadidas en migración 025.
CREATE TABLE IF NOT EXISTS clerk_users (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id     TEXT         NOT NULL UNIQUE,
  email        TEXT         NOT NULL,
  store_id     UUID         REFERENCES stores(id) ON DELETE SET NULL,
  system_admin BOOLEAN      NOT NULL DEFAULT false,
  store_admin  BOOLEAN      NOT NULL DEFAULT false,
  store_worker BOOLEAN      NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clerk_users_clerk_id  ON clerk_users(clerk_id);
CREATE INDEX IF NOT EXISTS idx_clerk_users_store_id  ON clerk_users(store_id);

ALTER TABLE clerk_users ENABLE ROW LEVEL SECURITY;

-- systemAdmin puede ver todos; los demás solo se ven a sí mismos
CREATE POLICY IF NOT EXISTS "clerk_users_isolation" ON clerk_users
  FOR ALL USING (
    clerk_id = auth.uid()::TEXT
    OR is_system_admin()
    OR store_id = get_user_store_id()
  );

CREATE TRIGGER trg_clerk_users_updated_at
  BEFORE UPDATE ON clerk_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── CLIENTES ────────────────────────────────────────────────
-- Clientes de cada tienda. Identificados por RUT.
CREATE TABLE IF NOT EXISTS clientes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  rut        TEXT        NOT NULL CHECK (char_length(rut) <= 15),
  nombre     TEXT        NOT NULL CHECK (char_length(nombre) BETWEEN 3 AND 100),
  email      TEXT        CHECK (char_length(email) <= 100),
  telefono   TEXT        CHECK (char_length(telefono) <= 20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, rut)
);

CREATE INDEX IF NOT EXISTS idx_clientes_store_id ON clientes(store_id);
CREATE INDEX IF NOT EXISTS idx_clientes_rut      ON clientes(store_id, rut);

ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "clientes_store_isolation" ON clientes
  FOR ALL USING (store_id = get_user_store_id());

CREATE TRIGGER trg_clientes_updated_at
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── PRODUCTOS ───────────────────────────────────────────────
-- Catálogo de productos de cada tienda.
-- Columnas añadidas por migraciones posteriores:
--   007: fecha_vencimiento, dias_alerta, precio_oferta, en_oferta
--   016: categoria_id
--   017: codigo_barra
--   019: demanda_promedio_diaria, dias_seguridad, tendencia_ventas, ultimo_consumo
--   024: renombra dias_alerta → dias_alerta_expira
--   028: tiene_vencimiento; precio pasa a nullable
CREATE TABLE IF NOT EXISTS productos (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku          TEXT         NOT NULL CHECK (char_length(sku) BETWEEN 1 AND 50),
  nombre       TEXT         NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 100),
  marca        TEXT,
  tipo_animal  TEXT,
  peso_gramos  INTEGER      CHECK (peso_gramos > 0),
  precio       DECIMAL(10,2) CHECK (precio > 0),
  costo        DECIMAL(10,2) CHECK (costo >= 0),
  stock        INTEGER      NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_minimo INTEGER      NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  activo       BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_productos_store_id ON productos(store_id);
CREATE INDEX IF NOT EXISTS idx_productos_sku      ON productos(store_id, sku);
CREATE INDEX IF NOT EXISTS idx_productos_stock_bajo ON productos(store_id, stock)
  WHERE activo = true;

ALTER TABLE productos ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "productos_store_isolation" ON productos
  FOR ALL USING (store_id = get_user_store_id());

CREATE TRIGGER trg_productos_updated_at
  BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── VENTAS ──────────────────────────────────────────────────
-- Transacciones del POS. Cada venta pertenece a un store.
-- Columnas añadidas por migraciones:
--   012-015: canal
--   023: procedencia
--   025: worker_clerk_id; vendedor_id eliminado
CREATE TABLE IF NOT EXISTS ventas (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cliente_id          UUID         REFERENCES clientes(id) ON DELETE SET NULL,
  numero_comprobante  TEXT,
  subtotal            DECIMAL(12,2) NOT NULL DEFAULT 0,
  impuesto            DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento           DECIMAL(12,2) NOT NULL DEFAULT 0,
  total               DECIMAL(12,2) NOT NULL DEFAULT 0,
  metodo_pago         TEXT         NOT NULL,
  estado              TEXT         NOT NULL DEFAULT 'completada'
                        CHECK (estado IN ('completada', 'pendiente', 'cancelada', 'reembolsada')),
  notas               TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ventas_store_id   ON ventas(store_id);
CREATE INDEX IF NOT EXISTS idx_ventas_cliente_id ON ventas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ventas_created_at ON ventas(store_id, created_at DESC);

ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "ventas_store_isolation" ON ventas
  FOR ALL USING (store_id = get_user_store_id());

CREATE TRIGGER trg_ventas_updated_at
  BEFORE UPDATE ON ventas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── VENTA_ITEMS ─────────────────────────────────────────────
-- Líneas de cada venta.
CREATE TABLE IF NOT EXISTS venta_items (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id        UUID         NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id     UUID         NOT NULL REFERENCES productos(id),
  mascota_id      UUID,
  cantidad        INTEGER      NOT NULL CHECK (cantidad > 0),
  precio_unitario DECIMAL(10,2) NOT NULL CHECK (precio_unitario >= 0),
  descuento       DECIMAL(10,2) NOT NULL DEFAULT 0,
  subtotal        DECIMAL(12,2) NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venta_items_venta_id   ON venta_items(venta_id);
CREATE INDEX IF NOT EXISTS idx_venta_items_producto_id ON venta_items(producto_id);

ALTER TABLE venta_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "venta_items_via_venta" ON venta_items
  FOR ALL USING (
    venta_id IN (
      SELECT id FROM ventas WHERE store_id = get_user_store_id()
    )
  );

-- ─── FIDELIZACION ────────────────────────────────────────────
-- Puntos / historial de fidelización por cliente.
CREATE TABLE IF NOT EXISTS fidelizacion (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id        UUID         NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  total_historico   DECIMAL(14,2) NOT NULL DEFAULT 0,
  frecuencia_compras INTEGER      NOT NULL DEFAULT 0,
  descuento_actual  DECIMAL(5,2) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(cliente_id)
);

ALTER TABLE fidelizacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "fidelizacion_via_cliente" ON fidelizacion
  FOR ALL USING (
    cliente_id IN (
      SELECT id FROM clientes WHERE store_id = get_user_store_id()
    )
  );

-- ─── STOCK_MOVEMENTS ─────────────────────────────────────────
-- Registro de entradas y salidas de stock para auditoría.
CREATE TABLE IF NOT EXISTS stock_movements (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id  UUID        NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  tipo         TEXT        NOT NULL CHECK (tipo IN ('entrada', 'salida', 'ajuste')),
  cantidad     INTEGER     NOT NULL,
  referencia_id UUID,
  notas        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_producto ON stock_movements(producto_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_fecha    ON stock_movements(producto_id, created_at DESC);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "stock_movements_via_producto" ON stock_movements
  FOR ALL USING (
    producto_id IN (
      SELECT id FROM productos WHERE store_id = get_user_store_id()
    )
  );

-- ─── ORDENES_COMPRA ───────────────────────────────────────────
-- Órdenes de compra a proveedores.
-- subtotal/impuesto/total son NULL hasta que la OC se recibe
-- (migración 028 hace esto explícito con ALTER COLUMN DROP NOT NULL).
-- estado: pendiente → enviada → recibida | cancelada
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  proveedor_id   UUID        NOT NULL,
  numero         TEXT        NOT NULL,
  estado         TEXT        NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente', 'enviada', 'recibida', 'cancelada')),
  subtotal       DECIMAL(12,2),
  impuesto       DECIMAL(12,2),
  total          DECIMAL(12,2),
  fecha_estimada TIMESTAMPTZ,
  fecha_recibida DATE,
  notas          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_ordenes_compra_store    ON ordenes_compra(store_id, estado);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_proveedor ON ordenes_compra(proveedor_id);

ALTER TABLE ordenes_compra ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "ordenes_compra_store_isolation" ON ordenes_compra
  FOR ALL USING (store_id = get_user_store_id());

CREATE TRIGGER trg_ordenes_compra_updated_at
  BEFORE UPDATE ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── ORDENES_COMPRA_ITEMS ─────────────────────────────────────
-- Líneas de cada orden de compra.
-- producto_id puede ser NULL si el producto aún no existe en el catálogo
-- (nombre_nuevo provee el nombre provisional).
-- precio_unitario y subtotal se rellenan al recibir la OC.
CREATE TABLE IF NOT EXISTS ordenes_compra_items (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id            UUID        NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  producto_id         UUID        REFERENCES productos(id) ON DELETE SET NULL,
  nombre_nuevo        TEXT,
  cantidad_solicitada INTEGER     NOT NULL CHECK (cantidad_solicitada > 0),
  cantidad_recibida   INTEGER     DEFAULT 0 CHECK (cantidad_recibida >= 0),
  precio_unitario     DECIMAL(10,2),
  subtotal            DECIMAL(12,2),
  CONSTRAINT oc_item_tiene_producto
    CHECK (producto_id IS NOT NULL OR (nombre_nuevo IS NOT NULL AND nombre_nuevo <> ''))
);

CREATE INDEX IF NOT EXISTS idx_oc_items_orden_id    ON ordenes_compra_items(orden_id);
CREATE INDEX IF NOT EXISTS idx_oc_items_producto_id ON ordenes_compra_items(producto_id);

ALTER TABLE ordenes_compra_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "oc_items_via_orden" ON ordenes_compra_items
  FOR ALL USING (
    orden_id IN (
      SELECT id FROM ordenes_compra WHERE store_id = get_user_store_id()
    )
  );

CREATE TRIGGER trg_ordenes_compra_items_updated_at
  BEFORE UPDATE ON ordenes_compra_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── CUENTAS_PAGAR ───────────────────────────────────────────
-- Deudas a proveedores, generadas automáticamente al recibir una OC.
-- También pueden crearse manualmente.
CREATE TABLE IF NOT EXISTS cuentas_pagar (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  proveedor_id     UUID        NOT NULL,
  orden_id         UUID        REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  monto            DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  fecha_emision    DATE        NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE       NOT NULL,
  estado           TEXT        NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente', 'pagada', 'vencida')),
  notas            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_store    ON cuentas_pagar(store_id, estado);
CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_proveedor ON cuentas_pagar(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_vencimiento ON cuentas_pagar(fecha_vencimiento)
  WHERE estado = 'pendiente';

ALTER TABLE cuentas_pagar ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "cuentas_pagar_store_isolation" ON cuentas_pagar
  FOR ALL USING (store_id = get_user_store_id());

CREATE TRIGGER trg_cuentas_pagar_updated_at
  BEFORE UPDATE ON cuentas_pagar
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
