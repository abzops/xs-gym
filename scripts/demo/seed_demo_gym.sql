-- Seed a realistic demo gym owned by a given account, so a pitch shows a full
-- app: plans, members in different states, today's collections and check-ins,
-- and a few expenses. Everything goes through the real command functions, so
-- dues, receipts and reports stay consistent.
--
-- Run AFTER the account exists (sign up once, or run reset_demo_login.sql).
-- Safe to read first; it only adds a new gym and will skip if one already
-- exists for this owner.

do $$
declare
  v_email text := 'svsnkr496@gmail.com';   -- demo account that will own the gym
  v_owner uuid;
  v_gym   uuid;
  g_month uuid; g_quarter uuid; g_year uuid; g_day uuid; g_15 uuid;
  m uuid;
  members text[][] := array[
    array['Rahul Krishnan','9847010001'], array['Anjali Menon','9847010002'],
    array['Mohammed Shafi','9847010003'], array['Priya Nair','9847010004'],
    array['Arjun Das','9847010005'],       array['Fathima Rizwan','9847010006'],
    array['Vishnu Prasad','9847010007'],   array['Sneha Thomas','9847010008'],
    array['Akhil Raj','9847010009'],       array['Deepa Suresh','9847010010'],
    array['Nikhil Varma','9847010011'],    array['Aiswarya Pillai','9847010012']];
  rec text[];
  i int := 0;
begin
  select id into v_owner from auth.users where lower(email) = lower(v_email);
  if v_owner is null then
    raise exception 'No account for %. Create it first.', v_email;
  end if;

  -- Act as the owner so command functions authorise correctly.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  if exists (select 1 from public.gyms where created_by = v_owner) then
    raise notice 'This account already owns a gym; not creating another. Add demo data by hand if needed.';
    return;
  end if;

  v_gym := (public.create_gym('XS Demo Gym', '9847000000')).id;

  g_month   := (public.save_plan(v_gym, null, 'Monthly',     'month', 1,  100000)).id;
  g_quarter := (public.save_plan(v_gym, null, 'Quarterly',   'month', 3,  270000)).id;
  g_year    := (public.save_plan(v_gym, null, 'Yearly',      'month', 12, 960000)).id;
  g_day     := (public.save_plan(v_gym, null, 'Day pass',    'day',   1,  15000)).id;
  g_15      := (public.save_plan(v_gym, null, '15-day trial','day',   15, 0)).id;

  foreach rec slice 1 in array members loop
    i := i + 1;
    m := (public.create_member(v_gym, rec[1], rec[2])).id;

    -- Spread members across plans and payment states.
    if i % 5 = 1 then
      perform public.sell_membership(v_gym, m, g_quarter, gen_random_uuid(), null, 0, null, 50000);
      perform public.record_payment(v_gym, m, 320000, 'upi', gen_random_uuid(), 'UTR' || i);          -- paid in full
    elsif i % 5 = 2 then
      perform public.sell_membership(v_gym, m, g_month, gen_random_uuid(), null, 0, null, 50000);
      perform public.record_payment(v_gym, m, 100000, 'cash', gen_random_uuid());                      -- 500 still due
    elsif i % 5 = 3 then
      perform public.sell_membership(v_gym, m, g_year, gen_random_uuid(), null, 100000, 'Festival offer', 0);
      perform public.record_payment(v_gym, m, 860000, 'bank', gen_random_uuid(), 'NEFT' || i);         -- paid in full
    elsif i % 5 = 4 then
      perform public.sell_membership(v_gym, m, g_15, gen_random_uuid());                               -- free trial, expiring soon
    else
      perform public.sell_membership(v_gym, m, g_month, gen_random_uuid());
      perform public.record_payment(v_gym, m, 120000, 'upi', gen_random_uuid(), 'UTR' || i);           -- 200 credit
    end if;

    -- Check in the first eight members today.
    if i <= 8 then
      begin perform public.check_in(v_gym, m); exception when others then null; end;
    end if;
  end loop;

  perform public.record_expense(v_gym, 'Electricity', 450000, (now() at time zone 'Asia/Kolkata')::date, 'bank', gen_random_uuid(), 'KSEB bill');
  perform public.record_expense(v_gym, 'Equipment',   180000, (now() at time zone 'Asia/Kolkata')::date, 'upi',  gen_random_uuid(), 'Dumbbell set');
  perform public.record_expense(v_gym, 'Cleaning',     60000, (now() at time zone 'Asia/Kolkata')::date, 'cash', gen_random_uuid());

  raise notice 'Demo gym ready: % members, plans, payments, check-ins and expenses.', i;
end $$;
