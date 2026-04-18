-- Libro Diario Contable (SII Chile)
-- Módulo: Contabilidad automática por partida doble

-- Plan de Cuentas (Chart of Accounts)
CREATE TABLE chart_of_accounts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  codigo           VARCHAR(20) NOT NULL,
  nombre           VARCHAR(255) NOT NULL,
  descripcion      TEXT,
  tipo             VARCHAR(20) NOT NULL,
  subtipo          VARCHAR(50),
  activo           BOOLEAN DEFAULT true,
  requiere_conciliacion BOOLEAN DEFAULT false,
  saldo_inicial    DECIMAL(12,2) DEFAULT 0,
  saldo_actual     DECIMAL(12,2) DEFAULT 0,
  created_at       TIMESTAMP DEFAULT now(),
  updated_at       TIMESTAMP DEFAULT now(),
  UNIQUE(store_id, codigo),
  CHECK(tipo IN ('ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO'))
);

-- Asientos Contables (encabezado)
CREATE TABLE journal_entries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  numero_asiento   BIGINT NOT NULL,
  fecha            DATE NOT NULL,
  tipo_movimiento  VARCHAR(50),
  referencia_id    UUID,
  referencia_numero VARCHAR(50),
  descripcion      TEXT NOT NULL,
  total_debito     DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_credito    DECIMAL(12,2) NOT NULL DEFAULT 0,
  esta_balanceado  BOOLEAN NOT NULL DEFAULT false,
  usuario_id       TEXT,
  creado_por       VARCHAR(100),
  created_at       TIMESTAMP DEFAULT now(),
  updated_at       TIMESTAMP DEFAULT now(),
  UNIQUE(store_id, numero_asiento)
);

-- Líneas de Asiento Contable (detalle)
CREATE TABLE journal_detail (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journal_entry_id  UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  numero_linea      INT NOT NULL,
  cuenta_codigo     VARCHAR(20) NOT NULL,
  cuenta_nombre     VARCHAR(255) NOT NULL,
  cuenta_tipo       VARCHAR(20),
  debito            DECIMAL(12,2) NOT NULL DEFAULT 0,
  credito           DECIMAL(12,2) NOT NULL DEFAULT 0,
  descripcion_linea VARCHAR(255),
  created_at        TIMESTAMP DEFAULT now(),
  UNIQUE(journal_entry_id, numero_linea)
);

-- Configuración de asientos automáticos por tipo de movimiento
CREATE TABLE movimientos_automaticos (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  tipo_movimiento  VARCHAR(50) NOT NULL,
  metodo_pago      VARCHAR(50),
  cuenta_deudora   VARCHAR(20) NOT NULL,
  cuenta_acreedora VARCHAR(20) NOT NULL,
  incluir_iva      BOOLEAN DEFAULT true,
  activo           BOOLEAN DEFAULT true,
  created_at       TIMESTAMP DEFAULT now()
);

-- Índices
CREATE INDEX idx_journal_entries_store_fecha ON journal_entries(store_id, fecha DESC);
CREATE INDEX idx_journal_entries_referencia ON journal_entries(store_id, referencia_id);
CREATE INDEX idx_journal_entries_tipo ON journal_entries(store_id, tipo_movimiento);
CREATE INDEX idx_journal_detail_cuenta ON journal_detail(cuenta_codigo);
CREATE INDEX idx_journal_detail_entry ON journal_detail(journal_entry_id);
CREATE INDEX idx_chart_of_accounts_store ON chart_of_accounts(store_id, codigo);
CREATE INDEX idx_movimientos_automaticos_store ON movimientos_automaticos(store_id, tipo_movimiento, metodo_pago);
