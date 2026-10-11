-- Migration 060: increment_stock — incremento atómico de stock
--
-- Investigado a raíz del ticket Trello 6a61a6136d3d8009490d7113 ("Recepción de
-- OC registra el movimiento pero no incrementa el stock real"). El caso
-- puntual del ticket no reprodujo contra datos reales (el producto/OC citados
-- en el reporte muestran el incremento correcto en producción, vía el trigger
-- sync_stock_on_lote para productos con fecha de vencimiento).
--
-- Pero al revisar la rama "sin fecha de vencimiento" de PATCH
-- /api/ordenes-compra/[id] (action=recibir) se encontró un patrón no atómico
-- real: SELECT stock → UPDATE stock = valor_leído + cantidad, en dos
-- statements separados. Bajo dos recepciones concurrentes del mismo producto
-- (dos OC casi simultáneas, o un doble clic en "Confirmar recepción"), esto
-- es un lost update clásico — produciría exactamente el síntoma del ticket
-- (el movimiento queda registrado en stock_movements pero el stock no sube)
-- bajo condiciones de carrera, aunque no fue la causa de este reporte
-- puntual. Mismo principio que decrement_stock() (000_base_schema.sql),
-- usado para el caso simétrico de ventas — increment_stock() no existía.

CREATE OR REPLACE FUNCTION increment_stock(
  p_producto_id UUID,
  p_cantidad    INTEGER
) RETURNS VOID AS $$
BEGIN
  UPDATE productos
  SET stock = stock + p_cantidad
  WHERE id = p_producto_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
