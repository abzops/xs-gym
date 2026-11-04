-- XS Gym — command functions (the only write path) and report functions.
-- Error messages start with a code the app maps to plain-language feedback:
-- XS401 sign in, XS402 read-only, XS403 forbidden, XS404 not found,
-- XS409 conflict/duplicate, XS412 precondition, XS422 invalid input.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create function private.normalize_phone(p_phone text)
returns text language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
begin
  if d ~ '^\+[1-9][0-9]{7,14}$' then return d; end if;
  d := replace(d, '+', '');
  if d ~ '^[6-9][0-9]{9}$'   then return '+91' || d; end if;
  if d ~ '^0[6-9][0-9]{9}$'  then return '+91' || substr(d, 2); end if;
  if d ~ '^91[6-9][0-9]{9}$' then return '+' || d; end if;
  raise exception 'XS422: enter a valid mobile number (10 digits, or with country code)' using errcode = '22023';
end;
$$;

create function private.next_member_no(p_gym uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  update public.gyms set member_seq = member_seq + 1 where id = p_gym returning member_seq into v;
  return 'XS-' || case when v < 10000 then lpad(v::text, 4, '0') else v::text end;
end;
$$;

-- Applies a member's unallocated payments to their open charges, oldest first.
create function private.apply_credit(p_gym uuid, p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p record; c record;
  v_left bigint; v_due bigint; v_take bigint;
begin
  for p in
    select pay.id from public.payments pay
    where pay.gym_id = p_gym and pay.member_id = p_member
      and not exists (select 1 from public.payment_reversals r where r.payment_id = pay.id)
    order by pay.received_at, pay.id
  loop
    v_left := private.payment_unallocated(p.id);
    continue when v_left <= 0;
    for c in
      select ch.id from public.charges ch
      where ch.gym_id = p_gym and ch.member_id = p_member and ch.status = 'open'
      order by ch.due_date, ch.created_at, ch.id
    loop
      exit when v_left <= 0;
      v_due := private.charge_due(c.id);
      continue when v_due <= 0;
      v_take := least(v_left, v_due);
      insert into public.payment_allocations (gym_id, payment_id, charge_id, amount_paise)
      values (p_gym, p.id, c.id, v_take);
      v_left := v_left - v_take;
    end loop;
  end loop;
end;
$$;

create function private.member_status_now(p_gym uuid, p_member uuid)
returns text language sql stable security definer set search_path = '' as $$
  select membership_status from public.member_overview where gym_id = p_gym and id = p_member;
$$;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

create function public.create_member(
  p_gym uuid, p_full_name text, p_phone text, p_email text default null,
  p_gender text default null, p_date_of_birth date default null, p_address text default null,
  p_emergency_contact text default null, p_join_date date default null)
returns public.members language plpgsql security definer set search_path = '' as $$
declare
  v_phone text;
  v_dup   public.members;
  v_m     public.members;
begin
  perform private.require(p_gym, 'members.write');
  v_phone := private.normalize_phone(p_phone);
  select * into v_dup from public.members
   where gym_id = p_gym and phone = v_phone and status = 'active';
  if v_dup.id is not null then
    raise exception 'XS409: % (%) already uses this number', v_dup.full_name, v_dup.member_no
      using errcode = '23505';
  end if;

  insert into public.members (gym_id, member_no, full_name, phone, email, gender, date_of_birth,
                              address, emergency_contact, join_date, created_by)
  values (p_gym, private.next_member_no(p_gym), btrim(p_full_name), v_phone,
          nullif(lower(btrim(p_email)), ''), nullif(p_gender, ''), p_date_of_birth,
          nullif(btrim(p_address), ''), nullif(btrim(p_emergency_contact), ''),
          coalesce(p_join_date, private.gym_today(p_gym)), auth.uid())
  returning * into v_m;

  perform private.audit(p_gym, 'member.created', 'members', v_m.id,
    jsonb_build_object('member_no', v_m.member_no, 'full_name', v_m.full_name));
  return v_m;
end;
$$;

create function public.update_member(
  p_gym uuid, p_member uuid, p_full_name text, p_phone text, p_email text default null,
  p_gender text default null, p_date_of_birth date default null, p_address text default null,
  p_emergency_contact text default null)
returns public.members language plpgsql security definer set search_path = '' as $$
declare
  v_phone text;
  v_old   public.members;
  v_m     public.members;
begin
  perform private.require(p_gym, 'members.write');
  select * into v_old from public.members where gym_id = p_gym and id = p_member;
  if v_old.id is null then raise exception 'XS404: member not found' using errcode = 'P0002'; end if;
  v_phone := private.normalize_phone(p_phone);
  if exists (select 1 from public.members where gym_id = p_gym and phone = v_phone
             and status = 'active' and id <> p_member) then
    raise exception 'XS409: another member already uses this number' using errcode = '23505';
  end if;

  update public.members
     set full_name = btrim(p_full_name), phone = v_phone, email = nullif(lower(btrim(p_email)), ''),
         gender = nullif(p_gender, ''), date_of_birth = p_date_of_birth,
         address = nullif(btrim(p_address), ''), emergency_contact = nullif(btrim(p_emergency_contact), '')
   where gym_id = p_gym and id = p_member
  returning * into v_m;

  perform private.audit(p_gym, 'member.updated', 'members', p_member,
    jsonb_build_object('before', jsonb_build_object('full_name', v_old.full_name, 'phone', v_old.phone),
                       'after',  jsonb_build_object('full_name', v_m.full_name, 'phone', v_m.phone)));
  return v_m;
end;
$$;

create function public.set_member_status(p_gym uuid, p_member uuid, p_status text, p_reason text)
returns public.members language plpgsql security definer set search_path = '' as $$
declare v_m public.members;
begin
  perform private.require(p_gym, 'members.archive');
  if p_status not in ('active', 'archived') then
    raise exception 'XS422: invalid status' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'XS422: a reason is required' using errcode = '22023';
  end if;
  update public.members set status = p_status where gym_id = p_gym and id = p_member returning * into v_m;
  if v_m.id is null then raise exception 'XS404: member not found' using errcode = 'P0002'; end if;
  perform private.audit(p_gym, 'member.' || p_status, 'members', p_member, null, p_reason);
  return v_m;
end;
$$;

-- ---------------------------------------------------------------------------
-- Plans and memberships
-- ---------------------------------------------------------------------------

create function public.save_plan(
  p_gym uuid, p_plan uuid, p_name text, p_duration_unit text, p_duration_count int,
  p_price_paise bigint, p_description text default null, p_status text default 'active')
returns public.membership_plans language plpgsql security definer set search_path = '' as $$
declare v_p public.membership_plans;
begin
  perform private.require(p_gym, 'plans.manage');
  if p_plan is null then
    insert into public.membership_plans (gym_id, name, duration_unit, duration_count, price_paise, description, status)
    values (p_gym, btrim(p_name), p_duration_unit, p_duration_count, p_price_paise,
            nullif(btrim(p_description), ''), p_status)
    returning * into v_p;
  else
    update public.membership_plans
       set name = btrim(p_name), duration_unit = p_duration_unit, duration_count = p_duration_count,
           price_paise = p_price_paise, description = nullif(btrim(p_description), ''), status = p_status
     where gym_id = p_gym and id = p_plan
    returning * into v_p;
    if v_p.id is null then raise exception 'XS404: plan not found' using errcode = 'P0002'; end if;
  end if;
  perform private.audit(p_gym, 'plan.saved', 'membership_plans', v_p.id,
    jsonb_build_object('name', v_p.name, 'price_paise', v_p.price_paise,
                       'duration', v_p.duration_count || ' ' || v_p.duration_unit, 'status', v_p.status));
  return v_p;
end;
$$;

-- Sells a new membership or renewal. Start date rule (D-04, assumed option A):
-- continue the day after the latest end if renewed before the grace period
-- ends; otherwise start today. Staff may pick another date within limits.
create function public.sell_membership(
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
    if p_start_date < v_today - 30 or p_start_date > v_today + 60 then
      raise exception 'XS422: start date must be within 30 days before or 60 days after today'
        using errcode = '22023';
    end if;
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

create function public.cancel_membership(p_gym uuid, p_membership uuid, p_reason text)
returns public.member_memberships language plpgsql security definer set search_path = '' as $$
declare v_mm public.member_memberships;
begin
  perform private.require(p_gym, 'memberships.cancel');
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'XS422: a reason is required' using errcode = '22023';
  end if;
  update public.member_memberships set status = 'cancelled', cancel_reason = btrim(p_reason)
   where gym_id = p_gym and id = p_membership and status = 'active'
  returning * into v_mm;
  if v_mm.id is null then raise exception 'XS404: active membership not found' using errcode = 'P0002'; end if;
  perform private.audit(p_gym, 'membership.cancelled', 'member_memberships', p_membership, null, p_reason);
  return v_mm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------

create function public.record_payment(
  p_gym uuid, p_member uuid, p_amount_paise bigint, p_method text, p_idempotency_key uuid,
  p_reference text default null, p_notes text default null)
returns public.payments language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.payments;
  v_p        public.payments;
begin
  perform private.require(p_gym, 'payments.record');

  select * into v_existing from public.payments where gym_id = p_gym and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.member_id = p_member and v_existing.amount_paise = p_amount_paise then
      return v_existing;
    end if;
    raise exception 'XS409: this payment was already submitted with different details' using errcode = '23505';
  end if;
  if not exists (select 1 from public.members where gym_id = p_gym and id = p_member) then
    raise exception 'XS404: member not found' using errcode = 'P0002';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 or p_amount_paise > 100000000 then
    raise exception 'XS422: enter an amount between ₹0.01 and ₹10,00,000' using errcode = '22023';
  end if;

  insert into public.payments (gym_id, member_id, amount_paise, method, reference, notes, received_by, idempotency_key)
  values (p_gym, p_member, p_amount_paise, p_method, nullif(btrim(p_reference), ''),
          nullif(btrim(p_notes), ''), auth.uid(), p_idempotency_key)
  returning * into v_p;

  perform private.apply_credit(p_gym, p_member);
  perform private.audit(p_gym, 'payment.recorded', 'payments', v_p.id,
    jsonb_build_object('member_id', p_member, 'amount_paise', v_p.amount_paise, 'method', v_p.method));
  return v_p;
end;
$$;

create function public.reverse_payment(p_gym uuid, p_payment uuid, p_reason text)
returns public.payment_reversals language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments;
  v_r   public.payment_reversals;
begin
  perform private.require(p_gym, 'payments.reverse');
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'XS422: a reason is required' using errcode = '22023';
  end if;
  select * into v_pay from public.payments where gym_id = p_gym and id = p_payment;
  if v_pay.id is null then raise exception 'XS404: payment not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.payment_reversals where payment_id = p_payment) then
    raise exception 'XS409: this payment is already reversed' using errcode = '23505';
  end if;

  insert into public.payment_reversals (gym_id, payment_id, reason, reversed_by)
  values (p_gym, p_payment, btrim(p_reason), auth.uid())
  returning * into v_r;

  perform private.apply_credit(p_gym, v_pay.member_id);
  perform private.audit(p_gym, 'payment.reversed', 'payments', p_payment,
    jsonb_build_object('amount_paise', v_pay.amount_paise), p_reason);
  return v_r;
end;
$$;

create function public.void_charge(p_gym uuid, p_charge uuid, p_reason text)
returns public.charges language plpgsql security definer set search_path = '' as $$
declare v_c public.charges;
begin
  perform private.require(p_gym, 'charges.void');
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'XS422: a reason is required' using errcode = '22023';
  end if;
  update public.charges set status = 'void', void_reason = btrim(p_reason), voided_at = now(), voided_by = auth.uid()
   where gym_id = p_gym and id = p_charge and status = 'open'
  returning * into v_c;
  if v_c.id is null then raise exception 'XS404: open charge not found' using errcode = 'P0002'; end if;
  perform private.apply_credit(p_gym, v_c.member_id);
  perform private.audit(p_gym, 'charge.voided', 'charges', p_charge,
    jsonb_build_object('net_paise', v_c.net_paise), p_reason);
  return v_c;
end;
$$;

-- ---------------------------------------------------------------------------
-- Attendance (D-07, assumed: one check-in per day; expired/frozen members
-- need a manager override with a reason)
-- ---------------------------------------------------------------------------

create function public.check_in(p_gym uuid, p_member uuid, p_override_reason text default null)
returns public.attendance_events language plpgsql security definer set search_path = '' as $$
declare
  v_member public.members;
  v_status text;
  v_tz     text;
  v_prev   timestamptz;
  v_reason text := nullif(btrim(p_override_reason), '');
  v_e      public.attendance_events;
begin
  perform private.require(p_gym, 'attendance.checkin');
  select * into v_member from public.members where gym_id = p_gym and id = p_member;
  if v_member.id is null then raise exception 'XS404: member not found' using errcode = 'P0002'; end if;
  if v_member.status <> 'active' then
    raise exception 'XS412: this member is archived' using errcode = 'P0001';
  end if;

  select timezone into v_tz from public.gyms where id = p_gym;
  v_status := private.member_status_now(p_gym, p_member);

  if v_status not in ('active', 'grace') and v_reason is null then
    raise exception 'XS412: membership is %. Renew it, or a manager can check in with a reason.',
      case v_status when 'none' then 'not set up' else v_status end using errcode = 'P0001';
  end if;

  select max(checked_in_at) into v_prev from public.attendance_events
   where gym_id = p_gym and member_id = p_member and voided_at is null
     and (checked_in_at at time zone v_tz)::date = private.gym_today(p_gym);
  if v_prev is not null and v_reason is null then
    raise exception 'XS409: already checked in today at %', to_char(v_prev at time zone v_tz, 'HH12:MI AM')
      using errcode = '23505';
  end if;

  if v_reason is not null and not private.has_permission(p_gym, 'attendance.override') then
    raise exception 'XS403: only a manager or owner can override a check-in' using errcode = '42501';
  end if;

  insert into public.attendance_events (gym_id, member_id, membership_status, override_reason, recorded_by)
  values (p_gym, p_member, v_status, v_reason, auth.uid())
  returning * into v_e;

  if v_reason is not null then
    perform private.audit(p_gym, 'attendance.override', 'attendance_events', v_e.id,
      jsonb_build_object('member_id', p_member, 'status', v_status), v_reason);
  end if;
  return v_e;
end;
$$;

create function public.void_check_in(p_gym uuid, p_event uuid, p_reason text)
returns public.attendance_events language plpgsql security definer set search_path = '' as $$
declare v_e public.attendance_events;
begin
  perform private.require(p_gym, 'attendance.correct');
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'XS422: a reason is required' using errcode = '22023';
  end if;
  update public.attendance_events set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where gym_id = p_gym and id = p_event and voided_at is null
  returning * into v_e;
  if v_e.id is null then raise exception 'XS404: check-in not found' using errcode = 'P0002'; end if;
  perform private.audit(p_gym, 'attendance.voided', 'attendance_events', p_event, null, p_reason);
  return v_e;
end;
$$;

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------

create function public.record_expense(
  p_gym uuid, p_category text, p_amount_paise bigint, p_expense_date date, p_method text,
  p_idempotency_key uuid, p_description text default null)
returns public.expenses language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.expenses;
  v_cat      uuid;
  v_today    date := private.gym_today(p_gym);
  v_x        public.expenses;
begin
  perform private.require(p_gym, 'expenses.record');
  select * into v_existing from public.expenses where gym_id = p_gym and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then return v_existing; end if;
  if length(btrim(coalesce(p_category, ''))) = 0 then
    raise exception 'XS422: choose a category' using errcode = '22023';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 or p_amount_paise > 100000000 then
    raise exception 'XS422: enter an amount between ₹0.01 and ₹10,00,000' using errcode = '22023';
  end if;
  if p_expense_date > v_today or p_expense_date < v_today - 365 then
    raise exception 'XS422: expense date must be within the last year and not in the future' using errcode = '22023';
  end if;

  select id into v_cat from public.expense_categories where gym_id = p_gym and lower(name) = lower(btrim(p_category));
  if v_cat is null then
    insert into public.expense_categories (gym_id, name) values (p_gym, btrim(p_category)) returning id into v_cat;
  end if;

  insert into public.expenses (gym_id, category_id, amount_paise, expense_date, method, description, recorded_by, idempotency_key)
  values (p_gym, v_cat, p_amount_paise, p_expense_date, p_method, nullif(btrim(p_description), ''), auth.uid(), p_idempotency_key)
  returning * into v_x;

  perform private.audit(p_gym, 'expense.recorded', 'expenses', v_x.id,
    jsonb_build_object('category', btrim(p_category), 'amount_paise', v_x.amount_paise, 'date', v_x.expense_date));
  return v_x;
end;
$$;

create function public.reverse_expense(p_gym uuid, p_expense uuid, p_reason text)
returns public.expense_reversals language plpgsql security definer set search_path = '' as $$
declare v_r public.expense_reversals;
begin
  perform private.require(p_gym, 'expenses.reverse');
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'XS422: a reason is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.expenses where gym_id = p_gym and id = p_expense) then
    raise exception 'XS404: expense not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.expense_reversals where expense_id = p_expense) then
    raise exception 'XS409: this expense is already reversed' using errcode = '23505';
  end if;
  insert into public.expense_reversals (gym_id, expense_id, reason, reversed_by)
  values (p_gym, p_expense, btrim(p_reason), auth.uid()) returning * into v_r;
  perform private.audit(p_gym, 'expense.reversed', 'expenses', p_expense, null, p_reason);
  return v_r;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports (metric definitions: PRODUCT_REQUIREMENTS.md §3)
-- ---------------------------------------------------------------------------

create function public.dashboard_summary(p_gym uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_tz    text;
  v_month date;
  v_ops   jsonb;
  v_fin   jsonb := null;
begin
  if not private.has_permission(p_gym, 'reports.operational') then
    raise exception 'XS403: you do not have permission to view the dashboard' using errcode = '42501';
  end if;
  select timezone into v_tz from public.gyms where id = p_gym;
  v_today := private.gym_today(p_gym);
  v_month := date_trunc('month', v_today)::date;

  select jsonb_build_object(
    'today', v_today,
    'timezone', v_tz,
    'active_members', count(*) filter (where o.status = 'active' and o.membership_status in ('active', 'grace')),
    'in_grace', count(*) filter (where o.status = 'active' and o.membership_status = 'grace'),
    'expiring_today', count(*) filter (where o.status = 'active' and o.valid_until = v_today),
    'expiring_7_days', count(*) filter (where o.status = 'active' and o.valid_until between v_today and v_today + 6),
    'expiring_30_days', count(*) filter (where o.status = 'active' and o.valid_until between v_today and v_today + 29),
    'expired_last_30_days', count(*) filter (where o.status = 'active' and o.membership_status = 'expired'
                                                 and o.valid_until >= v_today - 30),
    'new_members_month', count(*) filter (where o.join_date >= v_month),
    'checkins_today', (select count(*) from public.attendance_events a
                        where a.gym_id = p_gym and a.voided_at is null
                          and (a.checked_in_at at time zone v_tz)::date = v_today))
  into v_ops
  from public.member_overview o where o.gym_id = p_gym;

  if private.has_permission(p_gym, 'reports.financial') then
    select jsonb_build_object(
      'collections_today', coalesce(sum(p.amount_paise) filter (where (p.received_at at time zone v_tz)::date = v_today), 0),
      'collections_month', coalesce(sum(p.amount_paise) filter (where (p.received_at at time zone v_tz)::date >= v_month), 0),
      'cash_today',        coalesce(sum(p.amount_paise) filter (where (p.received_at at time zone v_tz)::date = v_today and p.method = 'cash'), 0),
      'upi_today',         coalesce(sum(p.amount_paise) filter (where (p.received_at at time zone v_tz)::date = v_today and p.method = 'upi'), 0),
      'other_today',       coalesce(sum(p.amount_paise) filter (where (p.received_at at time zone v_tz)::date = v_today and p.method not in ('cash', 'upi')), 0),
      'reversals_today',   (select coalesce(sum(p2.amount_paise), 0) from public.payment_reversals r join public.payments p2 on p2.id = r.payment_id
                             where r.gym_id = p_gym and (r.reversed_at at time zone v_tz)::date = v_today),
      'reversals_month',   (select coalesce(sum(p2.amount_paise), 0) from public.payment_reversals r join public.payments p2 on p2.id = r.payment_id
                             where r.gym_id = p_gym and (r.reversed_at at time zone v_tz)::date >= v_month),
      'expenses_today',    (select coalesce(sum(x.amount_paise), 0) from public.expenses x
                             where x.gym_id = p_gym and x.expense_date = v_today
                               and not exists (select 1 from public.expense_reversals er where er.expense_id = x.id)),
      'expenses_month',    (select coalesce(sum(x.amount_paise), 0) from public.expenses x
                             where x.gym_id = p_gym and x.expense_date >= v_month
                               and not exists (select 1 from public.expense_reversals er where er.expense_id = x.id)),
      'dues_total',        (select coalesce(sum(o.due_paise), 0) from public.member_overview o where o.gym_id = p_gym),
      'members_with_dues', (select count(*) from public.member_overview o where o.gym_id = p_gym and o.due_paise > 0))
    into v_fin
    from public.payments p where p.gym_id = p_gym and p.received_at >= (v_month - 1)::timestamptz;
  end if;

  return v_ops || jsonb_build_object('financial', v_fin);
end;
$$;

create function public.daily_report(p_gym uuid, p_from date, p_to date)
returns table (day date, collections_paise bigint, reversals_paise bigint, cash_paise bigint,
               upi_paise bigint, other_paise bigint, expenses_paise bigint, checkins bigint, new_members bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_tz text;
begin
  if not private.has_permission(p_gym, 'reports.financial') then
    raise exception 'XS403: you do not have permission to view financial reports' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'XS422: choose a range of up to 400 days' using errcode = '22023';
  end if;
  select timezone into v_tz from public.gyms where id = p_gym;
  return query
  select d::date,
    coalesce((select sum(p.amount_paise) from public.payments p where p.gym_id = p_gym and (p.received_at at time zone v_tz)::date = d), 0)::bigint,
    coalesce((select sum(p.amount_paise) from public.payment_reversals r join public.payments p on p.id = r.payment_id
              where r.gym_id = p_gym and (r.reversed_at at time zone v_tz)::date = d), 0)::bigint,
    coalesce((select sum(p.amount_paise) from public.payments p where p.gym_id = p_gym and p.method = 'cash' and (p.received_at at time zone v_tz)::date = d), 0)::bigint,
    coalesce((select sum(p.amount_paise) from public.payments p where p.gym_id = p_gym and p.method = 'upi' and (p.received_at at time zone v_tz)::date = d), 0)::bigint,
    coalesce((select sum(p.amount_paise) from public.payments p where p.gym_id = p_gym and p.method not in ('cash', 'upi') and (p.received_at at time zone v_tz)::date = d), 0)::bigint,
    coalesce((select sum(x.amount_paise) from public.expenses x where x.gym_id = p_gym and x.expense_date = d
              and not exists (select 1 from public.expense_reversals er where er.expense_id = x.id)), 0)::bigint,
    (select count(*) from public.attendance_events a where a.gym_id = p_gym and a.voided_at is null and (a.checked_in_at at time zone v_tz)::date = d),
    (select count(*) from public.members m where m.gym_id = p_gym and m.join_date = d)
  from generate_series(p_from, p_to, interval '1 day') d
  order by d desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
