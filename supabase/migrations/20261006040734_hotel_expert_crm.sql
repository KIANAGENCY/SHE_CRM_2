-- Hotel Expert CRM: authenticated multi-tenant data model.
-- All Data API access is explicit and protected by RLS.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

do $$ begin
  create type public.workspace_role as enum ('owner', 'admin', 'sales', 'production');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.crm_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  discount_limit numeric(5,2) not null default 0 check (discount_limit between 0 and 100),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  name text not null,
  legal_name text not null default '',
  rfc text not null default '',
  address text not null default '',
  contact text not null default '',
  position text not null default '',
  phone text not null default '',
  email text not null default '',
  owner_name text not null default '',
  last_order date,
  created_on date not null default current_date,
  aroma text not null default '',
  notes text not null default '',
  channel text not null default '',
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists public.opportunities (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  client_id text not null,
  stage smallint not null default 0 check (stage between 0 and 3),
  route text not null check (route in ('direct', 'sample')),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  next_action text not null default '',
  owner_name text not null default '',
  created_on date not null default current_date,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade
);

create table if not exists public.products (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  name text not null,
  size text not null default '',
  price numeric(14,2) not null default 0 check (price >= 0),
  sku text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, sku)
);

create table if not exists public.aromas (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  name text not null,
  family text not null default '',
  notes text not null default '',
  intensity text not null default '',
  areas text not null default '',
  product_ids text[] not null default '{}',
  approved boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists public.quotes (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  client_id text not null,
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount numeric(5,2) not null default 0 check (discount between 0 and 100),
  total numeric(14,2) not null default 0 check (total >= 0),
  valid_until date not null,
  payment text not null default '',
  shipping numeric(14,2) check (shipping is null or shipping >= 0),
  delivery text not null default '',
  channel text not null default '',
  status text not null default 'Borrador' check (status in ('Borrador', 'Aceptada', 'Rechazada', 'Vencida')),
  version integer not null default 1 check (version > 0),
  acceptance_reference text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade
);

create table if not exists public.orders (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  client_id text not null,
  opportunity_id text,
  quote_id text,
  total numeric(14,2) not null default 0 check (total >= 0),
  status text not null default 'Por autorizar' check (status in ('Por autorizar', 'En producción', 'Empacado', 'En tránsito', 'Entregado')),
  confirmed boolean not null default false,
  created_on date not null default current_date,
  due_on date,
  tracking text not null default '',
  channel text not null default '',
  invoice_amount numeric(14,2) not null default 0 check (invoice_amount >= 0),
  delivered_on date,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, quote_id),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade,
  foreign key (workspace_id, opportunity_id) references public.opportunities(workspace_id, id) on delete set null (opportunity_id),
  foreign key (workspace_id, quote_id) references public.quotes(workspace_id, id) on delete set null (quote_id)
);

create table if not exists public.samples (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  opportunity_id text not null,
  client_id text not null,
  status text not null default 'Solicitada' check (status in ('Solicitada', 'En preparación', 'Enviada', 'En evaluación', 'Evaluada')),
  aroma text not null default 'Por confirmar',
  result text not null default '',
  tracking text not null default '',
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, opportunity_id) references public.opportunities(workspace_id, id) on delete cascade,
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade
);

create table if not exists public.appointments (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  client_id text not null,
  owner_name text not null,
  start_at timestamptz not null,
  duration integer not null check (duration between 5 and 480),
  type text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade
);

create table if not exists public.tasks (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  client_id text not null,
  title text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade
);

create table if not exists public.notifications (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  event_key text not null,
  order_id text not null,
  event text not null,
  status text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, event_key),
  foreign key (workspace_id, order_id) references public.orders(workspace_id, id) on delete cascade
);

create table if not exists public.conversations (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  client_id text not null,
  human boolean not null default false,
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade
);

create table if not exists public.audit_log (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  occurred_at timestamptz not null default now(),
  actor text not null default '',
  action text not null,
  primary key (workspace_id, id)
);

create or replace function private.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and user_id = (select auth.uid())
  );
$$;

create or replace function private.has_workspace_role(target_workspace uuid, allowed public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace
      and user_id = (select auth.uid())
      and role = any(allowed)
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.has_workspace_role(uuid, public.workspace_role[]) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, public.workspace_role[]) to authenticated;

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public, anon, authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare new_workspace uuid;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  insert into public.workspaces (name, created_by)
  values (coalesce(nullif(new.raw_user_meta_data ->> 'workspace_name', ''), 'Hotel Expert'), new.id)
  returning id into new_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace, new.id, 'owner');

  insert into public.crm_settings (workspace_id) values (new_workspace);
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.enforce_order_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select private.has_workspace_role(new.workspace_id, array['owner','admin']::public.workspace_role[])) then
    return new;
  end if;

  if (select private.has_workspace_role(new.workspace_id, array['production']::public.workspace_role[]))
     and old.status = 'En producción'
     and new.status = 'Empacado'
     and (to_jsonb(new) - array['status','updated_at']) = (to_jsonb(old) - array['status','updated_at']) then
    return new;
  end if;

  raise exception 'Order update is not allowed for this role';
