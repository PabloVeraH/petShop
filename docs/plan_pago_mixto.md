# Plan de implementación — Pago mixto + cumplimiento SII (boleta del saldo)

**Rama:** `feat/pago-mixto` (desde `main`, 2026-11-12)
**Documento base:** `docs/pago_complementario.md` (análisis técnico y fiscal; leerlo
primero, en especial §4, §6.0 y §9).
**Objetivo:** que una venta (POS) o una cita se pueda pagar con 1 a 5 medios
(efectivo, débito, crédito, transferencia, nota de crédito, saldo a favor), con
contabilidad, anulación, reportes y recibo correctos, y que el sistema le diga
al cajero **por cuánto emitir boleta SII** (Res. Ex. SII N° 176/2020).

Este archivo es la bitácora de avance. Si la sesión se corta, retomar desde la
primera casilla `[ ]` de §5 y leer §7 (estado/notas).

---

## 1. Decisiones (cerradas)

Del documento base (§9.2) y de la sesión del 2026-11-12:

| # | Decisión |
|---|---|
| D1 | Solo se registra el monto aplicado; sin vuelto ni efectivo recibido. |
| D2 | `saldo_a_favor` se permite como medio de pago en el cobro inicial (venta y cita). |
| D3 | `ventas.metodo_pago`: 1 pago → su método; 2+ pagos → `'mixto'`. Se calcula **solo en la RPC**. |
| D4 | Citas usan el mismo contrato `pagos[]`. |
| D5 | Sin backfill (demo, sin ventas reales). |
| D6 | La tienda no emite DTE. Voucher Transbank = boleta de la parte con tarjeta; el resto se boletea fuera del sistema. El sistema calcula y muestra `montoBoleta`. |
| D7 | **NC con `tipo_reembolso='reembolso_directo'` no sirve como medio de pago** (el dinero ya se devolvió). Validación en API y RPC. |
| D8 | **Pagar con una NC tipo `saldo_a_favor` exige saldo suficiente** (descuento condicional, sin piso 0). Si la NC no tiene cliente de origen, solo se reclama la NC. **No se permite NC + saldo a favor en la misma venta.** |
| D9 | **Aviso 135 UF configurable:** columna `stores.umbral_identificacion_comprador` (pesos, NULL = sin aviso), editable por storeAdmin. El POS avisa, no bloquea. |
| D10 | La migración 093 se crea y prueba con mocks; **aplicarla al Supabase demo requiere confirmación explícita al final**. |
| D11 | No se registra el folio de la boleta externa (queda como pendiente en el doc base §9.3). |
| D12 | Documentos no tributarios no se rotulan "Boleta": PDF/correo/botón pasan a "Comprobante de venta" con la leyenda "No válido como documento tributario". |

## 2. Diseño

### 2.1 Contrato (API)

`POST /api/ventas` y `PATCH /api/citas/[id]` (accion `completar`) aceptan:

```ts
pagos?: Array<{
  metodo: "efectivo" | "debito" | "credito" | "transferencia" | "nota_credito" | "saldo_a_favor";
  monto: number;              // entero > 0, pesos
  numeroTransaccion?: string; // obligatorio en debito/credito/transferencia
  notaCreditoId?: string;     // obligatorio sii metodo = nota_credito
}>  // 1..5
```

- `pagos` y el formato legado (`metodoPago` + `pagoNc` + `numeroTransaccion`)
  son **mutuamente excluyentes**. El legado sigue aceptándose para no romper
  callers, pero se **normaliza a `pagos[]` en un solo lugar**
  (`normalizarPagos()`, `src/lib/ventas/pagos.ts`).
- Legado endurecido: `metodoPago` ∈ {`saldo_favor`,`plataforma`,`mixto`} sin
  `pagos` → 400; `metodoPago='nota_credito'` sin `pagoNc` → 400. Antes esos
  valores dejaban registrar un pago "con crédito" sin consumir ningún crédito.
- Reglas (Zod **y** RPC): suma exacta = total; montos enteros > 0; TRX en
  electrónicos; `notaCreditoId` solo con `nota_credito`; máx. 1 NC, máx. 1
  saldo, nunca ambos (D8); `saldo_a_favor` exige cliente; `canal != 'pos'` no
  acepta `pagos`. `store_id` siempre del contexto.

### 2.2 RPC (migración `093_pago_mixto.sql`)

