-- migrations/068_valor_servicio.sql
-- Fase 4 de "servicios agendables": valor monetario de un servicio. Requiere
-- que 063 (servicios), 066 (citas) y 067 (encargados) ya estén aplicadas.
--
-- Estado: **NO APLICADA**. Creada según AGENTS.md §11.1; requiere
-- confirmación explícita del usuario antes de aplicar (§11.2 — no hay
-- staging, wnxrdbnvreofrrmhcybc es el único proyecto real y contiene datos
-- de negocio reales).
--
-- Alcance (ver docs/plan_valorServicio.md):
--   3a. servicios.precio — NUMERIC nullable (las filas existentes quedan sin
--       precio; la obligatoriedad se aplica en la capa de aplicación vía
--       ServicioCreateSchema, y crear_cita_tx bloquea agendar un servicio
--       sin precio).
--   3b. citas.precio (snapshot de servicios.precio al crear la cita, igual
--       que duracion_minutos) y citas.venta_id (referencia a la venta que se
--       crea al completar la cita con pago; ON DELETE SET NULL — ver §23.5
--       de AGENTS.md, anular_venta_tx ya existe y no sabe nada de citas).
--   3c. crear_cita_tx v3: mismo signature que v2 (067), por lo que CREATE OR
--       REPLACE alcanza — sin DROP FUNCTION (a diferencia de 067, aquí no
--       cambia la firma). Valida que el servicio tenga precio y copia ese
--       valor (misma consulta que ya trae duracion_minutos).
--   3d. completar_cita_tx: función NUEVA. Reclamo atómico del estado como
--       primera operación (patrón anular_venta_tx / cancelar_cita_tx) y
--       subconjunto deliberadamente reducido de crear_venta_tx para crear la
--       venta + pago(s) + fidelización de un único servicio — sin stock, sin
--       lotes, sin consumo_alertas, sin COGS (un servicio no tiene costo de
--       mercancía en este modelo). Dos hallazgos de revisión posterior al
--       plan, corregidos acá (mejoras sobre completar_cita_tx, no estaban en
--       el diseño original):
--         - PS006: reclamo atómico de la nota de crédito
--           (UPDATE ... WHERE estado='activa') antes de marcarla 'usada' —
--           sin esto, dos requests concurrentes pagando con la MISMA NC
--           (doble clic, o una carrera con crear_venta_tx pagando la misma
--           NC desde el POS) podían ambos pasar el pre-chequeo y ambos
--           marcarla usada + descontar saldo — doble gasto del mismo
--           crédito. El mismo hueco existe hoy en crear_venta_tx (037); NO
--           se corrige acá por estar fuera del alcance de esta migración —
--           requiere su propia migración con autorización aparte.
--         - PS007: el monto de NC no puede exceder el precio de la cita —
--           la ruta ya lo previene con el clamp de la UI, pero el RPC no lo
--           validaba por su cuenta (defensa en profundidad: el RPC es la
--           última línea, no confía en que el caller ya lo validó).
--   3e. venta_items y nota_credito_items: producto_id pasa a NULLABLE y se
--       agrega servicio_id, con CHECK XOR que exige EXACTAMENTE uno de los
--       dos por línea. Aditivo y retrocompatible: las filas existentes ya
--       tienen producto_id poblado.
--   3f. crear_nota_credito_tx v2: lee vi.servicio_id, salta la restitución
--       de stock para líneas de servicio y persiste servicio_id en
--       nota_credito_items.
--
-- REVOKE proactivos (mismo motivo que 064/065/066/067): Supabase otorga
-- EXECUTE a anon/authenticated como grant DIRECTO en funciones nuevas del
-- schema public — se revocan en la misma migración.

-- ─── 3a. SERVICIOS.PRECIO ────────────────────────────────────
-- NULLABLE a nivel de BD (plan §3a): la fila existente no tiene precio y no
-- hay criterio de negocio real para inventarle uno retroactivamente. El
-- CHECK permite NULL o valor positivo — nunca cero ni negativo.
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS precio NUMERIC(10,2)
  CHECK (precio IS NULL OR precio > 0);

-- ─── 3b. CITAS.PRECIO Y CITAS.VENTA_ID ───────────────────────
ALTER TABLE citas ADD COLUMN IF NOT EXISTS precio NUMERIC(10,2);
ALTER TABLE citas ADD COLUMN IF NOT EXISTS venta_id UUID REFERENCES ventas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_citas_venta_id ON citas(venta_id);

