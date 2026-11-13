-- Core database tests: tenancy, permissions, money, dates, attendance.
-- Run with tests/db/run.sh. Any failed assertion aborts with a message.
\set ON_ERROR_STOP on
set client_min_messages = notice;
\o /dev/null

create schema t;
create function t.eq(actual anyelement, expected anyelement, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;
-- Runs a statement and asserts it fails with a message containing `needle`.
create function t.fails(stmt text, needle text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if position(needle in sqlerrm) > 0 then raise notice 'ok  %', label; return; end if;
    raise exception 'FAIL %: wrong error: %', label, sqlerrm;
  end;
  raise exception 'FAIL %: statement succeeded but should fail', label;
end $$;
grant usage on schema t to authenticated, anon;
grant execute on all functions in schema t to authenticated, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner.a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'desk.a@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'trainer.a@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', 'manager.a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner.b@test.local');

create table t.ids (k text primary key, v uuid);
grant all on t.ids to authenticated;
create function t.id(k text) returns uuid language sql as $$ select v from t.ids where ids.k = $1 $$;
grant execute on function t.id(text) to authenticated;

-- ---------------------------------------------------------------- dates
select t.eq(private.membership_end_date(s, u, n), e, format('end date %s +%s %s', s, n, u))
from (values
  ('2027-01-15'::date,'month',1,'2027-02-14'::date),('2027-01-28','month',1,'2027-02-27'),
  ('2027-01-29','month',1,'2027-02-28'),('2027-01-31','month',1,'2027-02-28'),
  ('2028-01-29','month',1,'2028-02-28'),('2028-01-31','month',1,'2028-02-29'),
  ('2027-03-01','month',1,'2027-03-31'),('2027-03-31','month',1,'2027-04-30'),
  ('2027-08-31','month',3,'2027-11-30'),('2026-12-31','month',2,'2027-02-28'),
  ('2027-01-01','month',12,'2027-12-31'),('2028-02-29','month',12,'2029-02-28'),
  ('2026-11-05','day',15,'2026-11-19')) v(s,u,n,e);

select t.eq(private.membership_status('active','2026-01-01','2026-01-31','2026-01-31',3), 'active', 'status on last day');
select t.eq(private.membership_status('active','2026-01-01','2026-01-31','2026-02-03',3), 'grace', 'status on last grace day');
select t.eq(private.membership_status('active','2026-01-01','2026-01-31','2026-02-04',3), 'expired', 'status day after grace');
select t.eq(private.membership_status('active','2026-02-01','2026-02-28','2026-01-31',3), 'upcoming', 'status before start');

select t.eq(private.normalize_phone('98765 43210'), '+919876543210', 'phone: 10 digits');
select t.eq(private.normalize_phone('+91-98765-43210'), '+919876543210', 'phone: with code');
select t.eq(private.normalize_phone('09876543210'), '+919876543210', 'phone: leading zero');

-- ---------------------------------------------------------------- set up two gyms
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
insert into t.ids select 'gymA', id from public.create_gym('Iron Temple Kozhikode', '9876500001');
select t.fails($$select public.create_gym('Second Gym')$$, 'XS409', 'one trial gym per user');
select t.eq((select slug from public.gyms where id = t.id('gymA')), 'iron-temple-kozhikode', 'slug generated');
select t.eq((select role from public.gym_staff where gym_id = t.id('gymA')), 'owner', 'creator is owner');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
insert into t.ids select 'gymB', id from public.create_gym('Gym B', null);
insert into t.ids select 'memberB', id from public.create_member(t.id('gymB'), 'Bee Member', '9000000002');

-- Owner A adds staff
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.save_staff(t.id('gymA'), 'desk.a@test.local', 'reception');
select public.save_staff(t.id('gymA'), 'trainer.a@test.local', 'trainer');
select public.save_staff(t.id('gymA'), 'manager.a@test.local', 'manager');
select t.fails($$select public.save_staff(t.id('gymA'), 'nobody@test.local', 'reception')$$, 'XS404', 'staff must have an account');
select t.fails($$select public.save_staff(t.id('gymA'), 'desk.a@test.local', 'owner')$$, 'XS422', 'cannot grant owner role');

-- ---------------------------------------------------------------- tenant isolation
select t.eq((select count(*) from public.gyms)::int, 1, 'owner A sees only gym A');
select t.eq((select count(*) from public.members where gym_id = t.id('gymB'))::int, 0, 'A cannot read B members');
select t.fails($$select public.create_member(t.id('gymB'), 'Intruder', '9000000003')$$, 'XS403', 'A cannot write into gym B');
select t.fails($$select public.record_payment(t.id('gymB'), t.id('memberB'), 1000, 'cash', gen_random_uuid())$$, 'XS403', 'A cannot pay into gym B');
select t.fails($$insert into public.members (gym_id, member_no, full_name, phone, join_date) values (t.id('gymA'), 'X', 'Direct', '+919000000009', current_date)$$,
  'permission denied', 'no direct table writes');

-- ---------------------------------------------------------------- members and plans
insert into t.ids select 'm1', id from public.create_member(t.id('gymA'), 'Rahul K', '98765 11111');
select t.eq((select member_no from public.members where id = t.id('m1')), 'XS-0001', 'member number assigned');

-- Editing a member's Joining Date is a separate audited profile change.
-- Old clients calling update_member without p_join_date must still work.
select public.update_member(t.id('gymA'), t.id('m1'), 'Rahul K', '98765 11111', '2026-03-12'::date);
select t.eq((select join_date from public.members where id = t.id('m1')), '2026-03-12'::date,
  'member joining date can be changed');
select t.eq((select join_date from public.member_overview where id = t.id('m1')), '2026-03-12'::date,
  'joining date reflected on member overview');
select t.eq((select count(*) from public.audit_logs where entity_id=t.id('m1')
  and action='member.join_date_updated')::int, 1, 'joining date edit has audit trail');
select public.update_member(t.id('gymA'), t.id('m1'), 'Rahul K', '98765 11111');
select t.eq((select join_date from public.members where id = t.id('m1')), '2026-03-12'::date,
  'legacy member edit preserves joining date');
select t.fails($sql$select public.update_member(t.id('gymA'),t.id('m1'),
  'Rahul K','98765 11111',null::date)$sql$, 'XS422', 'joining date cannot be empty');
select t.fails($sql$select public.update_member(t.id('gymB'),t.id('memberB'),
  'Intruder','9000000002','2026-03-12'::date)$sql$, 'XS403', 'joining date edit is tenant scoped');

select t.fails($$select public.create_member(t.id('gymA'), 'Rahul Again', '+919876511111')$$, 'XS409', 'duplicate phone blocked');
insert into t.ids select 'plan1m', id from public.save_plan(t.id('gymA'), null, 'Monthly', 'month', 1, 100000);
insert into t.ids select 'plan3m', id from public.save_plan(t.id('gymA'), null, 'Quarterly', 'month', 3, 270000);

-- Reception sells, records payment, checks in
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
select t.fails($$select public.save_plan(t.id('gymA'), null, 'Cheap', 'month', 1, 100)$$, 'XS403', 'reception cannot manage plans');
select t.fails($$select public.sell_membership(t.id('gymA'), t.id('m1'), t.id('plan1m'), gen_random_uuid(), null, 5000, 'friend')$$,
  'XS403', 'reception cannot discount');
select t.fails($$select public.check_in(t.id('gymA'), t.id('m1'))$$, 'XS412', 'no membership blocks check-in');

insert into t.ids values ('sellKey', gen_random_uuid());
insert into t.ids select 'mm1', id from public.sell_membership(t.id('gymA'), t.id('m1'), t.id('plan1m'), t.id('sellKey'), null, 0, null, 50000);
select t.eq((select id from public.sell_membership(t.id('gymA'), t.id('m1'), t.id('plan1m'), t.id('sellKey'))), t.id('mm1'), 'sell is idempotent');
select t.eq((select count(*) from public.member_memberships where member_id = t.id('m1'))::int, 1, 'one membership after retry');
select t.eq((select due_paise from public.member_overview where id = t.id('m1')), 150000::bigint, 'due = plan + admission');
select t.eq((select membership_status from public.member_overview where id = t.id('m1')), 'active', 'membership active');

-- Partial payment, idempotent retry
insert into t.ids values ('payKey', gen_random_uuid());
insert into t.ids select 'pay1', id from public.record_payment(t.id('gymA'), t.id('m1'), 120000, 'upi', t.id('payKey'), 'UTR123');
select public.record_payment(t.id('gymA'), t.id('m1'), 120000, 'upi', t.id('payKey'));
select t.eq((select count(*) from public.payments where member_id = t.id('m1'))::int, 1, 'payment retry creates one row');
select t.fails($$select public.record_payment(t.id('gymA'), t.id('m1'), 999, 'upi', t.id('payKey'))$$, 'XS409', 'same key, different amount rejected');
select t.eq((select due_paise from public.member_overview where id = t.id('m1')), 30000::bigint, 'due after partial payment');
select t.eq((select sum(amount_paise) from public.payment_allocations where payment_id = t.id('pay1')), 120000::numeric, 'payment fully allocated');

-- Overpayment becomes credit
select public.record_payment(t.id('gymA'), t.id('m1'), 50000, 'cash', gen_random_uuid());
select t.eq((select due_paise from public.member_overview where id = t.id('m1')), 0::bigint, 'no due after overpay');
select t.eq((select credit_paise from public.member_overview where id = t.id('m1')), 20000::bigint, 'overpay becomes credit');

-- Check-in rules
select public.check_in(t.id('gymA'), t.id('m1'));
select t.fails($$select public.check_in(t.id('gymA'), t.id('m1'))$$, 'XS409', 'second check-in same day blocked');
select t.fails($$select public.check_in(t.id('gymA'), t.id('m1'), 'forgot card')$$, 'XS403', 'reception cannot override');

-- Reversal needs manager/owner
select t.fails($$select public.reverse_payment(t.id('gymA'), t.id('pay1'), 'wrong')$$, 'XS403', 'reception cannot reverse');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.reverse_payment(t.id('gymA'), t.id('pay1'), 'UPI failed');
select t.eq((select due_paise from public.member_overview where id = t.id('m1')), 100000::bigint, 'reversal reopens due, credit reapplied');
select t.fails($$select public.reverse_payment(t.id('gymA'), t.id('pay1'), 'again')$$, 'XS409', 'double reversal blocked');

-- Renewal continues from old end date
insert into t.ids select 'mm2', id from public.sell_membership(t.id('gymA'), t.id('m1'), t.id('plan3m'), gen_random_uuid(), null, 20000, 'loyalty');
select t.eq((select start_date from public.member_memberships where id = t.id('mm2')),
            (select end_date + 1 from public.member_memberships where id = t.id('mm1')), 'renewal starts day after old end');
select t.eq((select membership_status from public.member_overview where id = t.id('m1')), 'active', 'still active (not upcoming) after early renewal');
select t.eq((select valid_until from public.member_overview where id = t.id('m1')),
            (select end_date from public.member_memberships where id = t.id('mm2')), 'valid_until is renewal end');

-- Ledger immutability (even for the definer role path, via triggers)
reset role;
select t.fails($$update public.payments set amount_paise = 1 where id = t.id('pay1')$$, 'XS405', 'payments immutable');
select t.fails($$delete from public.audit_logs$$, 'XS405', 'audit log immutable');
select t.fails($$update public.charges set gross_paise = 1 where member_id = t.id('m1')$$, 'XS405', 'charges cannot be edited');
set role authenticated;

-- Reports and permissions
select t.eq((select (public.dashboard_summary(t.id('gymA')) ->> 'checkins_today')::int), 1, 'dashboard check-ins');
select t.eq((select (public.dashboard_summary(t.id('gymA')) -> 'financial' ->> 'collections_today')::bigint), 170000::bigint,
  'collections count received payments before reversals');
select t.eq((select (public.dashboard_summary(t.id('gymA')) -> 'financial' ->> 'reversals_today')::bigint), 120000::bigint, 'reversals reported separately');
select t.eq((select sum(collections_paise - reversals_paise) from public.daily_report(t.id('gymA'), current_date - 1, current_date + 1)),
            (select sum(amount_paise) from public.payments p where p.gym_id = t.id('gymA')
               and not exists (select 1 from public.payment_reversals r where r.payment_id = p.id))::numeric,
            'report net equals raw non-reversed payments');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
select t.eq((select public.dashboard_summary(t.id('gymA')) -> 'financial'), 'null'::jsonb, 'reception gets no financial totals');
select t.fails($$select * from public.daily_report(t.id('gymA'), current_date, current_date)$$, 'XS403', 'reception cannot see financial report');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
select t.eq((select count(*) from public.payments)::int, 0, 'trainer cannot read payments');
select t.fails($$select public.create_member(t.id('gymA'), 'T', '9000000004')$$, 'XS403', 'trainer cannot add members');

-- Analytics, enquiries, onboarding
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select t.eq((select (public.gym_analytics(t.id('gymA'), 6) -> 'months' -> -1 ->> 'revenue_paise')::bigint),
            (select sum(amount_paise) from public.payments p where p.gym_id = t.id('gymA')
               and not exists (select 1 from public.payment_reversals r where r.payment_id = p.id))::bigint,
            'analytics month revenue excludes reversals');
select t.eq(jsonb_array_length(public.gym_analytics(t.id('gymA'), 6) -> 'months'), 6, 'analytics returns one row per month');
select t.fails($$select public.gym_analytics(t.id('gymA'), 30)$$, 'XS422', 'analytics month range limited');
select t.fails($$select public.gym_analytics(t.id('gymB'), 6)$$, 'XS403', 'analytics stays inside the tenant');
select t.eq((select (public.gym_analytics(t.id('gymA'), 6) -> 'members' ->> 'total')::int), 1, 'analytics member count');
insert into t.ids select 'enq1', id from public.save_enquiry(t.id('gymA'), null, 'Walk In', '+919000000099', 'instagram', 'Monthly', null, current_date + 1);
select t.eq((select status from public.enquiries where id = t.id('enq1')), 'new', 'enquiry saved as new');
select t.fails($$select public.save_enquiry(t.id('gymA'), t.id('enq1'), 'Walk In', '+919000000099', 'instagram', null, null, null, 'joined')$$,
               'XS422', 'joined enquiry needs a member');
select public.save_enquiry(t.id('gymA'), t.id('enq1'), 'Walk In', '+919000000099', 'instagram', null, null, null, 'joined', t.id('m1'));
select t.eq((select closed_at is not null from public.enquiries where id = t.id('enq1')), true, 'joined enquiry is closed');
select t.eq((select (public.gym_analytics(t.id('gymA'), 6) -> 'enquiries' ->> 'joined')::int), 1, 'analytics counts joined enquiries');
select t.fails($$update public.enquiries set status = 'lost'$$, 'permission denied', 'enquiries change only through commands');
select t.eq((select onboarded_at is null from public.gyms where id = t.id('gymA')), true, 'new gym starts onboarding');
select public.complete_onboarding(t.id('gymA'));
select t.eq((select onboarded_at is not null from public.gyms where id = t.id('gymA')), true, 'onboarding completes');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
select t.eq((select count(*) from public.enquiries)::int, 1, 'trainer (members.read) sees enquiries of own gym only');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
select t.fails($$select public.gym_analytics(t.id('gymA'), 6)$$, 'XS403', 'reception cannot see analytics');
select t.fails($$select public.complete_onboarding(t.id('gymA'))$$, 'XS403', 'reception cannot finish onboarding');

-- Member delete is reversible archive; history and receipt are preserved.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.set_member_status(t.id('gymA'), t.id('m1'), 'archived', 'Duplicate account');
select t.eq((select status from public.member_overview where id=t.id('m1')), 'archived', 'deleted member lives in archive');
select t.eq((select count(*) from public.payments where member_id=t.id('m1'))::int > 0, true, 'member archive preserves payments');
select public.set_member_status(t.id('gymA'), t.id('m1'), 'active', 'Restore');
select t.eq((select status from public.member_overview where id=t.id('m1')), 'active', 'archived member can be restored');

-- Permanent Delete is a distinct owner-only command. Never erase any ledger,
-- membership, check-in or receipt even if the owner explicitly tries.
select t.fails($sql$select public.permanently_delete_member(t.id('gymA'),t.id('m1'),'XS-0001','Wrong registration')$sql$,
  'XS409', 'permanent delete cannot remove a member with financial history');
select t.eq((select count(*) from public.payments where member_id=t.id('m1'))::int > 0,
  true, 'blocked delete keeps all payments');

insert into t.ids
  select 'trashOnly',id from public.create_member(t.id('gymA'), 'Throwaway Member', '9000000098');
select t.fails($sql$select public.permanently_delete_member(t.id('gymA'),t.id('trashOnly'),'WRONG','Duplicate')$sql$,
  'XS422', 'permanent delete requires matching member number');
select t.fails($sql$select public.permanently_delete_member(t.id('gymA'),t.id('trashOnly'),
  (select member_no from public.members where id=t.id('trashOnly')),'')$sql$,
  'XS422', 'permanent delete requires reason');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', false);
select t.fails($sql$select public.permanently_delete_member(t.id('gymA'),t.id('trashOnly'),
  (select member_no from public.members where id=t.id('trashOnly')),'Duplicate')$sql$,
  'XS403', 'manager with archive permission cannot permanently delete');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.fails($sql$select public.permanently_delete_member(t.id('gymA'),t.id('trashOnly'),
  (select member_no from public.members where id=t.id('trashOnly')),'Cross tenant')$sql$,
  'XS403', 'another gym owner cannot delete this member');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
insert into t.ids select 'trashLead', id from public.save_enquiry(
  t.id('gymA'), null, 'Throwaway Member', '+919000000098',
  'walk_in', null, null, null, 'joined', t.id('trashOnly'));
select public.permanently_delete_member(t.id('gymA'),t.id('trashOnly'),
  (select member_no from public.members where id=t.id('trashOnly')), 'Duplicate profile');
select t.eq((select count(*) from public.members where id=t.id('trashOnly'))::int,
  0, 'permanent delete removes unbilled member from database');
select t.eq((select count(*) from public.enquiries where id=t.id('trashLead'))::int,
  0, 'permanent delete removes linked enquiry');
select t.eq((select count(*) from public.audit_logs where entity_id=t.id('trashOnly')
  and action='member.permanently_deleted')::int,1,'permanent deletion is audited');
select t.fails($sql$select public.permanently_delete_member(t.id('gymA'),t.id('trashOnly'),'XS-9999','Again')$sql$,
  'XS404', 'cannot delete the same member twice');


-- Payment edits must be atomic reversal + replacement, not an UPDATE/DELETE.
insert into t.ids
  select 'editOriginal', p.id from public.payments p
  where p.gym_id=t.id('gymA') and p.amount_paise=50000
    and not exists (select 1 from public.payment_reversals r where r.payment_id=p.id)
  limit 1;
insert into t.ids values ('editKey', gen_random_uuid());
insert into t.ids
  select 'editNew', p.id from public.correct_payment(
    t.id('gymA'), t.id('editOriginal'), 40000, 'card',
    'Wrong amount entered', t.id('editKey'), 'CARD-REPLACEMENT', 'Card confirmed') p;
select t.eq((select count(*) from public.payment_reversals where payment_id=t.id('editOriginal'))::int,
  1, 'payment edit archives the old receipt');
select t.eq((select amount_paise from public.payments where id=t.id('editNew')),
  40000::bigint, 'payment edit records corrected amount');
select t.eq((select method from public.payments where id=t.id('editNew')),
  'card', 'payment edit records corrected method');
select t.eq((select notes like ('Correction of ' || t.id('editOriginal')::text || '.%')
    from public.payments where id=t.id('editNew')), true, 'payment edit links original for audit');
select t.eq((select id from public.correct_payment(t.id('gymA'),
  t.id('editOriginal'), 40000, 'card', 'Wrong amount entered',
  t.id('editKey'), 'CARD-REPLACEMENT', 'Card confirmed')),
  t.id('editNew'), 'payment edit is idempotent');
select t.eq((select count(*) from public.payments where idempotency_key=t.id('editKey'))::int,
  1, 'payment correction retry creates no duplicates');
select t.fails($sql$select public.correct_payment(t.id('gymA'),t.id('editOriginal'),50000,'cash','Another try',gen_random_uuid())$sql$,
  'XS409', 'already reversed payment cannot be corrected again');
select t.fails($sql$select public.correct_payment(t.id('gymA'),t.id('editNew'),45000,'upi','',gen_random_uuid())$sql$,
  'XS422', 'payment correction requires a reason');
select t.fails($sql$select public.correct_payment(t.id('gymB'),t.id('editNew'),40000,'card','Wrong gym',gen_random_uuid())$sql$,
  'XS403', 'payment edit cannot cross tenant');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
select t.fails($sql$select public.correct_payment(t.id('gymA'),t.id('editNew'),40000,'upi','Should fail',gen_random_uuid())$sql$,
  'XS403', 'reception cannot edit financial ledger');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

-- ---------------------------------------------------------------- privileged API inventory (isolated PG16)
-- Fails closed when new SECURITY DEFINER API functions are introduced without review.
select t.eq((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef)::int, 24,
  'inventory: 24 privileged public API function overloads require review');
select t.eq((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and has_function_privilege('anon',p.oid,'EXECUTE'))::int, 0,
  'none of the privileged public API functions callable by anon');
select t.eq((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and coalesce(array_to_string(p.proconfig,','),'') like 'search_path=%')::int, 24,
  'all privileged API functions declare an explicit search_path');

-- ---------------------------------------------------------------- pilot ledger safety regression (synthetic data ONLY)
-- Capture current behavior without deciding whether access should be cancelled.
-- A paid membership charge can be voided; the payment remains immutable,
-- the amount becomes credit and the membership currently remains active.
select t.fails($sql$select public.record_payment(t.id('gymA'), t.id('m1'),
  0, 'upi', gen_random_uuid())$sql$, 'XS422', 'zero payment refused');
select t.fails($sql$select public.record_payment(t.id('gymA'), t.id('m1'),
  -1, 'cash', gen_random_uuid())$sql$, 'XS422', 'negative payment refused');
select t.fails($sql$select public.correct_payment(t.id('gymA'), t.id('editNew'),
  0, 'card', 'Invalid zero correction', gen_random_uuid())$sql$, 'XS422', 'zero-value correction refused');
select t.fails($sql$select public.correct_payment(t.id('gymA'), t.id('editNew'),
  -1, 'card', 'Invalid negative correction', gen_random_uuid())$sql$, 'XS422', 'negative correction refused');

insert into t.ids select 'pilotVoidMember', id
  from public.create_member(t.id('gymA'), 'Synthetic Ledger Test', '9000000111');
insert into t.ids select 'pilotVoidMembership', id
  from public.sell_membership(t.id('gymA'), t.id('pilotVoidMember'),
    t.id('plan1m'), gen_random_uuid());
insert into t.ids select 'pilotVoidCharge', id from public.charges
  where gym_id=t.id('gymA') and member_id=t.id('pilotVoidMember')
    and kind='membership' and status='open';
insert into t.ids select 'pilotVoidPayment', id
  from public.record_payment(t.id('gymA'), t.id('pilotVoidMember'),
    100000, 'upi', gen_random_uuid());

select t.eq((select due_paise from public.member_overview
  where id=t.id('pilotVoidMember')), 0::bigint, 'paid synthetic charge has no dues');
select t.eq((select credit_paise from public.member_overview
  where id=t.id('pilotVoidMember')), 0::bigint, 'paid synthetic charge has no credit');
select public.void_charge(t.id('gymA'), t.id('pilotVoidCharge'),
  'Pilot policy clarification pending');
select t.eq((select credit_paise from public.member_overview
  where id=t.id('pilotVoidMember')), 100000::bigint, 'voided paid charge releases payment to credit');
select t.eq((select membership_status from public.member_overview
  where id=t.id('pilotVoidMember')), 'active', 'current behavior retains access after paid void (OPEN OWNER DECISION)');
select t.eq((select count(*) from public.payments
  where member_id=t.id('pilotVoidMember'))::int, 1, 'void never deletes original payment');
select t.eq((select count(*) from public.payment_allocations
  where payment_id=t.id('pilotVoidPayment'))::int, 1, 'void retains immutable allocation history');
select t.eq((select count(*) from public.audit_logs
  where entity_id=t.id('pilotVoidCharge') and action='charge.voided')::int,
  1, 'paid void has an audit record');
-- The owner has selected SEPARATE access cancellation.
-- A void does not silently alter the membership period; cancellation is
-- its own permission-checked, reasoned, auditable command.
select public.cancel_membership(t.id('gymA'), t.id('pilotVoidMembership'),
  'Separate membership cancellation after finance correction');
select t.eq((select status from public.member_memberships
  where id=t.id('pilotVoidMembership')), 'cancelled',
  'separate explicit command cancels membership access');
select t.eq((select credit_paise from public.member_overview
  where id=t.id('pilotVoidMember')), 100000::bigint,
  'separate membership cancellation preserves existing member credit');
select t.eq((select count(*) from public.payments
  where member_id=t.id('pilotVoidMember'))::int, 1,
  'separate membership cancellation does not reverse the original payment');
select t.eq((select count(*) from public.audit_logs
  where entity_id=t.id('pilotVoidMembership') and action='membership.cancelled')::int,
  1, 'separate membership cancellation is audited');


-- Expired subscription: read-only
reset role;
update public.gym_subscriptions set trial_ends_at = now() - interval '1 minute' where gym_id = t.id('gymA');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select t.fails($$select public.create_member(t.id('gymA'), 'Late', '9000000005')$$, 'XS402', 'expired trial blocks writes');
select t.eq((select count(*) from public.members where gym_id = t.id('gymA'))::int, 2, 'expired trial still reads both synthetic members');

-- Anonymous gets nothing
reset role;
set role anon;
select t.fails($$select count(*) from public.members$$, 'permission denied', 'anon cannot read');
reset role;

\echo 'ALL DATABASE TESTS PASSED'
