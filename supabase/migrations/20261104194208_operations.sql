-- XS Gym — members, plans, memberships, ledger, attendance, expenses.
-- Money is bigint paise. Composite (gym_id, id) foreign keys keep every
-- reference inside one tenant.

create table public.members (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.gyms (id),
  member_no         text not null,
  full_name         text not null check (length(btrim(full_name)) between 1 and 120),
  phone             text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email             text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  gender            text check (gender in ('male', 'female', 'other')),
  date_of_birth     date,
  address           text,
  emergency_contact text,
  join_date         date not null,
  status            text not null default 'active' check (status in ('active', 'archived')),
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  unique (gym_id, id),
  unique (gym_id, member_no)
);
create unique index members_active_phone_uq on public.members (gym_id, phone) where status = 'active';
create index members_name_trgm_idx on public.members using gin (full_name extensions.gin_trgm_ops);
create index members_gym_status_idx on public.members (gym_id, status);
create trigger members_touch before update on public.members
  for each row execute function private.touch_updated_at();

create table public.membership_plans (
  id             uuid primary key default gen_random_uuid(),
  gym_id         uuid not null references public.gyms (id),
  name           text not null check (length(btrim(name)) between 1 and 80),
  duration_unit  text not null check (duration_unit in ('day', 'month')),
  duration_count int  not null check (duration_count > 0),
  price_paise    bigint not null check (price_paise >= 0),
  description    text,
  status         text not null default 'active' check (status in ('active', 'archived')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (gym_id, id),
  check ((duration_unit = 'month' and duration_count <= 36) or (duration_unit = 'day' and duration_count <= 366))
);
create unique index plans_name_uq on public.membership_plans (gym_id, lower(name)) where status = 'active';
create trigger plans_touch before update on public.membership_plans
  for each row execute function private.touch_updated_at();

create table public.member_memberships (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms (id),
  member_id       uuid not null,
  plan_id         uuid not null,
  plan_name       text not null,
  start_date      date not null,
  end_date        date not null,
  price_paise     bigint not null check (price_paise >= 0),
  status          text not null default 'active' check (status in ('active', 'cancelled')),
  cancel_reason   text,
  renewed_from_id uuid,
  idempotency_key uuid not null,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  unique (gym_id, id),
  unique (gym_id, idempotency_key),
  check (end_date >= start_date),
  foreign key (gym_id, member_id) references public.members (gym_id, id),
  foreign key (gym_id, plan_id) references public.membership_plans (gym_id, id),
  foreign key (gym_id, renewed_from_id) references public.member_memberships (gym_id, id)
);
create index memberships_member_idx on public.member_memberships (gym_id, member_id, end_date desc);
create index memberships_end_idx on public.member_memberships (gym_id, end_date) where status = 'active';

-- What members owe.
create table public.charges (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms (id),
  member_id       uuid not null,
  membership_id   uuid,
  kind            text not null check (kind in ('membership', 'admission', 'other')),
  description     text not null,
  gross_paise     bigint not null check (gross_paise > 0),
  discount_paise  bigint not null default 0 check (discount_paise >= 0),
  net_paise       bigint generated always as (gross_paise - discount_paise) stored,
  discount_reason text,
  due_date        date not null,
  status          text not null default 'open' check (status in ('open', 'void')),
  void_reason     text,
  voided_at       timestamptz,
  voided_by       uuid,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  unique (gym_id, id),
  check (discount_paise <= gross_paise),
  check (discount_paise = 0 or length(btrim(coalesce(discount_reason, ''))) > 0),
  foreign key (gym_id, member_id) references public.members (gym_id, id),
  foreign key (gym_id, membership_id) references public.member_memberships (gym_id, id)
);
create index charges_member_idx on public.charges (gym_id, member_id, due_date);

-- What was received. Never updated or deleted.
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms (id),
  member_id       uuid not null,
  amount_paise    bigint not null check (amount_paise > 0),
  method          text not null check (method in ('cash', 'upi', 'card', 'bank', 'other')),
  received_at     timestamptz not null default now(),
  reference       text,
  notes           text,
  received_by     uuid,
  idempotency_key uuid not null,
  unique (gym_id, id),
  unique (gym_id, idempotency_key),
  foreign key (gym_id, member_id) references public.members (gym_id, id)
);
create index payments_gym_time_idx on public.payments (gym_id, received_at desc);
create index payments_member_idx on public.payments (gym_id, member_id);

