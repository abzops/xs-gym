-- Reset the password for a demo/owner account and mark its email confirmed.
-- Run in the Supabase SQL editor (or via the MCP connection) for project xs-gym.
-- This is a password RESET, not a reveal: existing passwords are hashed and
-- cannot be read back. Only the project owner should run this.
--
-- 1. Change the two values below.
-- 2. Run the whole script.
-- 3. Sign in at https://abzops.github.io/xs-gym/ with the email and new password.

do $$
declare
  v_email    text := 'svsnkr496@gmail.com';   -- the account to reset
  v_password text := 'CHANGE-ME-BEFORE-RUNNING';  -- the new password (min 8 chars)
  v_id       uuid;
begin
  if length(v_password) < 8 or v_password = 'CHANGE-ME-BEFORE-RUNNING' then
    raise exception 'Set v_password to a real password of at least 8 characters first.';
  end if;

  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    raise exception 'No account for %. Sign up with it once in the app, then run this.', v_email;
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = v_id;

  raise notice 'Password reset for %. You can now sign in.', v_email;
end $$;
