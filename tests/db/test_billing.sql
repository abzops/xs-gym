-- XS Gym subscription billing (migration 20261119120153_saas_billing).
-- Runs after test_core.sql (reuses its t.* helpers).
\set ON_ERROR_STOP on
set client_min_messages = notice;
\o /dev/null

reset role;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;
grant select on t.ids to service_role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'owner.d@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'manager.d@test.local');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
insert into t.ids select 'gymC', id from public.create_gym('Billing Gym', '9876500009');
select public.save_staff(t.id('gymC'), 'manager.d@test.local', 'manager');

-- Prices are readable; owner can prepare a payment
select t.eq((select count(*) from public.saas_prices)::int, 2, 'billing: two active prices');
select t.eq((public.prepare_saas_payment(t.id('gymC'), 'monthly')->>'amount_paise')::int, 49900, 'billing: owner prepares monthly');
select t.eq(public.prepare_saas_payment(t.id('gymC'), 'yearly')->>'email', 'owner.d@test.local', 'billing: prepare returns owner email');
select t.fails($$select public.prepare_saas_payment(t.id('gymC'), 'lifetime')$$, 'XS422', 'billing: unknown price refused');

-- Manager cannot pay; other gyms cannot pay for this gym
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', false);
select t.fails($$select public.prepare_saas_payment(t.id('gymC'), 'monthly')$$, 'XS403', 'billing: manager cannot pay');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.fails($$select public.prepare_saas_payment(t.id('gymC'), 'monthly')$$, 'XS403', 'billing: other gym owner cannot pay');

-- Clients cannot apply or insert payments
select t.fails($$select public.apply_saas_payment('plink_x', 'pay_x', 49900)$$, 'permission denied', 'billing: client cannot apply a payment');
select t.fails($$insert into public.saas_payments (gym_id, price_code, months, amount_paise, created_by) values (t.id('gymC'), 'monthly', 1, 1, auth.uid())$$, 'permission denied', 'billing: client cannot insert a payment');

-- Test-mode guard: a real gym cannot get paid time from a Razorpay test payment
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select t.eq(public.prepare_saas_payment(t.id('gymC'), 'monthly')->>'billing_test', 'false', 'billing: real gym is not a test gym');
reset role;
insert into public.saas_payments (gym_id, price_code, months, amount_paise, created_by, link_id, mode)
  values (t.id('gymC'), 'monthly', 1, 49900, '00000000-0000-0000-0000-0000000000d1', 'plink_test_0', 'test');
set role service_role;
select t.fails($$select public.apply_saas_payment('plink_test_0', 'pay_0', 49900)$$, 'XS403', 'billing: test payment refused for a real gym');
reset role;
select t.eq((select status from public.gym_subscriptions where gym_id = t.id('gymC')), 'trial', 'billing: real gym still on trial after test payment');
select t.eq((select status from public.saas_payments where link_id = 'plink_test_0'), 'created', 'billing: refused test payment not marked paid');
update public.saas_payments set status = 'cancelled' where link_id = 'plink_test_0';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
-- Real Supabase grants table privileges and relies on RLS (no update policy = 0 rows); the shim refuses outright. Either way nothing changes.
do $$ begin update public.gym_subscriptions set billing_test = true where gym_id = t.id('gymC'); exception when insufficient_privilege then null; end $$;
reset role;
select t.eq((select billing_test from public.gym_subscriptions where gym_id = t.id('gymC')), false, 'billing: test flag unchanged by owner');

-- From here gymC is a Xelorsoft test gym, so the existing flow runs on test links.
update public.gym_subscriptions set billing_test = true where gym_id = t.id('gymC');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select t.eq(public.prepare_saas_payment(t.id('gymC'), 'monthly')->>'billing_test', 'true', 'billing: test gym flagged in prepare');
reset role;

-- Server records a link, then applies it
insert into public.saas_payments (gym_id, price_code, months, amount_paise, created_by, link_id, mode)
  values (t.id('gymC'), 'monthly', 1, 49900, '00000000-0000-0000-0000-0000000000d1', 'plink_test_1', 'test');
set role service_role;
select t.fails($$select public.apply_saas_payment('plink_test_1', 'pay_1', 100)$$, 'XS409', 'billing: wrong amount refused');
select t.eq((public.apply_saas_payment('plink_test_1', 'pay_1', 49900)->>'applied')::boolean, true, 'billing: paid link applied');
select t.eq((public.apply_saas_payment('plink_test_1', 'pay_1', 49900)->>'already')::boolean, true, 'billing: second apply is a no-op');
reset role;
-- Trial still running: paid period starts when the trial ends
select t.eq((select status from public.gym_subscriptions where gym_id = t.id('gymC')), 'active', 'billing: subscription active');
select t.eq((select paid_until = trial_ends_at + interval '1 month' from public.gym_subscriptions where gym_id = t.id('gymC')), true, 'billing: month added after trial end');
select t.eq((select count(*) from public.audit_logs where gym_id = t.id('gymC') and action = 'billing.paid')::int, 1, 'billing: payment audited once');

-- Ended subscription: owner can still prepare a payment, and paying restarts from now
update public.gym_subscriptions set paid_until = now() - interval '2 days' where gym_id = t.id('gymC');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select t.fails($$select public.create_member(t.id('gymC'), 'Late', '9000000077')$$, 'XS402', 'billing: ended subscription is read-only');
select t.eq((public.prepare_saas_payment(t.id('gymC'), 'yearly')->>'months')::int, 12, 'billing: ended gym can still pay');
select t.eq((select count(*) from public.saas_payments where gym_id = t.id('gymC'))::int, 2, 'billing: owner reads own payments');
reset role;
insert into public.saas_payments (gym_id, price_code, months, amount_paise, created_by, link_id, mode)
  values (t.id('gymC'), 'yearly', 12, 499000, '00000000-0000-0000-0000-0000000000d1', 'plink_test_2', 'test');
set role service_role;
select public.apply_saas_payment('plink_test_2', 'pay_2', 499000);
reset role;
select t.eq((select paid_until between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months'
             from public.gym_subscriptions where gym_id = t.id('gymC')), true, 'billing: ended gym restarts from now');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', false);
select t.eq((select count(*) from public.saas_payments)::int, 0, 'billing: manager cannot see payments');
reset role;

\echo 'ALL BILLING TESTS PASSED'
