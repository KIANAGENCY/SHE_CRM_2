create index if not exists workspaces_created_by_idx
  on public.workspaces(created_by);
create index if not exists opportunities_client_idx
  on public.opportunities(workspace_id, client_id);
create index if not exists quotes_client_idx
  on public.quotes(workspace_id, client_id);
create index if not exists orders_client_idx
  on public.orders(workspace_id, client_id);
create index if not exists orders_opportunity_idx
  on public.orders(workspace_id, opportunity_id);
create index if not exists samples_opportunity_idx
  on public.samples(workspace_id, opportunity_id);
create index if not exists samples_client_idx
  on public.samples(workspace_id, client_id);
create index if not exists appointments_client_idx
  on public.appointments(workspace_id, client_id);
create index if not exists tasks_client_idx
  on public.tasks(workspace_id, client_id);
create index if not exists notifications_order_idx
  on public.notifications(workspace_id, order_id);
create index if not exists conversations_client_idx
  on public.conversations(workspace_id, client_id);
