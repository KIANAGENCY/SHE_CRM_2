-- SARA snapshots and team edits now persist in PostgreSQL, scoped to a workspace.
create table public.sara_snapshots (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  revision bigint not null default 0,
  payload jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.sara_snapshots enable row level security;
create policy sara_read on public.sara_snapshots for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy sara_insert on public.sara_snapshots for insert to authenticated
  with check (private.has_workspace_role(workspace_id,array['owner','admin','sales']::public.workspace_role[]));
create policy sara_update on public.sara_snapshots for update to authenticated
  using (private.has_workspace_role(workspace_id,array['owner','admin','sales']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id,array['owner','admin','sales']::public.workspace_role[]));
grant select,insert,update on public.sara_snapshots to authenticated;