- Funciones internas (no expuestas a `anon`/`authenticated`, `search_path`
  fijo):
  - `pagos_desde_legado(p_metodo_pago, p_pago_nc, p_numero_transaccion, p_total) → jsonb`
  - `validar_pagos(p_pagos, p_total, p_cliente_id) → text` (valida forma,
    suma, cardinalidad; devuelve el `metodo_pago` de la venta, D3).
  - `aplicar_pagos(p_store_id, p_venta_id, p_cliente_id, p_pagos) → void`
    (inserta filas de `pagos`; reclama NC con `estado='activa'` +
    `store_id` + no vencida + `tipo_reembolso='saldo_a_favor'`; descuento
    condicional de saldo, D8).
- `crear_venta_tx` y `completar_cita_tx`: se reemplazan (DROP + CREATE) con un
  parámetro nuevo `p_pagos jsonb DEFAULT NULL`; si viene NULL se usa
  `pagos_desde_legado(...)`. Mismo cuerpo que la 092 en todo lo demás.
  `crear_venta_tx` conserva `search_path` de la 087; GRANT/REVOKE iguales.
- Errores con `ERRCODE` estable para mapear a HTTP:

| ERRCODE | Significado | HTTP |
|---|---|---|
| `PV001` | Pagos inválidos (suma, monto, método, cardinalidad, TRX) | 400 |
| `PV002` | NC no encontrada (o de otra tienda) | 404 |
| `PV003` | NC no disponible (usada/inactiva, carrera) | 409 |
| `PV004` | NC vencida | 410 |
| `PV005` | NC con reembolso directo (D7) | 409 |
| `PV006` | Saldo a favor insuficiente (D8) | 409 |
| `PV007` | Saldo a favor sin cliente | 400 |

### 2.3 Dominio compartido — `src/lib/ventas/pagos.ts` (puro, cliente y servidor)

- Constantes de métodos (`METODOS_PAGO`, `METODOS_CON_TRX`,
  `METODOS_TARJETA`, `METODOS_CREDITO_INTERNO`), etiquetas legibles.
- `normalizarPagos(input, total)`, `calcularMontoBoleta(pagos)`,
  `desgloseBoleta(pagos)`.

### 2.4 Contabilidad

- `lineasCobroPagos(pagos)`: una línea de débito por pago (efectivo → Caja;
  débito/crédito/transferencia → Banco; NC/saldo → Saldos a favor).
- `lineasVentaPagos({ pagos, montoNeto, iva, cuentaIngreso })` y
  `lineasAnulacionVentaPagos({ pagos, montoNeto, iva })` (espejo exacto).
- Callers: `/api/ventas` (POS), `/api/citas/[id]` (VENTAS_SERVICIOS),
  `anular-venta.ts` (POS), `/api/contabilidad/backfill` (lee `pagos`). Los
  canales externos siguen con `lineasVentaCanal`/`lineasAnulacionVentaCanal`.
- Los builders viejos sin callers se eliminan.

### 2.5 UI

- `SelectorPagos` (componente compartido POS + cita): filas método/monto/TRX,
  NC con validación, saldo a favor con saldo disponible, "Resto", máx. 5 filas,
  aviso de boleta (`montoBoleta`) y aviso 135 UF.
- `ModalPago` y `ModalCobroCita` lo usan; el estado de cobro vive en el modal
  (no en el store, no en `localStorage`).
- Se quitan `metodoPago`/`numeroTransaccion`/`pagoNc` del store `pos.ts`.

### 2.6 Fiscal (Fase F)

- Aviso "Emitir boleta SII por $X" en el modal de pago, en el banner de éxito
  del POS y en el detalle de venta (`/sales/[id]`, fuera de lo impreso).
- Recibo HTML y PDF: título "Comprobante de venta" + leyenda "No válido como
  documento tributario". Correo: asunto y texto sin "Boleta".
- Reportes/dashboard: desglose por `pagos` para ventas `mixto` (opción A del
  doc base §4.5) y total "a boletear" del período.

## 3. Superficie afectada (verificada)

