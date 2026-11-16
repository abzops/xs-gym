-- Membership pause (freeze): a member stops coming for N days and keeps those
-- days. Pausing pushes the running membership's end date (and any already
-- sold renewals queued after it) forward by N days; resuming early pulls them
-- back by the days not used. Every pause is a row in membership_pauses and
-- every change is audited. Membership dates stay immutable for everything
-- else: the guard only lets these two commands move them.

create table public.membership_pauses (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms (id),
  member_id     uuid not null,
  membership_id uuid not null,
  start_date    date not null,
  end_date      date not null,                       -- last planned paused day (inclusive)
  days          int  not null check (days between 1 and 180),
  reason        text not null check (length(btrim(reason)) between 3 and 300),
  status        text not null default 'active' check (status in ('active', 'ended')),
  resumed_on    date,                                -- first day back, when resumed early
  unused_days   int check (unused_days between 0 and 180),
  end_reason    text check (end_reason is null or length(end_reason) <= 300),
  created_at    timestamptz not null default now(),
  created_by    uuid,
  ended_by      uuid,
  check (end_date = start_date + days - 1),
  foreign key (gym_id, member_id) references public.members (gym_id, id),
  foreign key (gym_id, membership_id) references public.member_memberships (gym_id, id)
);
create index membership_pauses_member_idx on public.membership_pauses (gym_id, member_id, start_date desc);
-- At most one open pause per member.
create unique index membership_pauses_one_open on public.membership_pauses (gym_id, member_id) where status = 'active';

alter table public.membership_pauses enable row level security;
create policy membership_pauses_read on public.membership_pauses for select to authenticated
  using ((select private.has_permission(gym_id, 'members.read')));
revoke all on public.membership_pauses from anon, authenticated;
grant select on public.membership_pauses to authenticated;

insert into public.role_permissions (role, permission)
values ('owner', 'memberships.pause'), ('manager', 'memberships.pause')
on conflict do nothing;

-- Dates may move only inside pause_membership / resume_membership, which set
-- a transaction-local flag. Status, price and ownership never change here.
create or replace function private.guard_membership_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'XS405: memberships cannot be deleted' using errcode = '42501';
  end if;
  if coalesce(current_setting('xs.membership_shift', true), '') = 'on'
     and old.status = 'active' and new.status = 'active'
     and (new.gym_id, new.member_id, new.plan_id, new.price_paise)
         is not distinct from (old.gym_id, old.member_id, old.plan_id, old.price_paise)
     and new.end_date >= new.start_date then
    return new;
  end if;
  if old.status <> 'active' or new.status <> 'cancelled'
     or (new.gym_id, new.member_id, new.plan_id, new.start_date, new.end_date, new.price_paise)
        is distinct from
        (old.gym_id, old.member_id, old.plan_id, old.start_date, old.end_date, old.price_paise) then
    raise exception 'XS405: a membership can only be cancelled' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Moves a member's membership `p_membership` end date, and the memberships
-- queued after it, by p_shift days (positive = later).
create function private.shift_memberships(p_gym uuid, p_member uuid, p_membership uuid, p_shift int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_cur public.member_memberships;
begin
  select * into v_cur from public.member_memberships where gym_id = p_gym and id = p_membership;
  perform set_config('xs.membership_shift', 'on', true);
  update public.member_memberships set end_date = end_date + p_shift
   where gym_id = p_gym and id = p_membership;
  update public.member_memberships set start_date = start_date + p_shift, end_date = end_date + p_shift
   where gym_id = p_gym and member_id = p_member and status = 'active'
     and id <> p_membership and start_date > v_cur.end_date;
  perform set_config('xs.membership_shift', 'off', true);
end;
$$;
revoke all on function private.shift_memberships(uuid, uuid, uuid, int) from public, anon, authenticated;

create function public.pause_membership(p_gym uuid, p_member uuid, p_days int, p_reason text,
                                        p_start_date date default null)
returns public.membership_pauses language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.gym_today(p_gym);
  v_start date := coalesce(p_start_date, private.gym_today(p_gym));
  v_mm    public.member_memberships;
  v_p     public.membership_pauses;
begin
  perform private.require(p_gym, 'memberships.pause');
  if p_days is null or p_days < 1 or p_days > 180 then
    raise exception 'XS422: a pause can be 1 to 180 days' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'XS422: give a reason for the pause (at least 3 characters)' using errcode = '22023';
  end if;
  if v_start < v_today or v_start > v_today + 60 then
    raise exception 'XS422: the pause must start today or within the next 60 days' using errcode = '22023';
  end if;
  perform 1 from public.members where gym_id = p_gym and id = p_member and status = 'active' for update;
  if not found then raise exception 'XS404: active member not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.membership_pauses
              where gym_id = p_gym and member_id = p_member and status = 'active' and end_date >= v_today) then
    raise exception 'XS409: this member already has a pause. Resume it first.' using errcode = '23505';
  end if;
  -- Close a finished pause so the one-open-pause index allows a new one.
  update public.membership_pauses set status = 'ended'
   where gym_id = p_gym and member_id = p_member and status = 'active' and end_date < v_today;

  select * into v_mm from public.member_memberships
   where gym_id = p_gym and member_id = p_member and status = 'active'
     and v_start between start_date and end_date
   order by start_date limit 1 for update;
  if v_mm.id is null then
    raise exception 'XS409: no running membership on that date to pause' using errcode = 'P0001';
  end if;

  perform private.shift_memberships(p_gym, p_member, v_mm.id, p_days);
  insert into public.membership_pauses (gym_id, member_id, membership_id, start_date, end_date, days, reason, created_by)
  values (p_gym, p_member, v_mm.id, v_start, v_start + p_days - 1, p_days, btrim(p_reason), auth.uid())
  returning * into v_p;
  perform private.audit(p_gym, 'membership.paused', 'member_memberships', v_mm.id,
    jsonb_build_object('pause_id', v_p.id, 'start', v_p.start_date, 'end', v_p.end_date, 'days', p_days,
                       'old_end', v_mm.end_date, 'new_end', v_mm.end_date + p_days),
    btrim(p_reason));
  return v_p;
