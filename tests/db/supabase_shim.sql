-- Minimal stand-in for the parts of Supabase the migrations rely on.
-- Used only for local database tests (ADR-0006). CI uses the real stack.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema extensions;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;

create table auth.users (
  id                 uuid primary key,
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
