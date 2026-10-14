-- 088: índices para las 32 foreign keys que no tenían uno.
--
-- Advisor de Supabase "unindexed_foreign_keys": sin índice en la columna FK,
-- un DELETE/UPDATE del padre recorre la tabla hija completa para validar la
-- restricción, y los joins/filtros por esa columna (venta_items.producto_id,
-- ordenes_compra_items.orden_id, cuentas_pagar.proveedor_id, ...) no tienen
-- índice. Lista sacada de pg_constraint del demo el 2026-10-13 (FKs del
-- esquema public cuyo prefijo no está cubierto por ningún índice).
--
-- Idempotente (IF NOT EXISTS). Tablas chicas: CREATE INDEX normal (no
-- CONCURRENTLY, que no corre dentro de una transacción).
-- Reversible: DROP INDEX IF EXISTS public.<nombre>.

CREATE INDEX IF NOT EXISTS idx_canal_config_canal_id ON public.canal_config (canal_id);
CREATE INDEX IF NOT EXISTS idx_canal_liquidaciones_canal_id ON public.canal_liquidaciones (canal_id);
CREATE INDEX IF NOT EXISTS idx_canal_liquidaciones_journal_entry_id ON public.canal_liquidaciones (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_canal_ordenes_canal_id ON public.canal_ordenes (canal_id);
CREATE INDEX IF NOT EXISTS idx_canal_ordenes_venta_id ON public.canal_ordenes (venta_id);
CREATE INDEX IF NOT EXISTS idx_canal_outbox_canal_id ON public.canal_outbox (canal_id);
CREATE INDEX IF NOT EXISTS idx_canal_outbox_canal_orden_id ON public.canal_outbox (canal_orden_id);
CREATE INDEX IF NOT EXISTS idx_cierre_mes_backups_cierre_asiento_id ON public.cierre_mes_backups (cierre_asiento_id);
CREATE INDEX IF NOT EXISTS idx_citas_mascota_id ON public.citas (mascota_id);
CREATE INDEX IF NOT EXISTS idx_consumo_alertas_cliente_id ON public.consumo_alertas (cliente_id);
CREATE INDEX IF NOT EXISTS idx_consumo_alertas_mascota_id ON public.consumo_alertas (mascota_id);
CREATE INDEX IF NOT EXISTS idx_consumo_alertas_producto_id ON public.consumo_alertas (producto_id);
CREATE INDEX IF NOT EXISTS idx_consumo_configs_producto_id ON public.consumo_configs (producto_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_orden_id ON public.cuentas_pagar (orden_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_proveedor_id ON public.cuentas_pagar (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_mascotas_alimento_habitual_id ON public.mascotas (alimento_habitual_id);
CREATE INDEX IF NOT EXISTS idx_nota_credito_items_producto_id ON public.nota_credito_items (producto_id);
CREATE INDEX IF NOT EXISTS idx_nota_credito_items_servicio_id ON public.nota_credito_items (servicio_id);
CREATE INDEX IF NOT EXISTS idx_nota_credito_items_venta_item_id ON public.nota_credito_items (venta_item_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_proveedor_id ON public.ordenes_compra (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_items_orden_id ON public.ordenes_compra_items (orden_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_items_producto_id ON public.ordenes_compra_items (producto_id);
CREATE INDEX IF NOT EXISTS idx_pagos_nota_credito_id ON public.pagos (nota_credito_id);
CREATE INDEX IF NOT EXISTS idx_proveedor_productos_producto_id ON public.proveedor_productos (producto_id);
CREATE INDEX IF NOT EXISTS idx_proveedores_store_id ON public.proveedores (store_id);
CREATE INDEX IF NOT EXISTS idx_sacos_abiertos_lote_id ON public.sacos_abiertos (lote_id);
CREATE INDEX IF NOT EXISTS idx_venta_items_mascota_id ON public.venta_items (mascota_id);
CREATE INDEX IF NOT EXISTS idx_venta_items_producto_id ON public.venta_items (producto_id);
CREATE INDEX IF NOT EXISTS idx_venta_items_servicio_id ON public.venta_items (servicio_id);
CREATE INDEX IF NOT EXISTS idx_ventas_canal ON public.ventas (canal);
CREATE INDEX IF NOT EXISTS idx_ventas_mascota_id ON public.ventas (mascota_id);
CREATE INDEX IF NOT EXISTS idx_ventas_worker_clerk_id ON public.ventas (worker_clerk_id);
