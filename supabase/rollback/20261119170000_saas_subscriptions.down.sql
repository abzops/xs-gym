-- ROLLBACK for 20261119170000_saas_subscriptions.sql
--
-- Returns the database to the 20261119120153_saas_billing model (one price,
-- payment links) WITHOUT touching gyms, members or member money.
--
-- Before running in production:
--   1. Export what this drops (admin_export: subscriptions, payments, invoices,
--      events) — invoices, subscription events, refunds and plan versions are
--      removed by this script. saas_payments rows stay.
--   2. Take a backup (Supabase dashboard → Database → Backups, or pg_dump).
--   3. Deploy the previous app build first so nothing calls the new functions.
-- Run as the database owner in one transaction:  psql -1 -f this_file.sql
--
-- Access after rollback: the legacy columns (status, paid_until, trial_ends_at)
-- were kept in sync, so the old rule decides again. Pilot gyms keep access
-- (status active, no end date); trials end on their trial date; paid gyms keep
-- their paid_until.

-- 1. Triggers
drop trigger if exists gym_subscriptions_sync_legacy on public.gym_subscriptions;
drop trigger if exists gym_subscriptions_init on public.gym_subscriptions;
drop trigger if exists gym_subscriptions_log_init on public.gym_subscriptions;
drop trigger if exists members_plan_limit on public.members;
drop trigger if exists gym_staff_plan_limit on public.gym_staff;
drop trigger if exists enquiries_entitlement on public.enquiries;

-- 2. Analytics back to the original function
drop function if exists public.gym_analytics(uuid, int);
alter function private.gym_analytics_core(uuid, int) rename to gym_analytics;
alter function private.gym_analytics(uuid, int) set schema public;
revoke execute on function public.gym_analytics(uuid, int) from public, anon;
grant execute on function public.gym_analytics(uuid, int) to authenticated;

-- 3. Original write check (trial / paid_until)
create or replace function private.can_write(p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select g.status = 'active' and (
         (s.status = 'trial'  and now() < s.trial_ends_at)
      or (s.status = 'active' and (s.paid_until is null or now() < s.paid_until)))
    from public.gyms g join public.gym_subscriptions s on s.gym_id = g.id
    where g.id = p_gym), false);
$$;