-- ─── 3e. VENTA_ITEMS / NOTA_CREDITO_ITEMS — LÍNEA DE SERVICIO ──
-- El CHECK XOR `(producto_id IS NOT NULL) <> (servicio_id IS NOT NULL)` es
-- exactamente-uno-de-los-dos: una línea es de producto o de servicio, nunca
-- ambas, nunca ninguna. `<>` entre booleanos ES XOR en PostgreSQL.
ALTER TABLE venta_items ALTER COLUMN producto_id DROP NOT NULL;
ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS servicio_id UUID REFERENCES servicios(id);
ALTER TABLE venta_items ADD CONSTRAINT venta_items_producto_xor_servicio
  CHECK ((producto_id IS NOT NULL) <> (servicio_id IS NOT NULL));

ALTER TABLE nota_credito_items ALTER COLUMN producto_id DROP NOT NULL;
ALTER TABLE nota_credito_items ADD COLUMN IF NOT EXISTS servicio_id UUID REFERENCES servicios(id);
ALTER TABLE nota_credito_items ADD CONSTRAINT nc_items_producto_xor_servicio
  CHECK ((producto_id IS NOT NULL) <> (servicio_id IS NOT NULL));

-- ─── 3c. CREAR_CITA_TX (v3 — precio) ─────────────────────────
-- Mismo signature que v2 (067): solo agrega lectura/validación/copia de
-- servicios.precio. No se hace DROP FUNCTION (la firma no cambia). Se
-- conserva SET search_path = public (cerrado en 067, hallazgo de revisión).
CREATE OR REPLACE FUNCTION crear_cita_tx(
  p_store_id      UUID,
  p_servicio_id   UUID,
  p_cliente_id    UUID,
  p_mascota_id    UUID,
  p_encargado_id  UUID,
  p_fecha         DATE,
  p_hora_inicio   TIME,
  p_notas         TEXT,
  p_created_by    TEXT
) RETURNS citas AS $$
DECLARE
  v_duracion       INTEGER;
  v_precio         NUMERIC;
  v_hora_fin       TIME;
  v_dia_semana     INTEGER;
  v_ventana_inicio TIME;
  v_ventana_fin    TIME;
  v_excepcion      RECORD;
  v_cita           citas;
