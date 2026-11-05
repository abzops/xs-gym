-- XS Gym — analytics, enquiries (leads) and signup onboarding.
-- Check-in is gone from the app; attendance history stays in the database
-- untouched (append-only), it is just no longer shown or counted.

-- ---------------------------------------------------------------------------
-- Onboarding: a gym is "set up" once the owner finishes or skips the wizard.
-- ---------------------------------------------------------------------------

alter table public.gyms add column onboarded_at timestamptz;
-- Gyms that already exist have been set up by hand.
update public.gyms set onboarded_at = created_at where onboarded_at is null;

create function public.complete_onboarding(p_gym uuid)
returns public.gyms language plpgsql security definer set search_path = '' as $$
declare v_g public.gyms;
begin
  perform private.require(p_gym, 'gym.settings');
  update public.gyms set onboarded_at = coalesce(onboarded_at, now())
   where id = p_gym returning * into v_g;
  perform private.audit(p_gym, 'gym.onboarded', 'gyms', p_gym);
  return v_g;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enquiries: people who asked about joining. Follow up, then mark them joined
-- (linked to the member they became) or lost.
-- ---------------------------------------------------------------------------

create table public.enquiries (
  id             uuid primary key default gen_random_uuid(),
  gym_id         uuid not null references public.gyms (id),
  full_name      text not null check (length(btrim(full_name)) between 1 and 120),
  phone          text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  source         text not null default 'walk_in'
                 check (source in ('walk_in', 'phone', 'whatsapp', 'instagram', 'referral', 'website', 'other')),
  interest       text check (interest is null or length(interest) <= 120),
  notes          text check (notes is null or length(notes) <= 1000),
  status         text not null default 'new' check (status in ('new', 'follow_up', 'trial', 'joined', 'lost')),
  follow_up_date date,
  member_id      uuid,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  closed_at      timestamptz,
  unique (gym_id, id),
  foreign key (gym_id, member_id) references public.members (gym_id, id),
  check (status <> 'joined' or member_id is not null)
);
create index enquiries_gym_status_idx on public.enquiries (gym_id, status, follow_up_date);
create index enquiries_gym_created_idx on public.enquiries (gym_id, created_at desc);
create trigger enquiries_touch before update on public.enquiries
  for each row execute function private.touch_updated_at();

alter table public.enquiries enable row level security;
create policy enquiries_read on public.enquiries for select to authenticated
  using ((select private.has_permission(gym_id, 'members.read')));
revoke all on public.enquiries from anon;
revoke insert, update, delete, truncate on public.enquiries from authenticated;
grant select on public.enquiries to authenticated;

-- Create (p_enquiry null) or update an enquiry.
create function public.save_enquiry(
  p_gym uuid, p_enquiry uuid, p_full_name text, p_phone text, p_source text default 'walk_in',
  p_interest text default null, p_notes text default null, p_follow_up_date date default null,
  p_status text default 'new', p_member_id uuid default null)
returns public.enquiries language plpgsql security definer set search_path = '' as $$
declare v_e public.enquiries;
begin
  perform private.require(p_gym, 'members.write');
  if p_status = 'joined' and p_member_id is null then
    raise exception 'XS422: choose the member this enquiry became' using errcode = '22023';
  end if;
  if p_enquiry is null then
    insert into public.enquiries (gym_id, full_name, phone, source, interest, notes, status, follow_up_date,
                                  member_id, created_by, closed_at)
    values (p_gym, btrim(p_full_name), btrim(p_phone), coalesce(p_source, 'walk_in'), nullif(btrim(p_interest), ''),
            nullif(btrim(p_notes), ''), coalesce(p_status, 'new'), p_follow_up_date, p_member_id, auth.uid(),
            case when p_status in ('joined', 'lost') then now() end)
    returning * into v_e;
  else
    update public.enquiries
       set full_name = btrim(p_full_name), phone = btrim(p_phone), source = coalesce(p_source, source),
           interest = nullif(btrim(p_interest), ''), notes = nullif(btrim(p_notes), ''),
           status = coalesce(p_status, status), follow_up_date = p_follow_up_date,
           member_id = coalesce(p_member_id, member_id),
           closed_at = case when coalesce(p_status, status) in ('joined', 'lost') then coalesce(closed_at, now()) end
     where gym_id = p_gym and id = p_enquiry
    returning * into v_e;
    if v_e.id is null then raise exception 'XS404: enquiry not found' using errcode = 'P0002'; end if;
  end if;
  perform private.audit(p_gym, 'enquiry.saved', 'enquiries', v_e.id,
    jsonb_build_object('name', v_e.full_name, 'status', v_e.status, 'source', v_e.source));
  return v_e;
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics: one call returns everything the Analytics screen draws.
-- Months are calendar months in the gym's timezone; the current month runs to
-- today. Reversed payments and expenses are excluded from revenue and cost.
-- ---------------------------------------------------------------------------

