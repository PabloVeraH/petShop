-- Fase 0: Multi-Channel Architecture — Step 3
-- Nuevas cuentas contables para canales externos

-- ============================================================
-- Paso 4: Nuevas cuentas contables
-- ============================================================

-- Para cada store, insertar nuevas cuentas de activo y gasto por canal
-- Esto debe ejecutarse para cada store_id del sistema

-- Función auxiliar para insertar cuentas por canal
DO $$
DECLARE
  v_store_id UUID;
  v_store_record RECORD;
BEGIN
  -- Para cada store existente, crear las cuentas de canal
  FOR v_store_record IN SELECT DISTINCT store_id FROM chart_of_accounts LIMIT 1
  LOOP
    v_store_id := v_store_record.store_id;

    -- Insertar cuentas por cobrar por canal externo (activo circulante)
    INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, descripcion, activo)
    VALUES
      (v_store_id, '110401', 'Cuentas por cobrar Rappi',      'ACTIVO', 'Ventas Rappi pendientes de liquidación', true),
      (v_store_id, '110402', 'Cuentas por cobrar PedidosYa',  'ACTIVO', 'Ventas PedidosYa pendientes de liquidación', true),
      (v_store_id, '110403', 'Cuentas por cobrar UberEats',   'ACTIVO', 'Ventas UberEats pendientes de liquidación', true)
    ON CONFLICT (store_id, codigo) DO NOTHING;

    -- Insertar gastos de comisión por plataforma
    INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, descripcion, activo)
    VALUES
      (v_store_id, '510101', 'Comisión Rappi',      'GASTO', 'Comisión cobrada por Rappi sobre ventas', true),
      (v_store_id, '510102', 'Comisión PedidosYa',  'GASTO', 'Comisión cobrada por PedidosYa sobre ventas', true),
      (v_store_id, '510103', 'Comisión UberEats',   'GASTO', 'Comisión cobrada por UberEats sobre ventas', true)
    ON CONFLICT (store_id, codigo) DO NOTHING;

    -- Insertar gasto por devoluciones en canal externo
    INSERT INTO chart_of_accounts (store_id, codigo, nombre, tipo, descripcion, activo)
    VALUES
      (v_store_id, '510201', 'Devoluciones canal externo', 'GASTO', 'Devoluciones absorbidas por plataformas', true)
    ON CONFLICT (store_id, codigo) DO NOTHING;
  END LOOP;
END $$;

COMMIT;
