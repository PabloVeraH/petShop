-- 091: filas del catálogo global canales_externos.
--
-- 000_baseline.sql es un pg_dump solo de esquema: crea la tabla pero no sus
-- filas, que en el demo vinieron de historico/012 y historico/020. En una
-- base nueva la tabla queda vacía y toda venta falla con
-- "violates foreign key constraint ventas_canal_fkey" (ventas.canal →
-- canales_externos.id; el POS usa canal = 'pos'). Visto en mascotaspetshop
-- (2026-10-16).
--
-- Mismos valores que historico/012 + 020. ON CONFLICT DO NOTHING: no toca
-- filas existentes (en el demo no cambia nada; respeta un `habilitado` ya
-- ajustado a mano). Idempotente. Reversible solo si ninguna venta referencia
-- el canal: DELETE FROM public.canales_externos WHERE id IN (...).

INSERT INTO public.canales_externos (id, nombre, es_externo, habilitado) VALUES
  ('pos',       'Presencial (POS)', false, true),
  ('rappi',     'Rappi',            true,  false),
  ('pedidosya', 'PedidosYa',        true,  false),
  ('ubereats',  'UberEats',         true,  false),
  ('instagram', 'Instagram',        true,  false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('091', '091_seed_canales_externos')
ON CONFLICT (version) DO NOTHING;
