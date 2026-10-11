-- 051_atomic_saldos_a_favor.sql
--
-- saldos_a_favor.saldo_disponible se mutaba en 3 call sites con un patrón
-- read-then-write en JS (SELECT seguido de UPDATE con el valor calculado en
-- la aplicación), no atómico. Bajo dos requests concurrentes sobre el mismo
-- cliente, ambos leen el mismo valor inicial y el segundo UPDATE pisa el
-- resultado del primero — permite:
--   - doble gasto real en POST /api/saldos-a-favor (usar el mismo saldo dos
--     veces, sin siquiera un piso en 0: `saldoDisponible - monto` podía
--     quedar negativo);
--   - reversión incorrecta de saldo al anular una venta con NC activa.
--
-- Se reemplaza por 3 funciones SQL con UPDATE atómico de una sola sentencia,
-- siguiendo el mismo patrón (SECURITY DEFINER + GRANT a service_role) que
-- crear_venta_tx (migración 037).

-- 1. Incrementar saldo (crear NC con tipo_reembolso='saldo_a_favor').
--    Upsert atómico: el UPDATE...SET x = x + EXCLUDED.x bajo ON CONFLICT
--    se serializa correctamente por el lock de fila del INSERT/UPDATE.
CREATE OR REPLACE FUNCTION incrementar_saldo_a_favor(
  p_store_id UUID,
  p_cliente_id UUID,
  p_monto NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nuevo_saldo NUMERIC;
BEGIN
  INSERT INTO saldos_a_favor (store_id, cliente_id, saldo_disponible, updated_at)
  VALUES (p_store_id, p_cliente_id, p_monto, NOW())
  ON CONFLICT (store_id, cliente_id) DO UPDATE
    SET saldo_disponible = saldos_a_favor.saldo_disponible + EXCLUDED.saldo_disponible,
        updated_at = NOW()
  RETURNING saldo_disponible INTO v_nuevo_saldo;

  RETURN v_nuevo_saldo;
END;
$$;

-- 2. Revertir saldo (anular venta cuya NC activa había otorgado saldo_a_favor).
--    Decremento incondicional, clamped a 0 — el saldo pudo haberse gastado
--    parcialmente entre la creación de la NC y la anulación; no es un error,
--    simplemente se revierte lo que quede disponible.
CREATE OR REPLACE FUNCTION revertir_saldo_a_favor(
  p_store_id UUID,
  p_cliente_id UUID,
  p_monto NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nuevo_saldo NUMERIC;
BEGIN
  UPDATE saldos_a_favor
     SET saldo_disponible = GREATEST(0, saldo_disponible - p_monto),
         updated_at = NOW()
   WHERE store_id = p_store_id AND cliente_id = p_cliente_id
  RETURNING saldo_disponible INTO v_nuevo_saldo;

  RETURN v_nuevo_saldo; -- NULL si el cliente no tiene fila de saldo (no-op)
END;
$$;

-- 3. Gastar saldo como pago (POST /api/saldos-a-favor).
--    Hace ambas mutaciones (decrementar saldo + insertar pago) en UNA sola
--    transacción de función: si el saldo es insuficiente no se inserta pago;
--    si por algún motivo fallara el insert, la función completa revierte
--    (una excepción en plpgsql aborta toda la transacción implícita del
--    RETURNING/INSERT). Esto evita la ventana de fallo parcial que existiría
--    si el decremento y el insert de pago fueran dos llamadas RPC separadas
--    desde JS (decremento exitoso + insert de pago fallido dejaría el saldo
--    descontado sin ningún pago que lo respalde).
--    El UPDATE es también condicional (saldo_disponible >= p_monto) y
--    atómico bajo el lock de fila: dos requests concurrentes para el mismo
--    cliente se serializan y el segundo ve el saldo YA descontado por el
--    primero — cierra el doble gasto real que existía con el patrón previo
--    de SELECT en JS seguido de UPDATE con el valor calculado en la app.
--    Retorna NULL (sin filas) si no hay saldo suficiente o no existe fila:
--    el llamador debe tratar la ausencia de resultado como "Saldo insuficiente".
CREATE OR REPLACE FUNCTION gastar_saldo_a_favor_pago(
  p_store_id UUID,
  p_cliente_id UUID,
  p_venta_id UUID,
  p_monto NUMERIC
) RETURNS TABLE(pago_id UUID, saldo_nuevo NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo_nuevo NUMERIC;
  v_pago_id UUID;
BEGIN
  UPDATE saldos_a_favor
     SET saldo_disponible = saldo_disponible - p_monto,
         updated_at = NOW()
   WHERE store_id = p_store_id
     AND cliente_id = p_cliente_id
     AND saldo_disponible >= p_monto
  RETURNING saldo_disponible INTO v_saldo_nuevo;

  IF v_saldo_nuevo IS NULL THEN
    RETURN; -- sin filas — saldo insuficiente o cliente sin saldo registrado
  END IF;

  INSERT INTO pagos (store_id, venta_id, metodo, monto, numero_transaccion)
  VALUES (p_store_id, p_venta_id, 'saldo_a_favor', p_monto, NULL)
  RETURNING id INTO v_pago_id;

  RETURN QUERY SELECT v_pago_id, v_saldo_nuevo;
END;
$$;

GRANT EXECUTE ON FUNCTION incrementar_saldo_a_favor TO service_role;
GRANT EXECUTE ON FUNCTION revertir_saldo_a_favor TO service_role;
GRANT EXECUTE ON FUNCTION gastar_saldo_a_favor_pago TO service_role;