BEGIN
  -- Se liberan automáticamente al terminar la transacción (COMMIT o ROLLBACK).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_servicio_id::text || p_fecha::text, 0));
  IF p_encargado_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_encargado_id::text || p_fecha::text, 1)); -- seed distinto al de servicio
  END IF;

  -- precio sale en la MISMA consulta que ya traía duracion_minutos (plan §3c).
  SELECT duracion_minutos, precio INTO v_duracion, v_precio
  FROM servicios WHERE id = p_servicio_id AND store_id = p_store_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Servicio no encontrado o inactivo' USING ERRCODE = 'P0002';
  END IF;

  IF v_precio IS NULL THEN
    RAISE EXCEPTION 'El servicio no tiene precio configurado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clientes WHERE id = p_cliente_id AND store_id = p_store_id) THEN
    RAISE EXCEPTION 'Cliente no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- mascotas no tiene store_id (tabla hija de clientes, §6.3): ownership
  -- validado vía el cliente padre, ya verificado arriba con store_id.
  IF p_mascota_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM mascotas WHERE id = p_mascota_id AND cliente_id = p_cliente_id
  ) THEN
    RAISE EXCEPTION 'La mascota no pertenece al cliente indicado' USING ERRCODE = 'P0002';
  END IF;

  IF p_encargado_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM encargados WHERE id = p_encargado_id AND store_id = p_store_id AND activo = true
  ) THEN
    RAISE EXCEPTION 'Encargado no encontrado o inactivo' USING ERRCODE = 'P0002';
  END IF;

  v_hora_fin := p_hora_inicio + (v_duracion || ' minutes')::INTERVAL;

  -- ISODOW: 1=Lunes ... 7=Domingo — coincide EXACTO con la convención de
  -- dia_semana de servicio_horarios (ver advertencia en migrations/063).
  v_dia_semana := EXTRACT(ISODOW FROM p_fecha)::INTEGER;

  SELECT * INTO v_excepcion FROM servicio_excepciones
   WHERE servicio_id = p_servicio_id AND store_id = p_store_id AND fecha = p_fecha;

  IF FOUND AND v_excepcion.cerrado THEN
    RAISE EXCEPTION 'El servicio no atiende ese día (excepción/feriado)' USING ERRCODE = 'PS001';
  ELSIF FOUND THEN
    v_ventana_inicio := v_excepcion.hora_inicio;
    v_ventana_fin    := v_excepcion.hora_fin;
  ELSE
    SELECT hora_inicio, hora_fin INTO v_ventana_inicio, v_ventana_fin
    FROM servicio_horarios
    WHERE servicio_id = p_servicio_id AND store_id = p_store_id AND dia_semana = v_dia_semana;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El servicio no atiende ese día de la semana' USING ERRCODE = 'PS001';
    END IF;
  END IF;

  IF p_hora_inicio < v_ventana_inicio OR v_hora_fin > v_ventana_fin THEN
    RAISE EXCEPTION 'El horario solicitado está fuera del rango habilitado' USING ERRCODE = 'PS001';
  END IF;

  -- Chequeo existente por servicio (límite de una cita por servicio y franja).
  IF EXISTS (
    SELECT 1 FROM citas
     WHERE servicio_id = p_servicio_id AND store_id = p_store_id AND fecha = p_fecha
       AND estado != 'cancelada'
       AND hora_inicio < v_hora_fin AND hora_fin > p_hora_inicio
  ) THEN
    RAISE EXCEPTION 'El horario solicitado ya está reservado' USING ERRCODE = 'PS002';
  END IF;

  -- Chequeo por encargado (Fase 3): el mismo encargado en dos citas de
  -- servicios DISTINTOS con horarios traslapados.
  IF p_encargado_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM citas
     WHERE encargado_id = p_encargado_id AND store_id = p_store_id AND fecha = p_fecha
       AND estado != 'cancelada'
       AND hora_inicio < v_hora_fin AND hora_fin > p_hora_inicio
  ) THEN
    RAISE EXCEPTION 'El encargado ya tiene otra cita en ese horario' USING ERRCODE = 'PS004';
  END IF;

  INSERT INTO citas (store_id, servicio_id, cliente_id, mascota_id, encargado_id, fecha, hora_inicio, hora_fin, duracion_minutos, precio, notas, created_by)
  VALUES (p_store_id, p_servicio_id, p_cliente_id, p_mascota_id, p_encargado_id, p_fecha, p_hora_inicio, v_hora_fin, v_duracion, v_precio, p_notas, p_created_by)
  RETURNING * INTO v_cita;

  RETURN v_cita;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION crear_cita_tx TO service_role;
REVOKE EXECUTE ON FUNCTION crear_cita_tx FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_cita_tx FROM anon, authenticated;

