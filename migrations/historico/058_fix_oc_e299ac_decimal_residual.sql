-- 058_fix_oc_e299ac_decimal_residual.sql
--
-- Corrige el residuo decimal en OC-20260329-E299AC (ticket Trello
-- 6a5f9af49b22d1d60a11747d: "Formato de precio corrupto con decimal extra
-- en OC recibida" — la UI mostraba "$1.503.077,1" en vez de "$1.503.077").
--
-- Causa raíz: esta OC se recibió el 2026-03-30, antes del commit 043e378
-- (5 jun 2026) que agregó Math.round() al cálculo de impuesto/total al
-- recibir una OC. El código de esa fecha calculaba
-- impuesto = totalNeto * 0.19 y total = totalNeto * 1.19 SIN redondear,
-- dejando impuesto=239987.10 y total=1503077.10 en vez de enteros
-- (subtotal=1263090.00 sí es entero — el residuo viene solo del *0.19/*1.19
-- sin round). El valor se propagó a cuentas_pagar.monto y a los asientos
-- contables COMPRA/PAGO_PROVEEDOR generados al recibir y pagar esta OC.
--
-- 043e378 ya corrige el cálculo para OCs nuevas. Además, esta migración
-- viene acompañada de un segundo fix (Math.round por ítem en
-- src/app/api/ordenes-compra/[id]/route.ts) para un gap que 043e378 no
-- cubría: precio_unitario acepta decimales (Zod solo exige nonnegative) y
-- cantidad_recibida * precio_unitario puede no ser un peso entero — sin
-- ese redondeo por ítem, totalNeto podía seguir arrastrando decimales
-- aunque impuesto ya se redondeara. Ver I-442 en spec-registry.md.
--
-- Alcance: acotado explícitamente a esta única OC identificada en el
-- ticket (no un scan amplio por totales no enteros — confirmado contra
-- producción que es la única fila de ordenes_compra afectada). Corrige
-- impuesto/total con el mismo criterio que el código actual
-- (impuesto = ROUND(subtotal * 0.19), total = subtotal + impuesto) y
-- propaga la corrección a cuentas_pagar.monto y a los journal_detail /
-- journal_entries de los asientos COMPRA y PAGO_PROVEEDOR de esta OC, para
-- no dejar el mayor contable desincronizado del papeleo corregido.
-- Idempotente: si la OC ya tiene total entero, no hace nada.

DO $$
DECLARE
  v_oc_id             UUID;
  v_oc_numero         VARCHAR;
  v_subtotal          NUMERIC;
  v_total_actual      NUMERIC;
  v_impuesto_correcto NUMERIC;
  v_total_correcto    NUMERIC;
  v_cp_id             UUID;
BEGIN
  SELECT id, numero, subtotal, total
    INTO v_oc_id, v_oc_numero, v_subtotal, v_total_actual
    FROM ordenes_compra
   WHERE numero = 'OC-20260329-E299AC';

  IF v_oc_id IS NULL THEN
    RAISE NOTICE 'OC-20260329-E299AC no encontrada — nada que corregir';
    RETURN;
  END IF;

  v_impuesto_correcto := ROUND(v_subtotal * 0.19);
  v_total_correcto := v_subtotal + v_impuesto_correcto;

  IF v_total_actual = v_total_correcto THEN
    RAISE NOTICE 'OC % ya tiene total entero (%) — nada que corregir', v_oc_numero, v_total_actual;
    RETURN;
  END IF;

  UPDATE ordenes_compra
     SET impuesto = v_impuesto_correcto,
         total    = v_total_correcto
   WHERE id = v_oc_id;

  SELECT id INTO v_cp_id FROM cuentas_pagar WHERE orden_id = v_oc_id;
  IF v_cp_id IS NOT NULL THEN
    UPDATE cuentas_pagar SET monto = v_total_correcto WHERE id = v_cp_id;
  END IF;

  -- Asiento COMPRA: IVA Crédito Fiscal (débito, cuenta 110601) y
  -- Proveedores (crédito, cuenta 210101). Inventario (111001) ya es entero
  -- (=subtotal) y no se toca.
  UPDATE journal_detail jd
     SET debito = v_impuesto_correcto
    FROM journal_entries je
   WHERE jd.journal_entry_id = je.id
     AND je.tipo_movimiento = 'COMPRA'
     AND je.referencia_id = v_oc_id
     AND jd.cuenta_codigo = '110601';

  UPDATE journal_detail jd
     SET credito = v_total_correcto
    FROM journal_entries je
   WHERE jd.journal_entry_id = je.id
     AND je.tipo_movimiento = 'COMPRA'
     AND je.referencia_id = v_oc_id
     AND jd.cuenta_codigo = '210101';

  UPDATE journal_entries
     SET total_debito  = v_total_correcto,
         total_credito = v_total_correcto
   WHERE tipo_movimiento = 'COMPRA'
     AND referencia_id = v_oc_id;

  -- Asiento PAGO_PROVEEDOR (referencia_id = cuentas_pagar.id): Banco
  -- Operacional (crédito, cuenta 110201) y Proveedores (débito, 210101).
  IF v_cp_id IS NOT NULL THEN
    UPDATE journal_detail jd
       SET credito = v_total_correcto
      FROM journal_entries je
     WHERE jd.journal_entry_id = je.id
       AND je.tipo_movimiento = 'PAGO_PROVEEDOR'
       AND je.referencia_id = v_cp_id
       AND jd.cuenta_codigo = '110201';

    UPDATE journal_detail jd
       SET debito = v_total_correcto
      FROM journal_entries je
     WHERE jd.journal_entry_id = je.id
       AND je.tipo_movimiento = 'PAGO_PROVEEDOR'
       AND je.referencia_id = v_cp_id
       AND jd.cuenta_codigo = '210101';

    UPDATE journal_entries
       SET total_debito  = v_total_correcto,
           total_credito = v_total_correcto
     WHERE tipo_movimiento = 'PAGO_PROVEEDOR'
       AND referencia_id = v_cp_id;
  END IF;

  RAISE NOTICE 'OC % corregida: impuesto %->%  total %->%', v_oc_numero, ROUND(v_subtotal * 0.19, 2), v_impuesto_correcto, v_total_actual, v_total_correcto;
END $$;
