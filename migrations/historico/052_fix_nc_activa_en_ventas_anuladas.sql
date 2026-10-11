-- 052_fix_nc_activa_en_ventas_anuladas.sql
--
-- Reparación de datos (ya aplicada manualmente el 2026-07-11, con
-- confirmación explícita del usuario, tras el fix de migrations/051 +
-- src/app/api/ventas/[id]/route.ts): dos ventas quedaron anuladas bajo el
-- código previo a commit 9b7fe62, que no cancelaba NCs activas ni revertía
-- saldos_a_favor al anular.
--
-- Caso 1 (impacto financiero real): venta 20260508-BAD98F45 — NC
-- 35c020e9-1be4-43a3-919a-9b2ae5e3fa4c (saldo_a_favor, $30.928) creada 46s
-- antes de que la venta fuera anulada, quedó "activa" indefinidamente. El
-- cliente tenía $61.844 de saldo disponible acumulado (incluye otras
-- transacciones posteriores), de los cuales $30.928 nunca debieron
-- otorgarse. Reparado con el mismo RPC atómico (revertir_saldo_a_favor) que
-- usará la aplicación de ahora en adelante: nuevo saldo = $30.916.
--
-- Caso 2 (sin impacto financiero): venta 20260628-AC73D507 — NC
-- a6bce648-340e-47e5-9f17-777ffb5159e1 (saldo_a_favor, $8.990) sin
-- cliente_id asociado en la venta — el código nunca acredita saldos_a_favor
-- sin cliente_id, así que no hubo crédito real otorgado. Corregido solo el
-- estado por consistencia de datos.
--
-- CORRECCIÓN (verificado al registrar esta migración en el tracking de
-- Supabase, que nunca había ocurrido pese a que el efecto ya estaba
-- aplicado): la afirmación de idempotencia de arriba era incorrecta para
-- revertir_saldo_a_favor() — esa llamada decrementa el saldo de forma
-- INCONDICIONAL (sin WHERE estado='activa'), a diferencia de los dos
-- UPDATE. Re-ejecutar el archivo tal como estaba habría restado $30.928
-- por SEGUNDA vez del saldo ACTUAL del cliente (que ya pudo haber cambiado
-- por transacciones posteriores) — el mismo defecto de doble crédito/débito
-- que esta migración corrige, en sentido inverso. Envuelta ahora en un
-- guard explícito: la reversión de saldo solo corre si la NC seguía
-- 'activa' en el momento de ejecutar, igual que los dos UPDATE.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM notas_credito
     WHERE id = '35c020e9-1be4-43a3-919a-9b2ae5e3fa4c' AND estado = 'activa'
  ) THEN
    PERFORM revertir_saldo_a_favor(
      '18d5dab7-24fe-4f46-85f5-95928a887d88'::uuid,
      'c69611b6-5be8-4a54-bd3d-495177c97ea0'::uuid,
      30928
    );

    UPDATE notas_credito
       SET estado = 'anulada'
     WHERE id = '35c020e9-1be4-43a3-919a-9b2ae5e3fa4c';
  END IF;

  UPDATE notas_credito
     SET estado = 'anulada'
   WHERE id = 'a6bce648-340e-47e5-9f17-777ffb5159e1'
     AND estado = 'activa';
END $$;
