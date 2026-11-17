-- Edit (backdate or correct) the dates of a sold membership.
-- Example: renewal due 2 Nov, paid 12 Nov, sold by mistake from 12 Nov.
-- The owner/manager sets the start to 2 Nov; the end is recalculated from the
-- plan (or set by hand) and renewals already queued after it move by the same
-- number of days, so the billing cycle stays continuous.
-- Payments, charges and allocations are untouched: no money is re-recorded.
-- Each change is audited with the old and new dates and a reason.

insert into public.role_permissions (role, permission)
values ('owner', 'memberships.edit_dates'), ('manager', 'memberships.edit_dates')
on conflict do nothing;

create function public.update_membership_dates(
  p_gym uuid, p_membership uuid, p_start_date date, p_reason text,
  p_end_date date default null, p_move_following boolean default true)
returns public.member_memberships language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.gym_today(p_gym);
  v_mm    public.member_memberships;
  v_plan  public.membership_plans;
  v_end   date;
  v_shift int;
  v_moved int := 0;
  v_old_start date;
  v_old_end   date;
begin
  perform private.require(p_gym, 'memberships.edit_dates');
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'XS422: give a reason for the date change (at least 3 characters)' using errcode = '22023';
  end if;
  if p_start_date is null then
    raise exception 'XS422: start date is required' using errcode = '22023';
  end if;
  if p_start_date < v_today - 400 or p_start_date > v_today + 400 then
    raise exception 'XS422: start date must be within about a year of today' using errcode = '22023';
  end if;

  select * into v_mm from public.member_memberships
   where gym_id = p_gym and id = p_membership for update;
  if v_mm.id is null then raise exception 'XS404: membership not found' using errcode = 'P0002'; end if;
  if v_mm.status <> 'active' then
    raise exception 'XS409: a cancelled membership cannot be edited' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.membership_pauses p
              where p.gym_id = p_gym and p.membership_id = v_mm.id and p.status = 'active' and p.end_date >= v_today) then
    raise exception 'XS409: this membership is paused. Resume the pause first, then edit the dates.' using errcode = 'P0001';
  end if;

  v_old_start := v_mm.start_date; v_old_end := v_mm.end_date;
  select * into v_plan from public.membership_plans where gym_id = p_gym and id = v_mm.plan_id;
  v_end := coalesce(p_end_date, private.membership_end_date(p_start_date, v_plan.duration_unit, v_plan.duration_count));
  if v_end < p_start_date then
    raise exception 'XS422: end date cannot be before the start date' using errcode = '22023';
  end if;
  if v_end - p_start_date > 3 * 366 then
    raise exception 'XS422: a membership cannot be longer than 3 years' using errcode = '22023';
  end if;
  if p_start_date = v_mm.start_date and v_end = v_mm.end_date then
    raise exception 'XS422: the dates are unchanged' using errcode = '22023';
  end if;
  v_shift := v_end - v_mm.end_date;

  perform set_config('xs.membership_shift', 'on', true);
  -- Queued renewals first, so the edited period never overlaps them midway.
  if p_move_following and v_shift <> 0 then
    update public.member_memberships set start_date = start_date + v_shift, end_date = end_date + v_shift
     where gym_id = p_gym and member_id = v_mm.member_id and status = 'active'
       and id <> v_mm.id and start_date > v_mm.end_date;
    get diagnostics v_moved = row_count;
  end if;
  update public.member_memberships set start_date = p_start_date, end_date = v_end
   where id = v_mm.id
  returning * into v_mm;
  perform set_config('xs.membership_shift', 'off', true);

  if exists (select 1 from public.member_memberships o
              where o.gym_id = p_gym and o.member_id = v_mm.member_id and o.status = 'active' and o.id <> v_mm.id
                and o.start_date <= v_mm.end_date and o.end_date >= v_mm.start_date) then
    raise exception 'XS409: these dates overlap another membership of this member' using errcode = '23P01';
  end if;

  perform private.audit(p_gym, 'membership.dates_changed', 'member_memberships', v_mm.id,
    jsonb_build_object('plan', v_mm.plan_name,
      'old_start', v_old_start, 'old_end', v_old_end,
      'new_start', v_mm.start_date, 'new_end', v_mm.end_date,
      'shift_days', v_shift, 'moved_following', v_moved),
    btrim(p_reason));
  return v_mm;
end;
$$;

revoke all on function public.update_membership_dates(uuid, uuid, date, text, date, boolean) from public, anon, authenticated;
grant execute on function public.update_membership_dates(uuid, uuid, date, text, date, boolean) to authenticated;
comment on function public.update_membership_dates(uuid, uuid, date, text, date, boolean)
  is 'Owner/manager: correct or backdate a membership''s dates; end recalculated from the plan unless given; queued renewals move by the same days; audited; payments untouched.';
