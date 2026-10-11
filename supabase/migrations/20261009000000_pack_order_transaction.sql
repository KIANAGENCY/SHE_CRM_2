-- Production cannot insert notifications through the Data API. Commit them with
-- the permitted order transition, checking membership inside the function.
create or replace function public.pack_order(target_workspace uuid, target_order text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_status text;
begin
  if not private.has_workspace_role(target_workspace, array['production']::public.workspace_role[]) then
    raise exception 'Producción debe registrar el empaque' using errcode = '42501';
  end if;

  select status into current_status from public.orders
  where workspace_id = target_workspace and id = target_order for update;
  if not found then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;
  -- A retry after a lost response must not duplicate the notification or audit.
  if current_status = 'Empacado' then return; end if;
  if current_status <> 'En producción' then
    raise exception 'El pedido debe estar en producción' using errcode = '22023';
  end if;

  update public.orders set status = 'Empacado'
  where workspace_id = target_workspace and id = target_order;

  insert into public.notifications (workspace_id, id, event_key, order_id, event, status)
  values (target_workspace, 'aviso-' || gen_random_uuid()::text,
    target_order || ':Empacado', target_order, 'Empacado', 'Pendiente de integración')
  on conflict (workspace_id, event_key) do nothing;

  insert into public.audit_log (workspace_id, id, actor, action)
  values (target_workspace, 'evt-' || gen_random_uuid()::text,
    'Producción', target_order || ': Empacado');
end;
$$;

revoke all on function public.pack_order(uuid, text) from public, anon;
grant execute on function public.pack_order(uuid, text) to authenticated;