-- ─── 3d. COMPLETAR_CITA_TX — cobrar y completar en una transacción ─────────
-- Espejo deliberado de dos funciones existentes (plan §3d):
--   - Reclamo atómico del estado igual a cancelar_cita_tx / anular_venta_tx:
--     el UPDATE ... WHERE estado = 'confirmada' es la PRIMERA operación; si 0
--     filas se afectan, aborta antes de mutar cualquier otra tabla — dos
--     clics simultáneos en "Completar y cobrar" no pueden generar dos ventas.
--   - Creación de venta + pago(s) + fidelización: subconjunto de crear_venta_tx
--     (037), mismo soporte de pago mixto con NC y mismo cálculo de nivel de
--     fidelización — SIN iterar productos, SIN stock, SIN consumo_alertas,
--     SIN COGS.
-- El IVA se calcula en la ruta API con extraerIva() (AGENTS.md §23.3) y se
-- pasa como p_impuesto — no se reimplementa la fórmula en PL/pgSQL.
-- Errores nuevos: PS005 (cita legado sin precio — la ruta ya filtra este caso
-- y usa el camino legado, este raise es defensa en profundidad).
CREATE OR REPLACE FUNCTION completar_cita_tx(
  p_cita_id              UUID,
  p_store_id             UUID,
  p_metodo_pago          TEXT,     -- método del "resto" si hay NC mixta, o el único método
  p_numero_transaccion   TEXT,
  p_impuesto             NUMERIC,  -- calculado en JS con extraerIva() (AGENTS.md §23.3)
  p_pago_nc              JSONB,    -- {nota_credito_id, monto, numero_nc} | null
  p_fidelizacion_niveles JSONB,    -- [{monto, descuento}]
  p_completado_por       TEXT      -- clerk user id
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cita               RECORD;
  v_venta              RECORD;
  v_numero_comprobante TEXT;
  v_metodo_pago_final  TEXT;
  v_monto_nc           NUMERIC;
  v_monto_resto        NUMERIC;
  v_estado             TEXT;
  v_nc_cliente_id      UUID;
  v_saldo_disp         NUMERIC;
  v_fid_total          NUMERIC;
  v_fid_frecuencia     INTEGER;
  v_nuevo_descuento    NUMERIC;
  v_nivel              JSONB;
  v_nivel_idx          INTEGER;
BEGIN
  -- ── 1. Reclamo atómico: primera y única operación que puede completar esta
  --       cita. Si 0 filas se afectan, nadie mutó nada todavía — se distingue
  --       "no encontrada" (P0002) de "ya no completable" (PS003) con un
  --       SELECT posterior, mismo patrón que cancelar_cita_tx.
  UPDATE citas
     SET estado = 'completada'
   WHERE id = p_cita_id AND store_id = p_store_id AND estado = 'confirmada'
  RETURNING * INTO v_cita;

  IF NOT FOUND THEN
    SELECT estado INTO v_estado FROM citas WHERE id = p_cita_id AND store_id = p_store_id;
    IF v_estado IS NULL THEN
      RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'P0002';
    ELSE
      RAISE EXCEPTION 'No se puede completar una cita en estado %', v_estado USING ERRCODE = 'PS003';
    END IF;
  END IF;

  IF v_cita.precio IS NULL THEN
    RAISE EXCEPTION 'Esta cita no tiene un precio asociado (creada antes de esta funcionalidad) — complétala sin cobro' USING ERRCODE = 'PS005';
  END IF;

  -- ── 2. Determinar método de pago final (mismo patrón que crear_venta_tx) ──
  IF p_pago_nc IS NOT NULL THEN
    v_monto_nc          := (p_pago_nc->>'monto')::NUMERIC;

    -- Hallazgo de revisión (mejora sobre completar_cita_tx, no estaba en el
    -- plan original): la ruta valida pagoNc.monto contra el monto_total de
    -- la NC, pero no contra lo que realmente se está cobrando — un caller
    -- que invoque el RPC directo (o un bug de UI) podría enviar un monto de
    -- NC mayor al precio de la cita, consumiendo de más el crédito del
    -- cliente sin necesidad. Defensa en profundidad: el RPC es la última
    -- línea, no confía en que la ruta ya lo validó.
    IF v_monto_nc > v_cita.precio THEN
      RAISE EXCEPTION 'El monto de la nota de crédito no puede exceder el total a cobrar' USING ERRCODE = 'PS007';
    END IF;

    v_monto_resto       := ROUND((v_cita.precio - v_monto_nc) * 100) / 100;
    v_metodo_pago_final := CASE WHEN v_monto_nc >= v_cita.precio THEN 'nota_credito' ELSE 'mixto' END;
  ELSE
    v_metodo_pago_final := p_metodo_pago;
  END IF;

  v_numero_comprobante := to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- ── 3. Crear venta (un único venta_item de servicio, sin stock ni COGS) ──
  INSERT INTO ventas (
    store_id, cliente_id, worker_clerk_id,
    subtotal, descuento, impuesto, total,
    metodo_pago, canal, procedencia, estado, numero_comprobante
  ) VALUES (
    p_store_id, v_cita.cliente_id, p_completado_por,
    v_cita.precio, 0, p_impuesto, v_cita.precio,
    v_metodo_pago_final, 'pos', 'presencial', 'pagada', v_numero_comprobante
  ) RETURNING * INTO v_venta;

  INSERT INTO venta_items (venta_id, servicio_id, mascota_id, cantidad, precio_unitario, subtotal)
  VALUES (v_venta.id, v_cita.servicio_id, v_cita.mascota_id, 1, v_cita.precio, v_cita.precio);

  -- ── 4. Registrar pagos (mismo patrón que crear_venta_tx: NC total/mixta) ──
  IF p_pago_nc IS NOT NULL THEN
    INSERT INTO pagos (store_id, venta_id, metodo, monto, nota_credito_id, numero_transaccion)
    VALUES (
      p_store_id, v_venta.id, 'nota_credito',
      v_monto_nc, (p_pago_nc->>'nota_credito_id')::UUID, p_pago_nc->>'numero_nc'
    );

    IF v_monto_resto > 0 THEN
      INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
      VALUES (p_store_id, v_venta.id, p_metodo_pago, v_monto_resto, p_numero_transaccion);
    END IF;

    -- Reclamo atómico de la NC (mejora sobre completar_cita_tx, hallazgo de
    -- revisión — el mismo hueco existe hoy en crear_venta_tx/037, no se toca
    -- acá por estar fuera del alcance de esta migración, requiere su propio
    -- fix). Sin "AND estado = 'activa'" en el WHERE, un UPDATE incondicional
    -- deja una carrera real: dos requests concurrentes usando la MISMA NC
    -- (doble clic, dos pestañas, o una carrera con crear_venta_tx pagando la
    -- misma NC desde el POS) pasan AMBOS el pre-chequeo en la ruta (ambos
    -- leen estado='activa' antes de que cualquiera confirme) y ambos
    -- llegarían a marcarla 'usada', descontar saldo_a_favor y registrar el
    -- pago — doble gasto del mismo crédito. Mismo principio de reclamo
    -- atómico que el paso 1 de esta función y que anular_venta_tx
    -- (AGENTS.md §23.5): la condición en el UPDATE es la única operación que
    -- puede "ganar" la carrera; si 0 filas se afectan, alguien más ya la usó.
    UPDATE notas_credito
       SET estado = 'usada'
     WHERE id = (p_pago_nc->>'nota_credito_id')::UUID
       AND store_id = p_store_id
       AND estado = 'activa';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La nota de crédito ya no está disponible (fue usada por otra operación)' USING ERRCODE = 'PS006';
    END IF;

    -- Deducir saldo_a_favor si la NC tiene venta de origen con cliente
    SELECT v2.cliente_id INTO v_nc_cliente_id
      FROM notas_credito nc
      JOIN ventas v2 ON v2.id = nc.venta_id
     WHERE nc.id = (p_pago_nc->>'nota_credito_id')::UUID
       AND nc.venta_id IS NOT NULL;

    IF v_nc_cliente_id IS NOT NULL THEN
      SELECT saldo_disponible INTO v_saldo_disp
        FROM saldos_a_favor
       WHERE cliente_id = v_nc_cliente_id AND store_id = p_store_id;

      IF FOUND THEN
        UPDATE saldos_a_favor
           SET saldo_disponible = GREATEST(0, v_saldo_disp - v_monto_nc),
               updated_at       = NOW()
         WHERE cliente_id = v_nc_cliente_id AND store_id = p_store_id;
      END IF;
    END IF;
  ELSE
    INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
    VALUES (p_store_id, v_venta.id, p_metodo_pago, v_cita.precio, p_numero_transaccion);
  END IF;

  -- ── 5. Actualizar fidelización (mismo patrón que crear_venta_tx paso 5) ──
  IF v_cita.cliente_id IS NOT NULL THEN
    SELECT total_historico, frecuencia_compras
      INTO v_fid_total, v_fid_frecuencia
      FROM fidelizacion
     WHERE cliente_id = v_cita.cliente_id;

    v_fid_total      := COALESCE(v_fid_total, 0) + v_cita.precio;
    v_fid_frecuencia := COALESCE(v_fid_frecuencia, 0) + 1;
    v_nuevo_descuento := 0;

    -- Recorrer niveles de mayor a menor monto para encontrar el nivel alcanzado
    FOR v_nivel_idx IN REVERSE jsonb_array_length(p_fidelizacion_niveles) - 1..0 LOOP
      v_nivel := p_fidelizacion_niveles->v_nivel_idx;
      IF v_fid_total >= (v_nivel->>'monto')::NUMERIC THEN
        v_nuevo_descuento := (v_nivel->>'descuento')::NUMERIC;
        EXIT;
      END IF;
    END LOOP;

    INSERT INTO fidelizacion (cliente_id, total_historico, frecuencia_compras, descuento_actual, updated_at)
    VALUES (v_cita.cliente_id, v_fid_total, v_fid_frecuencia, v_nuevo_descuento, NOW())
    ON CONFLICT (cliente_id) DO UPDATE SET
      total_historico    = EXCLUDED.total_historico,
      frecuencia_compras = EXCLUDED.frecuencia_compras,
      descuento_actual   = EXCLUDED.descuento_actual,
      updated_at         = EXCLUDED.updated_at;
  END IF;

  -- ── 6. Vincular la venta a la cita ────────────────────────────────────────
  UPDATE citas SET venta_id = v_venta.id WHERE id = p_cita_id;

  RETURN jsonb_build_object('cita', to_jsonb(v_cita) || jsonb_build_object('venta_id', v_venta.id), 'venta', to_jsonb(v_venta));
END;
$$;

GRANT EXECUTE ON FUNCTION completar_cita_tx TO service_role;
REVOKE EXECUTE ON FUNCTION completar_cita_tx FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION completar_cita_tx FROM anon, authenticated;

-- ─── 3f. CREAR_NOTA_CREDITO_TX (v2 — líneas de servicio) ───────────────────
-- Tres cambios puntuales sobre 061 (plan §3f), nada más:
--   1. El SELECT que lee el item de venta agrega vi.servicio_id. El LEFT JOIN
--      a productos es seguro con producto_id NULL (ya lo es): p.costo sale
--      NULL → COALESCE(...,0) ya existente deja el costo en 0 para servicios.
--   2. La restitución de stock se guarda con producto_id IS NOT NULL: un
--      servicio no tiene stock que restituir, sin importar restituir_stock.
--   3. El INSERT de nota_credito_items persiste servicio_id.
-- El cálculo de precio con descuento proporcional, el INSERT de notas_credito,
-- el incremento de saldo_a_favor y la actualización de fidelización son
-- agnósticos de producto vs. servicio — operan sobre montos, no se tocan.
CREATE OR REPLACE FUNCTION crear_nota_credito_tx(
  p_store_id UUID,
  p_user_id TEXT,
  p_venta_id UUID,
  p_items JSONB,
  p_numero_nc TEXT,
  p_motivo TEXT,
  p_tipo_reembolso TEXT,
  p_metodo_reembolso TEXT,
  p_fecha_vencimiento DATE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venta RECORD;
  v_item RECORD;
  v_venta_item RECORD;
  v_ya_devuelto INTEGER;
  v_disponible INTEGER;
  v_descuento_pct NUMERIC;
  v_descuento_factor NUMERIC;
  v_precio_con_descuento INTEGER;
  v_subtotal INTEGER;
  v_monto_total INTEGER := 0;
  v_costo_total INTEGER := 0;
  v_costo_unitario INTEGER;
  v_restituir BOOLEAN;
  v_nc_id UUID;
  v_has_lotes BOOLEAN;
  v_fid RECORD;
  v_niveles JSONB;
  v_nuevo_total INTEGER;
  v_nuevo_descuento NUMERIC;
  v_nc_items JSONB := '[]'::JSONB;
BEGIN
  -- 1. Validar venta: ownership por store_id, no anulada
  SELECT id, cliente_id, total, descuento, estado
    INTO v_venta
    FROM ventas
   WHERE id = p_venta_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada en esta tienda';
  END IF;

  IF v_venta.estado = 'anulada' THEN
    RAISE EXCEPTION 'No se puede devolver una venta anulada';
  END IF;

  v_descuento_pct := COALESCE(v_venta.descuento, 0);
  v_descuento_factor := CASE WHEN v_descuento_pct > 0
    THEN (100 - v_descuento_pct) / 100.0
    ELSE 1
  END;

  -- 2. Procesar cada item
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    venta_item_id UUID,
    cantidad_devuelta INTEGER,
    restituir_stock BOOLEAN
  )
  LOOP
    v_restituir := COALESCE(v_item.restituir_stock, true);

    -- 2a. Leer datos del item de venta, validar pertenencia. vi.servicio_id
    --     se lee aquí (cambio 3f.1) — el LEFT JOIN a productos sigue siendo
    --     seguro con producto_id NULL y deja p.costo NULL → 0 para servicios.
    SELECT vi.id, vi.cantidad, vi.precio_unitario, vi.producto_id, vi.servicio_id,
           COALESCE(p.costo, 0) AS costo
      INTO v_venta_item
      FROM venta_items vi
      LEFT JOIN productos p ON p.id = vi.producto_id
     WHERE vi.id = v_item.venta_item_id AND vi.venta_id = p_venta_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % no pertenece a la venta %', v_item.venta_item_id, p_venta_id;
    END IF;

    -- 2b. Calcular cantidad disponible
    SELECT COALESCE(SUM(nci.cantidad_devuelta), 0)::INTEGER
      INTO v_ya_devuelto
      FROM nota_credito_items nci
      JOIN notas_credito nc ON nc.id = nci.nota_credito_id
     WHERE nci.venta_item_id = v_item.venta_item_id
       AND nc.venta_id = p_venta_id;

    v_disponible := v_venta_item.cantidad - v_ya_devuelto;

    IF v_item.cantidad_devuelta > v_disponible THEN
      RAISE EXCEPTION 'Cantidad devuelta (%) excede el disponible (%) para el item %',
        v_item.cantidad_devuelta, v_disponible, v_item.venta_item_id;
    END IF;

    -- 2c. Calcular precios con descuento proporcional
    v_precio_con_descuento := ROUND(v_venta_item.precio_unitario * v_descuento_factor);
    v_subtotal := ROUND(v_item.cantidad_devuelta * v_venta_item.precio_unitario * v_descuento_factor);

    v_monto_total := v_monto_total + v_subtotal;

    IF v_restituir THEN
      v_costo_total := v_costo_total + v_item.cantidad_devuelta * v_venta_item.costo;
    END IF;

    -- 2d. Acumular item data para insert bulk (cambio 3f.3: agrega servicio_id)
    v_nc_items := v_nc_items || jsonb_build_object(
      'venta_item_id', v_item.venta_item_id,
      'producto_id', v_venta_item.producto_id,
      'servicio_id', v_venta_item.servicio_id,
      'cantidad_devuelta', v_item.cantidad_devuelta,
      'precio_unitario', v_precio_con_descuento,
      'subtotal', v_subtotal,
      'restituir_stock', v_restituir
    );
  END LOOP;

  IF v_monto_total <= 0 THEN
    RAISE EXCEPTION 'Monto total de la NC debe ser positivo';
  END IF;

  -- 3. INSERT notas_credito
  INSERT INTO notas_credito (
    store_id, venta_id, numero_nc, motivo,
    tipo_reembolso, metodo_reembolso, monto_total,
    estado, fecha_vencimiento
  ) VALUES (
    p_store_id, p_venta_id, p_numero_nc, p_motivo,
    p_tipo_reembolso, p_metodo_reembolso, v_monto_total,
    'activa', p_fecha_vencimiento
  )
  RETURNING id INTO v_nc_id;

  -- 4. INSERT nota_credito_items (cambio 3f.3: persiste servicio_id)
  INSERT INTO nota_credito_items (
    nota_credito_id, venta_item_id, producto_id, servicio_id,
    cantidad_devuelta, precio_unitario, subtotal, restituir_stock
  )
  SELECT
    v_nc_id,
    (item->>'venta_item_id')::UUID,
    (item->>'producto_id')::UUID,
    (item->>'servicio_id')::UUID,
    (item->>'cantidad_devuelta')::INTEGER,
    (item->>'precio_unitario')::INTEGER,
    (item->>'subtotal')::INTEGER,
    (item->>'restituir_stock')::BOOLEAN
  FROM jsonb_array_elements(v_nc_items) item;

  -- 5. Restituir stock y registrar movimientos
  --    Cambio 3f.2: las líneas de servicio (producto_id NULL) se saltan
  --    completo — no hay stock que restituir ni stock_movements que registrar,
  --    sin importar el valor de restituir_stock (defensa en profundidad).
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_nc_items) AS item
  LOOP
    v_restituir := (v_item.item->>'restituir_stock')::BOOLEAN;
    CONTINUE WHEN NOT v_restituir OR (v_item.item->>'producto_id') IS NULL;

    -- 5a. Verificar si el item tiene lotes
    SELECT EXISTS (
      SELECT 1 FROM venta_item_lotes
      WHERE venta_item_id = (v_item.item->>'venta_item_id')::UUID
    ) INTO v_has_lotes;

    IF v_has_lotes THEN
      PERFORM devolver_stock_a_lotes((v_item.item->>'venta_item_id')::UUID);
    ELSE
      PERFORM increment_stock(
        (v_item.item->>'producto_id')::UUID,
        (v_item.item->>'cantidad_devuelta')::INTEGER
      );
    END IF;

    -- 5b. Registrar movimiento de stock
    INSERT INTO stock_movements (
      producto_id, tipo, cantidad, referencia_id, notas, user_id
    ) VALUES (
      (v_item.item->>'producto_id')::UUID,
      'entrada',
      (v_item.item->>'cantidad_devuelta')::INTEGER,
      v_nc_id,
      'Devolución ' || p_numero_nc,
      p_user_id
    );
  END LOOP;

  -- 6. Incrementar saldo a favor si corresponde
  IF p_tipo_reembolso = 'saldo_a_favor' AND v_venta.cliente_id IS NOT NULL THEN
    PERFORM incrementar_saldo_a_favor(p_store_id, v_venta.cliente_id, v_monto_total);
  END IF;

  -- 7. Actualizar fidelización (decrementar total_historico, recalcular descuento)
  IF v_venta.cliente_id IS NOT NULL THEN
    SELECT total_historico, frecuencia_compras INTO v_fid
      FROM fidelizacion WHERE cliente_id = v_venta.cliente_id;

    IF FOUND THEN
      SELECT fidelizacion_niveles INTO v_niveles FROM stores WHERE id = p_store_id;
      IF v_niveles IS NULL OR jsonb_array_length(v_niveles) = 0 THEN
        v_niveles := '[{"monto":50000,"descuento":5},{"monto":150000,"descuento":10},{"monto":300000,"descuento":20}]'::JSONB;
      END IF;

      v_nuevo_total := GREATEST(0, v_fid.total_historico - v_monto_total);

      SELECT (n->>'descuento')::NUMERIC INTO v_nuevo_descuento
        FROM jsonb_array_elements(v_niveles) n
       WHERE v_nuevo_total >= (n->>'monto')::NUMERIC
       ORDER BY (n->>'monto')::NUMERIC DESC
       LIMIT 1;
      v_nuevo_descuento := COALESCE(v_nuevo_descuento, 0);

      UPDATE fidelizacion
         SET total_historico  = v_nuevo_total,
             descuento_actual = v_nuevo_descuento,
             updated_at       = NOW()
       WHERE cliente_id = v_venta.cliente_id;
    END IF;
  END IF;

  -- 8. Retornar datos para el llamador (contabilidad fire-and-forget en JS)
  RETURN jsonb_build_object(
    'id', v_nc_id,
    'numero_nc', p_numero_nc,
    'monto_total', v_monto_total,
    'costo_total', v_costo_total,
    'venta_cliente_id', v_venta.cliente_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION crear_nota_credito_tx TO service_role;
-- Hallazgo CRÍTICO de revisión, no estaba en el plan original: crear_nota_
-- credito_tx (061) nunca tuvo REVOKE — verificado contra pg_proc.proacl real:
-- {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
-- service_role=X/postgres}. El "=X/postgres" es PUBLIC con EXECUTE, más
-- anon/authenticated explícitos — cualquier request no autenticado (anon key,
-- pública en el bundle del cliente) puede invocar
-- /rest/v1/rpc/crear_nota_credito_tx con CUALQUIER p_store_id/p_venta_id: la
-- función es SECURITY DEFINER y no valida identidad del caller contra
-- p_store_id — es una vía de fraude financiero cross-tenant sin autenticar
-- (crea NC arbitraria, incrementa saldos_a_favor de un cliente ajeno,
-- restituye stock, reversa fidelización). Como esta migración YA reescribe
-- esta función (crear_nota_credito_tx v2, §3f), se cierra el hueco acá sin
-- costo de despliegue adicional — mismo patrón que 064/065/066/067.
-- NO se tocan aquí anular_venta_tx, crear_venta_tx, gastar_saldo_a_favor_pago,
-- increment_stock, incrementar_saldo_a_favor ni revertir_saldo_a_favor —
-- tienen el MISMO hueco (confirmado vía get_advisors contra el proyecto real)
-- pero están fuera del alcance de esta migración; requieren su propia
-- migración dedicada con autorización explícita aparte (AGENTS.md §11.2).
REVOKE EXECUTE ON FUNCTION crear_nota_credito_tx FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_nota_credito_tx FROM anon, authenticated;
