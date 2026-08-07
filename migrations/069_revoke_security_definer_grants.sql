-- migrations/069_revoke_security_definer_grants.sql
-- Cierre de hueco CRÍTICO de seguridad, hallazgo de la revisión de
-- docs/plan_valorServicio.md (2026-08-06/07) — no relacionado a esa
-- funcionalidad, pre-existente y ya vivo en producción.
--
-- Estado: **NO APLICADA**. Requiere confirmación explícita del usuario antes
-- de aplicar (AGENTS.md §11.2 — wnxrdbnvreofrrmhcybc es el único proyecto
-- real, con datos de negocio reales).
--
-- ─── El hallazgo ──────────────────────────────────────────────
-- Verificado contra pg_proc.proacl real: las 6 funciones de abajo son
-- SECURITY DEFINER (se ejecutan con privilegios del dueño, evadiendo RLS por
-- diseño) y tienen EXECUTE otorgado a PUBLIC/anon/authenticated además de
-- service_role. Como son invocables directo contra
-- POST /rest/v1/rpc/<función> de Supabase (sin pasar por Next.js, sin sesión
-- de Clerk, con la anon key — pública por diseño, embebida en el bundle del
-- cliente), cualquiera sin autenticar puede llamarlas con cualquier
-- parámetro: crear ventas falsas, anular ventas reales, incrementar saldo a
-- favor de la nada para cualquier cliente de cualquier tienda, gastarlo como
-- si fuera un pago legítimo, revertir saldo real, o manipular stock
-- directamente — cross-tenant, sin autenticar.
--
-- ─── Por qué se reintrodujo varias veces (verificado en el código real) ──
-- Ninguna de las migraciones que definieron o reemplazaron estas funciones
-- incluyó jamás un REVOKE — solo GRANT a service_role:
--   - crear_venta_tx:            037_crear_venta_transaction.sql
--   - anular_venta_tx:           053_anular_venta_tx.sql,
--                                 057_anular_venta_restaurar_saldo_consumido.sql
--   - incrementar_saldo_a_favor,
--     revertir_saldo_a_favor,
--     gastar_saldo_a_favor_pago: 051_atomic_saldos_a_favor.sql
--   - increment_stock:            060_increment_stock.sql
-- Supabase otorga EXECUTE a anon/authenticated como grant DIRECTO cada vez
-- que una función se crea o se reemplaza (mismo comportamiento documentado
-- en 064/065/066/067/068 para las funciones de servicios/citas/encargados/
-- valor de servicio) — sin un REVOKE explícito en la MISMA migración que la
-- toca, el hueco vuelve. Esta migración lo cierra para las 6 funciones a la
-- vez; **cualquier migración futura que haga CREATE OR REPLACE sobre
-- cualquiera de ellas debe repetir el REVOKE en esa misma migración** — no
-- alcanza con haberlo hecho una vez acá.
--
-- ─── Por qué no se corrigieron dentro de 068 ──────────────────────────────
-- 068 (valor de servicio) solo tocaba crear_nota_credito_tx directamente
-- (ya reescrita en esa migración por otro motivo) — se cerró su mismo hueco
-- ahí por no tener costo de despliegue adicional. Estas 6 no las toca
-- ninguna funcionalidad en curso; se corrigen en su propia migración,
-- acotada, de solo permisos — sin cambiar una sola línea de lógica de
-- negocio, cero riesgo de romper el flujo de ventas/POS que sí está en uso
-- activo ahora mismo.

REVOKE EXECUTE ON FUNCTION crear_venta_tx FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_venta_tx FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION anular_venta_tx FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION anular_venta_tx FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION incrementar_saldo_a_favor FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION incrementar_saldo_a_favor FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION revertir_saldo_a_favor FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION revertir_saldo_a_favor FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION gastar_saldo_a_favor_pago FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION gastar_saldo_a_favor_pago FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION increment_stock FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_stock FROM anon, authenticated;
