-- SaaS subscriptions (migration 20261119170000_saas_subscriptions).
-- Runs after test_core.sql and test_billing.sql (reuses their t.* helpers).
-- Synthetic customers only.
\set ON_ERROR_STOP on
set client_min_messages = notice;
\o /dev/null

reset role;
update public.saas_billing_settings set test_payments_grant_access = true, gst_status = 'unconfirmed';
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'Owner.E+gym@Gmail.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'manager.e@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'owner.e2@test.local'),     -- same phone as E: trial abuse
  ('00000000-0000-0000-0000-0000000000e4', 'ownere@gmail.com'),        -- same Gmail as E with dots/plus removed
  ('00000000-0000-0000-0000-0000000000f1', 'founder@xelorsoft.test'),  -- Xelorsoft owner
  ('00000000-0000-0000-0000-0000000000f2', 'viewer@xelorsoft.test'),   -- Xelorsoft viewer
  ('00000000-0000-0000-0000-0000000000f3', 'owner.g@test.local'),
  ('00000000-0000-0000-0000-0000000000f4', 'desk.g@test.local');
insert into public.platform_admins (user_id, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'owner'), ('00000000-0000-0000-0000-0000000000f2', 'viewer');

create function t.as_user(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', p::text, false) $$;
grant execute on function t.as_user(uuid) to authenticated, service_role;
create function t.sub(p_gym uuid) returns public.gym_subscriptions language sql as $$ select * from public.gym_subscriptions where gym_id = p_gym $$;
grant execute on function t.sub(uuid) to authenticated, service_role;
-- What xs-billing does after prepare_saas_checkout: record the payment link (service role).
create function t.record_link(p_prep jsonb, p_link text, p_mode text) returns uuid language sql security definer as $$
  insert into public.saas_payments (gym_id, price_code, months, amount_paise, created_by, link_id, mode,
    plan_version_id, billing_cycle, kind, list_price_paise, credit_paise)
  values ((p_prep->>'gym_id')::uuid, p_prep->>'price_code', (p_prep->>'months')::int, (p_prep->>'amount_paise')::int,
    (p_prep->>'user_id')::uuid, p_link, p_mode, (p_prep->>'plan_version_id')::uuid, p_prep->>'cycle', p_prep->>'kind',
    (p_prep->>'list_price_paise')::int, (p_prep->>'credit_paise')::int)
  returning id $$;
create function t.paid_event(p_link text, p_pay text, p_amount int) returns jsonb language sql as $$
  select jsonb_build_object('payment_link', jsonb_build_object('entity', jsonb_build_object('id', p_link, 'amount_paid', p_amount,
           'status', 'paid', 'notes', jsonb_build_object('product', 'xs-gym'))),
         'payment', jsonb_build_object('entity', jsonb_build_object('id', p_pay, 'amount', p_amount, 'status', 'captured'))) $$;
grant execute on all functions in schema t to service_role, authenticated;
create table t.money (k text primary key, v text);

-- ================================================================ catalogue
set role anon;
select t.eq(jsonb_array_length(public.public_pricing()->'plans'), 3, 'pricing: three public plans');
select t.eq((select string_agg(x->>'id', ',' order by (x->>'rank')::int) from jsonb_array_elements(public.public_pricing()->'plans') x), 'starter,growth,pro', 'pricing: starter, growth, pro');
select t.eq((select bool_and((x->>'provisional')::boolean) from jsonb_array_elements(public.public_pricing()->'plans') x), true, 'pricing: drafts shown as provisional');
select t.eq((public.public_pricing()#>>'{terms,trial_days}')::int, 30, 'pricing: 30-day trial');
select t.fails($$select * from public.saas_billing_settings$$, 'permission denied', 'anon cannot read billing settings');
select t.fails($$select * from public.saas_plan_versions$$, 'permission denied', 'anon cannot read plan versions');
select t.fails($$select public.admin_overview()$$, 'permission denied', 'anon cannot call admin');
reset role;

-- ================================================================ trial and trial abuse
select t.eq(private.normalize_email('Owner.E+gym@Gmail.com'), 'ownere@gmail.com', 'email: gmail dots and +tag removed');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000e1');
insert into t.ids select 'gymE', id from public.create_gym('Trial Gym E', '9876511111');
select t.eq((t.sub(t.id('gymE'))).state, 'TRIALING', 'trial: new gym is trialing');
select t.eq((select (trial_ends_at - trial_started_at) = interval '30 days' from public.gym_subscriptions where gym_id = t.id('gymE')), true, 'trial: 30 days');
select t.eq(public.gym_entitlements(t.id('gymE'))->>'plan_id', 'pro', 'trial: trial uses Pro features');
select t.eq((public.gym_entitlements(t.id('gymE'))->>'can_write')::boolean, true, 'trial: can write');
select t.eq((t.sub(t.id('gymE'))).status, 'trial', 'trial: legacy status kept in sync');
select public.save_staff(t.id('gymE'), 'manager.e@test.local', 'manager');

select t.as_user('00000000-0000-0000-0000-0000000000e3');
insert into t.ids select 'gymE2', id from public.create_gym('Same Phone Gym', '+91 98765 11111');
select t.eq((t.sub(t.id('gymE2'))).state, 'EXPIRED', 'trial abuse: same phone gets no second trial');
select t.eq((t.sub(t.id('gymE2'))).trial_eligible, false, 'trial abuse: marked ineligible');
select t.fails($$select public.create_member(t.id('gymE2'), 'Free Rider', '9000000201')$$, 'XS402', 'trial abuse: refused gym is read-only');
select t.eq((public.prepare_saas_checkout(t.id('gymE2'), 'starter', 'monthly')->>'kind'), 'new', 'trial abuse: can still buy a plan');
select t.as_user('00000000-0000-0000-0000-0000000000e4');
insert into t.ids select 'gymE3', id from public.create_gym('Same Email Gym', null);
select t.eq((t.sub(t.id('gymE3'))).state, 'EXPIRED', 'trial abuse: same Gmail (dots removed) gets no second trial');
reset role;
select t.eq((select count(*) from public.saas_subscription_events where gym_id = t.id('gymE2') and event = 'trial.refused')::int, 1, 'trial abuse: refusal logged');

-- ================================================================ clients cannot change their plan
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000e1');
select t.fails($$update public.gym_subscriptions set plan_version_id = (select id from public.saas_plan_versions where plan_id = 'pilot') where gym_id = t.id('gymE')$$, 'permission denied', 'owner cannot update subscription row');
select t.fails($$insert into public.saas_plan_versions (plan_id, version) values ('pro', 99)$$, 'permission denied', 'owner cannot add plan versions');
select t.fails($$update public.saas_billing_settings set test_payments_grant_access = true$$, 'permission denied', 'owner cannot change billing settings');
select t.fails($$select public.apply_saas_payment('x', 'y', 1)$$, 'permission denied', 'owner cannot apply payments');
select t.fails($$select public.ingest_gateway_event('evt_000001', 'payment_link.paid', '{}')$$, 'permission denied', 'owner cannot inject webhooks');
select t.fails($$select public.billing_tick()$$, 'permission denied', 'owner cannot run the billing clock');
select t.fails($$select public.admin_grant_complimentary(t.id('gymE'), null, 'pilot', 'free please')$$, 'XS403', 'owner cannot grant themselves access');
select t.fails($$select public.admin_overview()$$, 'XS403', 'owner cannot see Xelorsoft dashboard');
select t.fails($$insert into public.platform_admins values (auth.uid(), 'owner')$$, 'permission denied', 'owner cannot make themselves admin');
select t.as_user('00000000-0000-0000-0000-0000000000e2');
select t.fails($$select public.prepare_saas_checkout(t.id('gymE'), 'growth', 'monthly')$$, 'XS403', 'manager cannot buy');
select t.fails($$select public.cancel_subscription(t.id('gymE'))$$, 'XS403', 'manager cannot cancel');
select t.as_user('00000000-0000-0000-0000-0000000000b1');
select t.fails($$select public.gym_entitlements(t.id('gymE'))$$, 'XS403', 'other gym cannot read entitlements');
select t.fails($$select public.prepare_saas_checkout(t.id('gymE'), 'growth', 'monthly')$$, 'XS403', 'other gym cannot buy for E');
reset role;

-- ================================================================ admin: prices are versions; founder approval needed
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000f2');
select t.fails($$select public.admin_save_plan_version('starter', 100, 1000, 30, '{}', 2, 1, 1, 'x')$$, 'XS403', 'viewer cannot edit prices');
select t.eq((public.admin_overview()->>'gyms_total')::int > 0, true, 'viewer sees overview');
select t.as_user('00000000-0000-0000-0000-0000000000f1');
select t.fails($$select public.admin_save_plan_version('starter', 100, 1000, 30, '{"teleport":true}', 2, 1, 1, 'x')$$, 'XS422', 'unknown feature key refused');
-- Tiny test-only versions so limits are easy to reach
insert into t.ids select 'starterT', id from public.admin_save_plan_version('starter', 50000, 500000, 30,
  '{"analytics":false,"enquiries":false,"xs_ai":false}', 2, 1, 1, 'test version');
insert into t.ids select 'growthT', id from public.admin_save_plan_version('growth', 100000, 1000000, 30,
  '{"analytics":true,"enquiries":true,"xs_ai":true}', 5, 3, 1, 'test version');
select t.eq((select x->>'status' from jsonb_array_elements(public.admin_list_plan_versions()) x where x->>'id' = t.id('starterT')::text), 'draft', 'new version is a draft');
select t.fails($$select public.admin_activate_plan_version(t.id('starterT'), '')$$, 'XS422', 'activation needs a reason');
select public.admin_activate_plan_version(t.id('starterT'), 'test approval');
select public.admin_activate_plan_version(t.id('growthT'), 'test approval');
select t.eq((select (x->>'provisional')::boolean from jsonb_array_elements(public.admin_list_plan_versions()) x where x->>'id' = t.id('starterT')::text), false, 'activated version is not provisional');
select t.eq((select x->>'status' from jsonb_array_elements(public.admin_list_plan_versions()) x where x->>'plan_id' = 'starter' and x->>'version' = '1'), 'draft', 'old draft untouched');
select t.fails($$select count(*) from public.saas_admin_audit$$, 'permission denied', 'admin audit not readable directly');
reset role;
select t.eq((select count(*) from public.saas_admin_audit where action = 'plan_version.activate')::int, 2, 'activations audited');
select t.fails($$update public.saas_admin_audit set reason = 'x'$$, 'XS405', 'admin audit is append-only');

-- ================================================================ entitlements and limits (server-side)
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000f1');
select public.admin_set_plan(t.id('gymE'), t.id('starterT'), 'test: starter limits');
select t.as_user('00000000-0000-0000-0000-0000000000e1');
select t.eq(public.gym_entitlements(t.id('gymE'))->>'plan_id', 'starter', 'starter applied');
insert into t.ids select 'memE1', id from public.create_member(t.id('gymE'), 'Member One', '9000000301');
insert into t.ids select 'memE2', id from public.create_member(t.id('gymE'), 'Member Two', '9000000302');
select t.fails($$select public.create_member(t.id('gymE'), 'Member Three', '9000000303')$$, 'XS402', 'member limit enforced');
select public.set_member_status(t.id('gymE'), t.id('memE2'), 'archived', 'left');
insert into t.ids select 'memE3', id from public.create_member(t.id('gymE'), 'Member Three', '9000000303');
select t.fails($$select public.set_member_status(t.id('gymE'), t.id('memE2'), 'active', 'back')$$, 'XS402', 'restoring over the limit refused');
select t.eq((select count(*) from public.members where gym_id = t.id('gymE'))::int, 3, 'limit never deletes members');
select t.fails($$select public.save_enquiry(t.id('gymE'), null, 'Lead', '9000000399', 'walk_in', null, null, null, 'new', null)$$, 'XS402', 'enquiries need Growth');
select t.fails($$select public.gym_analytics(t.id('gymE'), 3)$$, 'XS402', 'analytics need Growth');
select t.eq(public.gym_entitlements(t.id('gymE'))#>>'{features,xs_ai}', 'false', 'XS AI off on Starter');
-- staff limit 1: the manager already uses it
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e5', 'desk.e@test.local');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000e1');
select t.fails($$select public.save_staff(t.id('gymE'), 'desk.e@test.local', 'reception')$$, 'XS402', 'staff limit enforced');
select t.as_user('00000000-0000-0000-0000-0000000000f1');
select public.admin_set_plan(t.id('gymE'), t.id('growthT'), 'test: growth');
select t.as_user('00000000-0000-0000-0000-0000000000e1');
select public.save_staff(t.id('gymE'), 'desk.e@test.local', 'reception');
select t.eq(jsonb_typeof(public.gym_analytics(t.id('gymE'), 3)), 'object', 'analytics open on Growth');
select public.save_enquiry(t.id('gymE'), null, 'Lead', '9000000399', 'walk_in', null, null, null, 'new', null);
reset role;

-- Gym's own member money, to prove SaaS billing never touches it
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000e1');
insert into t.ids select 'planE', id from public.save_plan(t.id('gymE'), null, 'Monthly', 'month', 1, 120000);
select public.sell_membership(t.id('gymE'), t.id('memE1'), t.id('planE'), gen_random_uuid());
select public.record_payment(t.id('gymE'), t.id('memE1'), 120000, 'upi', gen_random_uuid());
reset role;
insert into t.money select 'before', md5(string_agg(x, ',' order by x)) from (
  select id::text || amount_paise || method x from public.payments
  union all select id::text || net_paise || status from public.charges
  union all select payment_id::text || charge_id || amount_paise from public.payment_allocations) m;

-- ================================================================ checkout kinds and prices
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000e1');
select t.eq(public.prepare_saas_checkout(t.id('gymE'), 'growth', 'monthly')->>'kind', 'new', 'checkout in trial: new');
select t.eq((public.prepare_saas_checkout(t.id('gymE'), 'growth', 'monthly')->>'period_start')::timestamptz = (t.sub(t.id('gymE'))).trial_ends_at,
  true, 'checkout in trial: paid period starts when the trial ends');
select t.eq((public.prepare_saas_checkout(t.id('gymE'), 'growth', 'annual')->>'amount_paise')::int, 1000000, 'checkout: annual price from version');
select t.eq((public.prepare_saas_checkout(t.id('gymE'), 'pro', 'monthly')->>'provisional')::boolean, true, 'checkout: draft Pro is provisional');
select t.fails($$select public.prepare_saas_checkout(t.id('gymE'), 'pilot', 'monthly')$$, 'XS422', 'checkout: hidden plan not for sale');
select t.fails($$select public.prepare_saas_checkout(t.id('gymE'), 'growth', 'weekly')$$, 'XS422', 'checkout: unknown cycle');
reset role;
update public.saas_billing_settings set allow_provisional_checkout = false;
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000e1');
select t.fails($$select public.prepare_saas_checkout(t.id('gymE'), 'pro', 'monthly')$$, 'XS503', 'provisional plan blocked when switched off');
reset role;
update public.saas_billing_settings set allow_provisional_checkout = true;

-- ================================================================ verified payment via webhook (idempotent, out of order)
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000e1');
insert into t.ids select 'payE1', t.record_link(public.prepare_saas_checkout(t.id('gymE'), 'growth', 'monthly'), 'plink_E1', 'test');
reset role;
-- Nothing changes until the server confirms
select t.eq((t.sub(t.id('gymE'))).state, 'TRIALING', 'unpaid link changes nothing');
set role service_role;
select t.eq(public.ingest_gateway_event('evt_E1_paid', 'payment_link.paid', t.paid_event('plink_E1', 'pay_E1', 99), null)->>'status', 'failed', 'webhook: wrong amount fails (gateway retries)');
select t.eq(public.ingest_gateway_event('evt_E1_paid2', 'payment_link.paid', t.paid_event('plink_E1', 'pay_E1', 100000), null)->>'status', 'processed', 'webhook: paid link processed');
select t.eq(public.ingest_gateway_event('evt_E1_paid2', 'payment_link.paid', t.paid_event('plink_E1', 'pay_E1', 100000), null)->>'duplicate', 'true', 'webhook: same event id is a no-op');
select t.eq(public.ingest_gateway_event('evt_E1_paid3', 'payment_link.paid', t.paid_event('plink_E1', 'pay_E1', 100000), null)->>'already', 'true', 'webhook: second event for same link is a no-op');
select t.eq(public.ingest_gateway_event('evt_E1_exp', 'payment_link.expired', jsonb_build_object('payment_link', jsonb_build_object('entity', jsonb_build_object('id', 'plink_E1'))), null)->>'status', 'processed', 'webhook: late "expired" accepted');
select t.eq((select status from public.saas_payments where link_id = 'plink_E1'), 'paid', 'out of order: expired after paid keeps paid');
select t.eq(public.ingest_gateway_event('evt_other', 'payment_link.paid', jsonb_build_object('payment_link', jsonb_build_object('entity', jsonb_build_object('id', 'plink_zz', 'notes', jsonb_build_object('product', 'xs-connect')))), null)->>'status', 'ignored', 'webhook: other products ignored');
select t.fails($$select public.ingest_gateway_event('', 'x', '{}')$$, 'XS422', 'webhook: event id required');
reset role;
select t.eq((t.sub(t.id('gymE'))).state, 'ACTIVE', 'paid: active');
select t.eq((t.sub(t.id('gymE'))).current_period_start = (t.sub(t.id('gymE'))).trial_ends_at, true, 'paid in trial: no trial days lost');
select t.eq((select count(*) from public.saas_invoices where gym_id = t.id('gymE'))::int, 1, 'paid: one invoice');
select t.eq((select number ~ ('^TEST/' || private.fy_label(now()) || '/[0-9]{4}$') from public.saas_invoices where gym_id = t.id('gymE')), true, 'test payments use the TEST series');
select t.eq((select doc_type from public.saas_invoices where gym_id = t.id('gymE')), 'receipt', 'GST unconfirmed: receipt, no tax');
select t.eq((select tax_paise from public.saas_invoices where gym_id = t.id('gymE')), 0, 'GST unconfirmed: no tax charged');
select t.eq((select count(*) from public.saas_gateway_events where status = 'failed')::int, 1, 'failed webhook kept for retry/alert');

-- ================================================================ upgrade with credit; downgrade scheduled
-- Make the paid period current (started 10 of 30 days ago)
update public.gym_subscriptions set current_period_start = now() - interval '10 days', current_period_end = now() + interval '20 days',
  trial_ends_at = now() - interval '10 days' where gym_id = t.id('gymE');
update public.saas_payments set period_start = now() - interval '10 days', period_end = now() + interval '20 days' where link_id = 'plink_E1';
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000e1');
select t.eq(public.prepare_saas_checkout(t.id('gymE'), 'growth', 'monthly')->>'kind', 'renewal', 'same plan: renewal');
select t.eq((public.prepare_saas_checkout(t.id('gymE'), 'growth', 'monthly')->>'period_start')::timestamptz = (t.sub(t.id('gymE'))).current_period_end, true, 'renewal starts at period end');
select t.eq(public.prepare_saas_checkout(t.id('gymE'), 'pro', 'monthly')->>'kind', 'upgrade', 'higher plan: upgrade');
select t.eq((public.prepare_saas_checkout(t.id('gymE'), 'pro', 'monthly')->>'credit_paise')::int between 66000 and 67000, true, 'upgrade credits ~2/3 of ₹1,000');
select t.eq((public.prepare_saas_checkout(t.id('gymE'), 'pro', 'monthly')->>'amount_paise')::int
  = 199900 - (public.prepare_saas_checkout(t.id('gymE'), 'pro', 'monthly')->>'credit_paise')::int, true, 'upgrade amount = price − credit');
select t.eq(public.prepare_saas_checkout(t.id('gymE'), 'growth', 'annual')->>'kind', 'upgrade', 'monthly → annual: upgrade');
select t.fails($$select public.prepare_saas_checkout(t.id('gymE'), 'starter', 'monthly')$$, 'XS409', 'downgrade cannot be bought now');
select t.eq((public.schedule_plan_change(t.id('gymE'), 'starter', 'monthly')->>'scheduled')::boolean, true, 'downgrade scheduled');
select t.eq(public.gym_entitlements(t.id('gymE'))->>'plan_id', 'growth', 'downgrade waits for period end');
select t.eq(public.prepare_saas_checkout(t.id('gymE'), 'starter', 'monthly')->>'kind', 'renewal', 'scheduled plan can be paid ahead');
select public.cancel_plan_change(t.id('gymE'));
select t.eq(public.gym_entitlements(t.id('gymE'))->>'pending_plan_id', null, 'scheduled change cancelled');
insert into t.ids select 'payE2', t.record_link(public.prepare_saas_checkout(t.id('gymE'), 'pro', 'monthly'), 'plink_E2', 'test');
reset role;
set role service_role;
select public.ingest_gateway_event('evt_E2_paid', 'payment_link.paid', t.paid_event('plink_E2', 'pay_E2', (select amount_paise from public.saas_payments where link_id = 'plink_E2')), null);
reset role;
select t.eq(public.gym_entitlements(t.id('gymE'))->>'plan_id', 'pro', 'upgrade applied at once');
select t.eq((select current_period_end - current_period_start = interval '1 month' and current_period_start <= now()
             from public.gym_subscriptions where gym_id = t.id('gymE')), true, 'upgrade starts a fresh month now');
select t.eq((select i.credit_paise > 0 and i.subtotal_paise = 199900 and i.total_paise = 199900 - i.credit_paise from public.saas_invoices i
             join public.saas_payments p on p.id = i.payment_id where p.link_id = 'plink_E2'), true, 'invoice shows list price, credit and total');
select t.eq((select split_part(i2.number, '/', 3)::int - split_part(i1.number, '/', 3)::int
             from public.saas_invoices i1 join public.saas_payments p1 on p1.id = i1.payment_id and p1.link_id = 'plink_E1',
                  public.saas_invoices i2 join public.saas_payments p2 on p2.id = i2.payment_id and p2.link_id = 'plink_E2'), 1, 'invoice numbers are sequential, no gaps');

-- ================================================================ renewal keeps the agreed price
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000f1');
insert into t.ids select 'proNew', id from public.admin_save_plan_version('pro', 249900, 2499000, 30, '{"analytics":true,"enquiries":true,"xs_ai":true,"priority_support":true}', null, 20, 1, 'price rise');
select public.admin_activate_plan_version(t.id('proNew'), 'test: new price');
select t.as_user('00000000-0000-0000-0000-0000000000e1');
select t.eq((public.prepare_saas_checkout(t.id('gymE'), 'pro', 'monthly')->>'amount_paise')::int, 199900, 'renewal keeps the price agreed (old version)');
select t.as_user('00000000-0000-0000-0000-0000000000e3');
select t.eq((public.prepare_saas_checkout(t.id('gymE2'), 'pro', 'monthly')->>'amount_paise')::int, 249900, 'new customers get the new price');
reset role;

-- ================================================================ test payments do not grant access unless allowed
update public.saas_billing_settings set test_payments_grant_access = false;
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000e3');
select t.record_link(public.prepare_saas_checkout(t.id('gymE2'), 'starter', 'monthly'), 'plink_E2b', 'test');
reset role;
set role service_role;
select t.eq(public.ingest_gateway_event('evt_E2b', 'payment_link.paid', t.paid_event('plink_E2b', 'pay_E2b', 50000), null)->>'grants_access', 'false', 'test payment recorded without access');
reset role;
select t.eq((t.sub(t.id('gymE2'))).state, 'EXPIRED', 'test payment: still expired');
update public.saas_billing_settings set test_payments_grant_access = true;

-- ================================================================ live payment, GST and invoice numbering
reset role;
update public.saas_billing_settings set gst_status = 'registered', gstin = '32ABCDE1234F1Z5', supplier_state_code = '32', prices_include_gst = true;
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000f3');
insert into t.ids select 'gymG', id from public.create_gym('Live Gym G', '9876522222');
select t.record_link(public.prepare_saas_checkout(t.id('gymG'), 'starter', 'annual'), 'plink_G1', 'live');
reset role;
set role service_role;
select public.ingest_gateway_event('evt_G1', 'payment_link.paid', t.paid_event('plink_G1', 'pay_G1', 500000), null);
reset role;
select t.eq((select number from public.saas_invoices i where gym_id = t.id('gymG')), 'XS/' || private.fy_label(now()) || '/0001', 'live series starts at 0001');
select t.eq((select doc_type || ':' || taxable_paise || ':' || cgst_paise || ':' || sgst_paise || ':' || igst_paise from public.saas_invoices where gym_id = t.id('gymG')),
  'tax_invoice:423729:38135:38136:0', 'GST inclusive intra-state: ₹5,000 = ₹4,237.29 + CGST ₹381.35 + SGST ₹381.36');
select t.eq((select total_paise from public.saas_invoices where gym_id = t.id('gymG')), 500000, 'invoice total equals amount paid');
select t.eq((select tax.igst from private.saas_tax(118000, '29') tax), 18000, 'inter-state: IGST 18% of ₹1,180 inclusive = ₹180');
select t.eq((select tax.taxable from private.saas_tax(118000, '29') tax), 100000, 'inter-state: taxable ₹1,000');
update public.saas_billing_settings set prices_include_gst = false;
select t.eq(private.saas_gross(100000), 118000, 'GST exclusive: ₹1,000 + 18% = ₹1,180');
update public.saas_billing_settings set prices_include_gst = true, gst_status = 'unconfirmed', gstin = null;
select t.eq(private.fy_label('2027-03-31 23:00+05:30'), '2026-27', 'FY: 31 Mar is previous year');
select t.eq(private.fy_label('2027-04-01 00:30+05:30'), '2027-28', 'FY: 1 Apr starts new year');

-- ================================================================ refunds and disputes (out of order)
set role service_role;
select public.ingest_gateway_event('evt_rf_proc', 'refund.processed', '{"refund":{"entity":{"id":"rfnd_1","payment_id":"pay_G1","amount":100000}}}', null);
select public.ingest_gateway_event('evt_rf_created', 'refund.created', '{"refund":{"entity":{"id":"rfnd_1","payment_id":"pay_G1","amount":100000}}}', null);
reset role;
select t.eq((select status from public.saas_refunds where gateway_refund_id = 'rfnd_1'), 'processed', 'refund: late "created" does not undo "processed"');
select t.eq((select status || ':' || refunded_paise from public.saas_invoices where gym_id = t.id('gymG')), 'partially_refunded:100000', 'refund: invoice partially refunded');
set role service_role;
select public.ingest_gateway_event('evt_dp_2', 'payment.dispute.won', '{"dispute":{"entity":{"id":"disp_1","payment_id":"pay_G1","amount":500000,"status":"won"}}}', '2026-11-20 10:00+00');
select public.ingest_gateway_event('evt_dp_1', 'payment.dispute.created', '{"dispute":{"entity":{"id":"disp_1","payment_id":"pay_G1","amount":500000,"status":"open"}}}', '2026-11-19 10:00+00');
reset role;
select t.eq((select status from public.saas_disputes where gateway_dispute_id = 'disp_1'), 'won', 'dispute: older event does not overwrite newer');
set role service_role;
select public.ingest_gateway_event('evt_fail_1', 'payment.failed', '{"payment":{"entity":{"id":"pay_bad","amount":500000,"method":"upi","error_code":"BAD_REQUEST_ERROR","notes":{"product":"xs-gym"}}}}', null);
reset role;
select t.eq((select count(*) from public.saas_payment_attempts where gateway_payment_id = 'pay_bad')::int, 1, 'failed payment recorded');

-- ================================================================ metrics: live money only
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000f2');
select t.eq((public.admin_commercial_metrics()->>'paying_customers')::int, 1, 'metrics: only the live payer counts');
select t.eq((public.admin_commercial_metrics()->>'mrr_paise')::int, 41667, 'metrics: MRR = ₹5,000 ÷ 12');
select t.eq((public.admin_commercial_metrics()->>'arr_paise')::int, 500000, 'metrics: ARR = MRR × 12');
select t.eq((public.admin_overview()->>'test_payments_this_month')::int >= 2, true, 'overview: test payments counted separately');
reset role;

-- ================================================================ expiry path: PAST_DUE → GRACE_PERIOD → EXPIRED, data kept
update public.gym_subscriptions set current_period_start = now() - interval '32 days', current_period_end = now() - interval '1 day' where gym_id = t.id('gymG');
select t.eq(private.saas_effective_state(t.sub(t.id('gymG'))), 'PAST_DUE', 'period ended: past due');
select t.eq(private.can_write(t.id('gymG')), true, 'past due: still full access');
update public.gym_subscriptions set current_period_end = now() - interval '5 days' where gym_id = t.id('gymG');
select t.eq(private.saas_effective_state(t.sub(t.id('gymG'))), 'GRACE_PERIOD', 'after reminder days: grace period');
set role service_role;
select t.eq((public.billing_tick()->>'transitions')::int >= 1, true, 'tick records transitions');
reset role;
select t.eq((t.sub(t.id('gymG'))).state, 'GRACE_PERIOD', 'tick stored grace period');
select t.eq((t.sub(t.id('gymG'))).grace_ends_at is not null, true, 'grace end date stored');
update public.gym_subscriptions set current_period_end = now() - interval '20 days', grace_ends_at = now() - interval '10 days' where gym_id = t.id('gymG');
set role service_role;
select public.billing_tick();
reset role;
select t.eq((t.sub(t.id('gymG'))).state, 'EXPIRED', 'grace over: expired');
select t.eq((t.sub(t.id('gymG'))).status, 'suspended', 'legacy status follows');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000f3');
select t.fails($$select public.create_member(t.id('gymG'), 'Late', '9000000501')$$, 'XS402', 'expired: read-only');
select t.eq((select count(*) from public.gyms where id = t.id('gymG'))::int, 1, 'expired: gym data still readable');
select t.eq(public.prepare_saas_checkout(t.id('gymG'), 'starter', 'monthly')->>'kind', 'new', 'expired: can buy again');
reset role;
update public.saas_billing_settings set expired_access = 'billing_only';
select t.eq(private.saas_access(t.id('gymG')), 'billing_only', 'expired access mode is configurable');
update public.saas_billing_settings set expired_access = 'read_only';
select t.fails($$select private.saas_set_state(t.id('gymG'), 'PAST_DUE', 'x', 'system')$$, 'XS409', 'invalid transition EXPIRED → PAST_DUE refused');
select t.eq((select count(*) from public.saas_notifications where gym_id = t.id('gymG'))::int >= 1, true, 'reminders queued');

-- ================================================================ cancel and resume
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000e1');
select t.eq((public.cancel_subscription(t.id('gymE'), 'closing for renovation')->>'cancelled')::boolean, true, 'owner cancels');
select t.eq((t.sub(t.id('gymE'))).state, 'CANCELED', 'cancelled state');
select t.eq(private.can_write(t.id('gymE')), true, 'cancelled: access until period end');
select t.eq((t.sub(t.id('gymE'))).cancel_effective_at = (t.sub(t.id('gymE'))).current_period_end, true, 'cancel effective at period end');
select t.eq(public.resume_subscription(t.id('gymE'))->>'state', 'ACTIVE', 'owner resumes before period end');
select public.cancel_subscription(t.id('gymE'), null);
reset role;
update public.gym_subscriptions set current_period_end = now() - interval '1 minute', cancel_effective_at = now() - interval '1 minute' where gym_id = t.id('gymE');
select t.eq(private.saas_effective_state(t.sub(t.id('gymE'))), 'EXPIRED', 'cancelled + period over: expired');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000e1');
select t.fails($$select public.resume_subscription(t.id('gymE'))$$, 'XS409', 'cannot resume after it ended');
reset role;

-- ================================================================ admin adjustments
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000f1');
select t.fails($$select public.admin_extend_trial(t.id('gymE2'), 10, '')$$, 'XS422', 'trial extension needs a reason');
select public.admin_extend_trial(t.id('gymE2'), 10, 'abuse check was a false positive');
select t.eq(public.gym_entitlements(t.id('gymE2'))->>'state', 'TRIALING', 'admin extended trial');
select public.admin_grant_complimentary(t.id('gymG'), now() + interval '30 days', 'growth', 'partner gym');
select t.eq(private.can_write(t.id('gymG')), true, 'complimentary access restores writes');
select t.eq(public.gym_entitlements(t.id('gymG'))->>'plan_id', 'growth', 'complimentary uses chosen plan');
select t.eq((select count(*) from jsonb_array_elements(public.admin_audit_log(50)) x where x->>'target_id' = t.id('gymG')::text and x ? 'before' and x ? 'after')::int, 1, 'adjustment audited with before/after');
select t.eq(jsonb_array_length(public.admin_export('invoices')) >= 3, true, 'export invoices');
select t.eq(jsonb_array_length(public.admin_subscriptions()) >= 5, true, 'subscription list');
select t.eq(jsonb_typeof(public.admin_gym_billing(t.id('gymE'))->'events'), 'array', 'customer billing history');
reset role;

-- ================================================================ member money untouched
select t.eq((select md5(string_agg(x, ',' order by x)) from (
  select id::text || amount_paise || method x from public.payments
  union all select id::text || net_paise || status from public.charges
  union all select payment_id::text || charge_id || amount_paise from public.payment_allocations) m), (select v from t.money where k = 'before'),
  'gym member payments, charges and allocations unchanged by SaaS billing');
select t.eq((select count(*) from public.saas_payments s join public.payments p on p.id = s.id)::int, 0, 'SaaS payments and member payments never share rows');

\echo 'ALL SUBSCRIPTION TESTS PASSED'