end;
$$;
revoke all on function private.enforce_order_update() from public, anon, authenticated;

drop trigger if exists enforce_order_update on public.orders;
create trigger enforce_order_update
before update on public.orders
for each row execute function private.enforce_order_update();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles','workspaces','workspace_members','crm_settings','clients','opportunities',
    'products','aromas','quotes','orders','samples','appointments','tasks',
    'notifications','conversations','audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

create policy profiles_select_own on public.profiles for select to authenticated
using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy workspaces_select_member on public.workspaces for select to authenticated
using ((select private.is_workspace_member(id)));
create policy workspaces_update_admin on public.workspaces for update to authenticated
using ((select private.has_workspace_role(id, array['owner','admin']::public.workspace_role[])))
with check ((select private.has_workspace_role(id, array['owner','admin']::public.workspace_role[])));

create policy members_select_member on public.workspace_members for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy members_insert_admin on public.workspace_members for insert to authenticated
with check ((select private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])));
create policy members_update_admin on public.workspace_members for update to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])))
with check ((select private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])));
create policy members_delete_admin on public.workspace_members for delete to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])) and user_id <> (select auth.uid()));

create policy settings_select_member on public.crm_settings for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy settings_update_admin on public.crm_settings for update to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])))
with check ((select private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])));

do $$
declare table_name text;
begin
  foreach table_name in array array['clients','opportunities','quotes','samples','appointments','tasks','conversations'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_workspace_member(workspace_id)))', table_name || '_select_member', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.has_workspace_role(workspace_id, array[''owner'',''admin'',''sales'']::public.workspace_role[])))', table_name || '_insert_commercial', table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.has_workspace_role(workspace_id, array[''owner'',''admin'',''sales'']::public.workspace_role[]))) with check ((select private.has_workspace_role(workspace_id, array[''owner'',''admin'',''sales'']::public.workspace_role[])))', table_name || '_update_commercial', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.has_workspace_role(workspace_id, array[''owner'',''admin'',''sales'']::public.workspace_role[])))', table_name || '_delete_commercial', table_name);
  end loop;

  foreach table_name in array array['products','aromas'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_workspace_member(workspace_id)))', table_name || '_select_member', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.has_workspace_role(workspace_id, array[''owner'',''admin'']::public.workspace_role[])))', table_name || '_insert_admin', table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.has_workspace_role(workspace_id, array[''owner'',''admin'']::public.workspace_role[]))) with check ((select private.has_workspace_role(workspace_id, array[''owner'',''admin'']::public.workspace_role[])))', table_name || '_update_admin', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.has_workspace_role(workspace_id, array[''owner'',''admin'']::public.workspace_role[])))', table_name || '_delete_admin', table_name);
  end loop;
end $$;

create policy orders_select_member on public.orders for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy orders_insert_commercial on public.orders for insert to authenticated
with check (
  (select private.has_workspace_role(workspace_id, array['owner','admin','sales']::public.workspace_role[]))
  and status = 'Por autorizar'
);
create policy orders_update_operations on public.orders for update to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner','admin','production']::public.workspace_role[])))
with check ((select private.has_workspace_role(workspace_id, array['owner','admin','production']::public.workspace_role[])));
create policy orders_delete_admin on public.orders for delete to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])));

create policy notifications_select_member on public.notifications for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy notifications_write_admin on public.notifications for insert to authenticated
with check ((select private.has_workspace_role(workspace_id, array['owner','admin','sales']::public.workspace_role[])));
create policy notifications_update_admin on public.notifications for update to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])))
with check ((select private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])));

create policy audit_select_member on public.audit_log for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy audit_insert_member on public.audit_log for insert to authenticated
with check ((select private.is_workspace_member(workspace_id)));

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, update on public.crm_settings to authenticated;
grant select, insert, update, delete on public.clients, public.opportunities, public.products,
  public.aromas, public.quotes, public.orders, public.samples, public.appointments,
  public.tasks, public.notifications, public.conversations to authenticated;
grant select, insert on public.audit_log to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles','workspaces','crm_settings','clients','opportunities','products','aromas',
    'quotes','orders','samples','appointments','tasks','conversations'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', table_name);
  end loop;
end $$;

create index if not exists workspace_members_user_idx on public.workspace_members(user_id, workspace_id);
create index if not exists clients_workspace_idx on public.clients(workspace_id, name);
create index if not exists opportunities_workspace_idx on public.opportunities(workspace_id, stage, route);
create index if not exists orders_workspace_idx on public.orders(workspace_id, status, created_on desc);
create index if not exists appointments_workspace_idx on public.appointments(workspace_id, start_at);
create index if not exists audit_workspace_idx on public.audit_log(workspace_id, occurred_at desc);
