-- Shared global meat choices, variant-aware production batches, and private
-- multi-photo attachments. Existing batch IDs and all stock movements remain.

create table public.meat_options (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 40),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index meat_options_lower_name_unique on public.meat_options (lower(trim(name)));

create or replace function app_private.touch_meat_option_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger meat_options_touch_updated_at before update on public.meat_options
for each row execute function app_private.touch_meat_option_updated_at();

insert into public.meat_options (name) values ('Beef'), ('Chicken'), ('Pork'), ('Vegan')
on conflict do nothing;

alter table public.production_batches
  add column meat_option_id uuid references public.meat_options(id) on delete restrict;
create index production_batches_meat_option_idx
  on public.production_batches (meat_option_id, production_date desc) where deleted_at is null;

-- Convert recognized legacy menu names such as "Hummus vegan" to a shared
-- menu plus a meat option. Batch identity, stock movements, and child records
-- stay intact. Other menu names are not interpreted or changed.
create temporary table legacy_menu_variants as
select m.id as legacy_menu_id,
       btrim(regexp_replace(m.name, '\s+(beef|chicken|pork|vegan)$', '', 'i')) as base_name,
       lower(regexp_replace(m.name, '^.*\s+(beef|chicken|pork|vegan)$', '\1', 'i')) as meat_key,
       m.default_shelf_life_days,
       m.active
from public.menu_items m
where m.name ~* '\s+(beef|chicken|pork|vegan)$'
  and length(btrim(regexp_replace(m.name, '\s+(beef|chicken|pork|vegan)$', '', 'i'))) between 1 and 100;

insert into public.menu_items (name, default_shelf_life_days, active)
select v.base_name, min(v.default_shelf_life_days), bool_or(v.active)
from legacy_menu_variants v
where not exists (
  select 1 from public.menu_items existing
  where lower(btrim(existing.name)) = lower(v.base_name) and existing.deleted_at is null
)
group by v.base_name;

update public.production_batches b
set menu_id = canonical.id,
    meat_option_id = meat.id
from legacy_menu_variants legacy
join public.menu_items canonical
  on lower(btrim(canonical.name)) = lower(legacy.base_name)
 and canonical.deleted_at is null
join public.meat_options meat on lower(meat.name) = legacy.meat_key
where b.menu_id = legacy.legacy_menu_id
  and b.meat_option_id is null;

update public.menu_items legacy_menu
set active = false
from legacy_menu_variants legacy
where legacy_menu.id = legacy.legacy_menu_id;

drop table legacy_menu_variants;

-- New production must select an active global meat option. Legacy rows may
-- keep NULL if they did not match a recognized old menu suffix.
create or replace function app_private.validate_production_batch()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.production_date > timezone('Asia/Bangkok', now())::date then
    raise exception 'Production cannot be recorded for a future day.' using errcode = '22023';
  end if;
  if exists (select 1 from public.daily_closings where business_date = new.production_date and status = 'closed') then
    raise exception 'Reopen this day before adding production to it.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.menu_items where id = new.menu_id and active and deleted_at is null) then
    raise exception 'Choose an active menu item.' using errcode = '23514';
  end if;
  if new.meat_option_id is null or not exists (
    select 1 from public.meat_options where id = new.meat_option_id and active
  ) then
    raise exception 'Choose an active meat option.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Legacy single-photo fields remain readable during rollout. New uploads use