create table public.payment_allocations (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references public.gyms (id),
  payment_id   uuid not null,
  charge_id    uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  created_at   timestamptz not null default now(),
  foreign key (gym_id, payment_id) references public.payments (gym_id, id),
  foreign key (gym_id, charge_id) references public.charges (gym_id, id)
);
create index allocations_payment_idx on public.payment_allocations (payment_id);
create index allocations_charge_idx on public.payment_allocations (charge_id);

create table public.payment_reversals (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms (id),
  payment_id  uuid not null unique,
  reason      text not null check (length(btrim(reason)) > 0),
  reversed_at timestamptz not null default now(),
  reversed_by uuid,
  foreign key (gym_id, payment_id) references public.payments (gym_id, id)
);
create index reversals_gym_time_idx on public.payment_reversals (gym_id, reversed_at desc);

create table public.attendance_events (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.gyms (id),
  member_id         uuid not null,
  checked_in_at     timestamptz not null default now(),
  membership_status text not null,
  override_reason   text,
  recorded_by       uuid,
  voided_at         timestamptz,
  voided_by         uuid,
  void_reason       text,
  unique (gym_id, id),
  foreign key (gym_id, member_id) references public.members (gym_id, id)
);
create index attendance_gym_time_idx on public.attendance_events (gym_id, checked_in_at desc);
create index attendance_member_idx on public.attendance_events (gym_id, member_id, checked_in_at desc);

create table public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms (id),
  name       text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (gym_id, id)
);
create unique index expense_categories_name_uq on public.expense_categories (gym_id, lower(name));

create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms (id),
  category_id     uuid not null,
  amount_paise    bigint not null check (amount_paise > 0),
  expense_date    date not null,
  method          text not null check (method in ('cash', 'upi', 'card', 'bank', 'other')),
  description     text,
  recorded_by     uuid,
  idempotency_key uuid not null,
  created_at      timestamptz not null default now(),
  unique (gym_id, id),
  unique (gym_id, idempotency_key),
  foreign key (gym_id, category_id) references public.expense_categories (gym_id, id)
);
create index expenses_gym_date_idx on public.expenses (gym_id, expense_date desc);

create table public.expense_reversals (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms (id),
  expense_id  uuid not null unique,
  reason      text not null check (length(btrim(reason)) > 0),
  reversed_at timestamptz not null default now(),
  reversed_by uuid,
  foreign key (gym_id, expense_id) references public.expenses (gym_id, id)
);

-- ---------------------------------------------------------------------------
-- Immutability: ledger rows are never edited. Controlled exceptions below.
-- ---------------------------------------------------------------------------

create trigger payments_immutable before update or delete on public.payments
  for each row execute function private.reject_change();
create trigger allocations_immutable before update or delete on public.payment_allocations
  for each row execute function private.reject_change();
create trigger payment_reversals_immutable before update or delete on public.payment_reversals
  for each row execute function private.reject_change();
create trigger expenses_immutable before update or delete on public.expenses
  for each row execute function private.reject_change();
create trigger expense_reversals_immutable before update or delete on public.expense_reversals
  for each row execute function private.reject_change();

