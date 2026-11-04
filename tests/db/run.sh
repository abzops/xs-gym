#!/usr/bin/env bash
# Runs the migrations and database tests on a throwaway local PostgreSQL 16.
# Postgres refuses to run as root, so the cluster runs as a regular user.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
RUN_AS="${PG_RUN_AS:-$(id -un)}"
PORT="${PG_TEST_PORT:-54329}"
HOME_DIR="$(getent passwd "$RUN_AS" | cut -d: -f6)"
DATA="$(mktemp -d "$HOME_DIR/.xsgym-pgtest.XXXXXX")"
chown "$RUN_AS" "$DATA"

as_user() { if [ "$(id -un)" = "$RUN_AS" ]; then "$@"; else su "$RUN_AS" -s /bin/bash -c "$(printf '%q ' "$@")"; fi; }

cleanup() { as_user "$PGBIN/pg_ctl" -D "$DATA/db" stop -m fast >/dev/null 2>&1 || true; rm -rf -- "$DATA"; }
trap cleanup EXIT

as_user "$PGBIN/initdb" -D "$DATA/db" -A trust -U postgres >/dev/null
as_user "$PGBIN/pg_ctl" -D "$DATA/db" -o "-k $DATA -p $PORT -c listen_addresses=" -l "$DATA/log" -w start >/dev/null

PSQL=(psql -h "$DATA" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$ROOT/tests/db/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -f "$ROOT/tests/db/test_core.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
