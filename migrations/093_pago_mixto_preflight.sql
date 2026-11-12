-- Revisión previa a la migración 093 (pago mixto). SOLO LECTURA: no cambia
-- nada. Correrla en el SQL Editor del proyecto ANTES de aplicar la 093 y
-- revisar cada resultado con el dueño de la tienda. Ver migrations/README.md.
--
-- Cada consulta devuelve filas solo si hay algo que revisar. Vacío = OK.
-- BLOQUEANTE = la 093 aborta sola si existe (guarda de datos, sección 0).
-- AVISO      = la 093 se aplica, pero cambia lo que se puede hacer con esos datos.

-- 0. ¿Ya está aplicada? (si devuelve una fila, NO volver a aplicar sin revisar)
SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '093';

-- 1. BLOQUEANTE: citas confirmadas con precio con decimales. Los pagos son en
--    pesos enteros: estas citas no se podrían cobrar. Redondear el precio.
SELECT 'cita con precio decimal' AS revision, c.id, c.fecha, c.precio, s.nombre AS servicio
  FROM public.citas c
  LEFT JOIN public.servicios s ON s.id = c.servicio_id
 WHERE c.estado = 'confirmada' AND c.precio IS NOT NULL AND c.precio <> trunc(c.precio)
 ORDER BY c.fecha;

-- 2. BLOQUEANTE: servicios con precio con decimales (las citas nuevas copian
--    este precio).
SELECT 'servicio con precio decimal' AS revision, id, nombre, precio
  FROM public.servicios
 WHERE precio IS NOT NULL AND precio <> trunc(precio);

-- 3. AVISO: NC activas con reembolso directo. Desde la 093 no sirven como pago
--    (el dinero ya se devolvió). Si alguna se entregó al cliente como vale,
--    hay que resolverlo con él.
SELECT 'NC reembolso directo activa' AS revision, nc.numero_nc, nc.monto_total, nc.fecha_vencimiento, nc.created_at
  FROM public.notas_credito nc
 WHERE nc.estado = 'activa' AND nc.tipo_reembolso IS DISTINCT FROM 'saldo_a_favor'
 ORDER BY nc.created_at;

-- 4. AVISO: NC activas cuya venta de origen no tiene cliente. La 093 les asigna
--    como dueño el cliente de su venta; estas quedan SIN dueño y no se pueden
--    usar como pago hasta asignárselo. Para asignarlo (después de migrar,
--    verificando que el cliente sea de la misma tienda):
--      UPDATE public.notas_credito SET cliente_id = '<uuid del cliente>'
--       WHERE numero_nc = '<numero>' AND store_id = '<uuid de la tienda>';
--    y sumar su monto al saldo de ese cliente con
--      SELECT public.incrementar_saldo_a_favor('<tienda>', '<cliente>', <monto>);
--    (solo si es tipo saldo_a_favor: sin cliente nunca sumó saldo).
SELECT 'NC activa sin cliente' AS revision, nc.numero_nc, nc.tipo_reembolso, nc.monto_total, nc.fecha_vencimiento
  FROM public.notas_credito nc
  JOIN public.ventas v ON v.id = nc.venta_id
 WHERE nc.estado = 'activa' AND v.cliente_id IS NULL
 ORDER BY nc.created_at;

-- 5. AVISO: NC activas tipo saldo_a_favor cuyo cliente tiene MENOS saldo que el
--    monto de la NC (parte ya se gastó como saldo a favor). Desde la 093 solo
--    pagan hasta el saldo disponible (antes se aceptaban igual: doble gasto).
SELECT 'NC con saldo insuficiente' AS revision, nc.numero_nc, nc.monto_total,
       COALESCE(s.saldo_disponible, 0) AS saldo_cliente, cl.nombre AS cliente
  FROM public.notas_credito nc
  JOIN public.ventas v ON v.id = nc.venta_id
  LEFT JOIN public.clientes cl ON cl.id = v.cliente_id
  LEFT JOIN public.saldos_a_favor s ON s.cliente_id = v.cliente_id AND s.store_id = nc.store_id
 WHERE nc.estado = 'activa' AND nc.tipo_reembolso = 'saldo_a_favor'
   AND v.cliente_id IS NOT NULL
   AND COALESCE(s.saldo_disponible, 0) < nc.monto_total;

-- 6. AVISO: ventas vigentes cuyos pagos no suman el total (p. ej. pagos sueltos
--    de /api/pagos). No impide migrar: al anularlas o reconstruir su asiento se
--    usa un solo método por el total, como antes de la 093.
SELECT 'pagos no suman el total' AS revision, v.numero_comprobante, v.total,
       COALESCE(sum(p.monto), 0) AS suma_pagos, v.metodo_pago, v.created_at
  FROM public.ventas v
  LEFT JOIN public.pagos p ON p.venta_id = v.id
 WHERE v.estado <> 'anulada'
 GROUP BY v.id
HAVING COALESCE(sum(p.monto), 0) <> v.total
 ORDER BY v.created_at;

-- 7. INFORMATIVO: métodos de pago en uso (los legados 'saldo_favor' y 'mixto'
--    como método de UN pago ya no se aceptan en cobros nuevos).
SELECT 'métodos en pagos' AS revision, metodo, count(*) AS pagos, sum(monto) AS monto
  FROM public.pagos
 GROUP BY metodo
 ORDER BY pagos DESC;
