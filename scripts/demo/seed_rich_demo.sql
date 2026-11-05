-- Rich demo gym for pitching: ~10 months of believable history owned by the
-- account in v_email. Inserts directly (dates in the past), keeping every
-- ledger rule: charges, payments, allocations, reversals and dues all add up.
-- Run once on an empty project after the account exists.

do $$
declare
  v_email text := 'admin@xelorsoft.com';
  v_tz    text := 'Asia/Kolkata';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_owner uuid;
  v_gym   uuid;
  firsts text[] := array['Rahul','Anjali','Mohammed','Priya','Arjun','Fathima','Vishnu','Sneha','Akhil','Deepa','Nikhil','Aiswarya',
    'Rohan','Meera','Abhijith','Neha','Sreejith','Lakshmi','Aditya','Nandana','Faisal','Reshma','Kiran','Divya','Joel','Ann',
    'Harikrishnan','Amala','Sanjay','Gopika','Ashwin','Farhana','Vivek','Athira','Jithin','Shilpa'];
  lasts text[] := array['Krishnan','Menon','Nair','Das','Pillai','Thomas','Varghese','Kurian','Rizwan','Suresh','Varma','Joseph',
    'Mathew','Prasad','Raj','Babu','Abraham','Kumar','George','Iyer','Shenoy','Hameed','Panicker','Chandran'];
  plans uuid[];
  p record;
  i int;
  n_members int := 72;
  m_id uuid;
  join_d date;
  start_d date;
  end_d date;
  mm_id uuid;
  prev_mm uuid;
  first_period boolean;
  ch_plan uuid;
  ch_adm uuid;
  net bigint;
  adm bigint;
  disc bigint;
  disc_reason text;
  total bigint;
  pay bigint;
  pay_id uuid;
  r double precision;
  meth text;
  ref text;
  ts timestamptz;
  is_latest boolean;
  left_amt bigint;
  take bigint;
  c record;
  d date;
  freq double precision;
  k int;
  rev record;
  mstart date;
  cat_rent uuid; cat_power uuid; cat_sal uuid; cat_water uuid; cat_clean uuid; cat_equip uuid; cat_mkt uuid;
