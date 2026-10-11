drop policy if exists orders_insert_commercial on public.orders;

create policy orders_insert_commercial
on public.orders
for insert
to authenticated
with check (
  (select private.has_workspace_role(
    workspace_id,
    array['owner','admin']::public.workspace_role[]
  ))
  or (
    (select private.has_workspace_role(
      workspace_id,
      array['sales']::public.workspace_role[]
    ))
    and status = 'Por autorizar'
  )
);
