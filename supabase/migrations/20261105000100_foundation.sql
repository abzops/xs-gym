-- XS Gym — foundation: tenants, staff access, permissions, subscription, audit.
-- All writes go through command functions (ADR-0002). API roles only read, via RLS.

create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.gyms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  timezone    text not null default 'Asia/Kolkata',
  currency    text not null default 'INR' check (currency = 'INR'),
  phone       text,
  email       text,
  address     text,
  grace_days  int  not null default 3 check (grace_days between 0 and 60),
  member_seq  int  not null default 0,
  status      text not null default 'active' check (status in ('active', 'suspended')),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id),
  updated_at  timestamptz not null default now()
);

create table public.gym_staff (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references public.gyms (id),
  user_id      uuid not null references auth.users (id),
  role         text not null check (role in ('owner', 'manager', 'reception', 'trainer')),
  status       text not null default 'active' check (status in ('active', 'inactive')),
  display_name text,
  email        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id),
  unique (gym_id, user_id),
  unique (gym_id, id)
);
create index gym_staff_user_idx on public.gym_staff (user_id);

create table public.role_permissions (
  role       text not null check (role in ('owner', 'manager', 'reception', 'trainer')),
  permission text not null,
  primary key (role, permission)
);

create table public.gym_subscriptions (
  gym_id           uuid primary key references public.gyms (id),
  plan             text not null default 'max' check (plan in ('starter', 'growth', 'max')),
  status           text not null check (status in ('trial', 'active', 'suspended')),
  trial_started_at timestamptz,
  trial_ends_at    timestamptz,
  paid_until       timestamptz,
  updated_at       timestamptz not null default now()
);

create table public.audit_logs (
  id            bigint generated always as identity primary key,
  gym_id        uuid not null references public.gyms (id),
  occurred_at   timestamptz not null default now(),
  actor_user_id uuid,
  action        text not null,
  entity        text not null,
  entity_id     uuid,
  data          jsonb,
  reason        text
);
create index audit_logs_gym_time_idx on public.audit_logs (gym_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Permission matrix (SECURITY.md §3). Code checks permissions, never roles.
-- ---------------------------------------------------------------------------

insert into public.role_permissions (role, permission)
select 'owner', p from unnest(array[
  'members.read','members.write','members.archive','members.export',
  'plans.read','plans.manage','memberships.sell','memberships.cancel',
  'attendance.checkin','attendance.override','attendance.correct',
  'payments.record','payments.read','payments.reverse','discounts.apply','charges.void',
  'expenses.record','expenses.read','expenses.reverse',
  'reports.operational','reports.financial',
  'staff.read','staff.manage','gym.settings','billing.manage','audit.read']) p
union all
select 'manager', p from unnest(array[
  'members.read','members.write','members.archive','members.export',
  'plans.read','plans.manage','memberships.sell','memberships.cancel',
  'attendance.checkin','attendance.override','attendance.correct',
  'payments.record','payments.read','payments.reverse','discounts.apply','charges.void',
  'expenses.record','expenses.read','expenses.reverse',
  'reports.operational','reports.financial','staff.read']) p
union all
select 'reception', p from unnest(array[
  'members.read','members.write','plans.read','memberships.sell',
  'attendance.checkin','payments.record','payments.read','reports.operational','staff.read']) p
union all
select 'trainer', p from unnest(array[
  'members.read','plans.read','attendance.checkin','staff.read']) p;

-- ---------------------------------------------------------------------------
-- Helpers (not exposed through the API)
-- ---------------------------------------------------------------------------

create function private.is_staff(p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gym_staff s
    where s.gym_id = p_gym and s.user_id = auth.uid() and s.status = 'active');
$$;

create function private.has_permission(p_gym uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.gym_staff s
    join public.role_permissions rp on rp.role = s.role
    where s.gym_id = p_gym and s.user_id = auth.uid() and s.status = 'active'
      and rp.permission = p_permission);
$$;

-- Reads stay available after expiry (D-06, assumed option A); writes need an
-- active trial or paid period.
create function private.can_write(p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select g.status = 'active' and (
         (s.status = 'trial'  and now() < s.trial_ends_at)
      or (s.status = 'active' and (s.paid_until is null or now() < s.paid_until)))
    from public.gyms g join public.gym_subscriptions s on s.gym_id = g.id
    where g.id = p_gym), false);
$$;

create function private.require(p_gym uuid, p_permission text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'XS401: sign in required' using errcode = '42501';
  end if;
  if not private.has_permission(p_gym, p_permission) then
    raise exception 'XS403: you do not have permission to do this' using errcode = '42501';
  end if;
  if not private.can_write(p_gym) then
    raise exception 'XS402: this gym''s subscription has ended. Data is read-only; renew to continue.'
      using errcode = 'P0001';
  end if;
end;
$$;

create function private.gym_today(p_gym uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone g.timezone)::date from public.gyms g where g.id = p_gym;
$$;

create function private.audit(p_gym uuid, p_action text, p_entity text, p_entity_id uuid,
                              p_data jsonb default null, p_reason text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (gym_id, actor_user_id, action, entity, entity_id, data, reason)
  values (p_gym, auth.uid(), p_action, p_entity, p_entity_id, p_data, p_reason);
$$;

create function private.reject_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'XS405: % rows cannot be changed or deleted', tg_table_name using errcode = '42501';
end;
$$;

create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function private.reject_change();

create function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger gyms_touch before update on public.gyms
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security: default deny, read-only policies
-- ---------------------------------------------------------------------------

alter table public.gyms              enable row level security;
alter table public.gym_staff         enable row level security;
alter table public.role_permissions  enable row level security;
alter table public.gym_subscriptions enable row level security;
alter table public.audit_logs        enable row level security;

create policy gyms_read on public.gyms for select to authenticated
  using ((select private.is_staff(id)));

create policy gym_staff_read on public.gym_staff for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_permission(gym_id, 'staff.read')));

