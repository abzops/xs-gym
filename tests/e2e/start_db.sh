#!/usr/bin/env bash
# Fresh local Postgres 16 with the Supabase shim, the real migrations and the
# rich demo seed. Runs as user "claude" (Postgres refuses root). Port 54330.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN=/usr/lib/postgresql/16/bin
RUN_AS="${PG_RUN_AS:-claude}"
DATA="$(getent passwd "$RUN_AS" | cut -d: -f6)/.xsgym-e2e"
as_claude() { if [ "$(id -un)" = "$RUN_AS" ]; then "$@"; else su "$RUN_AS" -s /bin/bash -c "$(printf '%q ' "$@")"; fi; }
if [ -d "$DATA" ]; then as_claude "$PGBIN/pg_ctl" -D "$DATA/db" stop -m fast >/dev/null 2>&1 || true; rm -rf -- "$DATA"; fi
mkdir -p "$DATA" && chown "$RUN_AS" "$DATA"
as_claude "$PGBIN/initdb" -D "$DATA/db" -A trust -U postgres >/dev/null
as_claude "$PGBIN/pg_ctl" -D "$DATA/db" -o "-k $DATA -p 54330 -c listen_addresses=127.0.0.1 -c timezone=UTC" -l "$DATA/log" -w start >/dev/null
PSQL=(psql -h 127.0.0.1 -p 54330 -U postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$REPO/tests/db/supabase_shim.sql"
"${PSQL[@]}" -c "create table auth.passwords (user_id uuid primary key references auth.users(id), password text not null);
  create role authenticator noinherit login; grant anon, authenticated to authenticator;"
for f in "$REPO"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -c "insert into auth.users (id, email) values ('94e7afae-e4a3-4f4e-ad93-10b37b5f8f44', 'admin@xelorsoft.com');
  insert into auth.passwords values ('94e7afae-e4a3-4f4e-ad93-10b37b5f8f44', '${DEMO_PASSWORD:-demo-password}');"
"${PSQL[@]}" -f "$REPO/scripts/demo/seed_rich_demo.sql" 2>&1 | grep -v NOTICE || true
# The demo gym is already set up (live, the migration marks existing gyms).
"${PSQL[@]}" -c "update public.gyms set onboarded_at = coalesce(onboarded_at, created_at);"
"${PSQL[@]}" -tc "select 'members ' || count(*) from public.members; select 'payments ' || count(*) from public.payments;"
echo DB READY
