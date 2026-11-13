-- 094: columna ventas.notas (notas internas de la venta).
--
-- El POS ofrece "Notas internas" al cobrar y POST /api/ventas las guarda con un
-- UPDATE posterior a crear_venta_tx, pero la columna nunca existió (no está en
-- 000_baseline ni en ninguna migración): el UPDATE fallaba, la ruta no revisaba
-- el error y las notas se perdían en silencio en todas las tiendas. Detectado
-- 2026-11-12 al revisar ventas del demo.
--
-- Aditiva y sin riesgo de datos: columna nueva, nullable, mismo largo que valida
-- VentaCreateSchema (255). No requiere revisión previa. Idempotente (IF NOT
-- EXISTS). Reversible: ALTER TABLE public.ventas DROP COLUMN notas.
-- Requiere la 090 (registro al final).

ALTER TABLE public.ventas ADD COLUMN IF NOT EXISTS notas varchar(255);

COMMENT ON COLUMN public.ventas.notas IS
  'Notas internas de la venta (POS, "Notas internas"). No se imprimen en el comprobante.';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('094', '094_ventas_notas')
ON CONFLICT (version) DO NOTHING;
