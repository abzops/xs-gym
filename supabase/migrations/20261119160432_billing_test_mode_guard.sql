-- Safety hotfix: a Razorpay test-mode payment must never give a real gym paid time.
--
-- Until live Razorpay keys and founder-approved prices exist, the production
-- secrets hold test keys. Only gyms marked billing_test (the demo gym) may use
-- test mode; for every other gym the pay buttons stay hidden, xs-billing refuses
-- to make a test link, and apply_saas_payment refuses a test payment.
-- billing_test is set by Xelorsoft only (no write policy or command for it).

alter table public.gym_subscriptions
  add column billing_test boolean not null default false;

comment on column public.gym_subscriptions.billing_test is
  'Xelorsoft-only: this gym may pay with Razorpay test keys (demo/testing). Real gyms: false.';

update public.gym_subscriptions s
   set billing_test = true
  from public.gyms g
 where g.id = s.gym_id and g.slug = 'xs-fitness-studio';

-- Same as 20261119120153, plus billing_test in the result so xs-billing can refuse test links.
create or replace function public.prepare_saas_payment(p_gym uuid, p_price text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_price public.saas_prices;
  v_gym   public.gyms;
  v_email text;
  v_open  int;
  v_test  boolean;
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
  select coalesce(billing_test, false) into v_test from public.gym_subscriptions where gym_id = p_gym;
  return jsonb_build_object(
    'gym_id', v_gym.id, 'gym_name', v_gym.name, 'gym_phone', v_gym.phone, 'slug', v_gym.slug,
    'user_id', auth.uid(), 'email', v_email,
    'price_code', v_price.code, 'label', v_price.label, 'months', v_price.months, 'amount_paise', v_price.amount_paise,
    'billing_test', coalesce(v_test, false));
end;
$$;

-- Same as 20261119120153, plus: a test-mode payment is refused unless the gym is billing_test.
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
  if coalesce(p.mode, 'test') <> 'live' and not coalesce(s.billing_test, false) then
    raise exception 'XS403: a test-mode payment cannot be applied to this gym' using errcode = '42501';
  end if;

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
