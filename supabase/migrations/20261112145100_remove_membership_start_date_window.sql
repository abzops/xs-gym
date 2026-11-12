-- Remove the artificial 30-day-back / 60-day-ahead membership sale date window.
-- Preserve all original authorization, idempotency, pricing, ledger, renewal and audit logic.
-- Does not alter existing memberships or payments.
-- Rollback: reapply previous sell_membership definition from 20261104194332_commands.sql.

create or replace function public.sell_membership(
  p_gym uuid, p_member uuid, p_plan uuid, p_idempotency_key uuid,
  p_start_date date default null, p_discount_paise bigint default 0,
  p_discount_reason text default null, p_admission_fee_paise bigint default 0)
returns public.member_memberships language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.member_memberships;
  v_plan     public.membership_plans;
  v_member   public.members;
  v_last     public.member_memberships;
  v_today    date := private.gym_today(p_gym);
  v_grace    int;
  v_start    date;
  v_mm       public.member_memberships;
begin
  perform private.require(p_gym, 'memberships.sell');

  select * into v_existing from public.member_memberships
   where gym_id = p_gym and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then return v_existing; end if;

  if coalesce(p_discount_paise, 0) > 0 and not private.has_permission(p_gym, 'discounts.apply') then
    raise exception 'XS403: only a manager or owner can give a discount' using errcode = '42501';
  end if;
  if coalesce(p_discount_paise, 0) < 0 or coalesce(p_admission_fee_paise, 0) < 0 then
    raise exception 'XS422: amounts cannot be negative' using errcode = '22023';
  end if;

  select * into v_member from public.members where gym_id = p_gym and id = p_member;
  if v_member.id is null then raise exception 'XS404: member not found' using errcode = 'P0002'; end if;
  if v_member.status <> 'active' then
    raise exception 'XS412: this member is archived. Restore them first.' using errcode = 'P0001';
  end if;
  select * into v_plan from public.membership_plans where gym_id = p_gym and id = p_plan;
  if v_plan.id is null or v_plan.status <> 'active' then
    raise exception 'XS404: plan not found or no longer sold' using errcode = 'P0002';
  end if;
  if coalesce(p_discount_paise, 0) > v_plan.price_paise then
    raise exception 'XS422: discount cannot be more than the plan price' using errcode = '22023';
  end if;

  select grace_days into v_grace from public.gyms where id = p_gym;
  select * into v_last from public.member_memberships
   where gym_id = p_gym and member_id = p_member and status = 'active'
   order by end_date desc limit 1;

  if v_last.id is not null and v_today <= v_last.end_date + v_grace then
    v_start := v_last.end_date + 1;
  else
    v_start := v_today;
  end if;
  if p_start_date is not null then
    v_start := p_start_date;
  end if;

  insert into public.member_memberships (gym_id, member_id, plan_id, plan_name, start_date, end_date,
                                         price_paise, renewed_from_id, idempotency_key, created_by)
  values (p_gym, p_member, p_plan, v_plan.name, v_start,
          private.membership_end_date(v_start, v_plan.duration_unit, v_plan.duration_count),
          v_plan.price_paise, v_last.id, p_idempotency_key, auth.uid())
  returning * into v_mm;

  if v_plan.price_paise > 0 then
    insert into public.charges (gym_id, member_id, membership_id, kind, description, gross_paise,
                                discount_paise, discount_reason, due_date, created_by)
    values (p_gym, p_member, v_mm.id, 'membership',
            v_plan.name || ' · ' || to_char(v_mm.start_date, 'DD Mon YYYY') || ' – ' || to_char(v_mm.end_date, 'DD Mon YYYY'),
            v_plan.price_paise, coalesce(p_discount_paise, 0), nullif(btrim(p_discount_reason), ''),
            v_today, auth.uid());
  end if;
  if coalesce(p_admission_fee_paise, 0) > 0 then
    insert into public.charges (gym_id, member_id, kind, description, gross_paise, due_date, created_by)
    values (p_gym, p_member, 'admission', 'Admission fee', p_admission_fee_paise, v_today, auth.uid());
  end if;

  perform private.apply_credit(p_gym, p_member);
  perform private.audit(p_gym, case when v_last.id is null then 'membership.sold' else 'membership.renewed' end,
    'member_memberships', v_mm.id,
    jsonb_build_object('plan', v_plan.name, 'start', v_mm.start_date, 'end', v_mm.end_date,
                       'price_paise', v_plan.price_paise, 'discount_paise', coalesce(p_discount_paise, 0),
                       'admission_paise', coalesce(p_admission_fee_paise, 0)),
    nullif(btrim(p_discount_reason), ''));
  return v_mm;
end;
$$;
