-- Notas de Crédito y Devoluciones
CREATE TABLE notas_credito (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  venta_id         UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  numero_nc        VARCHAR(25) UNIQUE,
  motivo           TEXT,
  tipo_reembolso   VARCHAR(30) NOT NULL,
  metodo_reembolso VARCHAR(50),
  monto_total      DECIMAL(12,2) NOT NULL,
  estado           VARCHAR(30) DEFAULT 'activa',
  created_at       TIMESTAMP DEFAULT now(),
  updated_at       TIMESTAMP DEFAULT now()
);

CREATE TABLE nota_credito_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nota_credito_id  UUID NOT NULL REFERENCES notas_credito(id) ON DELETE CASCADE,
  venta_item_id    UUID NOT NULL REFERENCES venta_items(id),
  producto_id      UUID NOT NULL REFERENCES productos(id),
  cantidad_devuelta INT NOT NULL,
  precio_unitario  DECIMAL(10,2) NOT NULL,
  subtotal         DECIMAL(12,2) NOT NULL,
  restituir_stock  BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMP DEFAULT now()
);

CREATE TABLE saldos_a_favor (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cliente_id       UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  saldo_disponible DECIMAL(12,2) DEFAULT 0,
  updated_at       TIMESTAMP DEFAULT now(),
  UNIQUE(store_id, cliente_id)
);

CREATE INDEX idx_notas_credito_venta ON notas_credito(venta_id);
CREATE INDEX idx_notas_credito_store ON notas_credito(store_id);
CREATE INDEX idx_notas_credito_cliente ON notas_credito(store_id) WHERE estado = 'activa';
CREATE INDEX idx_nota_credito_items_nc ON nota_credito_items(nota_credito_id);
CREATE INDEX idx_saldos_a_favor_cliente ON saldos_a_favor(cliente_id, store_id);
