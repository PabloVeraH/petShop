-- =============================================================================
-- reset-servicios-citas.sql
--
-- ⚠️  DESTRUCTIVO, pero de alcance acotado. Vacía únicamente las tablas del
-- módulo "servicios agendables" (Fases 1-3) contra el proyecto Supabase real
-- (`wnxrdbnvreofrrmhcybc`) — el único proyecto existente, sin staging (ver
-- AGENTS.md §0.1). Pensado para probar de punta a punta la funcionalidad
-- nueva de encargados/citas sin afectar el resto de la demo (ventas,
-- clientes, contabilidad, inventario, etc., que quedan intactos).
--
-- Este archivo documenta y prepara la operación; NO la ejecuta por sí solo.
-- Ejecutarlo requiere una decisión explícita en el momento de correrlo
-- (mismo protocolo que aplicar una migración, AGENTS.md §11.2).
--
-- Tablas que vacía:
--   - servicios              (catálogo de servicios agendables)
--   - servicio_horarios      (horarios semanales por servicio)
--   - servicio_excepciones   (feriados/excepciones por servicio)
--   - citas                  (citas agendadas)
--   - encargados             (Fase 3 — solo si la migración 067 ya está
--                             aplicada; si no existe, el script la omite
--                             sin fallar)
--
-- Tablas que NO toca (todo el resto de la demo): clientes, mascotas,
-- productos, categorias, proveedores, ventas, pagos, notas_credito,
-- fidelizacion, contabilidad, canales externos, logs, sesiones, stores,
-- clerk_users, etc.
--
-- Verificado contra el schema real (solo lectura, information_schema): las
-- únicas FKs que referencian a `servicios` son `citas.servicio_id`,
-- `servicio_horarios.servicio_id` y `servicio_excepciones.servicio_id` —
-- las 3 están incluidas en este mismo script, así que no queda ninguna fila
-- huérfana fuera de este conjunto. Ninguna tabla tiene FK hacia `citas`
-- (no hay dependientes).
--
-- Alcance: vacía para TODAS las tiendas (no filtra por store_id) — hoy solo
-- existe una tienda ("PetShop La Huella"), así que es equivalente a un
-- reset por tienda.
--
-- Cómo correrlo (elige uno, cualquiera requiere confirmación explícita en
-- el momento):
--   - Vía MCP de Supabase: mcp__supabase__execute_sql con este archivo como
--     query, contra el project_id correcto.
--   - Vía Supabase SQL editor (dashboard), pegando el contenido.
--   - Vía CLI: psql "$DATABASE_URL" -f scripts/reset-servicios-citas.sql
-- =============================================================================

DO $$
DECLARE
  v_tablas text[] := ARRAY[
    'citas', 'servicio_horarios', 'servicio_excepciones', 'servicios',
    'encargados'
  ];
  v_existentes text[];
BEGIN
  SELECT array_agg(t) INTO v_existentes
  FROM unnest(v_tablas) AS t
  WHERE to_regclass('public.' || t) IS NOT NULL;

  IF v_existentes IS NULL OR array_length(v_existentes, 1) = 0 THEN
    RAISE NOTICE 'Ninguna tabla candidata existe en el schema — nada que vaciar.';
    RETURN;
  END IF;

  EXECUTE format('TRUNCATE TABLE %s RESTART IDENTITY CASCADE', array_to_string(v_existentes, ', '));

  RAISE NOTICE 'Reset de servicios/citas completo. Tablas vaciadas (%): %',
    array_length(v_existentes, 1), array_to_string(v_existentes, ', ');
END $$;
