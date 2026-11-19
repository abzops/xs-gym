-- XS Gym subscription billing through Razorpay Payment Links.
--
-- The gym owner (billing.manage) picks a price in Settings; the xs-billing Edge
-- Function makes a Razorpay payment link, the owner pays on Razorpay's page and
-- comes back. A payment is only ever applied by the server (service role) after
-- it has asked Razorpay that the link is paid, either on return (xs-billing
-- 'check') or from Razorpay's webhook (xs-billing-webhook). Applying is
-- idempotent: the second caller gets the same result.
--
-- This is Xelorsoft's money from gyms; it is never joined to member money.
-- Billing must keep working when the subscription has ended, so these functions
-- check the permission directly instead of private.require (which blocks writes
-- on an ended subscription).

-- ---------------------------------------------------------------------------
-- Prices. Change prices here (update the row); the app reads them live.
-- ---------------------------------------------------------------------------
create table public.saas_prices (
  code         text primary key check (code ~ '^[a-z0-9_]{2,30}$'),
  label        text not null check (length(label) between 2 and 40),
  months       int  not null check (months between 1 and 36),
  amount_paise int  not null check (amount_paise >= 100),
  active       boolean not null default true,
  sort         int  not null default 0
);

insert into public.saas_prices (code, label, months, amount_paise, sort) values
  ('monthly', 'Monthly', 1, 49900, 1),
  ('yearly',  'Yearly', 12, 499000, 2);

alter table public.saas_prices enable row level security;
create policy saas_prices_read on public.saas_prices for select to authenticated using (active);
grant select on public.saas_prices to authenticated;

-- ---------------------------------------------------------------------------
-- Payments (one row per payment link)
-- ---------------------------------------------------------------------------
create table public.saas_payments (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references public.gyms (id),
  price_code   text not null references public.saas_prices (code),
  months       int  not null check (months between 1 and 36),
  amount_paise int  not null check (amount_paise >= 100),
  status       text not null default 'created' check (status in ('created', 'paid', 'expired', 'cancelled', 'failed')),
  provider     text not null default 'razorpay',
  mode         text check (mode in ('test', 'live')),
  link_id      text unique,
  link_url     text,
  payment_id   text unique,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz,
  period_start timestamptz,
  period_end   timestamptz
);
create index saas_payments_gym_idx on public.saas_payments (gym_id, created_at desc);

alter table public.saas_payments enable row level security;
create policy saas_payments_read on public.saas_payments for select to authenticated
  using ((select private.has_permission(gym_id, 'billing.manage')));
grant select on public.saas_payments to authenticated;
grant select, insert, update on public.saas_payments to service_role;
grant select on public.saas_prices to service_role;

-- ---------------------------------------------------------------------------
-- Called by xs-billing as the signed-in owner, before a link is made.
-- Checks the permission and returns what the link needs. Writes nothing.
-- ---------------------------------------------------------------------------
create function public.prepare_saas_payment(p_gym uuid, p_price text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_price public.saas_prices;
  v_gym   public.gyms;
  v_email text;
  v_open  int;
begin
  if auth.uid() is null then
    raise exception 'XS401: sign in required' using errcode = '42501';
  end if;
  if not private.has_permission(p_gym, 'billing.manage') then
    raise exception 'XS403: only the gym owner can pay for XS Gym' using errcode = '42501';
  end if;
  select * into v_price from public.saas_prices where code = p_price and active;
  if not found then
    raise exception 'XS422: that price is not available' using errcode = 'P0001';
  end if;
  select * into v_gym from public.gyms where id = p_gym;
  select count(*) into v_open from public.saas_payments
    where gym_id = p_gym and created_at > now() - interval '1 hour';
  if v_open >= 10 then
    raise exception 'XS429: too many payment attempts. Please wait a while and try again.' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  return jsonb_build_object(
    'gym_id', v_gym.id, 'gym_name', v_gym.name, 'gym_phone', v_gym.phone, 'slug', v_gym.slug,
    'user_id', auth.uid(), 'email', v_email,
    'price_code', v_price.code, 'label', v_price.label, 'months', v_price.months, 'amount_paise', v_price.amount_paise);
end;
$$;
revoke all on function public.prepare_saas_payment(uuid, text) from public, anon;
grant execute on function public.prepare_saas_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Applies a paid link. Server only (service role), after Razorpay has said the
-- link is paid. The new period starts when the current one ends (trial or paid),
-- or now if that is already past.
-- ---------------------------------------------------------------------------
create function public.apply_saas_payment(p_link_id text, p_payment_id text, p_amount_paise int)
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
