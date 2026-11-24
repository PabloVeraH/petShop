# Migraciones

| Archivo | Qué es |
|---|---|
| `000_baseline.sql` | Esquema completo de `public` (+ extensiones y bucket `instagram-media`), tomado con `pg_dump` del demo el 2026-10-11. Incluye hasta la migración **086** (sucursales). Es lo que se aplica en un Supabase **nuevo**. |
| `085_pg_cron_canales.sql` | Jobs de pg_cron de canales. **No** está en el baseline ni aplicada en el demo: se aplica después de desplegar (ver `docs/INSTALACION_TIENDA.md` §8.4). |
| `087_search_path_security_definer.sql` | Fija `search_path` en 3 funciones `SECURITY DEFINER` (`crear_venta_tx`, `cancelar_cita_tx`, `replace_servicio_horarios`). Aplicada 2026-10-13 en el demo y en mascotaspetshop (SQL Editor). En mascotaspetshop quedó registrada a mano al aplicar la 090 (2026-10-16). |
| `088_indices_foreign_keys.sql` | Índices para las 32 foreign keys sin índice (advisor `unindexed_foreign_keys`). Aplicada en mascotaspetshop 2026-10-16 y en el demo 2026-10-22. |
| `089_rate_limit_global.sql` | Contador de rate limit compartido entre instancias (`rate_limit_contadores` + `rate_limit_hit`). Aplicada en mascotaspetshop 2026-10-16 y en el demo 2026-10-22. |
| `090_registro_migraciones.sql` | Crea `supabase_migrations.schema_migrations` (si no existe; misma tabla que usa Supabase) para registrar en la base qué migraciones tiene cada proyecto. Desde aquí cada migración se registra sola (ver reglas). Aplicada en mascotaspetshop 2026-10-16 y en el demo 2026-10-22 (en ambas con 000/087/088/089 registradas a mano; en el demo la tabla ya existía). |
| `091_seed_canales_externos.sql` | Filas del catálogo `canales_externos` (`pos`, `rappi`, `pedidosya`, `ubereats`, `instagram`), que el baseline (solo esquema) no trae: sin ellas toda venta falla por `ventas_canal_fkey`. No cambia nada en el demo (`ON CONFLICT DO NOTHING`). Aplicada en mascotaspetshop 2026-10-16 y en el demo 2026-10-22 (ahí no cambió filas). Toda tienda nueva la necesita justo después del baseline. |
| `092_fechas_hora_chile.sql` | Función `hoy_negocio()` (fecha en America/Santiago); las 10 funciones que usaban `CURRENT_DATE` (UTC en Supabase) pasan a usarla: comprobante de citas, FIFO y vencimiento de lotes, fecha de ingreso de lotes, licencia de canales, término estimado de alimento. También los defaults de `cuentas_pagar.fecha_emision` y `lotes_producto.fecha_ingreso`. Requiere la 090. Aplicada en el demo 2026-10-22 y en mascotaspetshop 2026-11-12. |
| `093_pago_mixto.sql` | Pago mixto: `crear_venta_tx` y `completar_cita_tx` aceptan `p_pagos` (1 a 5 medios; sin él usan los parámetros antiguos), con validación y consumo de crédito en `validar_pagos` / `aplicar_pagos`. NC con reembolso directo ya no sirve como pago; pagar con NC exige saldo suficiente. Columna `stores.umbral_identificacion_comprador`. Dueño de la NC: `notas_credito.cliente_id` (backfill desde la venta de origen); `crear_nota_credito_tx` exige cliente y solo el dueño usa la NC. **Antes de aplicarla en una tienda, correr `093_pago_mixto_preflight.sql` (solo lectura) y resolver lo que reporte**: la 093 aborta sola si hay precios con decimales en citas/servicios, y lo demás (NC sin dueño, NC con reembolso directo) es para decidir con la tienda. **Aplicar ANTES de desplegar el código que envía `p_pagos`** (el código anterior sigue funcionando con la 093). Probada en Postgres local con `bash tests/sql/run.sh`. Aplicada en el demo y en mascotaspetshop 2026-11-12 (en mascotaspetshop, después de la 092). |
| `094_ventas_notas.sql` | Columna `ventas.notas` (notas internas del POS). Nunca había existido: las notas se perdían en silencio. Aditiva, sin revisión previa. Aplicada en el demo y en mascotaspetshop 2026-11-12. |
| `095_vender_vencidos.sql` | Opción por tienda `stores.vender_vencidos` (default false = como antes). `deducir_stock_fifo` gana `p_incluir_vencidos` (default false: abrir saco y descuento manual no cambian); con true consume primero los lotes vigentes y después los vencidos. El error de stock nombra el producto y separa vigentes de vencidos. `crear_venta_tx` (copia de la 093 + esos dos cambios) aplica la opción solo a ventas `pos`. Sin revisión previa, no cambia filas. **Aplicar ANTES de desplegar el código** (GET /api/settings y /api/tienda/nombre leen la columna); el código anterior funciona con ella. Probada en Postgres local con `bash tests/sql/run.sh` (VENC-SQL-01…09). Aplicada en el demo 2026-11-23 (funciones verificadas por hash contra el archivo). Aplicada en mascotaspetshop 2026-11-24 (verificada por hash). |
| `096_varios_sacos_abiertos.sql` | Varios sacos abiertos del mismo producto (granel en varios puntos de venta). Quita el índice único; `fraccion_saco_abierto` suma todos; `abrir_saco` acepta `p_permitir_otro`; `consumir_granel`, `cerrar_saco_merma` y `ajustar_stock_conteo` aceptan `p_saco_id` (obligatorio con 2+ abiertos); `deshacer_apertura_saco` sin saco deshace la más reciente; `devolver_granel` devuelve al más antiguo; `crear_venta_tx` (copia de la 095) pasa `item.saco_id`. Parámetros nuevos con default: con un saco todo sigue igual. No cambia filas. Aplicar antes de desplegar el código que envía `permitir_otro`/`saco_id`. Probada en Postgres local (VSA-SQL-01…13). Aplicada en el demo 2026-11-23 (funciones verificadas por hash contra el archivo). Aplicada en mascotaspetshop 2026-11-24 (verificada por hash). |
| `097_revocar_execute_anon.sql` | **Seguridad.** Las tiendas instaladas con el baseline quedaban con funciones `SECURITY DEFINER` ejecutables con la clave pública (los permisos por defecto de Supabase dan EXECUTE directo a `anon`/`authenticated`, y el baseline solo revoca a `PUBLIC`). Revoca a los tres y asegura `service_role`. No cambia filas ni código; en el demo no cambia nada. Probada en Postgres local (ACL-SQL-01…04). Aplicada en mascotaspetshop 2026-11-24: 31 funciones expuestas antes (las 30 del baseline y `rls_auto_enable` de Supabase), 0 después. Aplicada en el demo 2026-11-24 (sin cambios de permisos). |
| `098_numero_transaccion_opcional.sql` | Opción por tienda `stores.numero_transaccion_obligatorio` (default true = como antes): con false, débito, crédito y transferencia no exigen número de transacción (POS y citas). `validar_pagos` gana `p_trx_obligatoria` (default true; NULL = true); `crear_venta_tx` (copia de la 096) y `completar_cita_tx` (copia de la 093) le pasan la configuración de su tienda. `pagos.numero_transaccion` ya aceptaba NULL. No cambia filas. **Aplicar ANTES de desplegar el código**; el código anterior funciona con ella. Probada en Postgres local (NTX-SQL-01…08). Aplicada en el demo 2026-11-24 (verificada por hash). Aplicada en mascotaspetshop 2026-11-24 (verificada por hash y permisos). |
| `099_venta_granel_por_valor.sql` | Opción por tienda `stores.venta_granel_por` (`gramos` default = como antes, o `valor`): el cajero escribe el monto, se cobra justo ese monto y se descuentan los gramos más cercanos. `crear_nota_credito_tx` (copia de la 093): una línea a granel devuelve la parte de lo cobrado (subtotal), por acumulado, en vez de kg × precio; y no devuelve más de lo vendido (rechaza líneas repetidas y bloquea la venta ante devoluciones simultáneas). `crear_venta_tx` no cambia. No cambia filas. **Aplicar ANTES de desplegar el código**; el código anterior funciona con ella. Probada en Postgres local (VGV-SQL-01…10). Aplicada en el demo 2026-11-24 (verificada por hash). **Pendiente en mascotaspetshop.** |
| `093_pago_mixto_preflight.sql` | Revisión previa de la 093, **solo lectura**. No es una migración: no se registra ni cambia nada. |
| `historico/` | Migraciones anteriores al baseline. Solo referencia (el porqué de cada tabla/función). **No se ejecutan**: no reproducían el esquema real (nombres que no calzan con el historial del demo, 074–084 aplicadas sin registro). |

