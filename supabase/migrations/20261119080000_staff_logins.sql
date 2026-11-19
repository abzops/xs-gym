-- Staff logins made by the owner (no email or sign-up needed by the staff member).
--
-- Flow (Edge Function `staff-login`, see supabase/functions/staff-login):
--   1. prepare_staff_login     — as the signed-in owner: checks staff.manage and
--                                 inputs, picks a free username.
--   2. the Edge Function makes the auth account with the service key:
--        email  = <username>@staff.xelorsoft.com (internal, never mailed)
--        app_metadata.xs_staff_gym = <gym id>   (only the server can set this)
--   3. attach_staff_login      — as the signed-in owner: links that account to
--                                 the gym with a limited role. Audited.
-- Passwords are generated in the Edge Function, shown once to the owner, and
-- never stored or logged by XS Gym.

alter table public.gym_staff
  add column username text,
  add column phone    text;

alter table public.gym_staff add constraint gym_staff_username_format
  check (username is null or (username ~ '^[a-z0-9]+(\.[a-z0-9]+)*$' and length(username) between 3 and 40));

create unique index gym_staff_username_key on public.gym_staff (username) where username is not null;

create function private.staff_login_domain()
returns text language sql immutable set search_path = '' as $$ select 'staff.xelorsoft.com' $$;

