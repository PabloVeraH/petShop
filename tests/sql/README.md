# Pruebas SQL contra la RPC real

Los tests de Jest son mock-first: no ejecutan las funciones de Postgres. Las
pruebas de esta carpeta sí lo hacen, en un **Postgres local desechable**
(Docker, `postgres:18-alpine`) con `000_baseline.sql` y las migraciones
posteriores aplicadas. **Nunca se corren contra Supabase.**

```bash
bash tests/sql/run.sh
```

- `00_supabase_prelude.sql`: lo mínimo de Supabase que el baseline necesita
  (roles `anon`/`authenticated`/`service_role`, esquemas `auth`, `extensions`,
  `storage`). Solo para pruebas.
- `*.test.sql`: cada archivo siembra sus datos dentro de una transacción que
  termina en `ROLLBACK` y usa `ASSERT`; un fallo detiene la corrida con el ID
  de la prueba (`PMX-SQL-NN`, registrados en `docs/spec-registry.md`).

Lo que no cubren: concurrencia entre sesiones. Para la 093 se verificó a mano
(2026-11-12) con dos sesiones `psql` cobrando con la misma NC: la segunda
espera el `FOR UPDATE` de `aplicar_pagos` y falla con `PV003`; queda una sola
fila de pago y el saldo no baja de 0.
