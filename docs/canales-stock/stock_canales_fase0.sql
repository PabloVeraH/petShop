-- ============================================================================
-- Fase 0 — Consultas de SOLO LECTURA (plan: stock_canales_externos.md §6 Fase 0)
-- Proyecto Supabase: wnxrdbnvreofrrmhcybc (producción)
--
-- Todas son SELECT: no modifican nada. Ejecutarlas UNA POR UNA en
-- Supabase Dashboard → SQL Editor (el editor solo muestra el resultado de la
-- última sentencia). Ninguna consulta lee credenciales ni datos de clientes.
-- ============================================================================


-- Q1 — Columnas reales de las tablas involucradas ----------------------------
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'canal_config', 'canal_ordenes', 'canal_producto_config', 'stock_reservas',
    'canales_externos', 'canal_liquidaciones', 'lotes_producto', 'productos',
    'venta_items', 'stock_movements'
  )
order by table_name, ordinal_position;


-- Q2 — Constraints (CHECK, UNIQUE, FK) de esas tablas -------------------------
select conrelid::regclass as tabla, conname as nombre, pg_get_constraintdef(oid) as definicion
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text in (
    'canal_config', 'canal_ordenes', 'canal_producto_config', 'stock_reservas',
    'lotes_producto', 'productos', 'venta_items', 'ventas', 'stock_movements'
  )
order by 1, 2;


-- Q3 — Índices ----------------------------------------------------------------
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('ventas', 'canal_ordenes', 'stock_reservas', 'lotes_producto', 'canal_producto_config', 'canal_config')
order by 1, 2;


-- Q4 — Triggers ---------------------------------------------------------------
select event_object_table as tabla, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('productos', 'lotes_producto', 'canal_ordenes', 'ventas', 'venta_items')
order by 1, 2;


-- Q5 — Definición vigente de las funciones de stock/venta ----------------------
-- (resultado largo: exportar como CSV o copiar la columna "definicion")
select p.proname as funcion,
       pg_get_function_identity_arguments(p.oid) as argumentos,
       pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'crear_venta_tx', 'decrement_stock', 'increment_stock', 'deducir_stock_fifo',
    'devolver_stock_a_lotes', 'anular_venta_tx', 'crear_nota_credito_tx',
    'sync_producto_stock_from_lotes'
  )
order by 1, 2;


-- Q6 — Conteo de filas de canales (sin datos sensibles) -----------------------
select 'canal_config' as tabla, count(*) as filas from canal_config
union all select 'canal_ordenes', count(*) from canal_ordenes
union all select 'canal_producto_config', count(*) from canal_producto_config
union all select 'stock_reservas', count(*) from stock_reservas
union all select 'canal_liquidaciones', count(*) from canal_liquidaciones;


-- Q7 — Canales configurados por estado (sin credenciales) ---------------------
select canal_id, activo, count(*) as tiendas
from canal_config
group by canal_id, activo
order by canal_id, activo;


-- Q8 — Productos con lotes cuyo stock NO coincide con la suma de lotes -------
-- (dimensiona el problema S6/D11: stock suelto perdido o desalineado)
select count(*) filter (where p.stock <> l.suma) as desalineados,
       count(*)                                  as productos_con_lotes
from productos p
join (
  select producto_id, sum(cantidad_actual) as suma
  from lotes_producto
  where activo = true
  group by producto_id
) l on l.producto_id = p.id;


-- Q9 — Resumen de stock: fraccionarios (S9), negativos, mínimo 0 --------------
select count(*)                                            as productos_activos,
       count(*) filter (where stock <> trunc(stock))       as stock_con_decimales,
       count(*) filter (where stock < 0)                   as stock_negativo,
       count(*) filter (where stock_minimo = 0)            as stock_minimo_cero
from productos
where activo = true;


-- Q10 — Detalle de productos con stock con decimales (para el conteo físico P10)
-- Este resultado incluye nombres de productos: úsalo tú para contar; NO hace
-- falta pegarlo en el chat (basta el número de Q9).
select id, nombre, stock, peso_gramos, precio_venta_kg
from productos
where stock <> trunc(stock)
order by nombre;


-- Q11 — Productos a granel y si tienen peso de saco (G8) ----------------------
select count(*) filter (where precio_venta_kg is not null)                                  as productos_granel,
       count(*) filter (where precio_venta_kg is not null and coalesce(peso_gramos, 0) <= 0) as granel_sin_peso
from productos;


-- Q12 — Extensiones disponibles/instaladas para pg_cron (§7.1) ---------------
select name, default_version, installed_version
from pg_available_extensions
where name in ('pg_cron', 'pg_net', 'supabase_vault')
order by name;


-- Q13 — Ventas a granel (cantidad con decimales) por mes ----------------------
-- Confirma si las ventas granel funcionan tras la migración 059 (ver V7).
-- Solo conteos, sin datos de clientes.
select date_trunc('month', v.created_at)::date as mes,
       count(*)                                  as items_granel,
       count(distinct v.id)                      as ventas
from venta_items vi
join ventas v on v.id = vi.venta_id
where vi.cantidad <> trunc(vi.cantidad)
group by 1
order by 1;


-- Q14 — Detalle del/los producto(s) con stock desalineado respecto de sus lotes
-- (Q8 dio 1). Sin nombres: solo id y cantidades.
select p.id,
       p.stock,
       l.suma_lotes_activos,
       l.suma_lotes_vigentes,
       p.stock - l.suma_lotes_activos as diferencia
from productos p
join (
  select producto_id,
         sum(cantidad_actual)                                                   as suma_lotes_activos,
         sum(cantidad_actual) filter (where fecha_vencimiento >= current_date) as suma_lotes_vigentes
  from lotes_producto
  where activo = true
  group by producto_id
) l on l.producto_id = p.id
where p.stock <> l.suma_lotes_activos;


-- Q15 — Últimos movimientos de ese producto (reemplazar <ID> por el id de Q14)
select tipo, cantidad, notas, created_at, user_id is not null as tiene_usuario
from stock_movements
where producto_id = '<ID>'
order by created_at desc
limit 20;