create function private.staff_role_check(p_role text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_role is null or p_role not in ('manager', 'reception', 'trainer') then
    raise exception 'XS422: role must be manager, reception or trainer' using errcode = '22023';
  end if;
end;
$$;

create function private.staff_name_check(p_name text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if length(v) not between 2 and 80 then
    raise exception 'XS422: enter the staff member''s name' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Step 1: access + input checks, and a free username like "ravi.chaos".
create function public.prepare_staff_login(p_gym uuid, p_name text, p_phone text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name  text;
  v_phone text;
  v_first text;
  v_tag   text;
  v_base  text;
  v_user  text;
  v_n     int := 1;
begin
  perform private.require(p_gym, 'staff.manage');
  perform private.staff_role_check(p_role);
  v_name  := private.staff_name_check(p_name);
  v_phone := private.normalize_phone(p_phone);

  if exists (select 1 from public.gym_staff where gym_id = p_gym and phone = v_phone and status = 'active') then
    raise exception 'XS409: a staff login already uses this number. Reset their password instead.' using errcode = '23505';
  end if;

  v_first := left(regexp_replace(lower(split_part(v_name, ' ', 1)), '[^a-z0-9]', '', 'g'), 16);
  if length(v_first) < 2 then v_first := 'staff'; end if;  -- e.g. names typed in Malayalam
  select left(split_part(slug, '-', 1), 12) into v_tag from public.gyms where id = p_gym;
  v_base := v_first || '.' || coalesce(nullif(v_tag, ''), 'gym');
  v_user := v_base;
  while exists (select 1 from public.gym_staff where username = v_user)
     or exists (select 1 from auth.users where lower(email) = v_user || '@' || private.staff_login_domain()) loop
    v_n := v_n + 1;
    v_user := v_base || v_n;
  end loop;

  return jsonb_build_object('username', v_user, 'email', v_user || '@' || private.staff_login_domain(),
                            'name', v_name, 'phone', v_phone, 'role', p_role);
end;
$$;

-- Step 3: link the server-made account to the gym. The account must carry the
-- server-only marker for this gym, so an owner cannot attach someone else.
create function public.attach_staff_login(p_gym uuid, p_user uuid, p_username text, p_name text,
                                          p_phone text, p_role text)
returns public.gym_staff language plpgsql security definer set search_path = '' as $$
declare
  v_user  auth.users;
  v_staff public.gym_staff;
  v_name  text;
  v_phone text;
begin
  perform private.require(p_gym, 'staff.manage');
  perform private.staff_role_check(p_role);
  v_name  := private.staff_name_check(p_name);
  v_phone := private.normalize_phone(p_phone);

  select * into v_user from auth.users where id = p_user;
  if v_user.id is null
     or coalesce(v_user.raw_app_meta_data ->> 'xs_staff_gym', '') <> p_gym::text
     or lower(v_user.email) <> lower(btrim(p_username)) || '@' || private.staff_login_domain() then
    raise exception 'XS422: this login was not made for this gym' using errcode = '22023';
  end if;
  if exists (select 1 from public.gym_staff where user_id = p_user) then
    raise exception 'XS409: this login is already linked' using errcode = '23505';
  end if;

  insert into public.gym_staff (gym_id, user_id, role, status, display_name, email, username, phone, created_by)
  values (p_gym, p_user, p_role, 'active', v_name, v_user.email, lower(btrim(p_username)), v_phone, auth.uid())
  returning * into v_staff;

  perform private.audit(p_gym, 'staff.login_created', 'gym_staff', v_staff.id,
    jsonb_build_object('username', v_staff.username, 'name', v_staff.display_name,
                       'role', v_staff.role, 'phone', v_staff.phone));
  return v_staff;
end;
$$;

-- Password reset for a login made in XS Gym. Returns the account to reset;
-- the Edge Function sets the new password.
create function public.prepare_staff_password_reset(p_gym uuid, p_staff uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_staff public.gym_staff;
begin
  perform private.require(p_gym, 'staff.manage');
  select * into v_staff from public.gym_staff where id = p_staff and gym_id = p_gym;
  if v_staff.id is null then
    raise exception 'XS404: staff member not found' using errcode = 'P0002';
  end if;
  if v_staff.role = 'owner' then
    raise exception 'XS403: the owner''s password cannot be reset here' using errcode = '42501';
  end if;
  if v_staff.username is null then
    raise exception 'XS422: this person signs in with their own email. They can use "Forgot password" on the sign-in page.'
      using errcode = '22023';
  end if;
  perform private.audit(p_gym, 'staff.password_reset', 'gym_staff', v_staff.id,
    jsonb_build_object('username', v_staff.username));
  return jsonb_build_object('user_id', v_staff.user_id, 'username', v_staff.username,
                            'name', v_staff.display_name, 'phone', v_staff.phone, 'role', v_staff.role);
end;
$$;

-- Edit name, phone, role and access of a staff member (not the owner).
create function public.update_staff(p_gym uuid, p_staff uuid, p_name text, p_phone text,
                                    p_role text, p_status text)
returns public.gym_staff language plpgsql security definer set search_path = '' as $$
declare v_staff public.gym_staff;
begin
  perform private.require(p_gym, 'staff.manage');
  perform private.staff_role_check(p_role);
  if p_status not in ('active', 'inactive') then
    raise exception 'XS422: status must be active or inactive' using errcode = '22023';
  end if;
  select * into v_staff from public.gym_staff where id = p_staff and gym_id = p_gym;
  if v_staff.id is null then
    raise exception 'XS404: staff member not found' using errcode = 'P0002';
  end if;
  if v_staff.role = 'owner' or v_staff.user_id = auth.uid() then
    raise exception 'XS403: the owner''s access cannot be changed here' using errcode = '42501';
  end if;

  update public.gym_staff
     set display_name = private.staff_name_check(p_name),
         phone = case when nullif(btrim(coalesce(p_phone, '')), '') is null then null
                      else private.normalize_phone(p_phone) end,
         role = p_role, status = p_status
   where id = p_staff
  returning * into v_staff;

  perform private.audit(p_gym, 'staff.updated', 'gym_staff', v_staff.id,
    jsonb_build_object('name', v_staff.display_name, 'phone', v_staff.phone,
                       'role', v_staff.role, 'status', v_staff.status));
  return v_staff;
end;
$$;

revoke execute on function private.staff_login_domain() from public, anon;
revoke execute on function private.staff_role_check(text) from public, anon;
revoke execute on function private.staff_name_check(text) from public, anon;
grant execute on function private.staff_login_domain() to authenticated;
grant execute on function private.staff_role_check(text) to authenticated;
grant execute on function private.staff_name_check(text) to authenticated;

revoke execute on function public.prepare_staff_login(uuid, text, text, text) from public, anon;
revoke execute on function public.attach_staff_login(uuid, uuid, text, text, text, text) from public, anon;
revoke execute on function public.prepare_staff_password_reset(uuid, uuid) from public, anon;
revoke execute on function public.update_staff(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.prepare_staff_login(uuid, text, text, text) to authenticated;
grant execute on function public.attach_staff_login(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.prepare_staff_password_reset(uuid, uuid) to authenticated;
grant execute on function public.update_staff(uuid, uuid, text, text, text, text) to authenticated;