-- A charge may only move open -> void, with a reason.
create function private.guard_charge_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'XS405: charges cannot be deleted' using errcode = '42501';
  end if;
  if old.status <> 'open' or new.status <> 'void'
     or (new.gym_id, new.member_id, new.membership_id, new.kind, new.description,
         new.gross_paise, new.discount_paise, new.discount_reason, new.due_date, new.created_at)
        is distinct from
        (old.gym_id, old.member_id, old.membership_id, old.kind, old.description,
         old.gross_paise, old.discount_paise, old.discount_reason, old.due_date, old.created_at)
     or length(btrim(coalesce(new.void_reason, ''))) = 0 then
    raise exception 'XS405: a charge can only be voided, with a reason' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger charges_guard before update or delete on public.charges
  for each row execute function private.guard_charge_update();

-- A check-in may only be voided once, with a reason.
create function private.guard_attendance_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'XS405: check-ins cannot be deleted' using errcode = '42501';
  end if;
  if old.voided_at is not null or new.voided_at is null
     or (new.gym_id, new.member_id, new.checked_in_at, new.membership_status, new.override_reason, new.recorded_by)
        is distinct from
        (old.gym_id, old.member_id, old.checked_in_at, old.membership_status, old.override_reason, old.recorded_by)
     or length(btrim(coalesce(new.void_reason, ''))) = 0 then
    raise exception 'XS405: a check-in can only be voided once, with a reason' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger attendance_guard before update or delete on public.attendance_events
  for each row execute function private.guard_attendance_update();

-- Memberships may only be cancelled; dates and price are fixed once sold.
create function private.guard_membership_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'XS405: memberships cannot be deleted' using errcode = '42501';
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
create trigger memberships_guard before update or delete on public.member_memberships
  for each row execute function private.guard_membership_update();

-- ---------------------------------------------------------------------------
-- Derived values
-- ---------------------------------------------------------------------------

-- End date: inclusive last valid day; calendar months with month-end clamp
-- (DATABASE.md §5, D-03 assumed option A). 13 test vectors in tests/db.
create function private.membership_end_date(p_start date, p_unit text, p_count int)
returns date language sql immutable set search_path = '' as $$
  select case p_unit
    when 'day' then p_start + (p_count - 1)
    when 'month' then case
      when extract(day from p_start) >
           extract(day from (date_trunc('month', p_start) + make_interval(months => p_count + 1) - interval '1 day'))
      then (date_trunc('month', p_start) + make_interval(months => p_count + 1) - interval '1 day')::date
      else (p_start + make_interval(months => p_count))::date - 1
    end
  end;
$$;

create function private.membership_status(p_status text, p_start date, p_end date,
                                          p_today date, p_grace int)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_status = 'cancelled'        then 'cancelled'
    when p_end is null                 then 'none'
    when p_today < p_start             then 'upcoming'
    when p_today <= p_end              then 'active'
    when p_today <= p_end + p_grace    then 'grace'
    else 'expired'
  end;
$$;

-- Remaining amount due on a charge (open charges, non-reversed payments).
create function private.charge_due(p_charge uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select case when c.status <> 'open' then 0 else
    c.net_paise - coalesce((
      select sum(a.amount_paise) from public.payment_allocations a
      where a.charge_id = c.id
        and not exists (select 1 from public.payment_reversals r where r.payment_id = a.payment_id)), 0)
  end
  from public.charges c where c.id = p_charge;
$$;

-- Unallocated amount of a payment (allocations to void charges are released).
create function private.payment_unallocated(p_payment uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.payment_reversals r where r.payment_id = p.id) then 0 else
    p.amount_paise - coalesce((
      select sum(a.amount_paise) from public.payment_allocations a
      join public.charges c on c.id = a.charge_id
      where a.payment_id = p.id and c.status = 'open'), 0)
  end
  from public.payments p where p.id = p_payment;
$$;

-- Allocation invariants, using the same definitions as dues and credit:
-- only live payments to open charges, never more than either has left.
create function private.check_allocation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.payment_reversals r where r.payment_id = new.payment_id)
     or not exists (select 1 from public.charges c where c.id = new.charge_id and c.status = 'open') then
    raise exception 'XS422: allocation must use a live payment and an open charge' using errcode = '23514';
  end if;
  if private.payment_unallocated(new.payment_id) < 0 or private.charge_due(new.charge_id) < 0 then
    raise exception 'XS422: allocation exceeds payment or charge' using errcode = '23514';
  end if;
  return new;