| Área | Archivos |
|---|---|
| Migración | `migrations/093_pago_mixto.sql`, `migrations/README.md` |
| Tipos | `src/types/index.ts` |
| Validación | `src/lib/validation/ventas.ts`, `src/lib/validation/citas.ts`, schema admin de tienda |
| Dominio | `src/lib/ventas/pagos.ts` (nuevo) |
| Contabilidad | `src/lib/contabilidad/generador-asientos.ts`, `src/lib/ventas/anular-venta.ts`, `src/app/api/contabilidad/backfill/route.ts` |
| API | `src/app/api/ventas/route.ts`, `src/app/api/citas/[id]/route.ts`, `src/app/api/notas-credito/route.ts` (GET por código: D7), `src/app/api/reports/route.ts`, `src/app/api/reports/export/route.ts`, `src/app/api/dashboard/route.ts`, `src/app/api/recibos/[ventaId]/route.ts`, endpoint de config de tienda |
| Correo/PDF | `src/lib/email.ts`, `src/lib/reports/pdf-generator.ts` |
| UI | `src/stores/pos.ts`, `src/app/(app)/pos/page.tsx`, `pos/api.ts`, `pos/components/ModalPago.tsx`, `citas/components/ModalCobroCita.tsx`, `sales/[id]/page.tsx`, admin de tienda |
| Tests | `tests/integration/api/{ventas.post,citas,recibos,reports,dashboard}.test.ts`, `tests/unit/lib/{contabilidad-generador,pos-store}.test.ts`, `tests/components/{ModalPago,ModalCobroCita,POSPage,...}.test.tsx`, nuevos |
| Docs | `docs/spec-registry.md`, `docs/pago_complementario.md`, `AGENTS.md` (§23 invariante nueva) |

## 4. Invariantes a probar

1. `Σ pagos.monto === ventas.total` en toda venta creada por el POS o una cita.
2. `ventas.metodo_pago` = método único o `'mixto'`, decidido solo en la RPC.
3. Una NC/saldo nunca se consume dos veces ni deja saldo negativo (D7, D8).
4. Asiento de venta: `Σ debe = Σ haber = total`, una línea de cobro por pago,
   `neto + IVA = total` con `extraerIva()`.
5. Anulación: el contra-asiento espeja **cada** línea de cobro.
6. `montoBoleta = Σ pagos no tarjeta`, mismo valor en modal, banner,
   detalle y reporte.
7. Ningún documento que emite el sistema se rotula "Boleta".

## 5. Fases y avance

Cada fase: código + tests (funcionamiento y seguridad, §19.1 de AGENTS.md),
suite del módulo en verde, commit. IDs de test: grep a `docs/spec-registry.md`
y `tests/` antes de asignar (§2.3 de AGENTS.md).

- [x] **F0 — Plan y rama.** Este archivo; rama `feat/pago-mixto`.
- [x] **F1 — Dominio + validación.** `src/lib/ventas/pagos.ts`;
      `VentaCreateSchema.pagos` y `CitaAccionSchema.pagos` con reglas; tests
      unitarios (incl. legado endurecido).
- [x] **F2 — Migración 093.** Funciones internas + `crear_venta_tx` +
      `completar_cita_tx` + columna `stores.umbral_identificacion_comprador`;
      tipos manuales; guardas SEC en verde.
- [x] **F3 — Contabilidad.** Builders por pagos + tests de balance;
      `anular-venta.ts`; backfill.
- [x] **F4 — API ventas.** `normalizarPagos`, pre-validación NC (D7),
      mapeo de ERRCODE, asiento, correo, auditoría; tests de integración
      (feliz 1/2/3 medios, 401, IDOR NC, `store_id` malicioso, suma inválida,
      TRX, NC reembolso directo, saldo sin cliente, canal + pagos, idempotencia).
- [x] **F5 — API citas.** Mismo contrato; tests.
- [x] **F6 — NC por código (D7).** `GET /api/notas-credito?numero_nc=` rechaza
      reembolso directo; test.
- [x] **F7 — UI POS.** `SelectorPagos`, `ModalPago`, store, `page.tsx`
      (banner boleta), `api.ts`; tests de componente (render, agregar/quitar,
      resto, Cobrar deshabilitado, body enviado, error de API, aviso boleta).
- [x] **F8 — UI cita.** `ModalCobroCita` con `SelectorPagos`; tests.
- [x] **F9 — Fiscal: documentos.** Recibo HTML, PDF, correo, detalle de venta
      con `montoBoleta`; tests.
- [x] **F10 — Reportes/dashboard.** Desglose por `pagos` y total a boletear;
      tests.
- [x] **F11 — Aviso 135 UF.** Config en admin (storeAdmin + auditoría) y
      lectura en POS; tests.
- [x] **F12 — Cierre.** `npm run build && npm test`, `typecheck`, `lint`,
      `test:security`, `test:coverage` (archivos nuevos > 0 %), revisión de
      diff, review independiente, `graphify update .`, spec-registry,
      AGENTS.md, formato §22.
- [x] **F13 — Infra (con confirmación).** Mostrar SQL 093, aplicar al demo
      solo con OK explícito, verificar con SELECTs y transacción con ROLLBACK.