-- 4. Original payment apply (from 20261119120153_saas_billing)
create or replace function public.apply_saas_payment(p_link_id text, p_payment_id text, p_amount_paise int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p      public.saas_payments;
  s      public.gym_subscriptions;
  v_from timestamptz;
  v_to   timestamptz;
begin
  select * into p from public.saas_payments where link_id = p_link_id for update;
  if not found then
    raise exception 'XS404: payment not found' using errcode = 'P0001';
  end if;
  if p.status = 'paid' then
    return jsonb_build_object('applied', false, 'already', true, 'paid_until', p.period_end, 'gym_id', p.gym_id);
  end if;
  if p_amount_paise is distinct from p.amount_paise then
    raise exception 'XS409: paid amount % does not match %', p_amount_paise, p.amount_paise using errcode = 'P0001';
  end if;

  select * into s from public.gym_subscriptions where gym_id = p.gym_id for update;
  v_from := greatest(now(),
    case when s.status = 'trial' then s.trial_ends_at end,
    case when s.status = 'active' then s.paid_until end);
  v_to := v_from + make_interval(months => p.months);

  update public.gym_subscriptions
     set status = 'active', paid_until = v_to, updated_at = now()
   where gym_id = p.gym_id;
  update public.saas_payments
     set status = 'paid', payment_id = p_payment_id, paid_at = now(), period_start = v_from, period_end = v_to
   where id = p.id;
  perform private.audit(p.gym_id, 'billing.paid', 'saas_payment', p.id,
    jsonb_build_object('amount_paise', p.amount_paise, 'months', p.months, 'mode', p.mode,
                       'payment_id', p_payment_id, 'paid_until', v_to));
  return jsonb_build_object('applied', true, 'already', false, 'paid_until', v_to, 'gym_id', p.gym_id);
end;
$$;
revoke all on function public.apply_saas_payment(text, text, int) from public, anon, authenticated;
grant execute on function public.apply_saas_payment(text, text, int) to service_role;

-- 5. Functions added by the migration
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (
       ('private','platform_role'),('private','require_platform'),('private','admin_log'),('public','is_platform_admin'),
       ('private','saas_settings'),('private','saas_transition_ok'),('private','saas_effective_state'),('private','saas_set_state'),
       ('private','saas_sync_legacy'),('private','normalize_email'),('private','trial_identities'),('private','saas_init_subscription'),
       ('private','saas_log_init'),('private','saas_access'),('private','saas_version'),('private','entitled'),
       ('private','active_member_count'),('private','active_staff_count'),('private','enforce_member_limit'),
       ('private','enforce_staff_limit'),('private','enforce_enquiries_entitlement'),('public','gym_entitlements'),
       ('private','fy_label'),('private','saas_tax'),('private','saas_gross'),('private','saas_issue_invoice'),
       ('public','prepare_saas_checkout'),('private','require_billing'),('public','schedule_plan_change'),
       ('public','cancel_plan_change'),('public','cancel_subscription'),('public','resume_subscription'),
       ('public','save_billing_profile'),('private','ts'),('private','process_gateway_event'),('private','saas_refresh_refunds'),
       ('public','ingest_gateway_event'),('public','billing_tick'),('public','public_pricing'),('private','monthly_value'),
       ('private','paying_subscriptions'),('public','admin_commercial_metrics'),('public','admin_overview'),
       ('public','admin_subscriptions'),('public','admin_gym_billing'),('private','admin_sub_snapshot'),('private','require_reason'),
       ('public','admin_extend_trial'),('public','admin_grant_complimentary'),('public','admin_end_complimentary'),
       ('public','admin_set_plan'),('public','admin_set_state'),('public','admin_list_plan_versions'),
       ('public','admin_save_plan_version'),('public','admin_activate_plan_version'),('public','admin_update_billing_settings'),
       ('public','admin_get_settings'),('public','admin_save_cost_model'),('public','admin_record_refund'),
       ('public','admin_audit_log'),('public','admin_export'))
  loop
    execute 'drop function ' || r.sig || ' cascade';
  end loop;
end $$;

-- 6. Columns (legacy columns already hold the right values)
drop policy if exists saas_plan_versions_read on public.saas_plan_versions;
alter table public.gym_subscriptions
  drop column state, drop column plan_version_id, drop column billing_cycle, drop column current_period_start,
  drop column current_period_end, drop column past_due_since, drop column grace_ends_at, drop column canceled_at,
  drop column cancel_effective_at, drop column cancel_reason, drop column cancel_from_state, drop column pending_plan_version_id,
  drop column pending_cycle, drop column complimentary_until, drop column complimentary_reason, drop column is_pilot,
  drop column trial_eligible;
alter table public.saas_payments
  drop column plan_version_id, drop column billing_cycle, drop column kind, drop column list_price_paise, drop column credit_paise,
  drop column tax_paise, drop column refunded_paise, drop column failure_reason, drop column failed_at, drop column grants_access;

-- 7. Tables
drop table public.saas_invoices, public.saas_invoice_counters, public.saas_refunds, public.saas_disputes,
  public.saas_payment_attempts, public.saas_gateway_events, public.saas_notifications, public.saas_billing_profiles,
  public.saas_trial_registry, public.saas_subscription_events, public.saas_admin_audit, public.platform_admins,
  public.saas_billing_settings, public.saas_cost_model, public.saas_addons, public.saas_plan_versions, public.saas_plans,
  public.saas_features;

-- 8. Migration history (only on Supabase)
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '20261119170000';
  end if;
end $$;
