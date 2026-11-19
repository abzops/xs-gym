#!/usr/bin/env bash
# Upgrade → rollback → upgrade on a copy shaped like production (pilot gyms with
# real-looking member money), proving that:
#   * no gym, member, membership, payment, charge, allocation, expense or staff row changes;
#   * every existing gym keeps (or gains) write access — nobody is locked out;
#   * a gym that already paid through the old payment link keeps its paid period;
#   * the rollback returns to the previous model and can be re-applied.
# Synthetic data only. Usage: PG_RUN_AS=<non-root user> bash tests/db/migration_safety.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
RUN_AS="${PG_RUN_AS:-$(id -un)}"
PORT="${PG_TEST_PORT:-54331}"
HOME_DIR="$(getent passwd "$RUN_AS" | cut -d: -f6)"
DATA="$(mktemp -d "$HOME_DIR/.xsgym-pgsafety.XXXXXX")"
chown "$RUN_AS" "$DATA"
as_user() { if [ "$(id -un)" = "$RUN_AS" ]; then "$@"; else su "$RUN_AS" -s /bin/bash -c "$(printf '%q ' "$@")"; fi; }
cleanup() { as_user "$PGBIN/pg_ctl" -D "$DATA/db" stop -m fast >/dev/null 2>&1 || true; rm -rf -- "$DATA"; }
trap cleanup EXIT
as_user "$PGBIN/initdb" -D "$DATA/db" -A trust -U postgres >/dev/null
as_user "$PGBIN/pg_ctl" -D "$DATA/db" -o "-k $DATA -p $PORT -c listen_addresses=" -l "$DATA/log" -w start >/dev/null
PSQL=(psql -h "$DATA" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
q() { "${PSQL[@]}" -At -c "$1"; }

NEW=20261119170000_saas_subscriptions.sql
"${PSQL[@]}" -f "$ROOT/tests/db/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  [ "$(basename "$f")" = "$NEW" ] && continue
  "${PSQL[@]}" -f "$f"
done
echo "applied production migrations (without $NEW)"

# --- production-shaped data -------------------------------------------------
"${PSQL[@]}" <<'SQL'
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000101', 'demo@pilot.test'),
  ('00000000-0000-0000-0000-000000000102', 'chaos@pilot.test'),
  ('00000000-0000-0000-0000-000000000103', 'paid@pilot.test'),
  ('00000000-0000-0000-0000-000000000104', 'ended@pilot.test');
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
do $$
declare u uuid; g uuid; m uuid; pl uuid; i int; k text;
begin
  foreach k in array array['101','102','103','104'] loop
    u := ('00000000-0000-0000-0000-000000000' || k)::uuid;
    perform set_config('request.jwt.claim.sub', u::text, true);
    set local role authenticated;
    g := (public.create_gym('Pilot Gym ' || k, '98765' || k || '00')).id;
    pl := (public.save_plan(g, null, 'Monthly', 'month', 1, 100000)).id;
    for i in 1..5 loop
      m := (public.create_member(g, 'Member ' || k || '-' || i, '90000' || k || lpad(i::text, 2, '0'))).id;
      perform public.sell_membership(g, m, pl, gen_random_uuid());
      perform public.record_payment(g, m, 60000 + i * 1000, case when i % 2 = 0 then 'upi' else 'cash' end, gen_random_uuid());
    end loop;
    perform public.record_expense(g, 'Rent', 2500000, current_date, 'bank', gen_random_uuid());
    reset role;
    insert into ids values ('gym' || k, g);
  end loop;
end $$;
-- 101: demo gym, made active for a year by hand (like XS Fitness Studio)
update public.gym_subscriptions set status = 'active', paid_until = now() + interval '1 year' where gym_id = (select v from ids where k = 'gym101');
-- 103: paid ₹499 through the old payment link
insert into public.saas_payments (gym_id, price_code, months, amount_paise, created_by, link_id, mode)
  values ((select v from ids where k = 'gym103'), 'monthly', 1, 49900, '00000000-0000-0000-0000-000000000103', 'plink_old', 'live');
set role service_role;
select public.apply_saas_payment('plink_old', 'pay_old', 49900);
reset role;
-- 104: trial already ended (read-only before the upgrade)
update public.gym_subscriptions set trial_ends_at = now() - interval '2 days' where gym_id = (select v from ids where k = 'gym104');
create table public.zz_ids as select * from ids;
grant select on public.zz_ids to authenticated;
SQL

SNAP="select md5(string_agg(t, '|' order by t)) from (
  select 'g' || id || name || slug || coalesce(phone,'') || status from public.gyms
  union all select 'm' || id || full_name || phone || status || member_no from public.members
  union all select 'mm' || id || start_date || end_date || status from public.member_memberships
  union all select 'p' || id || amount_paise || method from public.payments
  union all select 'c' || id || net_paise || status from public.charges
  union all select 'a' || payment_id || charge_id || amount_paise from public.payment_allocations
  union all select 'e' || id || amount_paise from public.expenses
  union all select 's' || user_id || gym_id || role || status from public.gym_staff
  union all select 'sp' || id || status || amount_paise || coalesce(period_end::text,'') from public.saas_payments) x(t)"