## 6. Riesgos conocidos

- **Despliegue acoplado:** la 093 cambia la firma de dos RPC. Si se despliega
  el código sin la migración (o al revés), el cobro falla. Aplicar la 093 y
  desplegar juntos. La RPC nueva acepta los parámetros legados, así que el
  código viejo sigue funcionando con la migración nueva.
- **Tests mock-first:** no prueban la RPC real. La validación en BD queda
  pendiente hasta F13.
- **Test preexistente fallando:** `tests/components/CanalConfigPage.test.tsx`
  (1 test) falla en `main` antes de cualquier cambio (línea base 2026-11-12:
  229/230 suites, 2958/2959 tests). No es de este cambio.

## 7. Estado / notas de sesión

- 2026-11-12: rama creada, plan escrito. Línea base registrada (§6).
- 2026-11-12: F1–F6 hechas (backend). Notas para retomar:
  - Pruebas SQL contra la RPC real: `bash tests/sql/run.sh` (Docker,
    `postgres:18-alpine`, nunca Supabase). 15 casos + concurrencia verificada
    a mano (misma NC en dos sesiones → la segunda falla PV003).
  - Venta de $0 (100 % descuento, I-50): se acepta un pago único de $0; con
    varios pagos, $0 se rechaza (TS y SQL).
  - Los builders `lineasVenta`, `lineasVentaConNc`, `lineasVentaServicio(ConNc)`
    y `lineasAnulacionVentaConNc` se reemplazaron por `lineasVentaPagos` /
    `lineasAnulacionVentaPagos`; sus tests se portaron con adaptadores
    locales (mismas aserciones).
  - `GET /api/notas-credito?numero_nc` devuelve `monto_disponible`
    (mín. entre la NC y el saldo del cliente de origen, D8): la UI debe
    proponer ese monto, no `monto_total`.
  - Anulación y backfill: si los pagos no suman el total (dato antiguo), se
    usa el asiento de un solo método por el total, como antes.
- 2026-11-12: F7, F8, F9 y F11 hechas. F9 la hizo un agente (revisado). Notas:
  - `SelectorPagos` (src/components/pagos/) es el único selector de pagos;
    POS y citas lo usan. Un pago único sigue al total SOLO cuando el total
    cambia (bug encontrado por MP-19: seguirlo en cada render revertía la
    edición del cajero).
  - Ticket/recibo/PDF/correo dicen "Comprobante de venta" + "No válido como
    documento tributario". El aviso de boleta no se imprime y no aparece en
    ventas anuladas ni de canal externo.
  - Umbral 135 UF: `stores.umbral_identificacion_comprador`, editable en
    /settings; el POS lo lee de `GET /api/tienda/nombre` (query `store-name`).
- 2026-11-12: F10 hecha por un agente (revisada): reportes y dashboard reparten las ventas mixtas por pago y devuelven montoBoleta/boletaPorMetodo; el CSV agrega "Detalle pagos" y "Monto a boletear". AGENTS.md §23.8 documenta la invariante.
- 2026-11-12: revisión independiente (agente revisor, solo lectura, con sondas
  SQL reales). Corregido en esta rama:
  - **C1 (CRÍTICO)**: las órdenes de canal externo (procesar-orden.ts envían
    `p_metodo_pago='plataforma'`) habrían fallado con PV001 tras la 093.
    `validar_pagos` acepta 'plataforma' solo si `p_canal <> 'pos'`
    (PMX-SQL-16). Mi grep inicial de llamadores no encontró esa llamada:
    lección para el gate §2.2.
  - M1: NC/saldo por $0 quemaban la NC (U-257, PMX-SQL-17).
  - M2: precio cambiado con el carrito abierto → mensaje con el total real
    y cómo seguir (I-833); la validación del servidor no se relaja.
  - B4: `completar_cita_tx` con `search_path 'public', 'pg_temp'`.
  - B5: el aviso de boleta usa los pagos que devuelve el servidor (I-834, PP-19).
  Pendiente (fuera de alcance, documentado):
  - B1 (preexistente): el reverso de una venta de cita debita VENTAS, no
    VENTAS_SERVICIOS (cuadra, pero no es el espejo exacto). También en backfill.
  - B2 (decisión de negocio): una NC tipo saldo_a_favor cuya venta de origen no
    tiene cliente no está respaldada por saldo; si se usa en una venta con
    cliente y esa venta se anula, `anular_venta_tx` (paso 6) acredita el monto
    al cliente de la venta anulada. El crédito se conserva, cambia de dueño.
  - B3 (preexistente, anterior a esta rama): `anular_venta_tx` paso 5 cancela
    NCs sin `AND estado='activa'` y bloquea saldo→NC (orden inverso a
    `aplicar_pagos`): ante concurrencia exacta, deadlock (500, sin daño) o
    doble descuento acotado en 0. Fix sugerido en una migración propia.
