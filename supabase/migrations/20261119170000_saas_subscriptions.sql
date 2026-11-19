-- XS Gym as a commercial SaaS: plans, versioned prices, subscription states,
-- entitlements, invoices, gateway event ledger, Xelorsoft admin and cost model.
--
-- Builds on 20261119120153_saas_billing (Razorpay payment links). Payment links
-- stay the checkout rail: each payment buys one prepaid period (1 or 12 months).
-- Renewal = paying the next period before the current one ends.
--
-- Rules this migration keeps:
-- * Xelorsoft's SaaS money (saas_*) is never mixed with a gym's member money
--   (payments, charges, allocations). No existing gym table row is changed except
--   gym_subscriptions, which gains columns; its old columns stay in sync.
-- * Every gym that exists when this runs is grandfathered: pilots get the
--   hidden "pilot" plan (everything, no limits) as complimentary access with
--   no end date until a Xelorsoft owner sets one. Nobody is locked out.
-- * Prices for Starter / Growth / Pro are DRAFT and PROVISIONAL. They are shown
--   as provisional and can only be bought in Razorpay test mode until a
--   Xelorsoft owner activates a version (admin_activate_plan_version).
-- * A paid period is only granted by the server after Razorpay confirms the
--   payment (apply_saas_payment, service role only).
-- * Expiry never deletes data; it makes the gym read-only (configurable).
--
-- Reverse with supabase/rollback/20261119170000_saas_subscriptions.down.sql.

-- ===========================================================================
-- 1. Catalogue: features, plans, versioned prices, add-ons, settings
-- ===========================================================================
create table public.saas_features (
  key         text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  label       text not null check (length(label) between 2 and 80),
  description text,
  gated       boolean not null default false,   -- enforced by the server when false in a plan
  available   boolean not null default true,    -- false = not built yet ("coming soon")
  sort        int not null default 0
);
insert into public.saas_features (key, label, description, gated, available, sort) values
  ('core_operations',   'Members, plans, renewals, payments and receipts', 'Front-desk essentials for one gym', false, true, 1),
  ('expenses',          'Expenses and daily collection report', 'Cash and UPI totals, expense categories', false, true, 2),
  ('dues_reminders',    'Dues and expiry lists with WhatsApp reminders', 'English and Malayalam messages, sent from your phone', false, true, 3),
  ('csv_import_export', 'Import members from Excel and export your data', 'CSV import with checks, CSV export', false, true, 4),
  ('membership_pause',  'Pause memberships and edit dates', 'Freeze for travel or injury; audited date changes', false, true, 5),
  ('staff_logins',      'Staff logins with roles', 'Reception, trainer and manager access', false, true, 6),
  ('analytics',         'Analytics', 'Revenue, profit, renewals, churn and charts', true, true, 7),
  ('enquiries',         'Enquiries (leads) with follow-ups', 'Walk-in and Instagram leads, follow-up dates', true, true, 8),
  ('xs_ai',             'XS AI assistant', 'Ask and act by voice or text in Malayalam or English (fair use)', true, true, 9),
  ('priority_support',  'Priority WhatsApp support', 'Faster replies from the Xelorsoft team', false, true, 10),
  ('multi_branch',      'Several branches under one account', 'Planned; not available yet', false, false, 11),
  ('auto_whatsapp',     'Automatic WhatsApp reminders', 'Planned; needs WhatsApp Business API', false, false, 12);

create table public.saas_plans (
  id           text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  display_name text not null check (length(display_name) between 2 and 40),
  tagline      text,
  rank         int  not null,                    -- higher = more features (upgrade direction)
  is_public    boolean not null default true,    -- false = not sold (pilot, launch)
  is_active    boolean not null default true,
  sort         int  not null default 0,
  created_at   timestamptz not null default now()
);
insert into public.saas_plans (id, display_name, tagline, rank, is_public, sort) values
  ('starter', 'Starter', 'Everything a single gym needs at the front desk', 1, true, 1),
  ('growth',  'Growth',  'Analytics, leads and XS AI for a growing gym', 2, true, 2),
  ('pro',     'Pro',     'No member limit, more staff and priority support', 3, true, 3),
  ('launch',  'XS Gym (launch price)', 'Single plan sold before tiers existed', 2, false, 90),
  ('pilot',   'Pilot', 'Complimentary plan for pilot gyms', 4, false, 99);

create table public.saas_plan_versions (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             text not null references public.saas_plans (id),
  version             int  not null check (version > 0),
  currency            text not null default 'INR' check (currency = 'INR'),
  monthly_price_paise int  check (monthly_price_paise >= 100),
  annual_price_paise  int  check (annual_price_paise >= 100),
  trial_days          int  not null default 30 check (trial_days between 0 and 90),
  features            jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  member_limit        int  check (member_limit > 0),       -- null = no limit
  staff_limit         int  check (staff_limit >= 0),       -- active non-owner staff; null = no limit
  branch_limit        int  not null default 1 check (branch_limit > 0),
  addons_allowed      text[] not null default '{}',
  status              text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  provisional         boolean not null default true,
  effective_from      timestamptz,
  effective_to        timestamptz,
  notes               text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  approved_by         uuid,
  approved_at         timestamptz,
  unique (plan_id, version)
);
create unique index saas_plan_versions_one_active on public.saas_plan_versions (plan_id) where status = 'active';

-- PROVISIONAL suggestions only (docs/BILLING.md §Pricing). Draft = not for sale live.
insert into public.saas_plan_versions
  (plan_id, version, monthly_price_paise, annual_price_paise, trial_days, features, member_limit, staff_limit, branch_limit, addons_allowed, status, provisional, notes)
values
  ('starter', 1,  49900,  499000, 30, '{"analytics":false,"enquiries":false,"xs_ai":false,"priority_support":false}', 200,  2,  1, '{}',
   'draft', true, 'Provisional suggestion pending founder approval'),
  ('growth',  1,  99900,  999000, 30, '{"analytics":true,"enquiries":true,"xs_ai":true,"priority_support":false}',   1000, 6,  1, '{}',
   'draft', true, 'Provisional suggestion pending founder approval'),
  ('pro',     1, 199900, 1999000, 30, '{"analytics":true,"enquiries":true,"xs_ai":true,"priority_support":true}',    null, 20, 1, '{extra_branch}',
   'draft', true, 'Provisional suggestion pending founder approval. Multi-branch is not built yet.'),
  ('pilot',   1, null, null, 0, '{"analytics":true,"enquiries":true,"xs_ai":true,"priority_support":true}', null, null, 1, '{}',
   'active', false, 'Complimentary pilot access; never sold');

-- The single price already live (saas_prices) becomes the hidden "launch" plan so
-- anyone who paid it keeps exactly those terms: every feature, no limits.
insert into public.saas_plan_versions
  (plan_id, version, monthly_price_paise, annual_price_paise, trial_days, features, member_limit, staff_limit, status, provisional, effective_from, notes)
select 'launch', 1,
       (select amount_paise from public.saas_prices where code = 'monthly'),
       (select amount_paise from public.saas_prices where code = 'yearly'),
       30, '{"analytics":true,"enquiries":true,"xs_ai":true,"priority_support":false}', null, null, 'active', false, now(),
       'Copied from saas_prices when tiers were introduced';

create table public.saas_addons (
  code                text primary key check (code ~ '^[a-z0-9_]{2,30}$'),
  label               text not null,
  description         text,
  monthly_price_paise int check (monthly_price_paise >= 100),
  status              text not null default 'planned' check (status in ('planned', 'available', 'retired'))
);
insert into public.saas_addons (code, label, description) values
  ('extra_branch', 'Extra branch', 'Another location under the same account (planned)'),
  ('auto_whatsapp', 'Automatic WhatsApp reminders', 'Sent daily through WhatsApp Business (planned)');

create table public.saas_billing_settings (
  id                         boolean primary key default true check (id),
  default_trial_days         int  not null default 30 check (default_trial_days between 0 and 90),
  trial_plan_id              text not null default 'pro' references public.saas_plans (id),
  past_due_days              int  not null default 3 check (past_due_days between 0 and 30),
  grace_days                 int  not null default 7 check (grace_days between 0 and 30),
  expired_access             text not null default 'read_only' check (expired_access in ('read_only', 'billing_only')),
  test_payments_grant_access boolean not null default false,  -- true only in test/staging databases
  allow_provisional_checkout boolean not null default true,   -- provisional prices: Razorpay TEST mode only
  gst_status                 text not null default 'unconfirmed' check (gst_status in ('unconfirmed', 'registered', 'not_registered')),
  gstin                      text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  gst_rate_bp                int  not null default 1800 check (gst_rate_bp between 0 and 2800),
  prices_include_gst         boolean not null default true,
  sac_code                   text,
  legal_name                 text not null default 'Xelorsoft',
  supplier_address           text,
  supplier_state_code        text not null default '32' check (supplier_state_code ~ '^[0-9]{2}$'),
  support_email              text not null default 'billing@xelorsoft.com',
  invoice_prefix             text not null default 'XS' check (invoice_prefix ~ '^[A-Z0-9-]{1,10}$'),
  payment_terms              text not null default
    'Plans are prepaid for one month or one year. Nothing renews or is charged automatically: you pay for the next period when you choose. There are no setup fees or hidden charges. If a period ends unpaid, you keep full access for a short grace period; after that your data stays safe and readable, and changes resume as soon as you pay. Payments are not refundable once a period has started, except where the law requires.',
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid
);
insert into public.saas_billing_settings default values;

