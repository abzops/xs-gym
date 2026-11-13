#!/usr/bin/env bash
# Isolated recovery drill: ONLY local PostgreSQL and synthetic test fixtures.
# Never accepts a production connection string, project ref, access token, or
# customer data. Runs inside a throwaway cluster and deletes all drill files.
set -euo pipefail

if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" || -n "${DATABASE_URL:-}" || -n "${PGHOST:-}" || -n "${PGPASSWORD:-}" ]]; then
  echo "REFUSE: remote database/privileged environment variables are set" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
RUN_AS="${PG_RUN_AS:-$(id -un)}"
RUN_HOME="$(getent passwd "$RUN_AS" | cut -d: -f6)"
PORT="${PILOT_RESTORE_PORT:-54338}"
DATA="$(mktemp -d "$RUN_HOME/.xsgym-synthetic-restore.XXXXXX")"
chown "$RUN_AS" "$DATA"

as_user() {
  if [[ "$(id -un)" == "$RUN_AS" ]]; then "$@"
  else su "$RUN_AS" -s /bin/bash -c "$(printf '%q ' "$@")"
  fi
}
cleanup() {
  as_user "$PGBIN/pg_ctl" -D "$DATA/db" stop -m fast >/dev/null 2>&1 || true
  rm -rf -- "$DATA"
}
trap cleanup EXIT

as_user "$PGBIN/initdb" -D "$DATA/db" -A trust -U postgres >/dev/null
as_user "$PGBIN/pg_ctl" -D "$DATA/db" -o "-k $DATA -p $PORT -c listen_addresses=" -l "$DATA/log" -w start >/dev/null

PSQL=(psql -h "$DATA" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$ROOT/tests/db/supabase_shim.sql" >/dev/null
for migration in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$migration" >/dev/null
done
# Existing tests create two dummy gyms and fake members/payments/roles.
"${PSQL[@]}" -f "$ROOT/tests/db/test_core.sql" >/dev/null 2>&1

# Dump and restore local disposable data only. No real customer backup, no
# remote network connection, no cloud token and no artifact upload.
pg_dump -h "$DATA" -p "$PORT" -U postgres -d postgres -Fc -f "$DATA/synthetic.dump"
# A purely synthetic, ephemeral encryption and tamper-detection exercise.
# The key is never written; production key escrow/off-site backup remains blocked.
node "$ROOT/tests/db/synthetic_backup_crypto.mjs" "$DATA/synthetic.dump" "$DATA/synthetic.dump.aesgcm" "$DATA/restored.dump"
rm -f "$DATA/synthetic.dump"
createdb -h "$DATA" -p "$PORT" -U postgres --template=template0 pilot_restored
pg_restore --exit-on-error -h "$DATA" -p "$PORT" -U postgres -d pilot_restored "$DATA/restored.dump" >/dev/null

CHECKS="select jsonb_build_object(
 'gym_count',(select count(*) from public.gyms),
 'member_count',(select count(*) from public.members),
 'membership_count',(select count(*) from public.member_memberships),
 'payment_count',(select count(*) from public.payments),
 'payment_total_paise',(select coalesce(sum(amount_paise),0) from public.payments),
 'charge_count',(select count(*) from public.charges),
 'charge_total_paise',(select coalesce(sum(net_paise),0) from public.charges),
 'allocations',(select count(*) from public.payment_allocations),
 'audit_count',(select count(*) from public.audit_logs),
 'auth_users',(select count(*) from auth.users),
 'rls_tables',(select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relrowsecurity),
 'anon_payment_execute',has_function_privilege('anon','public.record_payment(uuid,uuid,bigint,text,uuid,text,text)','EXECUTE')
)::text"
before=$("${PSQL[@]}" -d postgres -At -c "$CHECKS")
after=$("${PSQL[@]}" -d pilot_restored -At -c "$CHECKS")
if [[ "$before" != "$after" ]]; then
  echo "FAIL: synthetic restored database does not match source (aggregate/ACL mismatch)" >&2
  exit 1
fi
gym_count=$("${PSQL[@]}" -d pilot_restored -At -c 'select count(*) from public.gyms')
if [[ "$gym_count" != "2" ]]; then
  echo "FAIL: restored synthetic environment lacks two independent tenants" >&2
  exit 1
fi
echo "PASS: synthetic dump restored to disposable database; balances, records and RLS metadata match."
echo "PASS: test data only; no production connection or customer-data export."
