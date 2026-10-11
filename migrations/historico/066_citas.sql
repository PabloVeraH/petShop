-- migrations/066_citas.sql
-- Fase 2 de "servicios agendables": citas reales de clientes contra los
-- servicios configurados en Fase 1 (migración 063). Requiere que 063 ya
-- esté aplicada.
--
-- Estado: **NO APLICADA**. Creada según AGENTS.md §11.1; requiere
-- confirmación explícita del usuario antes de aplicar (§11.2 — no hay
-- staging, wnxrdbnvreofrrmhcybc es el único proyecto real y contiene datos
-- de negocio reales).
--
-- Alcance de Fase 2 (decisiones §9 de docs/plan_servicios.md — APROBADAS
-- explícitamente por el usuario el 2026-08-02): citas + disponibilidad +
-- prevención de conflictos + cancelaciones + excepciones/feriados.
-- Explícitamente fuera de Fase 2 (§17, "Fase 3"): notificaciones,
-- multi-profesional, buffer time, integración POS/canales, calendario
-- visual, autoservicio de cliente.
--
-- Nota de numeración: el plan original llamaba a este archivo 064_citas.sql,
-- pero 064/065 quedaron ocupadas por las migraciones de REVOKE de Fase 1
-- (fix del advisor de seguridad). Se numera 066.
--
-- REVOKE proactivos (desviación aprobada del plan §10): Supabase otorga
-- EXECUTE a anon/authenticated como grant DIRECTO en funciones nuevas del
-- schema public (verificado contra pg_proc.proacl al aplicar 063 — ver
-- migrations/064 y 065). Se incluyen los REVOKE en la misma migración para
-- no repetir el ciclo "aplicar → advisor flaggea → migración de revoke".

-- ─── SERVICIO_EXCEPCIONES ────────────────────────────────────
-- Feriados/cierres puntuales que sobreescriben servicio_horarios para un
-- día específico. Decisión diferida en Fase 1 §1c, resuelta ahora.
CREATE TABLE IF NOT EXISTS servicio_excepciones (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  servicio_id UUID         NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  fecha       DATE         NOT NULL,
  cerrado     BOOLEAN      NOT NULL DEFAULT true,
  hora_inicio TIME,
  hora_fin    TIME,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK (
    (cerrado = true  AND hora_inicio IS NULL AND hora_fin IS NULL) OR
    (cerrado = false AND hora_inicio IS NOT NULL AND hora_fin IS NOT NULL AND hora_inicio < hora_fin)
  ),
  UNIQUE (servicio_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_servicio_excepciones_store_id       ON servicio_excepciones(store_id);
CREATE INDEX IF NOT EXISTS idx_servicio_excepciones_servicio_fecha ON servicio_excepciones(servicio_id, fecha);

ALTER TABLE servicio_excepciones ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "servicio_excepciones_store_isolation" ON servicio_excepciones
    FOR ALL USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_servicio_excepciones_updated_at
    BEFORE UPDATE ON servicio_excepciones
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── CITAS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS citas (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  servicio_id        UUID         NOT NULL REFERENCES servicios(id) ON DELETE RESTRICT,
  cliente_id         UUID         NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  mascota_id         UUID         REFERENCES mascotas(id) ON DELETE SET NULL, -- opcional, decisión §9d
  fecha              DATE         NOT NULL,
  hora_inicio        TIME         NOT NULL,
  hora_fin           TIME         NOT NULL,
  duracion_minutos   INTEGER      NOT NULL, -- snapshot de servicios.duracion_minutos al crear; no se recalcula si el servicio cambia después
  estado             TEXT         NOT NULL DEFAULT 'confirmada'
                       CHECK (estado IN ('confirmada', 'cancelada', 'completada', 'no_show')), -- decisión §9e
  notas              TEXT         CHECK (char_length(notas) <= 500),
  motivo_cancelacion TEXT         CHECK (char_length(motivo_cancelacion) <= 500),
  cancelado_at       TIMESTAMPTZ,
  cancelado_por      TEXT, -- clerk user id
  created_by         TEXT         NOT NULL, -- clerk user id de quien agendó
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK (hora_inicio < hora_fin)
);

CREATE INDEX IF NOT EXISTS idx_citas_store_id       ON citas(store_id);
CREATE INDEX IF NOT EXISTS idx_citas_servicio_fecha ON citas(servicio_id, fecha);
CREATE INDEX IF NOT EXISTS idx_citas_cliente_id     ON citas(cliente_id);

ALTER TABLE citas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "citas_store_isolation" ON citas
    FOR ALL USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_citas_updated_at
    BEFORE UPDATE ON citas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No se agrega exclusion constraint GIST — decisión §9c (advisory lock en
-- crear_cita_tx en vez de CREATE EXTENSION btree_gist, sin precedente en
-- este proyecto).

-- ─── RPC: crear_cita_tx ──────────────────────────────────────
-- Valida servicio/cliente/mascota, resuelve la ventana horaria del día
-- (excepción si existe, si no servicio_horarios), valida que el horario
-- pedido quepa en esa ventana, y valida ausencia de conflicto — todo en una
-- transacción, serializada por pg_advisory_xact_lock (decisión §9c) para
-- que dos requests concurrentes sobre el mismo servicio+día no pasen ambas
-- el chequeo de conflicto antes de que la otra haya insertado su fila.
CREATE OR REPLACE FUNCTION crear_cita_tx(
  p_store_id    UUID,
  p_servicio_id UUID,
  p_cliente_id  UUID,
  p_mascota_id  UUID,
  p_fecha       DATE,
  p_hora_inicio TIME,
  p_notas       TEXT,
  p_created_by  TEXT
) RETURNS citas AS $$
DECLARE
  v_duracion       INTEGER;
  v_hora_fin       TIME;
  v_dia_semana     INTEGER;
  v_ventana_inicio TIME;
  v_ventana_fin    TIME;
  v_excepcion      RECORD;
  v_cita           citas;
BEGIN
  -- Se libera automáticamente al terminar la transacción (COMMIT o ROLLBACK).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_servicio_id::text || p_fecha::text, 0));

  SELECT duracion_minutos INTO v_duracion
  FROM servicios WHERE id = p_servicio_id AND store_id = p_store_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Servicio no encontrado o inactivo' USING ERRCODE = 'P0002';
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

  v_hora_fin := p_hora_inicio + (v_duracion || ' minutes')::INTERVAL;

  -- ISODOW: 1=Lunes ... 7=Domingo — coincide EXACTO con la convención de
  -- dia_semana de servicio_horarios (a diferencia de EXTRACT(DOW), que usa
  -- 0=Domingo; ver advertencia en migrations/063_servicios.sql).
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

  IF EXISTS (
    SELECT 1 FROM citas
     WHERE servicio_id = p_servicio_id AND store_id = p_store_id AND fecha = p_fecha
       AND estado != 'cancelada'
       AND hora_inicio < v_hora_fin AND hora_fin > p_hora_inicio
  ) THEN
    RAISE EXCEPTION 'El horario solicitado ya está reservado' USING ERRCODE = 'PS002';
  END IF;

  INSERT INTO citas (store_id, servicio_id, cliente_id, mascota_id, fecha, hora_inicio, hora_fin, duracion_minutos, notas, created_by)
  VALUES (p_store_id, p_servicio_id, p_cliente_id, p_mascota_id, p_fecha, p_hora_inicio, v_hora_fin, v_duracion, p_notas, p_created_by)
  RETURNING * INTO v_cita;

  RETURN v_cita;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION crear_cita_tx TO service_role;