create function public.gym_analytics(p_gym uuid, p_months int default 6)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz     text;
  v_grace  int;
  v_today  date;
  v_from   date;
  v_months jsonb;
  v_out    jsonb;
begin
  if not private.has_permission(p_gym, 'reports.financial') then
    raise exception 'XS403: you do not have permission to view analytics' using errcode = '42501';
  end if;
  if p_months is null or p_months < 1 or p_months > 24 then
    raise exception 'XS422: choose between 1 and 24 months' using errcode = '22023';
  end if;
  select timezone, grace_days into v_tz, v_grace from public.gyms where id = p_gym;
  v_today := private.gym_today(p_gym);
  v_from  := (date_trunc('month', v_today) - make_interval(months => p_months - 1))::date;

  with months as (
    select gs::date as m_start,
           least((gs + interval '1 month - 1 day')::date, v_today) as m_end
    from generate_series(v_from, date_trunc('month', v_today)::date, interval '1 month') gs
  ), live_pay as (
    select p.amount_paise, (p.received_at at time zone v_tz)::date as d
    from public.payments p
    where p.gym_id = p_gym and not exists (select 1 from public.payment_reversals r where r.payment_id = p.id)
  ), cover as (
    select mm.member_id, min(mm.start_date) as first_start, max(mm.end_date) as last_end
    from public.member_memberships mm
    join public.members m on m.gym_id = mm.gym_id and m.id = mm.member_id and m.status = 'active'
    where mm.gym_id = p_gym and mm.status = 'active'
    group by mm.member_id
  ), live_exp as (
    select x.amount_paise, x.expense_date as d
    from public.expenses x
    where x.gym_id = p_gym and not exists (select 1 from public.expense_reversals er where er.expense_id = x.id)
  )
  select jsonb_agg(jsonb_build_object(
    'month', to_char(mo.m_start, 'YYYY-MM'),
    'revenue_paise', coalesce((select sum(lp.amount_paise) from live_pay lp where lp.d between mo.m_start and mo.m_end), 0),
    'expenses_paise', coalesce((select sum(le.amount_paise) from live_exp le where le.d between mo.m_start and mo.m_end), 0),
    'new_members', (select count(*) from public.members m where m.gym_id = p_gym and m.join_date between mo.m_start and mo.m_end),
    'renewals', (select count(*) from public.member_memberships mm
                  where mm.gym_id = p_gym and mm.status = 'active'
                    and (mm.created_at at time zone v_tz)::date between mo.m_start and mo.m_end
                    and exists (select 1 from public.member_memberships prev
                                 where prev.gym_id = mm.gym_id and prev.member_id = mm.member_id
                                   and prev.status = 'active' and prev.id <> mm.id and prev.start_date < mm.start_date)),
    -- Covered at the end of the month (or today for the current month).
    'active_members', (select count(distinct mm.member_id) from public.member_memberships mm
                        join public.members m on m.gym_id = mm.gym_id and m.id = mm.member_id and m.status = 'active'
                        where mm.gym_id = p_gym and mm.status = 'active'
                          and mo.m_end between mm.start_date and mm.end_date + v_grace),
    -- Lost: coverage ran out in this month and they have not come back.
    'lost_members', (select count(*) from cover c
                      where c.last_end + v_grace + 1 between mo.m_start and mo.m_end
                        and c.last_end + v_grace < v_today)
  ) order by mo.m_start)
  into v_months
  from months mo;

  select jsonb_build_object(
    'today', v_today,
    'from', v_from,
    'months', v_months,

    'by_plan', coalesce((
      select jsonb_agg(jsonb_build_object('plan', t.plan_name, 'sold', t.sold, 'value_paise', t.value) order by t.value desc, t.sold desc)
      from (select mm.plan_name, count(*) as sold, sum(mm.price_paise) as value
            from public.member_memberships mm
            where mm.gym_id = p_gym and mm.status = 'active' and (mm.created_at at time zone v_tz)::date >= v_from
            group by mm.plan_name) t), '[]'::jsonb),

    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', t.method, 'amount_paise', t.amount, 'count', t.n) order by t.amount desc)
      from (select p.method, sum(p.amount_paise) as amount, count(*) as n
            from public.payments p
            where p.gym_id = p_gym and (p.received_at at time zone v_tz)::date >= v_from
              and not exists (select 1 from public.payment_reversals r where r.payment_id = p.id)
            group by p.method) t), '[]'::jsonb),

    'expense_by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', t.name, 'amount_paise', t.amount) order by t.amount desc)
      from (select c.name, sum(x.amount_paise) as amount
            from public.expenses x join public.expense_categories c on c.id = x.category_id
            where x.gym_id = p_gym and x.expense_date >= v_from
              and not exists (select 1 from public.expense_reversals er where er.expense_id = x.id)
            group by c.name) t), '[]'::jsonb),

    -- Outstanding dues by how long ago they fell due.
    'dues_aging', (
      select jsonb_build_object(
        'd0_7',    coalesce(sum(t.due) filter (where t.age <= 7), 0),
        'd8_30',   coalesce(sum(t.due) filter (where t.age between 8 and 30), 0),
        'd31_60',  coalesce(sum(t.due) filter (where t.age between 31 and 60), 0),
        'd60_plus', coalesce(sum(t.due) filter (where t.age > 60), 0),
        'members', count(distinct t.member_id) filter (where t.due > 0))
      from (select c.member_id, private.charge_due(c.id) as due, greatest(v_today - c.due_date, 0) as age
            from public.charges c
            join public.members m on m.gym_id = c.gym_id and m.id = c.member_id and m.status = 'active'
            where c.gym_id = p_gym and c.status = 'open') t
      where t.due > 0),

    -- Of everything billed in the period, how much has been paid.
    'collection', (
      select jsonb_build_object('billed_paise', coalesce(sum(c.net_paise), 0),
                                'outstanding_paise', coalesce(sum(private.charge_due(c.id)), 0))
      from public.charges c
      where c.gym_id = p_gym and c.status = 'open' and c.due_date between v_from and v_today),

    -- Memberships that ended (past grace) in the last 90 days: how many renewed.
    'renewal', (
      select jsonb_build_object('ended', count(*), 'renewed', count(*) filter (where t.renewed))
      from (select exists (select 1 from public.member_memberships nx
                            where nx.gym_id = mm.gym_id and nx.member_id = mm.member_id and nx.status = 'active'
                              and nx.id <> mm.id and nx.end_date > mm.end_date) as renewed
            from public.member_memberships mm
            join public.members m on m.gym_id = mm.gym_id and m.id = mm.member_id
            where mm.gym_id = p_gym and mm.status = 'active'
              and mm.end_date + v_grace between v_today - 90 and v_today - 1
            ) t),

    'members', (
      select jsonb_build_object(
        'total', count(*) filter (where m.status = 'active'),
        'active', count(*) filter (where m.status = 'active' and c.last_end + v_grace >= v_today and c.first_start <= v_today),
        'never_bought', count(*) filter (where m.status = 'active' and c.member_id is null),
        'male', count(*) filter (where m.status = 'active' and m.gender = 'male'),
        'female', count(*) filter (where m.status = 'active' and m.gender = 'female'),
        'other', count(*) filter (where m.status = 'active' and m.gender = 'other'),
        'unknown', count(*) filter (where m.status = 'active' and m.gender is null))
      from public.members m
      left join (select mm.member_id, min(mm.start_date) as first_start, max(mm.end_date) as last_end
                 from public.member_memberships mm where mm.gym_id = p_gym and mm.status = 'active'
                 group by mm.member_id) c on c.member_id = m.id
      where m.gym_id = p_gym),

    'last_30_revenue_paise', coalesce((
      select sum(p.amount_paise) from public.payments p
      where p.gym_id = p_gym and (p.received_at at time zone v_tz)::date > v_today - 30
        and not exists (select 1 from public.payment_reversals r where r.payment_id = p.id)), 0),

    'enquiries', (
      select jsonb_build_object(
        'total', count(*),
        'open', count(*) filter (where e.status in ('new', 'follow_up', 'trial')),
        'joined', count(*) filter (where e.status = 'joined'),
        'lost', count(*) filter (where e.status = 'lost'),
        'by_source', coalesce((select jsonb_object_agg(s.source, s.n) from (
            select e2.source, count(*) as n from public.enquiries e2
            where e2.gym_id = p_gym and (e2.created_at at time zone v_tz)::date >= v_from group by e2.source) s), '{}'::jsonb))
      from public.enquiries e
      where e.gym_id = p_gym and (e.created_at at time zone v_tz)::date >= v_from)
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.complete_onboarding(uuid) from public, anon;
revoke execute on function public.save_enquiry(uuid, uuid, text, text, text, text, text, date, text, uuid) from public, anon;
revoke execute on function public.gym_analytics(uuid, int) from public, anon;
grant execute on function public.complete_onboarding(uuid) to authenticated;
grant execute on function public.save_enquiry(uuid, uuid, text, text, text, text, text, date, text, uuid) to authenticated;
grant execute on function public.gym_analytics(uuid, int) to authenticated;