end;
$$;

create function public.resume_membership(p_gym uuid, p_member uuid, p_reason text default null)
returns public.membership_pauses language plpgsql security definer set search_path = '' as $$
declare
  v_today  date := private.gym_today(p_gym);
  v_p      public.membership_pauses;
  v_unused int;
begin
  perform private.require(p_gym, 'memberships.pause');
  select * into v_p from public.membership_pauses
   where gym_id = p_gym and member_id = p_member and status = 'active'
   for update;
  if v_p.id is null or v_p.end_date < v_today then
    raise exception 'XS404: this member has no pause to end' using errcode = 'P0002';
  end if;
  -- Days from today to the planned end are given back (all of them if the
  -- pause has not started yet). The member can train again today.
  v_unused := v_p.end_date - greatest(v_today, v_p.start_date) + 1;
  perform private.shift_memberships(p_gym, p_member, v_p.membership_id, -v_unused);
  update public.membership_pauses
     set status = 'ended', resumed_on = v_today, unused_days = v_unused,
         end_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), ''), ended_by = auth.uid()
   where id = v_p.id
  returning * into v_p;
  perform private.audit(p_gym, 'membership.resumed', 'member_memberships', v_p.membership_id,
    jsonb_build_object('pause_id', v_p.id, 'unused_days', v_unused, 'resumed_on', v_today),
    nullif(btrim(coalesce(p_reason, '')), ''));
  return v_p;
end;
$$;

revoke all on function public.pause_membership(uuid, uuid, int, text, date) from public, anon, authenticated;
revoke all on function public.resume_membership(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.pause_membership(uuid, uuid, int, text, date) to authenticated;
grant execute on function public.resume_membership(uuid, uuid, text) to authenticated;

-- Paused members show as "paused"; paused_until is the last paused day of a
-- current or upcoming pause. Columns are unchanged except the new last one.
create or replace view public.member_overview with (security_invoker = true) as
select
  m.id, m.gym_id, m.member_no, m.full_name, m.phone, m.email, m.gender, m.date_of_birth,
  m.address, m.emergency_contact, m.join_date, m.status, m.created_at,
  cur.id          as membership_id,
  cur.plan_name,
  cur.start_date,
  cur.end_date,
  (select max(mm.end_date) from public.member_memberships mm
    where mm.gym_id = m.gym_id and mm.member_id = m.id and mm.status = 'active') as valid_until,
  case when pz.start_date is not null and t.today >= pz.start_date then 'paused'
       else private.membership_status(coalesce(cur.status, 'active'), cur.start_date, cur.end_date,
                                      t.today, g.grace_days) end as membership_status,
  coalesce((select sum(private.charge_due(c.id)) from public.charges c
            where c.gym_id = m.gym_id and c.member_id = m.id and c.status = 'open'), 0)::bigint as due_paise,
  coalesce((select sum(private.payment_unallocated(p.id)) from public.payments p
            where p.gym_id = m.gym_id and p.member_id = m.id), 0)::bigint as credit_paise,
  (select max(a.checked_in_at) from public.attendance_events a
    where a.gym_id = m.gym_id and a.member_id = m.id and a.voided_at is null) as last_check_in_at,
  pz.end_date   as paused_until,
  pz.start_date as pause_starts
from public.members m
join public.gyms g on g.id = m.gym_id
cross join lateral (select private.gym_today(m.gym_id) as today) t
left join lateral (
  select mm.* from public.member_memberships mm
  where mm.gym_id = m.gym_id and mm.member_id = m.id and mm.status = 'active'
  order by case
             when t.today between mm.start_date and mm.end_date then 1
             when t.today > mm.end_date and t.today <= mm.end_date + g.grace_days then 2
             when t.today < mm.start_date then 3
             else 4
           end,
           mm.end_date desc, mm.created_at desc
  limit 1
) cur on true
left join lateral (
  select p.start_date, p.end_date from public.membership_pauses p
  where p.gym_id = m.gym_id and p.member_id = m.id and p.status = 'active' and p.end_date >= t.today
  order by p.start_date limit 1
) pz on true;
