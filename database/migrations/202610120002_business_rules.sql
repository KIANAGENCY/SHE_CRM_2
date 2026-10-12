create extension if not exists btree_gist;
alter table public.appointments add constraint appointments_no_overlap
exclude using gist (workspace_id with =, owner_name with =,
  tsrange(start_at at time zone 'UTC', (start_at at time zone 'UTC') + duration * interval '1 minute', '[)') with &&);
alter table public.clients add constraint clients_name_nonempty check(btrim(name)<>'');
alter table public.products add constraint products_name_nonempty check(btrim(name)<>'' and btrim(sku)<>'');
alter table public.tasks add constraint tasks_title_nonempty check(btrim(title)<>'');

create function private.validate_quote_catalog() returns trigger language plpgsql set search_path='' as $$
declare line jsonb; product public.products;
begin
  if TG_OP='UPDATE' and exists(select 1 from public.orders where workspace_id=new.workspace_id and quote_id=new.id)
    and (new.client_id,new.lines,new.total,new.status) is distinct from (old.client_id,old.lines,old.total,old.status) then
    raise exception 'La cotización ya está vinculada a un pedido.' using errcode='23514';
  end if;
  if TG_OP='INSERT' or new.lines is distinct from old.lines then
    for line in select value from jsonb_array_elements(new.lines) loop
      select * into product from public.products where workspace_id=new.workspace_id and id=line->>'productId';
      if product.id is null or product.price<>(line->>'price')::numeric then
        raise exception 'Producto o precio fuera de catálogo.' using errcode='23514';
      end if;
      if coalesce(line->>'aromaId','')<>'' and not exists(select 1 from public.aromas where workspace_id=new.workspace_id and id=line->>'aromaId' and approved and product.id=any(product_ids)) then
        raise exception 'Aroma no aprobado o incompatible.' using errcode='23514';
      end if;
    end loop;
  end if;
  if new.status='Aceptada' and (TG_OP='INSERT' or old.status<>'Aceptada') then
    if new.valid_until<current_date or coalesce(btrim(new.acceptance_reference),'')='' or new.accepted_at is null then
      raise exception 'Registra aceptación y vigencia de la cotización.' using errcode='23514';
    end if;
    if exists(select 1 from jsonb_array_elements(new.lines) as element(value) where coalesce(element.value->>'aromaId','')='') then
      raise exception 'Confirma el aroma de cada producto.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger validate_quote_catalog before insert or update on public.quotes for each row execute function private.validate_quote_catalog();

create function private.validate_sample() returns trigger language plpgsql set search_path='' as $$
declare stages text[]:=array['Solicitada','En preparación','Enviada','En evaluación','Evaluada'];
begin
  if not exists(select 1 from public.opportunities where workspace_id=new.workspace_id and id=new.opportunity_id and client_id=new.client_id) then
    raise exception 'Muestra y oportunidad deben pertenecer al mismo cliente.' using errcode='23514';
  end if;
  if TG_OP='INSERT' and new.status<>'Solicitada' then raise exception 'La muestra debe iniciar solicitada.' using errcode='23514'; end if;
  if TG_OP='UPDATE' and new.status<>old.status then
    if array_position(stages,new.status)<>array_position(stages,old.status)+1 then raise exception 'Transición de muestra inválida.' using errcode='23514'; end if;
    if old.status in ('Solicitada','En preparación') and not private.has_workspace_role(new.workspace_id,array['owner','admin']::public.workspace_role[]) then
      raise exception 'Administración debe autorizar o enviar la muestra.' using errcode='42501';
    end if;
  end if;
  if new.status in ('Enviada','En evaluación','Evaluada') and btrim(new.tracking)='' then raise exception 'Falta la guía de la muestra.' using errcode='23514'; end if;
  if new.status='Evaluada' and btrim(new.result)='' then raise exception 'Falta la evaluación.' using errcode='23514'; end if;
  return new;
end $$;
create trigger validate_sample before insert or update on public.samples for each row execute function private.validate_sample();
create unique index samples_one_active on public.samples(workspace_id,opportunity_id) where status<>'Evaluada';