-- ===========================================================================
-- 2. Xelorsoft platform admins and their audit trail
-- ===========================================================================
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id),
  role       text not null check (role in ('owner', 'admin', 'viewer')),
  added_by   uuid,
  created_at timestamptz not null default now()
);
create table public.saas_admin_audit (
  id          bigint generated always as identity primary key,
  actor       uuid,
  action      text not null,
  target_type text,
  target_id   text,
  reason      text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create trigger saas_admin_audit_immutable before update or delete on public.saas_admin_audit
  for each row execute function private.reject_change();

create function private.platform_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.platform_admins where user_id = auth.uid();
$$;

-- p_min: 'viewer' (read), 'admin' (customer changes), 'owner' (prices, settings)
create function private.require_platform(p_min text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_role text := private.platform_role();
begin
  if auth.uid() is null then raise exception 'XS401: sign in required' using errcode = '42501'; end if;
  if v_role is null
     or (p_min = 'admin' and v_role not in ('owner', 'admin'))
     or (p_min = 'owner' and v_role <> 'owner') then
    raise exception 'XS403: Xelorsoft admin access required' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

create function private.admin_log(p_action text, p_type text, p_id text, p_reason text, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.saas_admin_audit (actor, action, target_type, target_id, reason, before, after)
  values (auth.uid(), p_action, p_type, p_id, p_reason, p_before, p_after);
$$;

create function public.is_platform_admin()
returns text language sql stable security definer set search_path = '' as $$
  select private.platform_role();
$$;

-- ===========================================================================
-- 3. Subscriptions: new columns on gym_subscriptions + state machine
-- ===========================================================================
alter table public.gym_subscriptions drop constraint gym_subscriptions_plan_check;
alter table public.gym_subscriptions add constraint gym_subscriptions_plan_check
  check (plan in ('starter', 'growth', 'max', 'pro', 'launch', 'pilot'));

alter table public.gym_subscriptions
  add column state                  text check (state in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELED', 'EXPIRED')),
  add column plan_version_id        uuid references public.saas_plan_versions (id),
  add column billing_cycle          text check (billing_cycle in ('monthly', 'annual')),
  add column current_period_start   timestamptz,
  add column current_period_end     timestamptz,
  add column past_due_since         timestamptz,
  add column grace_ends_at          timestamptz,
  add column canceled_at            timestamptz,
  add column cancel_effective_at    timestamptz,
  add column cancel_reason          text,
  add column cancel_from_state      text,
  add column pending_plan_version_id uuid references public.saas_plan_versions (id),
  add column pending_cycle          text check (pending_cycle in ('monthly', 'annual')),
  add column complimentary_until    timestamptz,
  add column complimentary_reason   text,
  add column is_pilot               boolean not null default false,
  add column trial_eligible         boolean not null default true;

create table public.saas_subscription_events (
  id         bigint generated always as identity primary key,
  gym_id     uuid not null references public.gyms (id),
  event      text not null,
  from_state text,
  to_state   text,
  source     text not null check (source in ('system', 'owner', 'admin', 'gateway', 'migration', 'tick')),
  actor      uuid,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index saas_subscription_events_gym_idx on public.saas_subscription_events (gym_id, id desc);
create trigger saas_subscription_events_immutable before update or delete on public.saas_subscription_events
  for each row execute function private.reject_change();

create function private.saas_settings()
returns public.saas_billing_settings language sql stable security definer set search_path = '' as $$
  select * from public.saas_billing_settings where id;
$$;

create function private.saas_transition_ok(p_from text, p_to text)
returns boolean language sql immutable set search_path = '' as $$
  select p_from is null or (p_from, p_to) in (
    ('TRIALING', 'ACTIVE'), ('TRIALING', 'CANCELED'), ('TRIALING', 'EXPIRED'),
    ('ACTIVE', 'PAST_DUE'), ('ACTIVE', 'GRACE_PERIOD'), ('ACTIVE', 'CANCELED'), ('ACTIVE', 'EXPIRED'),
    ('PAST_DUE', 'ACTIVE'), ('PAST_DUE', 'GRACE_PERIOD'), ('PAST_DUE', 'CANCELED'), ('PAST_DUE', 'EXPIRED'),
    ('GRACE_PERIOD', 'ACTIVE'), ('GRACE_PERIOD', 'CANCELED'), ('GRACE_PERIOD', 'EXPIRED'),
    ('CANCELED', 'ACTIVE'), ('CANCELED', 'TRIALING'), ('CANCELED', 'EXPIRED'),
    ('EXPIRED', 'ACTIVE'), ('EXPIRED', 'TRIALING'));
$$;

-- What the state is right now, counting time that has passed since it was stored.
create function private.saas_effective_state(s public.gym_subscriptions)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  cfg public.saas_billing_settings := private.saas_settings();
  v_end timestamptz;
begin
  if s.state is null then return null; end if;
  if s.complimentary_until is not null and now() < s.complimentary_until then return 'ACTIVE'; end if;
  case s.state
    when 'TRIALING' then
      return case when now() < s.trial_ends_at then 'TRIALING' else 'EXPIRED' end;
    when 'ACTIVE', 'PAST_DUE' then
      v_end := s.current_period_end;
      if v_end is null or now() < v_end then return 'ACTIVE'; end if;
      if now() < v_end + make_interval(days => cfg.past_due_days) then return 'PAST_DUE'; end if;
      if now() < v_end + make_interval(days => cfg.past_due_days + cfg.grace_days) then return 'GRACE_PERIOD'; end if;
      return 'EXPIRED';
    when 'GRACE_PERIOD' then
      return case when s.grace_ends_at is not null and now() < s.grace_ends_at then 'GRACE_PERIOD' else 'EXPIRED' end;
    when 'CANCELED' then
      return case when s.cancel_effective_at is not null and now() < s.cancel_effective_at then 'CANCELED' else 'EXPIRED' end;
    else
      return 'EXPIRED';
  end case;
end;
$$;

-- Moves a subscription to a new state, validating the transition and logging it.
-- Same state = event only (e.g. a renewal while ACTIVE).
create function private.saas_set_state(p_gym uuid, p_to text, p_event text, p_source text, p_details jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare v_from text;
begin
  select state into v_from from public.gym_subscriptions where gym_id = p_gym for update;
  if p_to is distinct from v_from and not private.saas_transition_ok(v_from, p_to) then
    raise exception 'XS409: subscription cannot go from % to %', v_from, p_to using errcode = 'P0001';
  end if;
  if p_to is distinct from v_from then
    update public.gym_subscriptions set state = p_to, updated_at = now() where gym_id = p_gym;
  end if;
  insert into public.saas_subscription_events (gym_id, event, from_state, to_state, source, actor, details)
  values (p_gym, p_event, v_from, p_to, p_source, auth.uid(), coalesce(p_details, '{}'::jsonb));
  return p_to;
end;
$$;

-- Keeps the original columns (status, plan, paid_until) meaningful for older app
-- builds and for rollback: they are derived from the new state on every write.
create function private.saas_sync_legacy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_plan text;
begin
  if new.state is null then return new; end if;
  -- A hand edit of the old columns (support scripts, older tools) is translated
  -- into the new model instead of being silently overwritten.
  if tg_op = 'UPDATE' and new.state is not distinct from old.state
     and new.current_period_end is not distinct from old.current_period_end
     and new.complimentary_until is not distinct from old.complimentary_until
     and (new.status is distinct from old.status or new.paid_until is distinct from old.paid_until) then
    if new.status = 'active' then
      new.state := 'ACTIVE';
      new.complimentary_until := coalesce(new.paid_until, 'infinity');
      new.complimentary_reason := 'Set by hand on the legacy columns';
      new.current_period_start := coalesce(new.current_period_start, now());
      new.current_period_end := new.paid_until;
    elsif new.status = 'trial' then
      new.state := 'TRIALING';
    elsif new.status = 'suspended' then
      new.state := 'EXPIRED';
      new.complimentary_until := null;
      new.current_period_end := least(coalesce(new.current_period_end, now()), now());
    end if;
    insert into public.saas_subscription_events (gym_id, event, from_state, to_state, source, actor, details)
    values (new.gym_id, 'legacy.edit', old.state, new.state, 'system', auth.uid(),
            jsonb_build_object('status', new.status, 'paid_until', new.paid_until));
  end if;
  new.status := case new.state when 'TRIALING' then 'trial' when 'EXPIRED' then 'suspended' else 'active' end;
  select plan_id into v_plan from public.saas_plan_versions where id = new.plan_version_id;
  if v_plan is not null then new.plan := v_plan; end if;
  new.paid_until := case
    when new.state = 'TRIALING' then null
    when new.complimentary_until = 'infinity'::timestamptz then null
    when new.complimentary_until is not null and new.complimentary_until > coalesce(new.current_period_end, '-infinity') then new.complimentary_until
    when new.state = 'CANCELED' then new.cancel_effective_at
    when new.state = 'GRACE_PERIOD' then new.grace_ends_at
    when new.state = 'EXPIRED' then coalesce(new.current_period_end, new.trial_ends_at, now())
    else new.current_period_end end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trial once per customer: owner email (normalised) and gym phone.
-- ---------------------------------------------------------------------------
create table public.saas_trial_registry (
  identity   text primary key,           -- sha256 of kind:value
  kind       text not null check (kind in ('email', 'phone')),
  gym_id     uuid not null references public.gyms (id),
  created_at timestamptz not null default now()
);

create function private.normalize_email(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p is null or position('@' in p) = 0 then null
    when split_part(lower(btrim(p)), '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(btrim(p)), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else split_part(split_part(lower(btrim(p)), '@', 1), '+', 1) || '@' || split_part(lower(btrim(p)), '@', 2) end;
$$;

create function private.trial_identities(p_gym uuid)
returns table (identity text, kind text) language sql stable security definer set search_path = '' as $$
  select encode(sha256(convert_to('email:' || private.normalize_email(u.email), 'UTF8')), 'hex'), 'email'
    from public.gyms g join auth.users u on u.id = g.created_by
   where g.id = p_gym and private.normalize_email(u.email) is not null
  union all
  select encode(sha256(convert_to('phone:' || private.normalize_phone(g.phone), 'UTF8')), 'hex'), 'phone'
    from public.gyms g
   where g.id = p_gym and g.phone is not null and private.normalize_phone(g.phone) is not null;
$$;

-- New gyms (create_gym inserts the row): start the trial, or refuse it when this
-- email or phone already had one.
create function private.saas_init_subscription()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cfg     public.saas_billing_settings := private.saas_settings();
  v_trial uuid;
  v_used  boolean;
begin
  if new.state is not null then return new; end if;
  select exists (select 1 from private.trial_identities(new.gym_id) i join public.saas_trial_registry r on r.identity = i.identity)
    into v_used;
  select id into v_trial from public.saas_plan_versions
   where plan_id = cfg.trial_plan_id order by (status = 'active') desc, version desc limit 1;
  new.plan_version_id := v_trial;
  if v_used or cfg.default_trial_days = 0 then
    new.state := 'EXPIRED';
    new.trial_eligible := false;
    new.trial_started_at := null;
    new.trial_ends_at := null;
  else
    new.state := 'TRIALING';
    new.trial_started_at := now();
    new.trial_ends_at := now() + make_interval(days => cfg.default_trial_days);
    insert into public.saas_trial_registry (identity, kind, gym_id)
    select i.identity, i.kind, new.gym_id from private.trial_identities(new.gym_id) i
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create function private.saas_log_init()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.saas_subscription_events (gym_id, event, from_state, to_state, source, actor, details)
  values (new.gym_id, case when new.state = 'TRIALING' then 'trial.started' else 'trial.refused' end, null, new.state, 'system', auth.uid(),
          jsonb_build_object('trial_ends_at', new.trial_ends_at, 'reason', case when new.state = 'TRIALING' then null else 'free trial already used by this email or phone' end));
  return new;
end;
$$;

-- ===========================================================================
-- 4. Grandfather every gym that exists now (before the triggers are on)
-- ===========================================================================
update public.gym_subscriptions s set
  state = 'ACTIVE',
  plan_version_id = (select id from public.saas_plan_versions where plan_id = 'launch' and version = 1),
  billing_cycle = case when lp.months >= 12 then 'annual' else 'monthly' end,
  current_period_start = lp.period_start,
  current_period_end = s.paid_until,
  trial_eligible = false
from (select distinct on (gym_id) gym_id, months, period_start from public.saas_payments
       where status = 'paid' order by gym_id, paid_at desc) lp
where lp.gym_id = s.gym_id and s.paid_until is not null;

update public.gym_subscriptions s set
  state = 'ACTIVE',
  plan_version_id = (select id from public.saas_plan_versions where plan_id = 'pilot' and version = 1),
  is_pilot = true,
  trial_eligible = false,
  complimentary_until = 'infinity',
  complimentary_reason = 'Pilot gym before subscriptions existed: complimentary until Xelorsoft sets an end date with notice'
where s.state is null;

insert into public.saas_trial_registry (identity, kind, gym_id)
select i.identity, i.kind, g.id from public.gyms g cross join lateral private.trial_identities(g.id) i
on conflict do nothing;

insert into public.saas_subscription_events (gym_id, event, from_state, to_state, source, details)
select gym_id, case when is_pilot then 'pilot.grandfathered' else 'launch.grandfathered' end, null, state, 'migration',
       jsonb_build_object('legacy_status', status, 'legacy_paid_until', paid_until, 'trial_ends_at', trial_ends_at)
from public.gym_subscriptions;

create trigger gym_subscriptions_sync_legacy before insert or update on public.gym_subscriptions
  for each row execute function private.saas_sync_legacy();
-- Runs before the legacy sync (trigger names fire in alphabetical order).
create trigger gym_subscriptions_init before insert on public.gym_subscriptions
  for each row execute function private.saas_init_subscription();
create trigger gym_subscriptions_log_init after insert on public.gym_subscriptions
  for each row execute function private.saas_log_init();
update public.gym_subscriptions set updated_at = updated_at;  -- fill legacy columns once

-- ===========================================================================
-- 5. Access and entitlements
-- ===========================================================================
create function private.saas_access(p_gym uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare s public.gym_subscriptions; v text;
begin
  select * into s from public.gym_subscriptions where gym_id = p_gym;
  if not found then return 'read_only'; end if;
  v := private.saas_effective_state(s);
  if v in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELED') then return 'full'; end if;
  return (private.saas_settings()).expired_access;
end;
$$;

-- Replaces the trial/paid_until check: every command function calls this
-- through private.require, so the new states apply everywhere at once.
create or replace function private.can_write(p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select g.status = 'active' from public.gyms g where g.id = p_gym), false)
     and private.saas_access(p_gym) = 'full';
$$;

create function private.saas_version(p_gym uuid)
returns public.saas_plan_versions language sql stable security definer set search_path = '' as $$
  select v.* from public.gym_subscriptions s join public.saas_plan_versions v on v.id = s.plan_version_id where s.gym_id = p_gym;
$$;

create function private.entitled(p_gym uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(((private.saas_version(p_gym)).features ->> p_feature)::boolean, false);
$$;

create function private.active_member_count(p_gym uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.members where gym_id = p_gym and status = 'active';
$$;
create function private.active_staff_count(p_gym uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.gym_staff where gym_id = p_gym and status = 'active' and role <> 'owner';
$$;

create function private.enforce_member_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit int := (private.saas_version(new.gym_id)).member_limit;
begin
  if new.status <> 'active' or v_limit is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' then return new; end if;
  if private.active_member_count(new.gym_id) >= v_limit then
    raise exception 'XS402: your XS Gym plan allows % active members. Upgrade in Settings → Subscription to add more.', v_limit
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger members_plan_limit before insert or update of status on public.members
  for each row execute function private.enforce_member_limit();

create function private.enforce_staff_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit int := (private.saas_version(new.gym_id)).staff_limit;
begin
  if new.status <> 'active' or new.role = 'owner' or v_limit is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.role <> 'owner' then return new; end if;
  if private.active_staff_count(new.gym_id) >= v_limit then
    raise exception 'XS402: your XS Gym plan allows % staff logins. Upgrade in Settings → Subscription to add more.', v_limit
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger gym_staff_plan_limit before insert or update of status, role on public.gym_staff
  for each row execute function private.enforce_staff_limit();

create function private.enforce_enquiries_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.entitled(new.gym_id, 'enquiries') then
    raise exception 'XS402: Enquiries are part of the Growth and Pro plans. Upgrade in Settings → Subscription.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger enquiries_entitlement before insert on public.enquiries
  for each row execute function private.enforce_enquiries_entitlement();

-- Analytics: the original function moves to private; the public one checks the plan first.
alter function public.gym_analytics(uuid, int) set schema private;
alter function private.gym_analytics(uuid, int) rename to gym_analytics_core;
revoke all on function private.gym_analytics_core(uuid, int) from public, anon, authenticated;
create function public.gym_analytics(p_gym uuid, p_months int default 6)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.entitled(p_gym, 'analytics') then
    raise exception 'XS402: Analytics is part of the Growth and Pro plans. Upgrade in Settings → Subscription.' using errcode = 'P0001';
  end if;
  return private.gym_analytics_core(p_gym, p_months);
end;
$$;
revoke all on function public.gym_analytics(uuid, int) from public, anon;
grant execute on function public.gym_analytics(uuid, int) to authenticated;

-- What a gym's staff see about the subscription (UI hints; the server enforces).
create function public.gym_entitlements(p_gym uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s   public.gym_subscriptions;
  v   public.saas_plan_versions;
  pv  public.saas_plan_versions;
  cfg public.saas_billing_settings := private.saas_settings();
  eff text;
begin
  if not private.is_staff(p_gym) and private.platform_role() is null then
    raise exception 'XS403: you do not have permission to do this' using errcode = '42501';
  end if;
  select * into s from public.gym_subscriptions where gym_id = p_gym;
  if not found then return null; end if;
  select * into v from public.saas_plan_versions where id = s.plan_version_id;
  select * into pv from public.saas_plan_versions where id = s.pending_plan_version_id;
  eff := private.saas_effective_state(s);
  return jsonb_build_object(
    'state', s.state, 'effective_state', eff, 'access', private.saas_access(p_gym),
    'can_write', private.can_write(p_gym),
    'plan_id', v.plan_id, 'plan_name', (select display_name from public.saas_plans where id = v.plan_id),
    'plan_version_id', v.id, 'plan_version', v.version, 'provisional', v.provisional,
    'features', v.features,
    'limits', jsonb_build_object('members', v.member_limit, 'staff', v.staff_limit, 'branches', v.branch_limit),
    'usage', jsonb_build_object('members', private.active_member_count(p_gym), 'staff', private.active_staff_count(p_gym)),
    'billing_cycle', s.billing_cycle,
    'trial_started_at', s.trial_started_at, 'trial_ends_at', s.trial_ends_at, 'trial_eligible', s.trial_eligible,
    'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
    'past_due_since', case when eff in ('PAST_DUE', 'GRACE_PERIOD') then coalesce(s.past_due_since, s.current_period_end) end,
    'grace_ends_at', case when eff in ('PAST_DUE', 'GRACE_PERIOD')
      then coalesce(s.grace_ends_at, s.current_period_end + make_interval(days => cfg.past_due_days + cfg.grace_days)) end,
    'cancel_effective_at', s.cancel_effective_at, 'canceled_at', s.canceled_at,
    'pending_plan_id', pv.plan_id, 'pending_cycle', s.pending_cycle,
    'complimentary_until', s.complimentary_until, 'is_pilot', s.is_pilot,
    'expired_access', cfg.expired_access);
end;
$$;
revoke all on function public.gym_entitlements(uuid) from public, anon;
grant execute on function public.gym_entitlements(uuid) to authenticated;

-- ===========================================================================
-- 6. Customer billing details, payments, invoices, refunds, disputes
-- ===========================================================================
create table public.saas_billing_profiles (
  gym_id        uuid primary key references public.gyms (id),
  legal_name    text check (length(btrim(legal_name)) between 2 and 120),
  gstin         text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  address       text check (length(address) <= 300),
  state_code    text check (state_code ~ '^[0-9]{2}$'),
  billing_email text check (billing_email is null or billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

alter table public.saas_payments
  add column plan_version_id  uuid references public.saas_plan_versions (id),
  add column billing_cycle    text check (billing_cycle in ('monthly', 'annual')),
  add column kind             text not null default 'legacy' check (kind in ('new', 'renewal', 'upgrade', 'legacy')),
  add column list_price_paise int,
  add column credit_paise     int not null default 0 check (credit_paise >= 0),
  add column tax_paise        int not null default 0 check (tax_paise >= 0),
  add column refunded_paise   int not null default 0 check (refunded_paise >= 0),
  add column failure_reason   text,
  add column failed_at        timestamptz,
  add column grants_access    boolean;

create table public.saas_invoice_counters (
  series text primary key,            -- e.g. XS/2026-27 or TEST/2026-27
  last   int not null default 0
);

create table public.saas_invoices (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms (id),
  payment_id      uuid not null unique references public.saas_payments (id),
  number          text not null unique,
  doc_type        text not null check (doc_type in ('tax_invoice', 'receipt')),
  mode            text not null check (mode in ('test', 'live')),
  issued_at       timestamptz not null default now(),
  supplier        jsonb not null,
  customer        jsonb not null,
  lines           jsonb not null,
  subtotal_paise  int not null,     -- list price before credit
  credit_paise    int not null default 0,
  taxable_paise   int not null,
  cgst_paise      int not null default 0,
  sgst_paise      int not null default 0,
  igst_paise      int not null default 0,
  tax_paise       int not null default 0,
  total_paise     int not null,
  gst_rate_bp     int not null default 0,
  place_of_supply text,
  period_start    timestamptz,
  period_end      timestamptz,
  status          text not null default 'paid' check (status in ('paid', 'partially_refunded', 'refunded')),
  refunded_paise  int not null default 0,
  check (taxable_paise + tax_paise = total_paise),
  check (cgst_paise + sgst_paise + igst_paise = tax_paise)
);
create index saas_invoices_gym_idx on public.saas_invoices (gym_id, issued_at desc);
create trigger saas_invoices_no_delete before delete on public.saas_invoices
  for each row execute function private.reject_change();

create table public.saas_refunds (
  id                uuid primary key default gen_random_uuid(),
  payment_id        uuid not null references public.saas_payments (id),
  gym_id            uuid not null references public.gyms (id),
  gateway_refund_id text unique,
  amount_paise      int not null check (amount_paise > 0),
  status            text not null check (status in ('created', 'processed', 'failed', 'recorded')),
  reason            text,
  source            text not null check (source in ('gateway', 'admin')),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.saas_disputes (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid references public.saas_payments (id),
  gym_id             uuid references public.gyms (id),
  gateway_dispute_id text not null unique,
  gateway_payment_id text,
  amount_paise       int,
  status             text not null,
  reason_code        text,
  last_event_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.saas_payment_attempts (
  id                 bigint generated always as identity primary key,
  payment_id         uuid references public.saas_payments (id),
  gym_id             uuid references public.gyms (id),
  gateway_payment_id text,
  amount_paise       int,
  method             text,
  error_code         text,
  error_description  text,
  created_at         timestamptz not null default now()
);

create table public.saas_gateway_events (
  event_id          text primary key,
  provider          text not null default 'razorpay',
  event             text not null,
  entity_created_at timestamptz,
  received_at       timestamptz not null default now(),
  attempts          int not null default 1,
  status            text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  result            jsonb,
  error             text,
  payload           jsonb not null
);

create table public.saas_notifications (
  id         bigint generated always as identity primary key,
  gym_id     uuid not null references public.gyms (id),
  kind       text not null,
  due_on     date not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  unique (gym_id, kind, due_on)
);

create table public.saas_cost_model (
  id                           boolean primary key default true check (id),
  fixed_infra_monthly_paise    int not null default 230000,  -- ASSUMPTION: Supabase Pro ~$25 + domain/email
  infra_per_gym_monthly_paise  int not null default 2000,    -- ASSUMPTION: storage, egress, functions
  ai_cost_per_gym_monthly_paise jsonb not null default '{"starter":0,"growth":6000,"pro":12000,"launch":12000,"pilot":12000}',
  gateway_fee_bp               int not null default 236,     -- Razorpay 2% + 18% GST on the fee
  support_per_gym_monthly_paise int not null default 10000,  -- ASSUMPTION: ~20 min of founder time
  cac_paise                    int not null default 150000,  -- ASSUMPTION: cost to win one paying gym
  fixed_overhead_monthly_paise int not null default 0,       -- FOUNDER DECISION: salaries, office, tools
  notes                        text default 'All values are assumptions until a founder replaces them.',
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid
);
insert into public.saas_cost_model default values;

-- ---------------------------------------------------------------------------
-- Money helpers
-- ---------------------------------------------------------------------------
create function private.fy_label(p_at timestamptz)
returns text language sql stable set search_path = '' as $$
  select case when extract(month from d) >= 4
              then extract(year from d)::int || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
              else (extract(year from d)::int - 1) || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0') end
  from (select (p_at at time zone 'Asia/Kolkata')::date d) x;
$$;

-- GST split of an amount the customer pays. Returns taxable, cgst, sgst, igst, tax.
create function private.saas_tax(p_total int, p_customer_state text)
returns table (taxable int, cgst int, sgst int, igst int, tax int, rate_bp int, doc_type text, place text)
language plpgsql stable security definer set search_path = '' as $$
declare cfg public.saas_billing_settings := private.saas_settings(); v_tax int; v_place text;
begin
  v_place := coalesce(p_customer_state, cfg.supplier_state_code);
  if cfg.gst_status <> 'registered' or cfg.gst_rate_bp = 0 then
    return query select p_total, 0, 0, 0, 0, 0, 'receipt'::text, v_place;
    return;
  end if;
  v_tax := p_total - round(p_total * 10000.0 / (10000 + cfg.gst_rate_bp))::int;
  if v_place = cfg.supplier_state_code then
    return query select p_total - v_tax, v_tax / 2, v_tax - v_tax / 2, 0, v_tax, cfg.gst_rate_bp, 'tax_invoice'::text, v_place;
  else
    return query select p_total - v_tax, 0, 0, v_tax, v_tax, cfg.gst_rate_bp, 'tax_invoice'::text, v_place;
  end if;
end;
$$;

-- Price to charge for a list price: adds GST on top when prices exclude it.
create function private.saas_gross(p_net int)
returns int language sql stable security definer set search_path = '' as $$
  select case when cfg.gst_status = 'registered' and not cfg.prices_include_gst
              then p_net + round(p_net * cfg.gst_rate_bp / 10000.0)::int else p_net end
  from private.saas_settings() cfg;
$$;

create function private.saas_issue_invoice(p_payment uuid)
returns public.saas_invoices language plpgsql security definer set search_path = '' as $$
declare
  p   public.saas_payments;
  g   public.gyms;
  bp  public.saas_billing_profiles;
  cfg public.saas_billing_settings := private.saas_settings();
  v   public.saas_plan_versions;
  t   record;
  v_series text; v_seq int; v_inv public.saas_invoices;
begin
  select * into p from public.saas_payments where id = p_payment;
  select * into v_inv from public.saas_invoices where payment_id = p_payment;
  if found then return v_inv; end if;
  select * into g from public.gyms where id = p.gym_id;
  select * into bp from public.saas_billing_profiles where gym_id = p.gym_id;
  select * into v from public.saas_plan_versions where id = p.plan_version_id;
  select * into t from private.saas_tax(p.amount_paise, bp.state_code);

  v_series := case when p.mode = 'live' then cfg.invoice_prefix else 'TEST' end || '/' || private.fy_label(now());
  insert into public.saas_invoice_counters as c (series, last) values (v_series, 1)
  on conflict (series) do update set last = c.last + 1
  returning last into v_seq;

  insert into public.saas_invoices (gym_id, payment_id, number, doc_type, mode, supplier, customer, lines,
    subtotal_paise, credit_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise,
    gst_rate_bp, place_of_supply, period_start, period_end)
  values (p.gym_id, p.id, v_series || '/' || lpad(v_seq::text, 4, '0'), t.doc_type, coalesce(p.mode, 'test'),
    jsonb_build_object('name', cfg.legal_name, 'gstin', case when cfg.gst_status = 'registered' then cfg.gstin end,
                       'address', cfg.supplier_address, 'state_code', cfg.supplier_state_code, 'email', cfg.support_email,
                       'sac', cfg.sac_code, 'gst_status', cfg.gst_status),
    jsonb_build_object('name', coalesce(bp.legal_name, g.name), 'gstin', bp.gstin, 'address', coalesce(bp.address, g.address),
                       'state_code', bp.state_code, 'email', bp.billing_email, 'phone', g.phone, 'gym', g.name),
    jsonb_build_array(jsonb_build_object(
      'description', 'XS Gym ' || coalesce((select display_name from public.saas_plans where id = v.plan_id), 'subscription')
                     || ' — ' || case when p.months >= 12 then '12 months' else p.months || ' month' end,
      'kind', p.kind, 'amount_paise', coalesce(p.list_price_paise, p.amount_paise + p.credit_paise))),
    coalesce(p.list_price_paise, p.amount_paise + p.credit_paise), p.credit_paise,
    t.taxable, t.cgst, t.sgst, t.igst, t.tax, p.amount_paise, t.rate_bp, t.place, p.period_start, p.period_end)
  returning * into v_inv;
  return v_inv;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checkout preparation (owner, as the signed-in user). Writes nothing.
-- kind: new (trial/expired/pilot), renewal (same plan, next period),
-- upgrade (higher plan or monthly → annual now; unused days credited).
-- Moving down is scheduled instead (schedule_plan_change).
-- ---------------------------------------------------------------------------
create function public.prepare_saas_checkout(p_gym uuid, p_plan text, p_cycle text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg    public.saas_billing_settings := private.saas_settings();
  s      public.gym_subscriptions;
  cur    public.saas_plan_versions;
  nv     public.saas_plan_versions;
  pl     public.saas_plans;
  g      public.gyms;
  eff    text;
  v_kind text;
  v_list int; v_credit int := 0; v_months int; v_start timestamptz; v_amount int;
  v_last public.saas_payments;
  v_email text; v_open int; v_cur_rank int;
begin
  if auth.uid() is null then raise exception 'XS401: sign in required' using errcode = '42501'; end if;
  if not private.has_permission(p_gym, 'billing.manage') then
    raise exception 'XS403: only the gym owner can pay for XS Gym' using errcode = '42501';
  end if;
  if p_cycle not in ('monthly', 'annual') then raise exception 'XS422: choose monthly or yearly' using errcode = '22023'; end if;
  select * into pl from public.saas_plans where id = p_plan and is_public and is_active;
  if not found then raise exception 'XS422: that plan is not available' using errcode = '22023'; end if;
  select * into s from public.gym_subscriptions where gym_id = p_gym;
  select * into cur from public.saas_plan_versions where id = s.plan_version_id;
  select * into nv from public.saas_plan_versions where plan_id = p_plan and status = 'active';
  if not found then
    if not cfg.allow_provisional_checkout then
      raise exception 'XS503: % is not on sale yet', pl.display_name using errcode = 'P0001';
    end if;
    select * into nv from public.saas_plan_versions where plan_id = p_plan and status = 'draft' order by version desc limit 1;
    if not found then raise exception 'XS503: % is not on sale yet', pl.display_name using errcode = 'P0001'; end if;
  end if;
  -- Agreed terms: staying on (or paying ahead for) the plan you have keeps your version's prices.
  if cur.plan_id = p_plan and (case p_cycle when 'monthly' then cur.monthly_price_paise else cur.annual_price_paise end) is not null
     and s.current_period_end is not null   -- they have paid for this version before
     and not (s.complimentary_until is not null and now() < s.complimentary_until) then
    nv := cur;
  elsif s.pending_plan_version_id is not null and (select plan_id from public.saas_plan_versions where id = s.pending_plan_version_id) = p_plan then
    select * into nv from public.saas_plan_versions where id = s.pending_plan_version_id;
  end if;
  v_list := case p_cycle when 'monthly' then nv.monthly_price_paise else nv.annual_price_paise end;
  if v_list is null then raise exception 'XS422: % is not sold %', pl.display_name, case p_cycle when 'monthly' then 'monthly' else 'yearly' end using errcode = '22023'; end if;
  v_months := case p_cycle when 'monthly' then 1 else 12 end;

  eff := private.saas_effective_state(s);
  v_cur_rank := coalesce((select rank from public.saas_plans where id = cur.plan_id), 0);
  -- The payment that bought the current period (latest one that granted access)
  select * into v_last from public.saas_payments
   where gym_id = p_gym and status = 'paid' and coalesce(grants_access, true) order by period_end desc nulls last limit 1;

  if s.is_pilot and s.complimentary_until is not null and now() < s.complimentary_until then
    v_kind := 'new'; v_start := greatest(now(), case when s.complimentary_until = 'infinity' then now() else s.complimentary_until end);
  elsif eff = 'TRIALING' or (eff = 'CANCELED' and s.cancel_from_state = 'TRIALING') then
    v_kind := 'new'; v_start := greatest(now(), s.trial_ends_at);
  elsif eff = 'EXPIRED' or s.current_period_end is null or v_last.id is null then
    v_kind := 'new'; v_start := now();
  elsif cur.plan_id = p_plan and coalesce(s.billing_cycle, 'monthly') = p_cycle then
    v_kind := 'renewal'; v_start := greatest(now(), s.current_period_end);
  elsif s.pending_plan_version_id is not null and (select plan_id from public.saas_plan_versions where id = s.pending_plan_version_id) = p_plan
        and coalesce(s.pending_cycle, p_cycle) = p_cycle then
    v_kind := 'renewal'; v_start := greatest(now(), s.current_period_end);   -- scheduled downgrade paid in advance
  elsif pl.rank > v_cur_rank or (pl.rank = v_cur_rank and p_cycle = 'annual' and s.billing_cycle = 'monthly' and cur.plan_id = p_plan) then
    v_kind := 'upgrade'; v_start := now();
    if now() < s.current_period_end and s.current_period_start is not null and s.current_period_start < now() then
      v_credit := floor((v_last.amount_paise + v_last.credit_paise) *
                  extract(epoch from (s.current_period_end - now())) / extract(epoch from (s.current_period_end - s.current_period_start)))::int;
    elsif s.current_period_start is not null and s.current_period_start >= now() then
      v_credit := v_last.amount_paise + v_last.credit_paise;   -- period not started yet: all of it
    end if;
    v_credit := least(greatest(v_credit, 0), v_list - 100);
  else
    raise exception 'XS409: to move to a smaller plan or monthly billing, schedule it in Subscription; it starts when the current period ends.'
      using errcode = 'P0001';
  end if;

  v_amount := private.saas_gross(v_list - v_credit);
  select * into g from public.gyms where id = p_gym;
  select count(*) into v_open from public.saas_payments where gym_id = p_gym and created_at > now() - interval '1 hour';
  if v_open >= 10 then
    raise exception 'XS429: too many payment attempts. Please wait a while and try again.' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  return jsonb_build_object(
    'gym_id', g.id, 'gym_name', g.name, 'gym_phone', g.phone, 'slug', g.slug, 'user_id', auth.uid(), 'email', v_email,
    'plan_id', pl.id, 'plan_name', pl.display_name, 'plan_version_id', nv.id, 'provisional', nv.provisional,
    'cycle', p_cycle, 'months', v_months, 'kind', v_kind,
    'list_price_paise', v_list, 'credit_paise', v_credit, 'amount_paise', v_amount,
    'tax_paise', (select tax from private.saas_tax(v_amount, (select state_code from public.saas_billing_profiles where gym_id = p_gym))),
    'period_start', v_start, 'period_end', v_start + make_interval(months => v_months),
    'gst_status', cfg.gst_status, 'prices_include_gst', cfg.prices_include_gst,
    -- legacy keys read by older xs-billing builds
    'price_code', case p_cycle when 'monthly' then 'monthly' else 'yearly' end, 'label', pl.display_name || case p_cycle when 'monthly' then ' monthly' else ' yearly' end);
end;
$$;
revoke all on function public.prepare_saas_checkout(uuid, text, text) from public, anon;
grant execute on function public.prepare_saas_checkout(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Applying a confirmed payment (server only). Same signature as before so the
-- deployed webhook keeps working; now drives the state machine and invoices.
-- ---------------------------------------------------------------------------
create or replace function public.apply_saas_payment(p_link_id text, p_payment_id text, p_amount_paise int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg    public.saas_billing_settings := private.saas_settings();
  p      public.saas_payments;
  s      public.gym_subscriptions;
  eff    text;
  v_ver  uuid; v_cycle text; v_kind text;
  v_from timestamptz; v_to timestamptz;
  v_inv  public.saas_invoices;
  v_grant boolean;
begin
  select * into p from public.saas_payments where link_id = p_link_id for update;
  if not found then raise exception 'XS404: payment not found' using errcode = 'P0001'; end if;
  if p.status = 'paid' then
    return jsonb_build_object('applied', false, 'already', true, 'paid_until', p.period_end, 'gym_id', p.gym_id,
      'invoice', (select number from public.saas_invoices where payment_id = p.id));
  end if;
  if p_amount_paise is distinct from p.amount_paise then
    raise exception 'XS409: paid amount % does not match %', p_amount_paise, p.amount_paise using errcode = 'P0001';
  end if;

  v_grant := coalesce(p.mode, 'test') = 'live' or cfg.test_payments_grant_access;
  select * into s from public.gym_subscriptions where gym_id = p.gym_id for update;
  eff := private.saas_effective_state(s);
  v_ver := coalesce(p.plan_version_id, (select id from public.saas_plan_versions where plan_id = 'launch' and version = 1));
  v_cycle := coalesce(p.billing_cycle, case when p.months >= 12 then 'annual' else 'monthly' end);
  v_kind := p.kind;

  -- The period is decided now, from the subscription as it is when the money arrives.
  if v_kind = 'upgrade' and eff in ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELED') then
    v_from := now();
  elsif s.is_pilot and s.complimentary_until is not null and now() < s.complimentary_until then
    v_from := case when s.complimentary_until = 'infinity' then now() else s.complimentary_until end;
  elsif eff = 'TRIALING' or (eff = 'CANCELED' and s.cancel_from_state = 'TRIALING') then
    v_from := greatest(now(), s.trial_ends_at);
  elsif eff in ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELED') and s.current_period_end is not null then
    v_from := greatest(now(), s.current_period_end);
  else
    v_from := now();
  end if;
  v_to := v_from + make_interval(months => p.months);

  update public.saas_payments
     set status = 'paid', payment_id = coalesce(p_payment_id, payment_id), paid_at = now(),
         period_start = v_from, period_end = v_to, plan_version_id = v_ver, billing_cycle = v_cycle, grants_access = v_grant
   where id = p.id;

  if v_grant then
    -- EXPIRED/CANCELED/… → ACTIVE (validated); ACTIVE → ACTIVE is a renewal event.
    perform private.saas_set_state(p.gym_id, 'ACTIVE', 'payment.applied', 'gateway',
      jsonb_build_object('saas_payment_id', p.id, 'kind', v_kind, 'amount_paise', p.amount_paise, 'mode', p.mode,
                         'period_start', v_from, 'period_end', v_to));
    update public.gym_subscriptions set
      plan_version_id = v_ver, billing_cycle = v_cycle,
      current_period_start = v_from, current_period_end = v_to,
      past_due_since = null, grace_ends_at = null,
      canceled_at = null, cancel_effective_at = null, cancel_reason = null, cancel_from_state = null,
      pending_plan_version_id = case when pending_plan_version_id = v_ver then null else pending_plan_version_id end,
      pending_cycle = case when pending_plan_version_id = v_ver then null else pending_cycle end,
      complimentary_until = case when is_pilot then null else complimentary_until end,
      trial_eligible = false,
      updated_at = now()
    where gym_id = p.gym_id;
  else
    insert into public.saas_subscription_events (gym_id, event, from_state, to_state, source, details)
    values (p.gym_id, 'payment.test_recorded', s.state, s.state, 'gateway',
            jsonb_build_object('saas_payment_id', p.id, 'note', 'Test-mode payment: recorded, access unchanged'));
  end if;

  v_inv := private.saas_issue_invoice(p.id);
  perform private.audit(p.gym_id, 'billing.paid', 'saas_payment', p.id,
    jsonb_build_object('amount_paise', p.amount_paise, 'months', p.months, 'mode', p.mode, 'kind', v_kind,
                       'payment_id', p_payment_id, 'paid_until', v_to, 'invoice', v_inv.number, 'grants_access', v_grant));
  return jsonb_build_object('applied', true, 'already', false, 'paid_until', v_to, 'gym_id', p.gym_id,
                            'invoice', v_inv.number, 'grants_access', v_grant);
end;
$$;
revoke all on function public.apply_saas_payment(text, text, int) from public, anon, authenticated;
grant execute on function public.apply_saas_payment(text, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- Owner actions that need no payment
-- ---------------------------------------------------------------------------
create function private.require_billing(p_gym uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'XS401: sign in required' using errcode = '42501'; end if;
  if not private.has_permission(p_gym, 'billing.manage') then
    raise exception 'XS403: only the gym owner can manage the subscription' using errcode = '42501';
  end if;
end;
$$;

-- Moving down (smaller plan or monthly) starts when the paid period ends.
create function public.schedule_plan_change(p_gym uuid, p_plan text, p_cycle text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.gym_subscriptions; nv public.saas_plan_versions; cur text;
begin
  perform private.require_billing(p_gym);
  if p_cycle not in ('monthly', 'annual') then raise exception 'XS422: choose monthly or yearly' using errcode = '22023'; end if;
  select * into s from public.gym_subscriptions where gym_id = p_gym for update;
  if private.saas_effective_state(s) not in ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD') or s.current_period_end is null then
    raise exception 'XS409: choose a plan and pay instead; there is no paid period to change' using errcode = 'P0001';
  end if;
  select * into nv from public.saas_plan_versions v
   where v.plan_id = p_plan and v.status in ('active', 'draft')
     and exists (select 1 from public.saas_plans pl where pl.id = v.plan_id and pl.is_public and pl.is_active)
   order by (v.status = 'active') desc, v.version desc limit 1;
  if not found then raise exception 'XS422: that plan is not available' using errcode = '22023'; end if;
  select plan_id into cur from public.saas_plan_versions where id = s.plan_version_id;
  if cur = p_plan and s.billing_cycle = p_cycle then
    raise exception 'XS409: you are already on this plan' using errcode = 'P0001';
  end if;
  update public.gym_subscriptions set pending_plan_version_id = nv.id, pending_cycle = p_cycle, updated_at = now() where gym_id = p_gym;
  perform private.saas_set_state(p_gym, s.state, 'plan_change.scheduled', 'owner',
    jsonb_build_object('to_plan', p_plan, 'cycle', p_cycle, 'from_plan', cur, 'effective_at', s.current_period_end));
  return jsonb_build_object('scheduled', true, 'effective_at', s.current_period_end);
end;
$$;

create function public.cancel_plan_change(p_gym uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.gym_subscriptions;
begin
  perform private.require_billing(p_gym);
  select * into s from public.gym_subscriptions where gym_id = p_gym for update;
  if s.pending_plan_version_id is null then return; end if;
  update public.gym_subscriptions set pending_plan_version_id = null, pending_cycle = null, updated_at = now() where gym_id = p_gym;
  perform private.saas_set_state(p_gym, s.state, 'plan_change.cancelled', 'owner', '{}'::jsonb);
end;
$$;

-- Nothing renews by itself; cancelling means "do not remind me, end at period end".
create function public.cancel_subscription(p_gym uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.gym_subscriptions; eff text; v_at timestamptz;
begin
  perform private.require_billing(p_gym);
  select * into s from public.gym_subscriptions where gym_id = p_gym for update;
  eff := private.saas_effective_state(s);
  if s.complimentary_until is not null and now() < s.complimentary_until then
    raise exception 'XS409: complimentary access has nothing to cancel' using errcode = 'P0001';
  end if;
  if eff not in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD') then
    raise exception 'XS409: there is nothing to cancel' using errcode = 'P0001';
  end if;
  v_at := case eff when 'TRIALING' then s.trial_ends_at
                   when 'ACTIVE' then s.current_period_end
                   else now() end;
  -- bring a stale stored state up to date first (e.g. ACTIVE that is really PAST_DUE)
  if eff <> s.state then perform private.saas_set_state(p_gym, eff, 'state.refreshed', 'system', '{}'::jsonb); end if;
  update public.gym_subscriptions set canceled_at = now(), cancel_effective_at = v_at, cancel_from_state = eff,
         cancel_reason = left(nullif(btrim(p_reason), ''), 300), updated_at = now() where gym_id = p_gym;
  perform private.saas_set_state(p_gym, 'CANCELED', 'subscription.cancelled', 'owner',
    jsonb_build_object('effective_at', v_at, 'reason', left(nullif(btrim(p_reason), ''), 300)));
  return jsonb_build_object('cancelled', true, 'access_until', v_at);
end;
$$;

create function public.resume_subscription(p_gym uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.gym_subscriptions; v_to text;
begin
  perform private.require_billing(p_gym);
  select * into s from public.gym_subscriptions where gym_id = p_gym for update;
  if private.saas_effective_state(s) <> 'CANCELED' then
    raise exception 'XS409: the subscription is not cancelled' using errcode = 'P0001';
  end if;
  v_to := case when s.cancel_from_state = 'TRIALING' then 'TRIALING' else 'ACTIVE' end;
  update public.gym_subscriptions set canceled_at = null, cancel_effective_at = null, cancel_reason = null, cancel_from_state = null,
         updated_at = now() where gym_id = p_gym;
  perform private.saas_set_state(p_gym, v_to, 'subscription.resumed', 'owner', '{}'::jsonb);
  return jsonb_build_object('resumed', true, 'state', v_to);
end;
$$;

create function public.save_billing_profile(p_gym uuid, p_legal_name text, p_gstin text, p_address text, p_state_code text, p_email text)
returns public.saas_billing_profiles language plpgsql security definer set search_path = '' as $$
declare r public.saas_billing_profiles;
begin
  perform private.require_billing(p_gym);
  insert into public.saas_billing_profiles (gym_id, legal_name, gstin, address, state_code, billing_email, updated_by)
  values (p_gym, nullif(btrim(p_legal_name), ''), nullif(upper(btrim(p_gstin)), ''), nullif(btrim(p_address), ''),
          coalesce(nullif(btrim(p_state_code), ''), nullif(left(upper(btrim(p_gstin)), 2), '')), nullif(lower(btrim(p_email)), ''), auth.uid())
  on conflict (gym_id) do update set legal_name = excluded.legal_name, gstin = excluded.gstin, address = excluded.address,
    state_code = excluded.state_code, billing_email = excluded.billing_email, updated_at = now(), updated_by = auth.uid()
  returning * into r;
  perform private.audit(p_gym, 'billing.profile_saved', 'saas_billing_profile', p_gym, jsonb_build_object('gstin', r.gstin));
  return r;
exception when check_violation then
  raise exception 'XS422: check the GSTIN (15 characters), state code (2 digits) and email' using errcode = '22023';
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.schedule_plan_change(uuid, text, text)', 'public.cancel_plan_change(uuid)',
    'public.cancel_subscription(uuid, text)', 'public.resume_subscription(uuid)',
    'public.save_billing_profile(uuid, text, text, text, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ===========================================================================
-- 7. Gateway events (webhooks): idempotent, ordered, replay-safe
-- ===========================================================================
create function private.ts(p_epoch text)
returns timestamptz language sql immutable set search_path = '' as $$
  select case when p_epoch ~ '^[0-9]{9,11}$' then to_timestamp(p_epoch::bigint) end;
$$;

create function private.process_gateway_event(p_event text, p_payload jsonb, p_created_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  link jsonb := p_payload #> '{payment_link,entity}';
  pay  jsonb := p_payload #> '{payment,entity}';
  ref  jsonb := p_payload #> '{refund,entity}';
  dis  jsonb := p_payload #> '{dispute,entity}';
  sp   public.saas_payments;
  v_status text; r jsonb; v_rank int; v_old int;
begin
  if p_event = 'payment_link.paid' then
    if coalesce(link #>> '{notes,product}', 'xs-gym') <> 'xs-gym' then return jsonb_build_object('ignored', 'other product'); end if;
    begin
      r := public.apply_saas_payment(link ->> 'id', pay ->> 'id', coalesce((link ->> 'amount_paid')::int, (pay ->> 'amount')::int));
    exception when others then
      if sqlerrm like 'XS404%' then return jsonb_build_object('ignored', 'unknown link'); end if;
      raise;
    end;
    return r;
  elsif p_event in ('payment_link.expired', 'payment_link.cancelled') then
    update public.saas_payments set status = case p_event when 'payment_link.expired' then 'expired' else 'cancelled' end
     where link_id = link ->> 'id' and status = 'created';
    return jsonb_build_object('updated', found);
  elsif p_event = 'payment.failed' then
    select * into sp from public.saas_payments
     where id::text = coalesce(pay #>> '{notes,saas_payment_id}', '') or (link is not null and link_id = link ->> 'id') limit 1;
    if sp.id is null and coalesce(pay #>> '{notes,product}', '') <> 'xs-gym' then return jsonb_build_object('ignored', 'not an XS Gym payment'); end if;
    insert into public.saas_payment_attempts (payment_id, gym_id, gateway_payment_id, amount_paise, method, error_code, error_description)
    values (sp.id, sp.gym_id, pay ->> 'id', (pay ->> 'amount')::int, pay ->> 'method', pay ->> 'error_code', left(pay ->> 'error_description', 300));
    if sp.id is not null then
      update public.saas_payments set failure_reason = left(pay ->> 'error_description', 300), failed_at = now() where id = sp.id and status = 'created';
      insert into public.saas_subscription_events (gym_id, event, source, details)
      values (sp.gym_id, 'payment.failed', 'gateway', jsonb_build_object('saas_payment_id', sp.id, 'error', pay ->> 'error_code'));
    end if;
    return jsonb_build_object('recorded', true);
  elsif p_event in ('refund.created', 'refund.processed', 'refund.failed') then
    select * into sp from public.saas_payments where payment_id = ref ->> 'payment_id';
    if not found then return jsonb_build_object('ignored', 'unknown payment'); end if;
    v_status := split_part(p_event, '.', 2);
    v_rank := case v_status when 'created' then 1 else 2 end;
    insert into public.saas_refunds as rf (payment_id, gym_id, gateway_refund_id, amount_paise, status, source)
    values (sp.id, sp.gym_id, ref ->> 'id', (ref ->> 'amount')::int, v_status, 'gateway')
    on conflict (gateway_refund_id) do update
      set status = case when (case rf.status when 'created' then 1 else 2 end) < v_rank then excluded.status else rf.status end,
          updated_at = now();
    perform private.saas_refresh_refunds(sp.id);
    return jsonb_build_object('refund', v_status);
  elsif p_event like 'payment.dispute.%' then
    select * into sp from public.saas_payments where payment_id = dis ->> 'payment_id';
    insert into public.saas_disputes as d (payment_id, gym_id, gateway_dispute_id, gateway_payment_id, amount_paise, status, reason_code, last_event_at)
    values (sp.id, sp.gym_id, dis ->> 'id', dis ->> 'payment_id', (dis ->> 'amount')::int, coalesce(dis ->> 'status', split_part(p_event, '.', 3)),
            dis ->> 'reason_code', p_created_at)
    on conflict (gateway_dispute_id) do update
      set status = excluded.status, amount_paise = excluded.amount_paise, last_event_at = excluded.last_event_at, updated_at = now()
      where d.last_event_at is null or excluded.last_event_at >= d.last_event_at;
    if sp.id is not null then
      insert into public.saas_subscription_events (gym_id, event, source, details)
      values (sp.gym_id, p_event, 'gateway', jsonb_build_object('dispute', dis ->> 'id', 'saas_payment_id', sp.id));
    end if;
    return jsonb_build_object('dispute', dis ->> 'id');
  end if;
  return jsonb_build_object('ignored', p_event);
end;
$$;

create function private.saas_refresh_refunds(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ref int; v_amt int;
begin
  select coalesce(sum(amount_paise), 0) into v_ref from public.saas_refunds where payment_id = p_payment and status in ('processed', 'recorded');
  select amount_paise into v_amt from public.saas_payments where id = p_payment;
  update public.saas_payments set refunded_paise = least(v_ref, v_amt) where id = p_payment;
  update public.saas_invoices set refunded_paise = least(v_ref, v_amt),
         status = case when v_ref = 0 then 'paid' when v_ref >= v_amt then 'refunded' else 'partially_refunded' end
   where payment_id = p_payment;
end;
$$;

-- Server only. A repeat of a processed event id does nothing (replay-safe).
-- A failed event is retried when the gateway sends it again.
create function public.ingest_gateway_event(p_event_id text, p_event text, p_payload jsonb, p_created_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.saas_gateway_events; r jsonb;
begin
  if p_event_id is null or length(p_event_id) not between 6 and 200 then
    raise exception 'XS422: event id missing' using errcode = '22023';
  end if;
  insert into public.saas_gateway_events as ge (event_id, event, payload, entity_created_at)
  values (p_event_id, coalesce(p_event, 'unknown'), coalesce(p_payload, '{}'::jsonb), p_created_at)
  on conflict (event_id) do update set attempts = ge.attempts + 1
  returning * into e;
  if e.attempts > 1 and e.status in ('processed', 'ignored') then
    return jsonb_build_object('duplicate', true, 'status', e.status);
  end if;
  begin
    r := private.process_gateway_event(p_event, coalesce(p_payload, '{}'::jsonb), p_created_at);
    update public.saas_gateway_events set status = case when r ? 'ignored' then 'ignored' else 'processed' end, result = r, error = null
     where event_id = p_event_id;
    return r || jsonb_build_object('status', case when r ? 'ignored' then 'ignored' else 'processed' end);
  exception when others then
    update public.saas_gateway_events set status = 'failed', error = left(sqlerrm, 500) where event_id = p_event_id;
    return jsonb_build_object('status', 'failed', 'error', left(sqlerrm, 200));
  end;
end;
$$;
revoke all on function public.ingest_gateway_event(text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.ingest_gateway_event(text, text, jsonb, timestamptz) to service_role;

-- ===========================================================================
-- 8. Time-based transitions and reminders (run every hour by pg_cron or the
--    billing function; access is already correct without it — see
--    saas_effective_state — this only records the changes and queues reminders)
-- ===========================================================================
create function public.billing_tick()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg public.saas_billing_settings := private.saas_settings();
  s   public.gym_subscriptions;
  eff text; n int := 0; q int := 0; v_today date := (now() at time zone 'Asia/Kolkata')::date; d int;
begin
  for s in select * from public.gym_subscriptions where state is not null for update skip locked loop
    eff := private.saas_effective_state(s);
    if eff is distinct from s.state and not (s.complimentary_until is not null and now() < s.complimentary_until) then
      if eff = 'PAST_DUE' then
        update public.gym_subscriptions set past_due_since = coalesce(past_due_since, current_period_end) where gym_id = s.gym_id;
      elsif eff = 'GRACE_PERIOD' then
        update public.gym_subscriptions set past_due_since = coalesce(past_due_since, current_period_end),
          grace_ends_at = coalesce(grace_ends_at, current_period_end + make_interval(days => cfg.past_due_days + cfg.grace_days))
         where gym_id = s.gym_id;
      end if;
      perform private.saas_set_state(s.gym_id, eff, case eff when 'EXPIRED' then 'subscription.expired' when 'PAST_DUE' then 'renewal.missed'
        when 'GRACE_PERIOD' then 'grace.started' else 'state.refreshed' end, 'tick', '{}'::jsonb);
      n := n + 1;
    end if;
    -- Reminders (in-app now; email/WhatsApp delivery reads this queue later)
    if eff = 'TRIALING' then
      d := (s.trial_ends_at at time zone 'Asia/Kolkata')::date - v_today;
      if d in (7, 3, 1) then
        insert into public.saas_notifications (gym_id, kind, due_on, payload) values (s.gym_id, 'trial_ending_' || d, v_today,
          jsonb_build_object('trial_ends_at', s.trial_ends_at)) on conflict do nothing;
        q := q + 1;
      end if;
    elsif eff = 'ACTIVE' and s.current_period_end is not null and s.complimentary_until is null then
      d := (s.current_period_end at time zone 'Asia/Kolkata')::date - v_today;
      if d in (7, 3, 1) then
        insert into public.saas_notifications (gym_id, kind, due_on, payload) values (s.gym_id, 'renewal_due_' || d, v_today,
          jsonb_build_object('period_end', s.current_period_end)) on conflict do nothing;
        q := q + 1;
      end if;
    elsif eff in ('PAST_DUE', 'GRACE_PERIOD') then
      insert into public.saas_notifications (gym_id, kind, due_on) values (s.gym_id, lower(eff), v_today) on conflict do nothing;
    end if;
  end loop;
  return jsonb_build_object('transitions', n, 'reminders', q);
end;
$$;
revoke all on function public.billing_tick() from public, anon, authenticated;
grant execute on function public.billing_tick() to service_role;

-- ===========================================================================
-- 9. Public pricing (no sign-in)
-- ===========================================================================
create function public.public_pricing()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'name', pl.display_name, 'tagline', pl.tagline, 'rank', pl.rank,
        'version', v.version, 'provisional', v.provisional or v.status <> 'active',
        'monthly_paise', v.monthly_price_paise, 'annual_paise', v.annual_price_paise, 'trial_days', v.trial_days,
        'features', v.features, 'member_limit', v.member_limit, 'staff_limit', v.staff_limit, 'branch_limit', v.branch_limit,
        'addons', v.addons_allowed) order by pl.sort)
      from public.saas_plans pl
      cross join lateral (select * from public.saas_plan_versions x where x.plan_id = pl.id and x.status in ('active', 'draft')
                          order by (x.status = 'active') desc, x.version desc limit 1) v
      where pl.is_public and pl.is_active), '[]'::jsonb),
    'features', (select jsonb_agg(to_jsonb(f) order by f.sort) from public.saas_features f),
    'addons', (select jsonb_agg(to_jsonb(a)) from public.saas_addons a where a.status <> 'retired'),
    'terms', (select jsonb_build_object('trial_days', default_trial_days, 'gst_status', gst_status, 'prices_include_gst', prices_include_gst,
                                        'gst_rate_bp', gst_rate_bp, 'payment_terms', payment_terms, 'support_email', support_email,
                                        'grace_days', past_due_days + grace_days)
              from public.saas_billing_settings));
$$;
revoke all on function public.public_pricing() from public;
grant execute on function public.public_pricing() to anon, authenticated;

-- ===========================================================================
-- 10. Xelorsoft admin: overview, metrics, customer adjustments, prices, settings
-- ===========================================================================
create function private.monthly_value(v public.saas_plan_versions, p_cycle text)
returns numeric language sql immutable set search_path = '' as $$
  select case when p_cycle = 'annual' then coalesce(v.annual_price_paise, 0) / 12.0 else coalesce(v.monthly_price_paise, 0)::numeric end;
$$;

-- Paying = live money, not complimentary, state that will renew or is being chased.
create function private.paying_subscriptions()
returns table (gym_id uuid, plan_id text, cycle text, mrr_paise numeric, eff text)
language sql stable security definer set search_path = '' as $$
  select s.gym_id, v.plan_id, s.billing_cycle, private.monthly_value(v, s.billing_cycle), private.saas_effective_state(s)
    from public.gym_subscriptions s
    join public.saas_plan_versions v on v.id = s.plan_version_id
   where private.saas_effective_state(s) in ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD')
     and (s.complimentary_until is null or now() >= s.complimentary_until)
     and exists (select 1 from public.saas_payments p where p.gym_id = s.gym_id and p.status = 'paid' and p.mode = 'live'
                  and p.period_end >= coalesce(s.current_period_end, now()) - interval '1 second');
$$;

create function public.admin_commercial_metrics()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c   public.saas_cost_model;
  v_mrr numeric; v_paying int; v_arpu numeric; v_cogs numeric; v_var_per numeric; v_new int; v_churn_base int; v_churned int;
  v_be numeric; v_ai numeric;
begin
  perform private.require_platform('viewer');
  select * into c from public.saas_cost_model where id;
  select coalesce(sum(mrr_paise), 0), count(*) into v_mrr, v_paying from private.paying_subscriptions();
  v_arpu := case when v_paying > 0 then v_mrr / v_paying else 0 end;
  select coalesce(sum(coalesce((c.ai_cost_per_gym_monthly_paise ->> plan_id)::numeric, 0)), 0) into v_ai from private.paying_subscriptions();
  v_cogs := v_paying * (c.infra_per_gym_monthly_paise + c.support_per_gym_monthly_paise) + v_ai + v_mrr * c.gateway_fee_bp / 10000.0;
  v_var_per := case when v_paying > 0 then v_cogs / v_paying
                    else c.infra_per_gym_monthly_paise + c.support_per_gym_monthly_paise end;
  select count(distinct gym_id) into v_new from public.saas_payments
   where status = 'paid' and mode = 'live' and kind = 'new' and paid_at >= date_trunc('month', now());
  select count(distinct gym_id) into v_churn_base from public.saas_payments
   where status = 'paid' and mode = 'live' and period_end > now() - interval '30 days' and period_start <= now() - interval '30 days';
  select count(distinct e.gym_id) into v_churned from public.saas_subscription_events e
   where e.to_state in ('EXPIRED', 'CANCELED') and e.from_state is distinct from e.to_state and e.created_at > now() - interval '30 days'
     and exists (select 1 from public.saas_payments p where p.gym_id = e.gym_id and p.status = 'paid' and p.mode = 'live');
  v_be := case when v_arpu - v_var_per > 0 then ceil((c.fixed_infra_monthly_paise + c.fixed_overhead_monthly_paise) / (v_arpu - v_var_per)) end;
  return jsonb_build_object(
    'mrr_paise', round(v_mrr), 'arr_paise', round(v_mrr * 12), 'paying_customers', v_paying, 'arpu_paise', round(v_arpu),
    'cogs_paise', round(v_cogs), 'gross_margin_pct', case when v_mrr > 0 then round((v_mrr - v_cogs) * 100 / v_mrr, 1) end,
    'cac_spend_paise', v_new * c.cac_paise, 'new_paying_this_month', v_new,
    'contribution_paise', round(v_mrr - v_cogs - v_new * c.cac_paise),
    'contribution_margin_pct', case when v_mrr > 0 then round((v_mrr - v_cogs - v_new * c.cac_paise) * 100 / v_mrr, 1) end,
    'fixed_costs_paise', c.fixed_infra_monthly_paise + c.fixed_overhead_monthly_paise,
    'operating_profit_paise', round(v_mrr - v_cogs - v_new * c.cac_paise - c.fixed_infra_monthly_paise - c.fixed_overhead_monthly_paise),
    'variable_cost_per_customer_paise', round(v_var_per),
    'break_even_customers', v_be,
    'churn_30d_pct', case when v_churn_base > 0 then round(v_churned * 100.0 / v_churn_base, 1) end,
    'cost_model', to_jsonb(c),
    'definitions', jsonb_build_object(
      'mrr', 'Sum of the monthly value (annual price ÷ 12) of live-paid, non-complimentary subscriptions that are Active, Past due or in Grace. Cancelled ones are excluded because they will not renew.',
      'arr', 'MRR × 12.',
      'arpu', 'MRR ÷ paying customers.',
      'cogs', 'Per paying gym: infrastructure + AI/API + support, plus payment processing (gateway fee % × MRR).',
      'gross_margin', '(MRR − COGS) ÷ MRR.',
      'contribution', 'MRR − COGS − acquisition spend this month (new paying gyms × CAC).',
      'break_even', 'Fixed costs ÷ (ARPU − variable cost per customer), rounded up.',
      'churn', 'Paying gyms that moved to Cancelled or Expired in the last 30 days ÷ gyms paid 30 days ago.'));
end;
$$;

create function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require_platform('viewer');
  with subs as (
    select s.*, private.saas_effective_state(s) eff, v.plan_id
      from public.gym_subscriptions s left join public.saas_plan_versions v on v.id = s.plan_version_id)
  select jsonb_build_object(
    'gyms_total', (select count(*) from public.gyms),
    'by_state', (select coalesce(jsonb_object_agg(eff, n), '{}'::jsonb) from (select eff, count(*) n from subs group by eff) x),
    'by_plan', (select coalesce(jsonb_object_agg(plan_id, n), '{}'::jsonb) from (select coalesce(plan_id, 'none') plan_id, count(*) n from subs group by 1) x),
    'trials', (select count(*) from subs where eff = 'TRIALING'),
    'trials_ending_7d', (select count(*) from subs where eff = 'TRIALING' and trial_ends_at < now() + interval '7 days'),
    'past_due', (select count(*) from subs where eff in ('PAST_DUE', 'GRACE_PERIOD')),
    'expired', (select count(*) from subs where eff = 'EXPIRED'),
    'complimentary', (select count(*) from subs where complimentary_until is not null and now() < complimentary_until),
    'collected_this_month_paise', (select coalesce(sum(amount_paise), 0) from public.saas_payments where status = 'paid' and mode = 'live' and paid_at >= date_trunc('month', now())),
    'refunded_this_month_paise', (select coalesce(sum(r.amount_paise), 0) from public.saas_refunds r join public.saas_payments p on p.id = r.payment_id
                                   where r.status in ('processed', 'recorded') and p.mode = 'live' and r.created_at >= date_trunc('month', now())),
    'test_payments_this_month', (select count(*) from public.saas_payments where status = 'paid' and coalesce(mode, 'test') = 'test' and paid_at >= date_trunc('month', now())),
    'failed_payments_30d', (select count(*) from public.saas_payment_attempts where created_at > now() - interval '30 days'),
    'open_disputes', (select count(*) from public.saas_disputes where status not in ('won', 'lost', 'closed')),
    'failed_webhooks', (select count(*) from public.saas_gateway_events where status = 'failed'),
    'metrics', public.admin_commercial_metrics()) into r;
  return r;
end;
$$;

create function public.admin_subscriptions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform('viewer');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'gym_id', g.id, 'gym', g.name, 'slug', g.slug, 'phone', g.phone, 'created_at', g.created_at,
      'owner_email', (select email from auth.users where id = g.created_by),
      'state', s.state, 'effective_state', private.saas_effective_state(s), 'plan_id', v.plan_id, 'plan_version', v.version,
      'cycle', s.billing_cycle, 'trial_ends_at', s.trial_ends_at, 'period_end', s.current_period_end,
      'complimentary_until', s.complimentary_until, 'is_pilot', s.is_pilot, 'cancel_effective_at', s.cancel_effective_at,
      'members', private.active_member_count(g.id), 'staff', private.active_staff_count(g.id),
      'mrr_paise', (select round(mrr_paise) from private.paying_subscriptions() ps where ps.gym_id = g.id),
      'last_payment_at', (select max(paid_at) from public.saas_payments p where p.gym_id = g.id and p.status = 'paid'),
      'paid_total_paise', (select coalesce(sum(amount_paise - refunded_paise), 0) from public.saas_payments p where p.gym_id = g.id and p.status = 'paid' and p.mode = 'live'))
      order by g.created_at desc)
    from public.gyms g join public.gym_subscriptions s on s.gym_id = g.id
    left join public.saas_plan_versions v on v.id = s.plan_version_id), '[]'::jsonb);
end;
$$;

create function public.admin_gym_billing(p_gym uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform('viewer');
  return jsonb_build_object(
    'entitlements', public.gym_entitlements(p_gym),
    'payments', (select coalesce(jsonb_agg(to_jsonb(p) - 'link_url' order by p.created_at desc), '[]') from public.saas_payments p where p.gym_id = p_gym),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'issued_at', i.issued_at, 'total_paise', i.total_paise,
                  'status', i.status, 'mode', i.mode) order by i.issued_at desc), '[]') from public.saas_invoices i where i.gym_id = p_gym),
    'refunds', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]') from public.saas_refunds r where r.gym_id = p_gym),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc), '[]') from (select * from public.saas_subscription_events where gym_id = p_gym order by id desc limit 100) e));
end;
$$;

create function private.admin_sub_snapshot(p_gym uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(s) - 'updated_at' from public.gym_subscriptions s where gym_id = p_gym;
$$;

create function private.require_reason(p_reason text)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'XS422: a reason is required' using errcode = '22023'; end if;
  return left(btrim(p_reason), 300);
end;
$$;

create function public.admin_extend_trial(p_gym uuid, p_days int, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.gym_subscriptions; b jsonb; eff text; v_reason text := private.require_reason(p_reason);
begin
  perform private.require_platform('admin');
  if p_days not between 1 and 60 then raise exception 'XS422: extend by 1 to 60 days' using errcode = '22023'; end if;
  b := private.admin_sub_snapshot(p_gym);
  select * into s from public.gym_subscriptions where gym_id = p_gym for update;
  if not found then raise exception 'XS404: gym not found' using errcode = 'P0001'; end if;
  eff := private.saas_effective_state(s);
  if eff not in ('TRIALING', 'EXPIRED') or (eff = 'EXPIRED' and s.current_period_end is not null) then
    raise exception 'XS409: only trials (running or ended) can be extended' using errcode = 'P0001';
  end if;
  if eff <> s.state then perform private.saas_set_state(p_gym, eff, 'state.refreshed', 'system', '{}'::jsonb); end if;
  update public.gym_subscriptions set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => p_days),
         trial_started_at = coalesce(trial_started_at, now()), updated_at = now() where gym_id = p_gym;
  perform private.saas_set_state(p_gym, 'TRIALING', 'trial.extended', 'admin', jsonb_build_object('days', p_days, 'reason', v_reason));
  perform private.admin_log('trial.extend', 'gym', p_gym::text, v_reason, b, private.admin_sub_snapshot(p_gym));
  return private.admin_sub_snapshot(p_gym);
end;
$$;

-- p_until null = no end date. p_plan: plan whose features apply (default: pilot = everything).
create function public.admin_grant_complimentary(p_gym uuid, p_until timestamptz, p_plan text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.gym_subscriptions; b jsonb; v_ver uuid; v_reason text := private.require_reason(p_reason);
begin
  perform private.require_platform('admin');
  if p_until is not null and p_until <= now() then raise exception 'XS422: end date must be in the future' using errcode = '22023'; end if;
  select id into v_ver from public.saas_plan_versions where plan_id = coalesce(p_plan, 'pilot')
   order by (status = 'active') desc, version desc limit 1;
  if v_ver is null then raise exception 'XS422: unknown plan' using errcode = '22023'; end if;
  b := private.admin_sub_snapshot(p_gym);
  select * into s from public.gym_subscriptions where gym_id = p_gym for update;
  if not found then raise exception 'XS404: gym not found' using errcode = 'P0001'; end if;
  update public.gym_subscriptions set complimentary_until = coalesce(p_until, 'infinity'), complimentary_reason = v_reason,
         plan_version_id = v_ver, updated_at = now() where gym_id = p_gym;
  perform private.saas_set_state(p_gym, 'ACTIVE', 'complimentary.granted', 'admin',
    jsonb_build_object('until', coalesce(p_until, 'infinity'), 'plan', coalesce(p_plan, 'pilot'), 'reason', v_reason));
  perform private.admin_log('complimentary.grant', 'gym', p_gym::text, v_reason, b, private.admin_sub_snapshot(p_gym));
  return private.admin_sub_snapshot(p_gym);
end;
$$;

-- Ends complimentary/pilot access on a date (give pilots notice). After it the
-- gym needs a paid plan; nothing is deleted.
create function public.admin_end_complimentary(p_gym uuid, p_at timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b jsonb; s public.gym_subscriptions; v_reason text := private.require_reason(p_reason);
begin
  perform private.require_platform('admin');
  select * into s from public.gym_subscriptions where gym_id = p_gym for update;
  if s.complimentary_until is null then raise exception 'XS409: this gym has no complimentary access' using errcode = 'P0001'; end if;
  if p_at < now() then raise exception 'XS422: choose today or a later date' using errcode = '22023'; end if;
  b := private.admin_sub_snapshot(p_gym);
  -- When it ends: a paid period continues; otherwise the gym is expired (read-only)
  update public.gym_subscriptions set complimentary_until = p_at,
         current_period_end = case when current_period_end is null or current_period_end < p_at then p_at else current_period_end end,
         current_period_start = coalesce(current_period_start, now()), updated_at = now()
   where gym_id = p_gym;
  perform private.saas_set_state(p_gym, 'ACTIVE', 'complimentary.end_scheduled', 'admin', jsonb_build_object('at', p_at, 'reason', v_reason));
  perform private.admin_log('complimentary.end', 'gym', p_gym::text, v_reason, b, private.admin_sub_snapshot(p_gym));
  return private.admin_sub_snapshot(p_gym);
end;
$$;

create function public.admin_set_plan(p_gym uuid, p_version uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b jsonb; v_reason text := private.require_reason(p_reason);
begin
  perform private.require_platform('admin');
  if not exists (select 1 from public.saas_plan_versions where id = p_version) then raise exception 'XS422: unknown plan version' using errcode = '22023'; end if;
  b := private.admin_sub_snapshot(p_gym);
  update public.gym_subscriptions set plan_version_id = p_version, updated_at = now() where gym_id = p_gym;
  if not found then raise exception 'XS404: gym not found' using errcode = 'P0001'; end if;
  perform private.saas_set_state(p_gym, (select state from public.gym_subscriptions where gym_id = p_gym), 'plan.set_by_admin', 'admin',
    jsonb_build_object('version', p_version, 'reason', v_reason));
  perform private.admin_log('plan.set', 'gym', p_gym::text, v_reason, b, private.admin_sub_snapshot(p_gym));
  return private.admin_sub_snapshot(p_gym);
end;
$$;

create function public.admin_set_state(p_gym uuid, p_state text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b jsonb; v_reason text := private.require_reason(p_reason);
begin
  perform private.require_platform('admin');
  b := private.admin_sub_snapshot(p_gym);
  perform private.saas_set_state(p_gym, p_state, 'state.set_by_admin', 'admin', jsonb_build_object('reason', v_reason));
  if p_state = 'EXPIRED' then
    update public.gym_subscriptions set current_period_end = least(coalesce(current_period_end, now()), now()),
           trial_ends_at = least(coalesce(trial_ends_at, now()), now()), complimentary_until = null where gym_id = p_gym;
  end if;
  perform private.admin_log('state.set', 'gym', p_gym::text, v_reason, b, private.admin_sub_snapshot(p_gym));
  return private.admin_sub_snapshot(p_gym);
end;
$$;

create function public.admin_list_plan_versions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform('viewer');
  return (select coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object('plan_name', p.display_name, 'is_public', p.is_public,
           'subscribers', (select count(*) from public.gym_subscriptions s where s.plan_version_id = v.id)) order by p.sort, v.version desc), '[]')
          from public.saas_plan_versions v join public.saas_plans p on p.id = v.plan_id);
end;
$$;

-- New prices or limits = a new DRAFT version. Subscribers keep their version.
create function public.admin_save_plan_version(p_plan text, p_monthly int, p_annual int, p_trial_days int, p_features jsonb,
  p_member_limit int, p_staff_limit int, p_branch_limit int, p_notes text)
returns public.saas_plan_versions language plpgsql security definer set search_path = '' as $$
declare r public.saas_plan_versions;
begin
  perform private.require_platform('owner');
  if not exists (select 1 from public.saas_plans where id = p_plan) then raise exception 'XS422: unknown plan' using errcode = '22023'; end if;
  if p_features is null or jsonb_typeof(p_features) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_features) k where k not in (select key from public.saas_features)) then
    raise exception 'XS422: features must use known feature keys' using errcode = '22023';
  end if;
  insert into public.saas_plan_versions (plan_id, version, monthly_price_paise, annual_price_paise, trial_days, features,
    member_limit, staff_limit, branch_limit, status, provisional, notes, created_by)
  values (p_plan, coalesce((select max(version) from public.saas_plan_versions where plan_id = p_plan), 0) + 1,
    p_monthly, p_annual, coalesce(p_trial_days, 30), p_features, p_member_limit, p_staff_limit, coalesce(p_branch_limit, 1),
    'draft', true, left(p_notes, 500), auth.uid())
  returning * into r;
  perform private.admin_log('plan_version.create', 'plan_version', r.id::text, p_notes, null, to_jsonb(r));
  return r;
end;
$$;

-- Founder approval: the version goes on sale (not provisional) and replaces the
-- previous active one for NEW purchases only.
create function public.admin_activate_plan_version(p_version uuid, p_reason text)
returns public.saas_plan_versions language plpgsql security definer set search_path = '' as $$
declare r public.saas_plan_versions; old public.saas_plan_versions; v_reason text := private.require_reason(p_reason);
begin
  perform private.require_platform('owner');
  select * into r from public.saas_plan_versions where id = p_version for update;
  if not found or r.status <> 'draft' then raise exception 'XS409: only a draft version can be activated' using errcode = 'P0001'; end if;
  if (select is_public from public.saas_plans where id = r.plan_id) and r.monthly_price_paise is null and r.annual_price_paise is null then
    raise exception 'XS422: set at least one price first' using errcode = '22023';
  end if;
  select * into old from public.saas_plan_versions where plan_id = r.plan_id and status = 'active' for update;
  if found then
    update public.saas_plan_versions set status = 'retired', effective_to = now() where id = old.id;
  end if;
  update public.saas_plan_versions set status = 'active', provisional = false, effective_from = now(),
         approved_by = auth.uid(), approved_at = now() where id = p_version returning * into r;
  perform private.admin_log('plan_version.activate', 'plan_version', r.id::text, v_reason, to_jsonb(old), to_jsonb(r));
  return r;
end;
$$;

create function public.admin_update_billing_settings(p_patch jsonb, p_reason text)
returns public.saas_billing_settings language plpgsql security definer set search_path = '' as $$
declare b public.saas_billing_settings; r public.saas_billing_settings; k text; v_reason text := private.require_reason(p_reason);
begin
  perform private.require_platform('owner');
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('default_trial_days', 'trial_plan_id', 'past_due_days', 'grace_days', 'expired_access', 'test_payments_grant_access',
                 'allow_provisional_checkout', 'gst_status', 'gstin', 'gst_rate_bp', 'prices_include_gst', 'sac_code', 'legal_name',
                 'supplier_address', 'supplier_state_code', 'support_email', 'invoice_prefix', 'payment_terms') then
      raise exception 'XS422: % cannot be changed here', k using errcode = '22023';
    end if;
  end loop;
  select * into b from public.saas_billing_settings where id for update;
  r := jsonb_populate_record(b, p_patch);
  r.updated_at := now(); r.updated_by := auth.uid();
  if r.gst_status = 'registered' and r.gstin is null then raise exception 'XS422: enter the GSTIN to mark GST as registered' using errcode = '22023'; end if;
  update public.saas_billing_settings s set
    default_trial_days = r.default_trial_days, trial_plan_id = r.trial_plan_id, past_due_days = r.past_due_days, grace_days = r.grace_days,
    expired_access = r.expired_access, test_payments_grant_access = r.test_payments_grant_access,
    allow_provisional_checkout = r.allow_provisional_checkout, gst_status = r.gst_status, gstin = r.gstin, gst_rate_bp = r.gst_rate_bp,
    prices_include_gst = r.prices_include_gst, sac_code = r.sac_code, legal_name = r.legal_name, supplier_address = r.supplier_address,
    supplier_state_code = r.supplier_state_code, support_email = r.support_email, invoice_prefix = r.invoice_prefix,
    payment_terms = r.payment_terms, updated_at = r.updated_at, updated_by = r.updated_by
  where s.id returning * into r;
  perform private.admin_log('settings.update', 'billing_settings', 'singleton', v_reason, to_jsonb(b), to_jsonb(r));
  return r;
end;
$$;

create function public.admin_get_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform('viewer');
  return jsonb_build_object('billing', (select to_jsonb(s) from public.saas_billing_settings s), 'cost_model', (select to_jsonb(c) from public.saas_cost_model c),
                            'role', private.platform_role());
end;
$$;

create function public.admin_save_cost_model(p_patch jsonb, p_reason text)
returns public.saas_cost_model language plpgsql security definer set search_path = '' as $$
declare b public.saas_cost_model; r public.saas_cost_model; k text; v_reason text := private.require_reason(p_reason);
begin
  perform private.require_platform('owner');
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('fixed_infra_monthly_paise', 'infra_per_gym_monthly_paise', 'ai_cost_per_gym_monthly_paise', 'gateway_fee_bp',
                 'support_per_gym_monthly_paise', 'cac_paise', 'fixed_overhead_monthly_paise', 'notes') then
      raise exception 'XS422: % cannot be changed here', k using errcode = '22023';
    end if;
  end loop;
  select * into b from public.saas_cost_model where id for update;
  r := jsonb_populate_record(b, p_patch);
  update public.saas_cost_model c set fixed_infra_monthly_paise = r.fixed_infra_monthly_paise, infra_per_gym_monthly_paise = r.infra_per_gym_monthly_paise,
    ai_cost_per_gym_monthly_paise = r.ai_cost_per_gym_monthly_paise, gateway_fee_bp = r.gateway_fee_bp,
    support_per_gym_monthly_paise = r.support_per_gym_monthly_paise, cac_paise = r.cac_paise,
    fixed_overhead_monthly_paise = r.fixed_overhead_monthly_paise, notes = r.notes, updated_at = now(), updated_by = auth.uid()
  where c.id returning * into r;
  perform private.admin_log('cost_model.update', 'cost_model', 'singleton', v_reason, to_jsonb(b), to_jsonb(r));
  return r;
end;
$$;

-- Records a refund made in the Razorpay dashboard (this does not move money).
create function public.admin_record_refund(p_payment uuid, p_amount_paise int, p_reason text)
returns public.saas_refunds language plpgsql security definer set search_path = '' as $$
declare p public.saas_payments; r public.saas_refunds; v_reason text := private.require_reason(p_reason);
begin
  perform private.require_platform('admin');
  select * into p from public.saas_payments where id = p_payment for update;
  if not found or p.status <> 'paid' then raise exception 'XS409: only paid payments can be refunded' using errcode = 'P0001'; end if;
  if p_amount_paise <= 0 or p_amount_paise > p.amount_paise - p.refunded_paise then
    raise exception 'XS422: refund must be between ₹0.01 and what is left on the payment' using errcode = '22023';
  end if;
  insert into public.saas_refunds (payment_id, gym_id, amount_paise, status, reason, source, created_by)
  values (p.id, p.gym_id, p_amount_paise, 'recorded', v_reason, 'admin', auth.uid()) returning * into r;
  perform private.saas_refresh_refunds(p.id);
  insert into public.saas_subscription_events (gym_id, event, source, actor, details)
  values (p.gym_id, 'refund.recorded', 'admin', auth.uid(), jsonb_build_object('saas_payment_id', p.id, 'amount_paise', p_amount_paise, 'reason', v_reason));
  perform private.admin_log('refund.record', 'saas_payment', p.id::text, v_reason, null, to_jsonb(r));
  return r;
end;
$$;

create function public.admin_audit_log(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform('viewer');
  return (select coalesce(jsonb_agg(x order by x.id desc), '[]') from (
    select a.id, a.created_at, a.action, a.target_type, a.target_id, a.reason, a.before, a.after,
           (select email from auth.users where id = a.actor) actor
      from public.saas_admin_audit a order by a.id desc limit least(greatest(p_limit, 1), 1000)) x);
end;
$$;

-- Rows for CSV export (kind: subscriptions | payments | invoices | events)
create function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform('viewer');
  return case p_kind
    when 'subscriptions' then public.admin_subscriptions()
    when 'payments' then (select coalesce(jsonb_agg(jsonb_build_object('gym', g.name, 'created_at', p.created_at, 'paid_at', p.paid_at,
        'status', p.status, 'mode', p.mode, 'kind', p.kind, 'plan_version_id', p.plan_version_id, 'cycle', p.billing_cycle,
        'amount_paise', p.amount_paise, 'credit_paise', p.credit_paise, 'refunded_paise', p.refunded_paise,
        'period_start', p.period_start, 'period_end', p.period_end, 'gateway_payment_id', p.payment_id) order by p.created_at desc), '[]')
      from public.saas_payments p join public.gyms g on g.id = p.gym_id)
    when 'invoices' then (select coalesce(jsonb_agg(jsonb_build_object('number', i.number, 'gym', g.name, 'issued_at', i.issued_at,
        'doc_type', i.doc_type, 'mode', i.mode, 'taxable_paise', i.taxable_paise, 'cgst_paise', i.cgst_paise, 'sgst_paise', i.sgst_paise,
        'igst_paise', i.igst_paise, 'total_paise', i.total_paise, 'refunded_paise', i.refunded_paise, 'status', i.status) order by i.issued_at), '[]')
      from public.saas_invoices i join public.gyms g on g.id = i.gym_id)
    when 'events' then (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]') from public.saas_subscription_events e)
    else null end;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.is_platform_admin()', 'public.admin_commercial_metrics()', 'public.admin_overview()', 'public.admin_subscriptions()',
    'public.admin_gym_billing(uuid)', 'public.admin_extend_trial(uuid, int, text)', 'public.admin_grant_complimentary(uuid, timestamptz, text, text)',
    'public.admin_end_complimentary(uuid, timestamptz, text)', 'public.admin_set_plan(uuid, uuid, text)', 'public.admin_set_state(uuid, text, text)',
    'public.admin_list_plan_versions()', 'public.admin_save_plan_version(text, int, int, int, jsonb, int, int, int, text)',
    'public.admin_activate_plan_version(uuid, text)', 'public.admin_update_billing_settings(jsonb, text)', 'public.admin_get_settings()',
    'public.admin_save_cost_model(jsonb, text)', 'public.admin_record_refund(uuid, int, text)', 'public.admin_audit_log(int)',
    'public.admin_export(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ===========================================================================
-- 11. Row-level security and grants
-- ===========================================================================
alter table public.saas_features enable row level security;
alter table public.saas_plans enable row level security;
alter table public.saas_plan_versions enable row level security;
alter table public.saas_addons enable row level security;
alter table public.saas_billing_settings enable row level security;
alter table public.platform_admins enable row level security;
alter table public.saas_admin_audit enable row level security;
alter table public.saas_subscription_events enable row level security;
alter table public.saas_trial_registry enable row level security;
alter table public.saas_billing_profiles enable row level security;
alter table public.saas_invoice_counters enable row level security;
alter table public.saas_invoices enable row level security;
alter table public.saas_refunds enable row level security;
alter table public.saas_disputes enable row level security;
alter table public.saas_payment_attempts enable row level security;
alter table public.saas_gateway_events enable row level security;
alter table public.saas_notifications enable row level security;
alter table public.saas_cost_model enable row level security;

-- Catalogue is public; drafts are visible only through public_pricing (flagged provisional).
create policy saas_features_read on public.saas_features for select to anon, authenticated using (true);
create policy saas_plans_read on public.saas_plans for select to anon, authenticated using (is_public and is_active);
create policy saas_plan_versions_read on public.saas_plan_versions for select to authenticated
  using (status = 'active' or id in (select plan_version_id from public.gym_subscriptions s where private.is_staff(s.gym_id)));
create policy saas_addons_read on public.saas_addons for select to anon, authenticated using (status <> 'retired');
grant select on public.saas_features, public.saas_plans, public.saas_addons to anon, authenticated;
grant select on public.saas_plan_versions to authenticated;

create policy saas_events_read on public.saas_subscription_events for select to authenticated
  using ((select private.has_permission(gym_id, 'billing.manage')));
create policy saas_profiles_read on public.saas_billing_profiles for select to authenticated
  using ((select private.has_permission(gym_id, 'billing.manage')));
create policy saas_invoices_read on public.saas_invoices for select to authenticated
  using ((select private.has_permission(gym_id, 'billing.manage')));
create policy saas_refunds_read on public.saas_refunds for select to authenticated
  using ((select private.has_permission(gym_id, 'billing.manage')));
create policy saas_notifications_read on public.saas_notifications for select to authenticated
  using ((select private.has_permission(gym_id, 'billing.manage')));
grant select on public.saas_subscription_events, public.saas_billing_profiles, public.saas_invoices, public.saas_refunds,
  public.saas_notifications to authenticated;
-- No client policies: platform_admins, saas_admin_audit, saas_trial_registry, saas_invoice_counters,
-- saas_disputes, saas_payment_attempts, saas_gateway_events, saas_cost_model, saas_billing_settings
-- (read through admin_* functions and public_pricing only).

grant select, insert, update on public.saas_payments to service_role;
grant select on public.saas_plan_versions, public.saas_plans, public.saas_billing_settings to service_role;

-- Clients may not change subscriptions or entitlements directly (they never could;
-- stated here so a future grant does not open it by accident).
revoke insert, update, delete on public.gym_subscriptions from anon, authenticated;