ACCESS="select string_agg(k || '=' || private.can_write(v), ',' order by k) from public.zz_ids"
before_snap=$(q "$SNAP"); before_access=$(q "$ACCESS")
before_paid=$(q "select paid_until from public.gym_subscriptions where gym_id = (select v from public.zz_ids where k = 'gym103')")
echo "before: access $before_access"

fail() { echo "FAIL $1"; exit 1; }
ok() { echo "ok   $1"; }

# --- upgrade ----------------------------------------------------------------
"${PSQL[@]}" -1 -f "$ROOT/supabase/migrations/$NEW"
[ "$(q "$SNAP")" = "$before_snap" ] && ok "upgrade: gym, member, money and staff rows unchanged" || fail "upgrade changed existing rows"
after_access=$(q "$ACCESS")
echo "after upgrade: access $after_access"
[ "$after_access" = "gym101=true,gym102=true,gym103=true,gym104=true" ] && ok "upgrade: every existing gym can write (nobody locked out)" || fail "access after upgrade: $after_access"
[ "$(q "select string_agg(k || '=' || s.state || '/' || v.plan_id || '/' || s.is_pilot, ',' order by k) from public.zz_ids z join public.gym_subscriptions s on s.gym_id = z.v join public.saas_plan_versions v on v.id = s.plan_version_id")" \
  = "gym101=ACTIVE/pilot/true,gym102=ACTIVE/pilot/true,gym103=ACTIVE/launch/false,gym104=ACTIVE/pilot/true" ] \
  && ok "upgrade: pilots grandfathered, paid gym on its launch terms" || fail "grandfathering"
[ "$(q "select current_period_end = '$before_paid'::timestamptz from public.gym_subscriptions where gym_id = (select v from public.zz_ids where k = 'gym103')")" = "t" ] \
  && ok "upgrade: paid period kept exactly" || fail "paid period changed"
[ "$(q "select count(*) from public.gym_subscriptions where complimentary_until = 'infinity' and paid_until is null and status = 'active'")" = "3" ] \
  && ok "upgrade: pilot legacy columns readable by older app builds" || fail "legacy columns"
[ "$(q "select count(*) from public.saas_subscription_events where source = 'migration'")" = "4" ] && ok "upgrade: grandfathering logged per gym" || fail "events"
# pilot gym keeps working: record a member payment as its owner
"${PSQL[@]}" -c "set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', false);
  select public.record_payment((select v from public.zz_ids where k = 'gym102'), (select id from public.members where full_name = 'Member 102-1'), 5000, 'cash', gen_random_uuid());" >/dev/null \
  && ok "upgrade: pilot gym records member payments" || fail "pilot gym cannot record a payment"
# the trial that would have locked on its end date is now complimentary
[ "$(q "select private.can_write((select v from public.zz_ids where k = 'gym102'))")" = "t" ] && ok "upgrade: pilot trial end no longer locks the gym" || fail "pilot trial"
before_snap=$(q "$SNAP")

# --- rollback ----------------------------------------------------------------
"${PSQL[@]}" -1 -f "$ROOT/supabase/rollback/${NEW%.sql}.down.sql"
[ "$(q "$SNAP")" = "$before_snap" ] && ok "rollback: gym, member, money and staff rows unchanged" || fail "rollback changed rows"
[ "$(q "select to_regclass('public.saas_plans') is null and to_regclass('public.saas_prices') is not null")" = "t" ] && ok "rollback: back to the payment-link model" || fail "rollback tables"
[ "$(q "$ACCESS")" = "gym101=true,gym102=true,gym103=true,gym104=true" ] && ok "rollback: nobody locked out" || fail "access after rollback: $(q "$ACCESS")"
[ "$(q "select paid_until = '$before_paid'::timestamptz from public.gym_subscriptions where gym_id = (select v from public.zz_ids where k = 'gym103')")" = "t" ] \
  && ok "rollback: paid gym keeps its paid_until" || fail "paid_until after rollback"
[ "$(q "select prokind from pg_proc where proname = 'gym_analytics' and pronamespace = 'public'::regnamespace")" = "f" ] && ok "rollback: analytics function restored" || fail "analytics"

# --- upgrade again -------------------------------------------------------------
"${PSQL[@]}" -1 -f "$ROOT/supabase/migrations/$NEW"
[ "$(q "$SNAP")" = "$before_snap" ] && ok "re-upgrade: rows unchanged" || fail "re-upgrade changed rows"
[ "$(q "$ACCESS")" = "gym101=true,gym102=true,gym103=true,gym104=true" ] && ok "re-upgrade: nobody locked out" || fail "re-upgrade access"
echo 'MIGRATION SAFETY PASSED'