REVOKE EXECUTE ON FUNCTION crear_cita_tx FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_cita_tx FROM anon, authenticated;

-- ─── RPC: cancelar_cita_tx ───────────────────────────────────
-- Mismo patrón de reclamo atómico que anular_venta_tx (AGENTS.md §23.5): el
-- UPDATE con la condición de estado es la primera y única operación que
-- puede transicionar a 'cancelada'; si 0 filas se afectan, se distingue
-- "no encontrada" de "ya no cancelable" con un SELECT posterior, sin haber
-- mutado nada.
CREATE OR REPLACE FUNCTION cancelar_cita_tx(
  p_cita_id       UUID,
  p_store_id      UUID,
  p_motivo        TEXT,
  p_cancelado_por TEXT
) RETURNS citas AS $$
DECLARE
  v_cita   citas;
  v_estado TEXT;
BEGIN
  UPDATE citas
     SET estado = 'cancelada',
         motivo_cancelacion = p_motivo,
         cancelado_at = NOW(),
         cancelado_por = p_cancelado_por
   WHERE id = p_cita_id AND store_id = p_store_id
     AND estado NOT IN ('cancelada', 'completada')
  RETURNING * INTO v_cita;

  IF NOT FOUND THEN
    SELECT estado INTO v_estado FROM citas WHERE id = p_cita_id AND store_id = p_store_id;
    IF v_estado IS NULL THEN
      RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'P0002';
    ELSE
      RAISE EXCEPTION 'No se puede cancelar una cita en estado %', v_estado USING ERRCODE = 'PS003';
    END IF;
  END IF;

  RETURN v_cita;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cancelar_cita_tx TO service_role;
REVOKE EXECUTE ON FUNCTION cancelar_cita_tx FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancelar_cita_tx FROM anon, authenticated;
