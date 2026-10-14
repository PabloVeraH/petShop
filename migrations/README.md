# Migraciones

| Archivo | Qué es |
|---|---|
| `000_baseline.sql` | Esquema completo de `public` (+ extensiones y bucket `instagram-media`), tomado con `pg_dump` del demo el 2026-10-11. Incluye hasta la migración **086** (sucursales). Es lo que se aplica en un Supabase **nuevo**. |
| `085_pg_cron_canales.sql` | Jobs de pg_cron de canales. **No** está en el baseline ni aplicada en el demo: se aplica después de desplegar (ver `docs/INSTALACION_TIENDA.md` §8.4). |
| `087_search_path_security_definer.sql` | Fija `search_path` en 3 funciones `SECURITY DEFINER` (`crear_venta_tx`, `cancelar_cita_tx`, `replace_servicio_horarios`). Aplicada 2026-10-13 en el demo y en mascotaspetshop (SQL Editor; mascotaspetshop no tiene `supabase_migrations.schema_migrations`). |
| `088_indices_foreign_keys.sql` | Índices para las 32 foreign keys sin índice (advisor `unindexed_foreign_keys`). **Pendiente de aplicar** en el demo y en mascotaspetshop. |
| `089_rate_limit_global.sql` | Contador de rate limit compartido entre instancias (`rate_limit_contadores` + `rate_limit_hit`). **Pendiente de aplicar** en el demo y en mascotaspetshop; mientras tanto el middleware usa el contador en memoria. |
| `historico/` | Migraciones anteriores al baseline. Solo referencia (el porqué de cada tabla/función). **No se ejecutan**: no reproducían el esquema real (nombres que no calzan con el historial del demo, 074–084 aplicadas sin registro). |

## Reglas desde el baseline

- **No aplicar `000_baseline.sql` en el demo**: ya tiene todo eso.
- Todo cambio de esquema es un archivo nuevo `NNN_descripcion.sql` con número
  mayor al último usado en `migrations/`, `historico/` y el demo. **El
  siguiente libre es `090`** (la `086` es de sucursales; la `087`, search_path; la `088`, índices de FKs; la `089`, rate limit).
- Se aplica con ese mismo nombre (ej. `apply_migration`), nunca como SQL suelto
  en el editor, para que el historial de cada proyecto calce con el repo.
- Cada tienda registra su última migración aplicada en la tabla de
  `docs/INSTALACION_TIENDA.md` §10.
