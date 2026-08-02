-- migrations/063_servicios.sql
-- Fase 1 de "servicios agendables": configuración administrativa pura
-- (nombre, duración, horario semanal habilitado). NO incluye citas/reservas
-- de clientes, disponibilidad calculada ni excepciones/feriados — eso es
-- Fase 2, deliberadamente fuera de este alcance (ver docs/plan_servicios.md §8).
--
-- Estado: **NO APLICADA**. Creada según AGENTS.md §11.1; requiere
-- confirmación explícita del usuario antes de aplicar (§11.2 — no hay
-- staging, wnxrdbnvreofrrmhcybc es el único proyecto real y contiene datos
-- de negocio reales).
--
-- Modelo (decisiones documentadas en §1 de docs/plan_servicios.md):
--   servicios         — catálogo de servicios ofrecidos por la tienda. Una
--                        fila por VARIANTE de duración (ej. "Corte básico"
--                        30min y "Corte completo" 60min son dos filas, no
--                        una fila con múltiples duraciones) — decisión §1a.
--                        duracion_minutos restringida a {30, 60, 90} por
--                        requisito explícito del usuario ("puede ser 30, 60
--                        y 90 minutos") — NO es un rango libre.
--   servicio_horarios — a lo sumo UNA franja horaria por día de la semana
--                        por servicio (sin franjas partidas mañana/tarde en
--                        Fase 1) — decisión §1b. dia_semana usa convención
--                        ISO 8601: 1=Lunes ... 7=Domingo (NO la convención
--                        EXTRACT(DOW) de Postgres, que usa 0=Domingo).
--
-- store_id se duplica en servicio_horarios (en vez de resolverse solo vía
-- JOIN a servicios) a propósito: toda tabla tenant-scoped debe poder
-- filtrarse directamente con .eq("store_id", storeId) sin depender de un
-- JOIN (defensa en profundidad, ya que RLS no está en la ruta real de
-- ejecución — el service role la salta, AGENTS.md §0.2). Esto difiere del
-- patrón antiguo de venta_items/nota_credito_items (§6.3 de AGENTS.md), que
-- sí dependen de JOIN al padre por no tener store_id propio; aquí se sigue
-- el patrón más estricto para tabla nueva.
--
-- Patrón RLS: get_user_store_id() OR is_system_admin() (vigente desde la
-- migración 062), vía DO/EXCEPTION porque CREATE POLICY IF NOT EXISTS no
-- existe en Postgres.

-- ─── SERVICIOS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS servicios (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  nombre           TEXT         NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 100),
  descripcion      TEXT         CHECK (char_length(descripcion) <= 500),
  duracion_minutos INTEGER      NOT NULL CHECK (duracion_minutos IN (30, 60, 90)),
  activo           BOOLEAN      NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_servicios_store_id ON servicios(store_id);

ALTER TABLE servicios ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "servicios_store_isolation" ON servicios
    FOR ALL USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_servicios_updated_at
    BEFORE UPDATE ON servicios
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── SERVICIO_HORARIOS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS servicio_horarios (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  servicio_id UUID         NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  dia_semana  INTEGER      NOT NULL CHECK (dia_semana BETWEEN 1 AND 7), -- 1=Lunes ... 7=Domingo (ISO 8601)
  hora_inicio TIME         NOT NULL,
  hora_fin    TIME         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK (hora_inicio < hora_fin),
  UNIQUE (servicio_id, dia_semana)
);

CREATE INDEX IF NOT EXISTS idx_servicio_horarios_store_id    ON servicio_horarios(store_id);
CREATE INDEX IF NOT EXISTS idx_servicio_horarios_servicio_id ON servicio_horarios(servicio_id);

ALTER TABLE servicio_horarios ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "servicio_horarios_store_isolation" ON servicio_horarios
    FOR ALL USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_servicio_horarios_updated_at
    BEFORE UPDATE ON servicio_horarios
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── RPC: reemplazo atómico del horario semanal de un servicio ─────────────
-- Usada por PUT /api/servicios/[id]/horarios. DELETE + INSERT dentro de una
-- sola función (transaccional) para no dejar el horario en estado parcial
-- si el reemplazo falla a mitad de camino (ej. dos pestañas del admin
-- editando a la vez).
CREATE OR REPLACE FUNCTION replace_servicio_horarios(
  p_servicio_id UUID,
  p_store_id    UUID,
  p_horarios    JSONB  -- array de {dia_semana, hora_inicio, hora_fin}, ya validado por Zod en la API
) RETURNS SETOF servicio_horarios AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM servicios WHERE id = p_servicio_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Servicio % no encontrado para la tienda %', p_servicio_id, p_store_id
      USING ERRCODE = 'P0002'; -- la API mapea este código a 404
  END IF;

  DELETE FROM servicio_horarios
  WHERE servicio_id = p_servicio_id AND store_id = p_store_id;

  RETURN QUERY
  INSERT INTO servicio_horarios (store_id, servicio_id, dia_semana, hora_inicio, hora_fin)
  SELECT p_store_id, p_servicio_id,
         (elem->>'dia_semana')::INTEGER,
         (elem->>'hora_inicio')::TIME,
         (elem->>'hora_fin')::TIME
  FROM jsonb_array_elements(p_horarios) AS elem
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION replace_servicio_horarios TO service_role;