-- one private metadata row per object, allowing multiple files per record.
create table public.waste_record_photos (
  id uuid primary key default gen_random_uuid(),
  waste_record_id uuid not null references public.waste_records(id) on delete restrict,
  file_path text not null unique check (file_path like 'waste/%' and file_path !~ '(^|/)\.\.(/|$)'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid()
);
create index waste_record_photos_parent_idx on public.waste_record_photos (waste_record_id, created_at);

create table public.expense_receipt_photos (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete restrict,
  file_path text not null unique check (file_path like 'receipts/%' and file_path !~ '(^|/)\.\.(/|$)'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid()
);
create index expense_receipt_photos_parent_idx on public.expense_receipt_photos (expense_id, created_at);

insert into public.waste_record_photos (waste_record_id, file_path)
select id, photo_url from public.waste_records where photo_url like 'waste/%'
on conflict (file_path) do nothing;

insert into public.expense_receipt_photos (expense_id, file_path)
select id, receipt_url from public.expenses where receipt_url like 'receipts/%'
on conflict (file_path) do nothing;

update storage.buckets set public = false where id = 'operational-photos';

-- Generalize the existing audit writer so menu removal is captured with a
-- before image. Existing update/insert auditing continues unchanged.
create or replace function app_private.write_activity_log()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
  v_label text;
  v_action text;
  v_row jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);
  v_id := coalesce(
    nullif(v_row->>'id', '')::uuid,
    nullif(v_row->>'user_id', '')::uuid
  );
  v_action := case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end;
  if tg_table_name in ('menu_items', 'meat_options') then v_label := coalesce(v_row->>'name', 'Menu item');
  elsif tg_table_name = 'stores' or tg_table_name = 'expense_categories' then v_label := coalesce(v_row->>'name', 'List item');
  elsif tg_table_name = 'production_batches' then v_label := 'Production batch ' || left(v_id::text, 8);
  elsif tg_table_name = 'waste_records' then v_label := 'Waste record ' || left(v_id::text, 8);
  elsif tg_table_name = 'expenses' then v_label := 'Expense ' || left(v_id::text, 8);
  elsif tg_table_name = 'daily_closings' then v_label := 'Daily closing ' || coalesce(v_row->>'business_date', '');
  elsif tg_table_name = 'settings' then v_label := 'Kitchen setting ' || coalesce(v_row->>'key', '');
  elsif tg_table_name = 'app_members' then v_label := 'Staff member ' || coalesce(v_row->>'display_name', '');
  elsif tg_table_name = 'waste_record_photos' then v_label := 'Waste photo ' || left(v_id::text, 8);
  elsif tg_table_name = 'expense_receipt_photos' then v_label := 'Receipt photo ' || left(v_id::text, 8);
  else v_label := tg_table_name || ' ' || left(v_id::text, 8);
  end if;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, description, before_data, after_data)
  values (auth.uid(), v_action, tg_table_name, v_id, initcap(v_action) || ' ' || v_label, v_old, v_new);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger menu_items_delete_activity after delete on public.menu_items
for each row execute function app_private.write_activity_log();
create trigger meat_options_activity after insert or update on public.meat_options
for each row execute function app_private.write_activity_log();
create trigger waste_record_photos_activity after insert on public.waste_record_photos
for each row execute function app_private.write_activity_log();
create trigger expense_receipt_photos_activity after insert on public.expense_receipt_photos
for each row execute function app_private.write_activity_log();

create or replace view public.v_stock_by_batch
with (security_invoker = true)
as
select b.id, b.menu_id,
       m.name || case when meat.name is null then '' else ' · ' || meat.name end as menu_name,
       b.production_date, b.expiry_date,
       coalesce(sum(sm.quantity_delta), 0)::integer as quantity_remaining
from public.production_batches b
join public.menu_items m on m.id = b.menu_id
left join public.meat_options meat on meat.id = b.meat_option_id
left join public.stock_movements sm on sm.production_batch_id = b.id
where b.deleted_at is null
group by b.id, b.menu_id, m.name, meat.name, b.production_date, b.expiry_date;

alter table public.meat_options enable row level security;
alter table public.waste_record_photos enable row level security;
alter table public.expense_receipt_photos enable row level security;

grant select, insert on public.meat_options to authenticated;
grant update (active) on public.meat_options to authenticated;
grant delete on public.menu_items to authenticated;
grant select, insert on public.waste_record_photos, public.expense_receipt_photos to authenticated;

create policy meat_options_select_member on public.meat_options for select to authenticated
  using ((select app_private.is_active_member()));
create policy meat_options_insert_member on public.meat_options for insert to authenticated
  with check ((select app_private.is_active_member()));
create policy meat_options_update_member on public.meat_options for update to authenticated
  using ((select app_private.is_active_member())) with check ((select app_private.is_active_member()));
create policy menu_items_delete_member on public.menu_items for delete to authenticated
  using ((select app_private.is_active_member()));

create policy waste_record_photos_select_member on public.waste_record_photos for select to authenticated
  using ((select app_private.is_active_member()));
create policy waste_record_photos_insert_member on public.waste_record_photos for insert to authenticated
  with check ((select app_private.is_active_member()) and exists (
    select 1 from public.waste_records where id = waste_record_id and deleted_at is null
  ));
create policy expense_receipt_photos_select_member on public.expense_receipt_photos for select to authenticated
  using ((select app_private.is_active_member()));
create policy expense_receipt_photos_insert_member on public.expense_receipt_photos for insert to authenticated
  with check ((select app_private.is_active_member()) and exists (
    select 1 from public.expenses where id = expense_id and deleted_at is null
  ));

notify pgrst, 'reload schema';
