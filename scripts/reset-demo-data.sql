-- =============================================================================
-- reset-demo-data.sql
--
-- ⚠️  DESTRUCTIVO. Vacía TODAS las tablas de datos de negocio del proyecto
-- Supabase real (`wnxrdbnvreofrrmhcybc`) — el único proyecto existente, sin
-- staging (ver AGENTS.md §0.1). Este archivo documenta y prepara la
-- operación; NO la ejecuta por sí solo. Ejecutarlo requiere una decisión
-- explícita tuya en el momento de correrlo (mismo protocolo que aplicar una
-- migración, AGENTS.md §11.2), incluso tratándose de un proyecto demo.
--
-- Qué conserva ("tienda en blanco"):
--   - stores        (config de la tienda — nombre, licencia, settings)
--   - clerk_users   (cuentas de acceso y roles sincronizadas desde Clerk)
-- Todo lo demás queda vacío: catálogo (productos, categorías, servicios,
-- proveedores, encargados) e historial completo (clientes, mascotas,
-- ventas, citas, pagos, notas de crédito, contabilidad, logs, sesiones).
--
-- Alcance: vacía TODAS las tiendas (no filtra por store_id) — hoy solo
-- existe una tienda ("PetShop La Huella"), así que es equivalente a un
-- reset por tienda. Si en el futuro hay más de una tienda, este script deja
-- de ser apto para un reset selectivo — habría que reescribirlo con
-- DELETE ... WHERE store_id = $1 en vez de TRUNCATE.
--
-- Cómo correrlo (elige uno, cualquiera requiere tu confirmación explícita
-- en el momento):
--   - Vía MCP de Supabase: mcp__supabase__execute_sql con este archivo como
--     query, contra el project_id correcto.
--   - Vía Supabase SQL editor (dashboard), pegando el contenido.
--   - Vía CLI: psql "$DATABASE_URL" -f scripts/reset-demo-data.sql
--
-- La lista de tablas se resuelve dinámicamente con to_regclass(), así que
-- el script no falla si `encargados` todavía no existe (antes de aplicar
-- migrations/067_encargados.sql) — simplemente la omite.
-- =============================================================================

DO $$
DECLARE
  v_tablas text[] := ARRAY[
    -- Catálogo
    'productos', 'categorias', 'proveedores', 'proveedor_productos',
    'servicios', 'servicio_horarios', 'servicio_excepciones', 'encargados',
    -- Clientes y mascotas
    'clientes', 'mascotas', 'fidelizacion',
    -- Ventas y POS
    'ventas', 'venta_items', 'venta_item_lotes', 'pagos',
    'notas_credito', 'nota_credito_items', 'saldos_a_favor',
    'ventas_historico',
    -- Inventario y compras
    'stock_movements', 'lotes_producto', 'ordenes_compra',
    'ordenes_compra_items', 'cuentas_pagar', 'consumo_alertas',
    'consumo_configs',
    -- Citas (Fase 1-3 de servicios agendables)
    'citas',
    -- Contabilidad
    'journal_entries', 'journal_detail', 'cierre_mes_backups',
    -- Canales externos (Rappi/PedidosYa/UberEats)
    'canales_externos', 'canal_config', 'canal_producto_config',
    'canal_ordenes', 'stock_reservas', 'canal_liquidaciones',
    -- Marketing / IA
    'instagram_posts', 'instagram_post_media', 'ai_vencimientos_analisis',
    'ai_pos_cache',
    -- Auditoría, sesiones y logs de error
    'audit_logs', 'auth_failures', 'user_sessions', 'error_logs'
    -- Deliberadamente NO incluidas: stores, clerk_users (ver cabecera).
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

  RAISE NOTICE 'Reset de demo completo. Tablas vaciadas (%): %',
    array_length(v_existentes, 1), array_to_string(v_existentes, ', ');
END $$;
