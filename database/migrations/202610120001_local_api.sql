-- Optimistic workspace revision is locked by every API write.
create table public.workspace_revisions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  revision bigint not null default 0
);
insert into public.workspace_revisions(workspace_id) select id from public.workspaces;
alter table public.workspace_revisions enable row level security;
create policy revisions_member on public.workspace_revisions for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy revisions_update on public.workspace_revisions for update to authenticated
using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
grant select, update on public.workspace_revisions to authenticated;
create function private.new_workspace_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.workspace_revisions(workspace_id) values(new.id);
  return new;
end $$;
revoke all on function private.new_workspace_revision() from public;
create trigger workspace_revision after insert on public.workspaces
for each row execute function private.new_workspace_revision();

-- Database owns business validation even when the browser is bypassed.
create function private.validate_local_quote() returns trigger language plpgsql set search_path='' as $$
declare line jsonb; calculated numeric := 0; discount_max numeric;
begin
  if jsonb_array_length(new.lines) = 0 then raise exception 'La cotización necesita partidas.' using errcode='23514'; end if;
  for line in select value from jsonb_array_elements(new.lines) loop
    if jsonb_typeof(line->'quantity') is distinct from 'number'
      or jsonb_typeof(line->'price') is distinct from 'number'
      or (line->>'quantity')::numeric <= 0
      or trunc((line->>'quantity')::numeric) <> (line->>'quantity')::numeric
      or (line->>'price')::numeric < 0 then
      raise exception 'Cantidad o precio inválido.' using errcode='23514';
    end if;
    calculated := calculated + (line->>'quantity')::numeric * (line->>'price')::numeric;
  end loop;
  select discount_limit into discount_max from public.crm_settings where workspace_id=new.workspace_id;
  if new.discount > discount_max then raise exception 'Descuento superior al autorizado.' using errcode='23514'; end if;
  if new.subtotal <> round(calculated,2) or new.total <> round(round(calculated,2)*(1-new.discount/100),2) then
    raise exception 'Totales de cotización inconsistentes.' using errcode='23514';
  end if;
  return new;
end $$;
create trigger validate_local_quote before insert or update on public.quotes for each row execute function private.validate_local_quote();

create function private.validate_local_order() returns trigger language plpgsql set search_path='' as $$
declare q public.quotes; stages text[] := array['Por autorizar','En producción','Empacado','En tránsito','Entregado'];
begin
  if new.quote_id is not null then
    select * into q from public.quotes where workspace_id=new.workspace_id and id=new.quote_id;
    if q.id is null or q.client_id <> new.client_id or q.total <> new.total or q.status <> 'Aceptada' or not new.confirmed then
      raise exception 'El pedido debe coincidir con una cotización aceptada.' using errcode='23514';
    end if;
  end if;
  if new.opportunity_id is not null and not exists(select 1 from public.opportunities where workspace_id=new.workspace_id and id=new.opportunity_id and client_id=new.client_id) then
    raise exception 'Oportunidad de otro cliente.' using errcode='23514';
  end if;
  if TG_OP='INSERT' and new.status <> 'Por autorizar' then
    raise exception 'El pedido debe iniciar por autorizar.' using errcode='23514';
  end if;
  if TG_OP='UPDATE' and new.status <> old.status and array_position(stages,new.status) <> array_position(stages,old.status)+1 then
    raise exception 'Transición de pedido inválida.' using errcode='23514';
  end if;
  if new.status in ('En tránsito','Entregado') and btrim(new.tracking)='' then raise exception 'Falta la guía de envío.' using errcode='23514'; end if;
  return new;
end $$;
create trigger validate_local_order before insert or update on public.orders for each row execute function private.validate_local_order();

-- Only direction can manage memberships through the local API.
create or replace function private.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
declare workspace uuid;
begin
  insert into public.profiles(id,full_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''));
  if coalesce((new.raw_user_meta_data->>'managed')::boolean,false) then return new; end if;
  insert into public.workspaces(name,created_by) values(coalesce(nullif(new.raw_user_meta_data->>'workspace_name',''),'Hotel Expert'),new.id) returning id into workspace;
  insert into public.workspace_members(workspace_id,user_id,role) values(workspace,new.id,'owner');
  insert into public.crm_settings(workspace_id) values(workspace);
  return new;
end $$;
drop policy members_insert_admin on public.workspace_members;
drop policy members_update_admin on public.workspace_members;
drop policy members_delete_admin on public.workspace_members;
create policy members_insert_owner on public.workspace_members for insert to authenticated
with check(private.has_workspace_role(workspace_id,array['owner']::public.workspace_role[]));
create policy members_update_owner on public.workspace_members for update to authenticated
using(private.has_workspace_role(workspace_id,array['owner']::public.workspace_role[]) and user_id<>auth.uid())
with check(private.has_workspace_role(workspace_id,array['owner']::public.workspace_role[]));
create policy members_delete_owner on public.workspace_members for delete to authenticated
using(private.has_workspace_role(workspace_id,array['owner']::public.workspace_role[]) and user_id<>auth.uid());
