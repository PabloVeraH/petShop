#!/usr/bin/env bash
# Corre las pruebas SQL (tests/sql/*.test.sql) contra un Postgres local
# desechable en Docker: baseline + migraciones 087…NNN. Nunca toca Supabase.
# Uso: bash tests/sql/run.sh        (requiere Docker en ejecución)
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../.."
NAME=petshop-sql-test
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test postgres:18-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres -q && break; sleep 1; done
docker cp migrations "$NAME":/tmp/migrations
docker cp tests/sql "$NAME":/tmp/sql
psql_f() { docker exec "$NAME" psql -U postgres -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
psql_f /tmp/sql/00_supabase_prelude.sql
psql_f /tmp/migrations/000_baseline.sql
# 085 (pg_cron) no aplica fuera de Supabase.
for f in $(ls migrations | grep -E '^0(8[6-9]|9[0-9]|[1-9][0-9]{2})_.*\.sql$' | sort); do
  psql_f "/tmp/migrations/$f"
done
for t in tests/sql/*.test.sql; do
  echo "== $t"
  docker exec "$NAME" psql -U postgres -q -v ON_ERROR_STOP=1 -f "/tmp/sql/$(basename "$t")"
done
