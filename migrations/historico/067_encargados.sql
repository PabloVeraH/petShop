-- migrations/067_encargados.sql
-- Fase 3 de "servicios agendables": asignación de un encargado (miembro del
-- personal) a cada cita + CRUD de encargados. Requiere que 066 ya esté
-- aplicada (tabla citas) y que 063 esté aplicada (tabla servicios).
--
-- Estado: **NO APLICADA**. Creada según AGENTS.md §11.1; requiere
-- confirmación explícita del usuario antes de aplicar (§11.2 — no hay
-- staging, wnxrdbnvreofrrmhcybc es el único proyecto real y contiene datos
-- de negocio reales).
--
-- Alcance de Fase 3 (ver docs/plan_sirvientes.md):
--   3a. Tabla encargados (catálogo por tienda, baja lógica, mismo patrón
--       que servicios — migración 063).
--   3b. citas.encargado_id como columna NULLABLE (las 5 citas históricas
--       quedan con NULL, mostradas como "Sin asignar"; la obligatoriedad se
--       aplica en la capa de aplicación vía CitaCreateSchema, NO como NOT
--       NULL en el schema — plan §2).
--   3c. crear_cita_tx v2: nuevo parámetro p_encargado_id con validación
--       (existe/activo/misma tienda), segundo advisory lock aditivo (orden
--       fijo: servicio primero, encargado después) y chequeo de conflicto
--       por encargado sin filtrar por servicio_id (ERRCODE 'PS004').
--   Fuera de alcance (§11 del plan): horario individual por encargado,
--   paralelismo por servicio (confirmado que NO se quiere), reasignación de
--   encargado en citas existentes, backfill de las 5 citas históricas.
--
-- Nota sobre el REPLACE: se cambia la firma de crear_cita_tx (se agrega
-- p_encargado_id), por lo que CREATE OR REPLACE crearía una sobrecarga nueva
-- dejando la antigua de 066 viva. Se DROP explicitamente la firma de 066
-- para no dejar código muerto que el service_role aún pueda invocar sin
-- asignar encargado.
--
-- REVOKE proactivos (mismo motivo que 066): Supabase otorga EXECUTE a
-- anon/authenticated como grant DIRECTO en funciones nuevas del schema
-- public — se revocan en la misma migración.
--
-- SET search_path = public (hallazgo de revisión, no estaba en el plan
-- original): crear_cita_tx en 066 quedó SIN `search_path` fijo (a diferencia
-- de crear_nota_credito_tx/061 y anular_venta_tx/053, que sí lo fijan) —
-- verificado contra pg_proc.proconfig en la base real. Como esta migración
-- ya reescribe la función completa, se aprovecha para cerrar ese hueco
-- (mutable search_path en una función SECURITY DEFINER) en vez de arrastrarlo
-- a una tercera versión. No se modifica cancelar_cita_tx (066, ya aplicada,
-- fuera del alcance de esta migración) — si se quiere corregir, es un cambio
-- aparte.

-- ─── ENCARGADOS ───────────────────────────────────────────────
-- Mismo patrón que servicios: catálogo simple por tienda, baja lógica.
-- Deliberadamente sin más columnas (sin "especialidad", "foto", "teléfono"
-- — YAGNI, plan §3a).
CREATE TABLE IF NOT EXISTS encargados (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  nombre      TEXT         NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 100),
  activo      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_encargados_store_id ON encargados(store_id);

ALTER TABLE encargados ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "encargados_store_isolation" ON encargados
    FOR ALL USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_encargados_updated_at
    BEFORE UPDATE ON encargados
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── CITAS.ENCARGADO_ID ───────────────────────────────────────
-- NULLABLE (plan §2): las 5 citas históricas existentes quedan con NULL y se
-- muestran como "Sin asignar". ON DELETE RESTRICT (no SET NULL): no hay
-- DELETE real de encargados (solo baja lógica) — defensa adicional que no
-- debería activarse en flujo normal.
ALTER TABLE citas ADD COLUMN IF NOT EXISTS encargado_id UUID REFERENCES encargados(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_citas_encargado_id ON citas(encargado_id);

-- ─── RPC: crear_cita_tx (v2 — Fase 3) ─────────────────────────
-- Se agrega p_encargado_id (nullable a nivel de firma por compatibilidad,
-- pero la API siempre lo enviará no-nulo vía CitaCreateSchema). Cambios:
--   1. Validación de encargado: existe, activo y de p_store_id (P0002).
--   2. Segundo advisory lock ADITIVO, mismo orden siempre (servicio primero,
--      encargado después) para no introducir deadlocks.
--   3. Chequeo de conflicto NUEVO por encargado_id, SIN filtrar por
--      servicio_id: el encargado no puede estar en dos citas de ningún
--      servicio a la misma hora (PS004). Complementa al chequeo por
--      servicio_id que ya existe (límite de una cita por servicio y franja).
DROP FUNCTION IF EXISTS crear_cita_tx(UUID, UUID, UUID, UUID, DATE, TIME, TEXT, TEXT);
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

  -- Chequeo existente por servicio (límite de una cita por servicio y franja,
  -- plan §1 — comportamiento confirmado, no se toca).
  IF EXISTS (
    SELECT 1 FROM citas
     WHERE servicio_id = p_servicio_id AND store_id = p_store_id AND fecha = p_fecha
       AND estado != 'cancelada'
       AND hora_inicio < v_hora_fin AND hora_fin > p_hora_inicio
  ) THEN
    RAISE EXCEPTION 'El horario solicitado ya está reservado' USING ERRCODE = 'PS002';
  END IF;

  -- Chequeo NUEVO por encargado: cubre el caso que el chequeo por servicio
  -- NO detecta — el mismo encargado en dos citas de servicios DISTINTOS con
  -- horarios traslapados (plan §1/§3c).
  IF p_encargado_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM citas
     WHERE encargado_id = p_encargado_id AND store_id = p_store_id AND fecha = p_fecha
       AND estado != 'cancelada'
       AND hora_inicio < v_hora_fin AND hora_fin > p_hora_inicio
  ) THEN
    RAISE EXCEPTION 'El encargado ya tiene otra cita en ese horario' USING ERRCODE = 'PS004';
  END IF;

  INSERT INTO citas (store_id, servicio_id, cliente_id, mascota_id, encargado_id, fecha, hora_inicio, hora_fin, duracion_minutos, notas, created_by)
  VALUES (p_store_id, p_servicio_id, p_cliente_id, p_mascota_id, p_encargado_id, p_fecha, p_hora_inicio, v_hora_fin, v_duracion, p_notas, p_created_by)
  RETURNING * INTO v_cita;

  RETURN v_cita;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION crear_cita_tx TO service_role;
REVOKE EXECUTE ON FUNCTION crear_cita_tx FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_cita_tx FROM anon, authenticated;
