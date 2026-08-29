-- Migration 073: ventas.procedencia — agregar canales externos con conexión real
--
-- Contexto (definido por el equipo): `procedencia` distingue el origen de
-- captación del cliente cuando NO existe una integración de API real —
-- WhatsApp Commerce, por ejemplo, no está habilitado en Chile, así que esas
-- ventas se registran manualmente en el POS con procedencia='whatsapp'. Lo
-- mismo aplica a instagram/facebook/tiktok/telefonico: son canales donde el
-- cliente pudo haber hecho el primer contacto, pero la venta se cobra
-- igual por POS sin que exista un sistema conectado.
--
-- Rappi/PedidosYa/UberEats SÍ tienen conexión sistémica real (ver
-- src/lib/canales/hub.ts, aceptarOrdenExterna()) — hasta ahora esas ventas
-- quedaban con procedencia='presencial' por defecto, perdiendo la distinción
-- entre "vino por Rappi" y "cliente que entró a la tienda". Se agregan sus
-- IDs reales para poder reportarlos.
--
-- Los tres valores nuevos NO se exponen como opción al cajero: el desplegable
-- de Procedencia en el POS (PROCEDENCIAS, src/app/(app)/pos/components/ModalPago.tsx)
-- y el schema Zod de POST /api/ventas (src/lib/validation/ventas.ts) siguen
-- restringidos a los 6 valores manuales — ninguno de los dos se toca en esta
-- migración. Solo `aceptarOrdenExterna()` (que no pasa por ese schema Zod,
-- llama a crear_venta_tx directamente) puede escribir estos tres valores.
--
-- IMPORTANTE para quien agregue un canal nuevo con conexión real (ej.
-- Shopify): agregar su CanalId aquí también — de lo contrario
-- aceptarOrdenExterna() fallará con check_violation (código Postgres 23514)
-- al aceptar la primera orden de ese canal.
--
-- La constraint original (migración 023) no tiene nombre explícito, así que
-- Postgres le asignó uno generado — se busca por introspección en vez de
-- asumir el nombre por defecto, en línea con AGENTS.md §11.2 (puede haber
-- migraciones aplicadas manualmente sin registro de tracking).

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'ventas'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%procedencia%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ventas DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE ventas
  ADD CONSTRAINT ventas_procedencia_check
    CHECK (procedencia IN (
      'presencial', 'instagram', 'whatsapp', 'facebook', 'tiktok', 'telefonico',
      'rappi', 'pedidosya', 'ubereats'
    ));
