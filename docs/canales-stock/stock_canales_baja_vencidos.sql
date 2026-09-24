-- ============================================================================
-- Baja de lotes vencidos (decisión D23 del plan stock_canales_externos.md)
-- Proyecto Supabase: wnxrdbnvreofrrmhcybc
--
-- ESCRITURA SOBRE LA BD. Ejecutar manualmente en Supabase → SQL Editor,
-- EN ORDEN: PASO 1 (revisar) → PASO 2 (baja) → PASO 3 (verificar).
--
-- Qué hace: marca como inactivos (activo = false) los lotes con stock cuya
-- fecha de vencimiento ya pasó, y registra un movimiento 'merma' por producto.
-- El trigger sync_stock_on_lote recalcula productos.stock = Σ lotes activos,
-- así que el stock queda igual a las unidades vigentes.
--
-- Por qué "baja" y no DELETE: los lotes vendidos están referenciados por
-- venta_item_lotes (trazabilidad de ventas, devoluciones FIFO). Borrarlos
-- rompe esa historia o falla por FK. Con activo = false el lote deja de
-- contar como stock pero la historia se conserva, y es reversible
-- (volver activo = true).
-- ============================================================================


-- PASO 1 — Revisar qué se va a dar de baja (solo lectura) --------------------
-- Anota el resultado: store_id, cuántos lotes y cuántas unidades por producto.
select l.store_id,
       l.producto_id,
       count(*)                 as lotes_vencidos,
       sum(l.cantidad_actual)   as unidades_vencidas,
       min(l.fecha_vencimiento) as vencimiento_mas_antiguo,
       max(l.fecha_vencimiento) as vencimiento_mas_reciente
from lotes_producto l
where l.activo = true
  and l.cantidad_actual > 0
  and l.fecha_vencimiento < current_date
group by l.store_id, l.producto_id
order by l.store_id, unidades_vencidas desc;


-- PASO 2 — Dar de baja (ESCRITURA) -------------------------------------------
-- Si PASO 1 muestra más de un store_id y solo quieres afectar una tienda,
-- descomenta la línea "and l.store_id = ..." y pon el UUID real.
-- Todo el bloque es una sola sentencia → atómica (todo o nada).
with vencidos as (
  update lotes_producto l
     set activo     = false,
         notas      = coalesce(l.notas || ' | ', '') || 'Baja por vencimiento ' || current_date,
         updated_at = now()
   where l.activo = true
     and l.cantidad_actual > 0
     and l.fecha_vencimiento < current_date
     -- and l.store_id = '00000000-0000-0000-0000-000000000000'
  returning l.producto_id, l.cantidad_actual
)
insert into stock_movements (producto_id, tipo, cantidad, referencia_id, notas, user_id)
select producto_id,
       'merma',
       -round(sum(cantidad_actual))::integer,
       null,
       -- stock_movements.cantidad es INTEGER (V7): la cantidad exacta
       -- (puede ser fraccionaria por granel, ej. 76.3) queda en la nota.
       'Baja de ' || count(*) || ' lote(s) vencido(s), cantidad exacta '
         || sum(cantidad_actual) || ' — SQL manual (plan D23)',
       null
from vencidos
group by producto_id
returning producto_id, cantidad, notas;


-- PASO 3 — Verificar (solo lectura) -------------------------------------------
-- Debe devolver una fila con el valor 0 (ningún lote activo vencido con stock).
select count(*) as lotes_activos_vencidos_restantes
from lotes_producto
where activo = true and cantidad_actual > 0 and fecha_vencimiento < current_date;

-- Y el stock de los productos con lotes debe coincidir con la suma de lotes activos
-- (esperado: 0 desalineados).
select count(*) filter (where p.stock <> l.suma) as desalineados,
       count(*)                                  as productos_con_lotes
from productos p
join (
  select producto_id, sum(cantidad_actual) as suma
  from lotes_producto
  where activo = true
  group by producto_id
) l on l.producto_id = p.id;


-- REVERTIR (solo si hiciera falta) --------------------------------------------
-- update lotes_producto
--    set activo = true, updated_at = now()
--  where notas like '%Baja por vencimiento%';
-- delete from stock_movements where notas like '%SQL manual (plan D23)%';
