-- Removing a menu must not erase the identity of historical batches. Keep a
-- production-time name snapshot, then detach the menu FK when an admin removes
-- the configuration row permanently.
alter table public.production_batches add column menu_name_snapshot text;
update public.production_batches b
set menu_name_snapshot = m.name
from public.menu_items m
where m.id = b.menu_id;
alter table public.production_batches alter column menu_name_snapshot set not null;

create or replace function app_private.capture_production_menu_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.menu_id is null then
    if tg_op = 'INSERT' or old.menu_id is null or new.menu_name_snapshot is null then
      raise exception 'Choose a menu item for production.' using errcode = '23514';
    end if;
    -- ON DELETE SET NULL detaches a historical batch; preserve its snapshot.
    new.menu_name_snapshot := old.menu_name_snapshot;
    return new;
  end if;

  select name into new.menu_name_snapshot
  from public.menu_items
  where id = new.menu_id;
  if not found then
    raise exception 'Choose an existing menu item for production.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists production_batches_capture_menu_name on public.production_batches;
create trigger production_batches_capture_menu_name
before insert or update of menu_id on public.production_batches
for each row execute function app_private.capture_production_menu_name();

alter table public.production_batches alter column menu_id drop not null;
do $$
declare
  v_constraint name;
begin
  select conname into v_constraint
  from pg_catalog.pg_constraint
  where conrelid = 'public.production_batches'::regclass
    and confrelid = 'public.menu_items'::regclass
    and contype = 'f';
  if v_constraint is not null then
    execute format('alter table public.production_batches drop constraint %I', v_constraint);
  end if;
end;
$$;
alter table public.production_batches
  add constraint production_batches_menu_id_fkey
  foreign key (menu_id) references public.menu_items(id) on delete set null;

create or replace view public.v_stock_by_batch
with (security_invoker = true)
as
select b.id, b.menu_id,
       coalesce(b.menu_name_snapshot, m.name) || case when meat.name is null then '' else ' · ' || meat.name end as menu_name,
       b.production_date, b.expiry_date,
       coalesce(sum(sm.quantity_delta), 0)::integer as quantity_remaining
from public.production_batches b
left join public.menu_items m on m.id = b.menu_id
left join public.meat_options meat on meat.id = b.meat_option_id
left join public.stock_movements sm on sm.production_batch_id = b.id
where b.deleted_at is null
group by b.id, b.menu_id, b.menu_name_snapshot, m.name, meat.name, b.production_date, b.expiry_date;

create or replace function public.permanently_delete_menu(p_menu_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if not app_private.has_app_role(array['admin']) then
    raise exception 'Only a Website Admin can permanently remove a menu.' using errcode = '42501';
  end if;

  select name into v_name from public.menu_items where id = p_menu_id for update;
  if not found then raise exception 'Menu not found.' using errcode = 'P0002'; end if;

  -- Production rows, stock ledger, closing counts, waste, and reports stay in
  -- place with their original menu name; only the menu configuration is gone.
  delete from public.menu_items where id = p_menu_id;
  return v_name;
end;
$$;
revoke all on function public.permanently_delete_menu(uuid) from public, anon;
grant execute on function public.permanently_delete_menu(uuid) to authenticated;
drop function if exists public.permanently_delete_unused_menu(uuid);