## Reglas desde el baseline

- **Revisión previa.** Si una migración trae un `NNN_*_preflight.sql`, correrlo
  en el proyecto destino ANTES de aplicarla y revisar el resultado con la
  tienda. Las migraciones que pueden chocar con datos existentes llevan además
  una guarda que aborta sin aplicar nada (ej. sección 0 de la 093).

- **No aplicar `000_baseline.sql` en el demo**: ya tiene todo eso.
- **El baseline es solo esquema: no trae filas.** Toda tabla global de
  catálogo que el código o una FK necesitan con datos (hoy:
  `canales_externos`, ver 091) va con sus filas en una migración propia, con
  `INSERT ... ON CONFLICT DO NOTHING`. Si agregas un catálogo nuevo, sus
  filas van en la misma migración que crea la tabla. Sin esto, una tienda
  nueva arranca con la tabla vacía y falla en producción (en mascotaspetshop
  toda venta daba 500 por `ventas_canal_fkey`, 2026-10-16).
- Todo cambio de esquema es un archivo nuevo `NNN_descripcion.sql` con número
  mayor al último usado en `migrations/`, `historico/` y el demo. **El
  siguiente libre es `100`** (la `086` es de sucursales; la `087`, search_path; la `088`, índices de FKs; la `089`, rate limit; la `090`, registro de migraciones; la `091`, filas de canales_externos; la `092`, fechas en hora de Chile; la `093`, pago mixto; la `094`, notas de venta; la `095`, vender productos vencidos; la `096`, varios sacos abiertos; la `097`, revocar EXECUTE a anon; la `098`, número de transacción opcional; la `099`, granel por valor).
