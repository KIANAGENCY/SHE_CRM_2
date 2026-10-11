alter table public.crm_settings
  add column if not exists initialized boolean not null default false;