create policy role_permissions_read on public.role_permissions for select to authenticated
  using (true);

create policy subscriptions_read on public.gym_subscriptions for select to authenticated
  using ((select private.is_staff(gym_id)));

create policy audit_read on public.audit_logs for select to authenticated
  using ((select private.has_permission(gym_id, 'audit.read')));

-- ---------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------

-- Creates a gym with the caller as owner and starts the one-time 30-day trial
-- (assumed D-15: trial starts at creation; one gym per creating user).
create function public.create_gym(p_name text, p_phone text default null)
returns public.gyms language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_base text;
  v_slug text;
  v_gym  public.gyms;
begin
  if v_uid is null then
    raise exception 'XS401: sign in required' using errcode = '42501';
  end if;
  if exists (select 1 from public.gyms where created_by = v_uid) then
    raise exception 'XS409: you have already created a gym' using errcode = '23505';
  end if;

  v_base := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then v_base := 'gym'; end if;
  v_base := left(v_base, 40);
  v_slug := v_base;
  while exists (select 1 from public.gyms where slug = v_slug) loop
    v_slug := v_base || '-' || substr(md5(random()::text), 1, 4);
  end loop;

  insert into public.gyms (name, slug, phone, created_by)
  values (btrim(p_name), v_slug, nullif(btrim(p_phone), ''), v_uid)
  returning * into v_gym;

  insert into public.gym_staff (gym_id, user_id, role, email, display_name, created_by)
  select v_gym.id, u.id, 'owner', u.email, coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)), v_uid
  from auth.users u where u.id = v_uid;

  insert into public.gym_subscriptions (gym_id, plan, status, trial_started_at, trial_ends_at)
  values (v_gym.id, 'max', 'trial', now(), now() + interval '30 days');

  perform private.audit(v_gym.id, 'gym.created', 'gyms', v_gym.id, jsonb_build_object('name', v_gym.name));
  return v_gym;
end;
$$;

create function public.update_gym_settings(p_gym uuid, p_name text, p_phone text,
                                           p_address text, p_grace_days int)
returns public.gyms language plpgsql security definer set search_path = '' as $$
declare v_gym public.gyms;
begin
  perform private.require(p_gym, 'gym.settings');
  update public.gyms
     set name = btrim(p_name), phone = nullif(btrim(p_phone), ''),
         address = nullif(btrim(p_address), ''), grace_days = p_grace_days
   where id = p_gym
  returning * into v_gym;
  perform private.audit(p_gym, 'gym.settings_updated', 'gyms', p_gym,
    jsonb_build_object('name', v_gym.name, 'grace_days', v_gym.grace_days));
  return v_gym;
end;
$$;

-- Adds an existing account (they sign up first) as staff, or updates their role.
create function public.save_staff(p_gym uuid, p_email text, p_role text, p_status text default 'active')
returns public.gym_staff language plpgsql security definer set search_path = '' as $$
declare
  v_user  auth.users;
  v_staff public.gym_staff;
begin
  perform private.require(p_gym, 'staff.manage');
  if p_role not in ('manager', 'reception', 'trainer') then
    raise exception 'XS422: role must be manager, reception or trainer' using errcode = '22023';
  end if;
  select * into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user.id is null then
    raise exception 'XS404: no account uses that email. Ask them to sign up first, then add them.'
      using errcode = 'P0002';
  end if;
  if v_user.id = auth.uid() then
    raise exception 'XS422: you cannot change your own role' using errcode = '22023';
  end if;
  if exists (select 1 from public.gym_staff where gym_id = p_gym and user_id = v_user.id and role = 'owner') then
    raise exception 'XS403: the owner''s access cannot be changed here' using errcode = '42501';
  end if;

  insert into public.gym_staff (gym_id, user_id, role, status, email, display_name, created_by)
  values (p_gym, v_user.id, p_role, p_status, v_user.email,
          coalesce(v_user.raw_user_meta_data ->> 'display_name', split_part(v_user.email, '@', 1)), auth.uid())
  on conflict (gym_id, user_id) do update set role = excluded.role, status = excluded.status
  returning * into v_staff;

  perform private.audit(p_gym, 'staff.saved', 'gym_staff', v_staff.id,
    jsonb_build_object('email', v_staff.email, 'role', v_staff.role, 'status', v_staff.status));
  return v_staff;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: API roles read through RLS only; commands are the write path.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

revoke execute on function public.create_gym(text, text) from public, anon;
revoke execute on function public.update_gym_settings(uuid, text, text, text, int) from public, anon;
revoke execute on function public.save_staff(uuid, text, text, text) from public, anon;
grant execute on function public.create_gym(text, text) to authenticated;
grant execute on function public.update_gym_settings(uuid, text, text, text, int) to authenticated;
grant execute on function public.save_staff(uuid, text, text, text) to authenticated;