- Se aplican **en orden** y completas, pegando el archivo en el SQL Editor del
  proyecto (o `psql -f`). No usar `apply_migration` de la CLI/MCP: registra
  con una versión tipo fecha y la migración quedaría anotada dos veces.
- **Desde la 090, toda migración termina registrándose a sí misma** (última
  sentencia del archivo, `version` = número y `name` = nombre del archivo sin
  `.sql`):
  ```sql
  INSERT INTO supabase_migrations.schema_migrations (version, name)
  VALUES ('093', '093_descripcion')
  ON CONFLICT (version) DO NOTHING;
  ```
- Ver qué tiene aplicado un proyecto:
  ```sql
  select version, name from supabase_migrations.schema_migrations order by version;
  ```
  En el demo también aparecen filas antiguas con versión tipo fecha (las
  creó `apply_migration`); las de 3 dígitos son las de esta convención.
- **Al aplicar la 090 en una base por primera vez**, registrar a mano lo que
  ya tenía (una sola vez), verificando antes que de verdad esté aplicado.
  Ejemplo para una tienda con baseline + 087–089:
  ```sql
  INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
    ('000', '000_baseline'),
    ('087', '087_search_path_security_definer'),
    ('088', '088_indices_foreign_keys'),
    ('089', '089_rate_limit_global')
  ON CONFLICT (version) DO NOTHING;
  ```
- Además, cada tienda anota su última migración en la tabla de
  `docs/INSTALACION_TIENDA.md` §10 (la base es la fuente de verdad; §10 es el
  resumen).