- 2026-11-12: F12 cerrada. Verificado: typecheck OK, lint 0 errores, `npm test` 3070/3070 (236 suites), test:security 13/13, audit:deps 0 vulnerabilidades, build OK, `bash tests/sql/run.sh` OK, cobertura de líneas 98,4 % en los archivos nuevos. Pendiente: F13 (aplicar la 093 al demo, requiere OK explícito).
- 2026-11-12 (sesión cortada por límite de uso) — **EN CURSO: dueño de la NC**
  (decisión del usuario: toda NC es de un cliente y solo él la usa; si la venta
  no tenía cliente, se registra al crear la NC). Commit WIP; los tests de Jest
  NO están en verde todavía.
  Hecho y verificado:
  - Migración 093: columna `notas_credito.cliente_id` + backfill desde la venta,
    `crear_nota_credito_tx(..., p_cliente_id)` exige cliente (PV009),
    `aplicar_pagos` exige que la venta sea del dueño (PV008),
    `anular_venta_tx` devuelve el crédito al dueño. Guarda de datos (aborta si
    hay precios con decimales) y `migrations/093_pago_mixto_preflight.sql`
    (solo lectura). `bash tests/sql/run.sh` OK (PMX-SQL-18…22); la guarda se
    probó abortando con un servicio de precio decimal.
  - TS: `validarPagos` exige cliente con NC; PV008/PV009 mapeados;
    `prevalidarNotaCredito(..., clienteId)` verifica el dueño (ventas y citas).
  Falta:
  1. `GET /api/notas-credito?numero_nc` → exigir `clienteId`, comparar con
     `nc.cliente_id`, saldo desde `nc.cliente_id`.
  2. `SelectorPagos`: NC deshabilitada sin cliente; `ValidadorNc` envía `&clienteId=`.
  3. Crear NC: `NotaCreditoPostSchema.clienteId` opcional → `p_cliente_id`;
     mapear PV009 a 400; `DevolucionModal` pide cliente (búsqueda por RUT,
     `/api/clientes?rut=`) cuando la venta no tiene.
  4. Actualizar mocks de tests (NC con `cliente_id`, ventas con `clienteId`):
     ventas-pago-mixto, ventas.post (I-491), citas, notas-credito, SelectorPagos;
     tests nuevos de dueño; registrar IDs; README de migraciones (preflight
     obligatorio antes de migrar una tienda).
  5. Suite completa + build; luego F13 (aplicar en el demo: correr primero el
     preflight) y push + PR (el usuario ya autorizó ambos).
- 2026-11-12: dueño de la NC TERMINADO. Endpoint de búsqueda por código exige el cliente y compara con el dueño; SelectorPagos no ofrece NC sin cliente; crear NC acepta `clienteId` y el modal de devolución lo pide (búsqueda por RUT) cuando la venta no tiene. Verificado: `npm test` 3078/3078, SQL OK, build OK, lint/typecheck 0 errores. README de migraciones: preflight obligatorio. Siguiente: F13 (demo) y PR.
- 2026-11-12: F13 hecha. El usuario aplicó la 093 en el demo (SQL Editor). Verificado con lecturas (registrada, firmas, search_path, sin grants a anon/authenticated, columnas, backfill de 11 NC) y con pruebas reales revertidas: venta mixta, PV001, crear NC con dueño y saldo, PV008 con otro cliente, consumo por el dueño y anulación que devuelve el crédito. Sin residuos. Quedan 15 NC activas sin dueño en el demo (datos de prueba). PR #1 abierto. Pendiente: aplicar en mascotaspetshop con el preflight y desplegar.
- 2026-11-12: medios de pago sin repetir (pedido del usuario): la UI deshabilita en cada fila los medios ya elegidos en otras y "Agregar" propone el primer medio libre; `validarPagos` rechaza repetidos en la API (U-258, SEL-12, SEL-13, I-841). Los IDs de SelectorPagos pasaron de `SP-` a `SEL-`: `SP-01…` ya eran de SuppliersPage (colisión que el gate §2.3 debió detectar). Sin cambio en SQL: un repetido no es un riesgo de dinero (la suma sigue exacta y NC/saldo ya eran únicos en la RPC), y la 093 ya está aplicada en ambas bases.