end;
$$;
create constraint trigger allocations_check after insert on public.payment_allocations
  deferrable initially immediate for each row execute function private.check_allocation();

-- Member's current membership, status, dues and credit — the main read model.
-- security_invoker: RLS of the underlying tables applies to the caller.
create view public.member_overview with (security_invoker = true) as
select
  m.id, m.gym_id, m.member_no, m.full_name, m.phone, m.email, m.gender, m.date_of_birth,
  m.address, m.emergency_contact, m.join_date, m.status, m.created_at,
  cur.id          as membership_id,
  cur.plan_name,
  cur.start_date,
  cur.end_date,
  (select max(mm.end_date) from public.member_memberships mm
    where mm.gym_id = m.gym_id and mm.member_id = m.id and mm.status = 'active') as valid_until,
  private.membership_status(coalesce(cur.status, 'active'), cur.start_date, cur.end_date,
                            t.today, g.grace_days) as membership_status,
  coalesce((select sum(private.charge_due(c.id)) from public.charges c
            where c.gym_id = m.gym_id and c.member_id = m.id and c.status = 'open'), 0)::bigint as due_paise,
  coalesce((select sum(private.payment_unallocated(p.id)) from public.payments p
            where p.gym_id = m.gym_id and p.member_id = m.id), 0)::bigint as credit_paise,
  (select max(a.checked_in_at) from public.attendance_events a
    where a.gym_id = m.gym_id and a.member_id = m.id and a.voided_at is null) as last_check_in_at
from public.members m
join public.gyms g on g.id = m.gym_id
cross join lateral (select private.gym_today(m.gym_id) as today) t
-- Current period: the one covering today, else one in grace, else the next
-- upcoming one, else the most recent.
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
) cur on true;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.members             enable row level security;
alter table public.membership_plans    enable row level security;
alter table public.member_memberships  enable row level security;
alter table public.charges             enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_reversals   enable row level security;
alter table public.attendance_events   enable row level security;
alter table public.expense_categories  enable row level security;
alter table public.expenses            enable row level security;
alter table public.expense_reversals   enable row level security;

create policy members_read on public.members for select to authenticated
  using ((select private.has_permission(gym_id, 'members.read')));
create policy plans_read on public.membership_plans for select to authenticated
  using ((select private.has_permission(gym_id, 'plans.read')));
create policy memberships_read on public.member_memberships for select to authenticated
  using ((select private.has_permission(gym_id, 'members.read')));
create policy charges_read on public.charges for select to authenticated
  using ((select private.has_permission(gym_id, 'payments.read')));
create policy payments_read on public.payments for select to authenticated
  using ((select private.has_permission(gym_id, 'payments.read')));
create policy allocations_read on public.payment_allocations for select to authenticated
  using ((select private.has_permission(gym_id, 'payments.read')));
create policy payment_reversals_read on public.payment_reversals for select to authenticated
  using ((select private.has_permission(gym_id, 'payments.read')));
create policy attendance_read on public.attendance_events for select to authenticated
  using ((select private.has_permission(gym_id, 'members.read')));
create policy expense_categories_read on public.expense_categories for select to authenticated
  using ((select private.has_permission(gym_id, 'expenses.read')));
create policy expenses_read on public.expenses for select to authenticated
  using ((select private.has_permission(gym_id, 'expenses.read')));
create policy expense_reversals_read on public.expense_reversals for select to authenticated
  using ((select private.has_permission(gym_id, 'expenses.read')));

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
