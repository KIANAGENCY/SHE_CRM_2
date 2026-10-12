-- Local PostgreSQL compatibility layer. No Supabase service is required.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'she_api') then create role she_api login noinherit; end if;
end $$;
grant authenticated to she_api;
revoke create on schema public from public;
create schema if not exists auth;
revoke all on schema auth from public;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text not null,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists auth.sessions (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_expiry_idx on auth.sessions(expires_at);
create index if not exists sessions_user_idx on auth.sessions(user_id);
create table if not exists auth.login_limits (
  key text primary key, attempts integer not null, reset_at timestamptz not null
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
revoke all on function auth.uid() from public;
grant usage on schema auth to authenticated, she_api;
grant execute on function auth.uid() to authenticated;
grant select, insert on auth.users to she_api;
grant select, insert, delete on auth.sessions to she_api;
grant select, insert, update, delete on auth.login_limits to she_api;