begin
  perform setseed(0.42);

  select id into v_owner from auth.users where lower(email) = lower(v_email);
  if v_owner is null then raise exception 'Account % does not exist', v_email; end if;
  if exists (select 1 from public.gyms where created_by = v_owner) then
    raise exception 'This account already owns a gym';
  end if;

  insert into public.gyms (name, slug, phone, address, grace_days, created_by, created_at)
  values ('XS Fitness Studio', 'xs-fitness-studio', '+914842900100', 'Panampilly Nagar, Kochi', 3, v_owner, now() - interval '300 days')
  returning id into v_gym;
  insert into public.gym_staff (gym_id, user_id, role, display_name, email, created_by, created_at)
  values (v_gym, v_owner, 'owner', 'Xelorsoft Admin', v_email, v_owner, now() - interval '300 days');
  insert into public.gym_subscriptions (gym_id, plan, status, trial_started_at, trial_ends_at, paid_until)
  values (v_gym, 'max', 'active', now() - interval '300 days', now() - interval '270 days', now() + interval '365 days');

  -- Plans
  create temp table _plans (id uuid, name text, unit text, cnt int, price bigint, cum double precision) on commit drop;
  with ins as (
    insert into public.membership_plans (gym_id, name, duration_unit, duration_count, price_paise, description, created_at)
    values (v_gym, 'Monthly', 'month', 1, 120000, null, now() - interval '300 days'),
           (v_gym, 'Quarterly', 'month', 3, 330000, 'Save ₹300', now() - interval '300 days'),
           (v_gym, 'Half-yearly', 'month', 6, 600000, 'Save ₹1,200', now() - interval '300 days'),
           (v_gym, 'Yearly', 'month', 12, 1080000, 'Best value', now() - interval '300 days'),
           (v_gym, 'Day pass', 'day', 1, 15000, 'Drop-in', now() - interval '300 days'),
           (v_gym, 'Personal training', 'month', 1, 400000, '12 sessions with a trainer', now() - interval '300 days')
    returning id, name, duration_unit, duration_count, price_paise)
  insert into _plans select id, name, duration_unit, duration_count, price_paise,
    case name when 'Monthly' then 0.52 when 'Quarterly' then 0.77 when 'Half-yearly' then 0.88 when 'Yearly' then 0.96 when 'Personal training' then 1.0 else 2 end
  from ins;

  create temp table _pay (id uuid, member uuid, amount bigint, at timestamptz, method text) on commit drop;

  for i in 1..n_members loop
    -- Join dates spread over ~10 months, with a cluster of new joiners this month
    if i > n_members - 9 then join_d := v_today - (random() * (extract(day from v_today) - 1))::int;
    else join_d := v_today - 30 - (random() * 270)::int; end if;

    insert into public.members (gym_id, member_no, full_name, phone, gender, join_date, status, created_by, created_at)
    values (v_gym, 'XS-' || lpad(i::text, 4, '0'),
            firsts[1 + ((i * 7) % array_length(firsts, 1))] || ' ' || lasts[1 + ((i * 11) % array_length(lasts, 1))],
            '+9194' || lpad((46000000 + i * 1373)::text, 8, '0'),
            case when i % 3 = 0 then 'female' else 'male' end,
            join_d, 'active', v_owner, (join_d + time '08:00')::timestamp at time zone v_tz)
    returning id into m_id;

    -- One plan per member, chosen by weight
    r := random();
    select * into p from _plans where cum >= r and name <> 'Day pass' order by cum limit 1;

    start_d := join_d;
    first_period := true;
    prev_mm := null;
    loop
      exit when start_d > v_today;
      end_d := private.membership_end_date(start_d, p.unit, p.cnt);
      is_latest := end_d >= v_today;

      insert into public.member_memberships (gym_id, member_id, plan_id, plan_name, start_date, end_date, price_paise,
                                             renewed_from_id, idempotency_key, created_by, created_at)
      values (v_gym, m_id, p.id, p.name, start_d, end_d, p.price, prev_mm, gen_random_uuid(), v_owner,
              (start_d + time '07:30')::timestamp at time zone v_tz)
      returning id into mm_id;

      disc := 0; disc_reason := null;
      if p.cnt >= 3 and random() < 0.3 then disc := (p.price / 10 / 100) * 100; disc_reason := 'Loyalty offer'; end if;
      insert into public.charges (gym_id, member_id, membership_id, kind, description, gross_paise, discount_paise, discount_reason, due_date, created_by, created_at)
      values (v_gym, m_id, mm_id, 'membership', p.name || ' · ' || to_char(start_d, 'DD Mon YYYY') || ' – ' || to_char(end_d, 'DD Mon YYYY'),
              p.price, disc, disc_reason, start_d, v_owner, (start_d + time '07:30')::timestamp at time zone v_tz)
      returning id, net_paise into ch_plan, net;

      adm := 0; ch_adm := null;
      if first_period and random() < 0.7 then
        adm := 50000;
        insert into public.charges (gym_id, member_id, kind, description, gross_paise, due_date, created_by, created_at)
        values (v_gym, m_id, 'admission', 'Admission fee', adm, start_d, v_owner, (start_d + time '07:29')::timestamp at time zone v_tz)
        returning id into ch_adm;
      end if;

      total := net + adm;
      r := random();
      pay := total;
      if is_latest and r < 0.07 then pay := 0;                                   -- not paid yet
      elsif is_latest and r < 0.24 then pay := (total / 2 / 10000) * 10000; end if; -- part paid

      if pay > 0 then
        r := random();
        meth := case when r < 0.56 then 'upi' when r < 0.95 then 'cash' else 'card' end;
        ref := case when meth = 'upi' then 'UTR ' || (400000000000 + (random() * 99999999999)::bigint)::text end;
        ts := ((start_d + time '06:00') + (random() * interval '14 hours'))::timestamp at time zone v_tz;
        if ts > now() then ts := now() - (random() * interval '3 hours'); end if;
        insert into public.payments (gym_id, member_id, amount_paise, method, received_at, reference, received_by, idempotency_key)
        values (v_gym, m_id, pay, meth, ts, ref, v_owner, gen_random_uuid())
        returning id into pay_id;
        insert into _pay values (pay_id, m_id, pay, ts, meth);

        left_amt := pay;
        for c in select id, net_paise from public.charges where id in (ch_adm, ch_plan) order by kind = 'membership', created_at loop
          exit when left_amt <= 0;
          take := least(left_amt, c.net_paise);
          insert into public.payment_allocations (gym_id, payment_id, charge_id, amount_paise) values (v_gym, pay_id, c.id, take);
          left_amt := left_amt - take;
        end loop;
      end if;

      prev_mm := mm_id;
      first_period := false;
      start_d := end_d + 1;
      exit when random() < 0.11;   -- some members stop renewing
    end loop;

    -- Check-ins over the last six weeks, only on days the membership was valid
    freq := 0.25 + random() * 0.5;
    for d in select generate_series(greatest(join_d, v_today - 45), v_today, interval '1 day')::date loop
      continue when random() > freq;
      continue when not exists (select 1 from public.member_memberships mm
                                where mm.member_id = m_id and d between mm.start_date and mm.end_date + 3);
      ts := (d + case when random() < 0.6 then time '05:30' + random() * interval '4 hours'
                      else time '17:00' + random() * interval '4 hours 30 minutes' end)::timestamp at time zone v_tz;
      continue when ts > now();
      insert into public.attendance_events (gym_id, member_id, checked_in_at, membership_status, recorded_by)
      values (v_gym, m_id, ts, case when exists (select 1 from public.member_memberships mm where mm.member_id = m_id and d between mm.start_date and mm.end_date)
                                    then 'active' else 'grace' end, v_owner);
    end loop;
  end loop;

  -- Walk-ins this morning: day passes paid in cash
  select * into p from _plans where name = 'Day pass';
  for k in 1..4 loop
    n_members := n_members + 1;
    ts := least(now() - interval '20 minutes', ((v_today + time '06:10') + make_interval(mins => k * 23))::timestamp at time zone v_tz);
    insert into public.members (gym_id, member_no, full_name, phone, join_date, status, created_by, created_at)
    values (v_gym, 'XS-' || lpad(n_members::text, 4, '0'), (array['Sameer Ali','Karthik Menon','Riya Joseph','Anoop Varghese'])[k],
            '+9196' || lpad((51000000 + k * 7919)::text, 8, '0'), v_today, 'active', v_owner, ts)
    returning id into m_id;
    insert into public.member_memberships (gym_id, member_id, plan_id, plan_name, start_date, end_date, price_paise, idempotency_key, created_by, created_at)
    values (v_gym, m_id, p.id, p.name, v_today, v_today, p.price, gen_random_uuid(), v_owner, ts) returning id into mm_id;
    insert into public.charges (gym_id, member_id, membership_id, kind, description, gross_paise, due_date, created_by, created_at)
    values (v_gym, m_id, mm_id, 'membership', 'Day pass · ' || to_char(v_today, 'DD Mon YYYY'), p.price, v_today, v_owner, ts) returning id into ch_plan;
    insert into public.payments (gym_id, member_id, amount_paise, method, received_at, received_by, idempotency_key)
    values (v_gym, m_id, p.price, 'cash', ts, v_owner, gen_random_uuid()) returning id into pay_id;
    insert into public.payment_allocations (gym_id, payment_id, charge_id, amount_paise) values (v_gym, pay_id, ch_plan, p.price);
    insert into public.attendance_events (gym_id, member_id, checked_in_at, membership_status, recorded_by)
    values (v_gym, m_id, ts + interval '1 minute', 'active', v_owner);
  end loop;

  update public.gyms set member_seq = n_members where id = v_gym;

  -- Reversals: two corrected (re-recorded), one left reversed so it shows as due
  k := 0;
  for rev in select * from _pay where at > now() - interval '25 days' and at < now() - interval '1 day' order by random() limit 3 loop
    k := k + 1;
    insert into public.payment_reversals (gym_id, payment_id, reason, reversed_at, reversed_by)
    values (v_gym, rev.id, case k when 3 then 'UPI payment failed at the bank' else 'Recorded against the wrong member' end,
            rev.at + interval '25 minutes', v_owner);
    if k < 3 then
      insert into public.payments (gym_id, member_id, amount_paise, method, received_at, reference, notes, received_by, idempotency_key)
      values (v_gym, rev.member, rev.amount, rev.method, rev.at + interval '30 minutes', null, 'Re-recorded after correction', v_owner, gen_random_uuid())
      returning id into pay_id;
      left_amt := rev.amount;
      for c in select a.charge_id, sum(a.amount_paise) amt from public.payment_allocations a where a.payment_id = rev.id group by a.charge_id loop
        take := least(left_amt, c.amt);
        insert into public.payment_allocations (gym_id, payment_id, charge_id, amount_paise) values (v_gym, pay_id, c.charge_id, take);
        left_amt := left_amt - take;
      end loop;
    end if;
  end loop;

  -- Expenses for the last six months
  insert into public.expense_categories (gym_id, name) values
    (v_gym, 'Rent'), (v_gym, 'Electricity'), (v_gym, 'Salaries'), (v_gym, 'Water'), (v_gym, 'Cleaning'), (v_gym, 'Equipment'), (v_gym, 'Marketing');
  select id into cat_rent  from public.expense_categories where gym_id = v_gym and name = 'Rent';
  select id into cat_power from public.expense_categories where gym_id = v_gym and name = 'Electricity';
  select id into cat_sal   from public.expense_categories where gym_id = v_gym and name = 'Salaries';
  select id into cat_water from public.expense_categories where gym_id = v_gym and name = 'Water';
  select id into cat_clean from public.expense_categories where gym_id = v_gym and name = 'Cleaning';
  select id into cat_equip from public.expense_categories where gym_id = v_gym and name = 'Equipment';
  select id into cat_mkt   from public.expense_categories where gym_id = v_gym and name = 'Marketing';

  for k in 0..5 loop
    mstart := (date_trunc('month', v_today) - make_interval(months => k))::date;
    insert into public.expenses (gym_id, category_id, amount_paise, expense_date, method, description, recorded_by, idempotency_key)
    select v_gym, x.cat, x.amt, x.d, x.m, x.note, v_owner, gen_random_uuid()
    from (values
      (cat_rent,  3500000::bigint, mstart + 1,  'bank', 'Monthly rent'),
      (cat_sal,   1800000::bigint, mstart + 1,  'bank', 'Head trainer'),
      (cat_sal,   1500000::bigint, mstart + 1,  'bank', 'Trainer'),
      (cat_sal,   1200000::bigint, mstart + 1,  'bank', 'Front desk'),
      (cat_power, (800000 + (random() * 450000)::bigint / 100 * 100), mstart + 8, 'upi', 'KSEB bill'),
      (cat_water, 120000::bigint, mstart + 10, 'upi', 'Water authority'),
      (cat_clean, 250000::bigint, mstart + 15, 'cash', 'Housekeeping supplies'),
      (cat_equip, case when random() < 0.5 then (500000 + (random() * 3500000)::bigint / 100 * 100) end, mstart + 18, 'bank', 'Equipment purchase'),
      (cat_mkt,   case when random() < 0.4 then (200000 + (random() * 600000)::bigint / 100 * 100) end, mstart + 20, 'upi', 'Instagram ads')
    ) as x(cat, amt, d, m, note)
    where x.amt is not null and x.d <= v_today;
  end loop;
  -- One duplicate entry, reversed
  insert into public.expenses (gym_id, category_id, amount_paise, expense_date, method, description, recorded_by, idempotency_key)
  values (v_gym, cat_clean, 250000, v_today - 3, 'cash', 'Housekeeping supplies', v_owner, gen_random_uuid())
  returning id into pay_id;
  insert into public.expense_reversals (gym_id, expense_id, reason, reversed_by) values (v_gym, pay_id, 'Entered twice', v_owner);

  -- A few audit entries so the trail is not empty
  insert into public.audit_logs (gym_id, actor_user_id, action, entity, entity_id, data, occurred_at)
  values (v_gym, v_owner, 'gym.created', 'gyms', v_gym, jsonb_build_object('name', 'XS Fitness Studio'), now() - interval '300 days');

  raise notice 'Demo gym ready: % members.', n_members;
end $$;
