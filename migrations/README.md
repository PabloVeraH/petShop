# Migraciones

| Archivo | Qué es |
|---|---|
| `000_baseline.sql` | Esquema completo de `public` (+ extensiones y bucket `instagram-media`), tomado con `pg_dump` del demo el 2026-10-11. Incluye hasta la migración **086** (sucursales). Es lo que se aplica en un Supabase **nuevo**. |
| `085_pg_cron_canales.sql` | Jobs de pg_cron de canales. **No** está en el baseline ni aplicada en el demo: se aplica después de desplegar (ver `docs/INSTALACION_TIENDA.md` §8.4). |
| `087_search_path_security_definer.sql` | Fija `search_path` en 3 funciones `SECURITY DEFINER` (`crear_venta_tx`, `cancelar_cita_tx`, `replace_servicio_horarios`). Aplicada 2026-10-13 en el demo y en mascotaspetshop (SQL Editor; mascotaspetshop no tiene `supabase_migrations.schema_migrations`). |
| `088_indices_foreign_keys.sql` | Índices para las 32 foreign keys sin índice (advisor `unindexed_foreign_keys`). **Pendiente de aplicar** en el demo y en mascotaspetshop. |
| `089_rate_limit_global.sql` | Contador de rate limit compartido entre instancias (`rate_limit_contadores` + `rate_limit_hit`). **Pendiente de aplicar** en el demo y en mascotaspetshop; mientras tanto el middleware usa el contador en memoria. |
| `090_registro_migraciones.sql` | Crea `supabase_migrations.schema_migrations` (si no existe; misma tabla que usa Supabase) para registrar en la base qué migraciones tiene cada proyecto. Desde aquí cada migración se registra sola (ver reglas). **Pendiente de aplicar** en el demo y en mascotaspetshop. |
| `091_seed_canales_externos.sql` | Filas del catálogo `canales_externos` (`pos`, `rappi`, `pedidosya`, `ubereats`, `instagram`), que el baseline (solo esquema) no trae: sin ellas toda venta falla por `ventas_canal_fkey`. No cambia nada en el demo (`ON CONFLICT DO NOTHING`). **Pendiente de aplicar** en el demo y en mascotaspetshop. Toda tienda nueva la necesita justo después del baseline. |
| `historico/` | Migraciones anteriores al baseline. Solo referencia (el porqué de cada tabla/función). **No se ejecutan**: no reproducían el esquema real (nombres que no calzan con el historial del demo, 074–084 aplicadas sin registro). |

## Reglas desde el baseline

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
  siguiente libre es `092`** (la `086` es de sucursales; la `087`, search_path; la `088`, índices de FKs; la `089`, rate limit; la `090`, registro de migraciones; la `091`, filas de canales_externos).
- Se aplican **en orden** y completas, pegando el archivo en el SQL Editor del
  proyecto (o `psql -f`). No usar `apply_migration` de la CLI/MCP: registra
  con una versión tipo fecha y la migración quedaría anotada dos veces.
- **Desde la 090, toda migración termina registrándose a sí misma** (última
  sentencia del archivo, `version` = número y `name` = nombre del archivo sin
  `.sql`):
  ```sql
  INSERT INTO supabase_migrations.schema_migrations (version, name)
  VALUES ('092', '092_descripcion')
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
