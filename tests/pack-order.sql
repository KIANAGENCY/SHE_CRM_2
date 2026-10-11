-- Run only in a disposable database with all migrations applied.
-- Fixture changes are rolled back even after a successful test.
begin;
insert into auth.users (id, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000001', '{"workspace_name":"Test owner"}'),
  ('10000000-0000-0000-0000-000000000002', '{"workspace_name":"Test production"}'),
  ('10000000-0000-0000-0000-000000000003', '{"workspace_name":"Test sales"}');

select set_config('test.workspace', id::text, true) from public.workspaces
where created_by = '10000000-0000-0000-0000-000000000001';
insert into public.workspace_members (workspace_id, user_id, role) values
  (current_setting('test.workspace')::uuid, '10000000-0000-0000-0000-000000000002', 'production'),
  (current_setting('test.workspace')::uuid, '10000000-0000-0000-0000-000000000003', 'sales');
insert into public.clients (workspace_id, id, name)
values (current_setting('test.workspace')::uuid, 'client-test', 'Test client');
insert into public.orders (workspace_id, id, client_id, status, total)
values (current_setting('test.workspace')::uuid, 'order-test', 'client-test', 'En producción', 500),
  (current_setting('test.workspace')::uuid, 'pending-test', 'client-test', 'Por autorizar', 500);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select public.pack_order(current_setting('test.workspace')::uuid, 'order-test');
select public.pack_order(current_setting('test.workspace')::uuid, 'order-test');
do $$
declare workspace uuid := current_setting('test.workspace')::uuid;
begin
  if (select status from public.orders where workspace_id = workspace and id = 'order-test') <> 'Empacado' then
    raise exception 'Order was not packed';
  end if;
  if (select count(*) from public.notifications where workspace_id = workspace and order_id = 'order-test') <> 1 then
    raise exception 'Notification missing or duplicated';
  end if;
  if (select count(*) from public.audit_log where workspace_id = workspace and action = 'order-test: Empacado') <> 1 then
    raise exception 'Audit missing or duplicated';
  end if;
  begin
    perform public.pack_order(workspace, 'pending-test');
    raise exception 'Incorrect stage was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.pack_order(workspace, 'missing-test');
    raise exception 'Missing order was accepted';
  exception when no_data_found then null; end;
  begin
    update public.orders set total = 1 where workspace_id = workspace and id = 'order-test';
    raise exception 'Production changed the order total';
  exception when raise_exception then
    if sqlerrm <> 'Order update is not allowed for this role' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
do $$ begin
  begin
    perform public.pack_order(current_setting('test.workspace')::uuid, 'order-test');
    raise exception 'Sales packed an order';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
do $$ begin
  begin
    perform public.pack_order('20000000-0000-0000-0000-000000000001'::uuid, 'order-test');
    raise exception 'Cross-workspace request was accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
