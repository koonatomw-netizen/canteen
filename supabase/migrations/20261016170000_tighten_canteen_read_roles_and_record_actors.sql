-- Keep canteen operations inside the roles that work with or report on them,
-- and snapshot the staff name on the two removal ledgers for manager reports.
begin;

alter table public.waste_records
  add column if not exists created_by_name text;
alter table public.post_close_stock_outs
  add column if not exists created_by_name text;

update public.waste_records wr
set created_by_name = coalesce(nullif(btrim(am.display_name), ''), 'Unknown staff')
from public.app_members am
where am.user_id = wr.created_by and wr.created_by_name is null;
update public.post_close_stock_outs so
set created_by_name = coalesce(nullif(btrim(am.display_name), ''), 'Unknown staff')
from public.app_members am
where am.user_id = so.created_by and so.created_by_name is null;

update public.waste_records set created_by_name = 'Unknown staff' where created_by_name is null;
update public.post_close_stock_outs set created_by_name = 'Unknown staff' where created_by_name is null;

alter table public.waste_records alter column created_by_name set default 'Unknown staff';
alter table public.waste_records alter column created_by_name set not null;
alter table public.post_close_stock_outs alter column created_by_name set default 'Unknown staff';
alter table public.post_close_stock_outs alter column created_by_name set not null;

create or replace function app_private.snapshot_canteen_record_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_display_name text;
begin
  if v_actor is null then
    new.created_by_name := coalesce(nullif(btrim(new.created_by_name), ''), 'System');
    return new;
  end if;

  select nullif(btrim(am.display_name), '') into v_display_name
  from public.app_members am
  where am.user_id = v_actor and am.active;

  if v_display_name is null then
    raise exception 'An active staff account is required to record this item.' using errcode = '42501';
  end if;

  new.created_by := v_actor;
  new.created_by_name := v_display_name;
  return new;
end;
$$;

revoke all on function app_private.snapshot_canteen_record_actor() from public, anon, authenticated;

drop trigger if exists waste_records_snapshot_actor on public.waste_records;
create trigger waste_records_snapshot_actor
before insert on public.waste_records
for each row execute function app_private.snapshot_canteen_record_actor();

drop trigger if exists post_close_stock_outs_snapshot_actor on public.post_close_stock_outs;
create trigger post_close_stock_outs_snapshot_actor
before insert on public.post_close_stock_outs
for each row execute function app_private.snapshot_canteen_record_actor();

-- SELECT policies are intentionally separate from write policies. Kitchen only
-- needs store and category choices for its expense form; Co-living has no access
-- to canteen rows. Managers and the read-only auditor retain report access.
drop policy if exists menu_items_select_member on public.menu_items;
drop policy if exists menu_items_read_members on public.menu_items;
create policy menu_items_read_canteen_roles on public.menu_items
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor'])));

drop policy if exists meat_options_select_member on public.meat_options;
drop policy if exists meat_options_read_members on public.meat_options;
create policy meat_options_read_canteen_roles on public.meat_options
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor'])));

drop policy if exists stores_select_member on public.stores;
drop policy if exists stores_read_members on public.stores;
create policy stores_read_expense_workflow_roles on public.stores
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'kitchen', 'manager'])));

drop policy if exists expense_categories_select_member on public.expense_categories;
drop policy if exists expense_categories_read_members on public.expense_categories;
create policy expense_categories_read_expense_workflow_roles on public.expense_categories
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'kitchen', 'manager'])));

drop policy if exists production_batches_select_member on public.production_batches;
drop policy if exists production_batches_read_members on public.production_batches;
create policy production_batches_read_canteen_roles on public.production_batches
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor'])));

drop policy if exists daily_closings_select_member on public.daily_closings;
drop policy if exists daily_closings_read_members on public.daily_closings;
create policy daily_closings_read_canteen_roles on public.daily_closings
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor'])));

drop policy if exists closing_batch_counts_select_member on public.closing_batch_counts;
drop policy if exists closing_batch_counts_read_members on public.closing_batch_counts;
create policy closing_batch_counts_read_canteen_roles on public.closing_batch_counts
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor'])));

drop policy if exists stock_movements_select_member on public.stock_movements;
drop policy if exists stock_movements_read_members on public.stock_movements;
create policy stock_movements_read_canteen_roles on public.stock_movements
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor'])));

drop policy if exists waste_records_select_member on public.waste_records;
drop policy if exists waste_records_read_members on public.waste_records;
create policy waste_records_read_canteen_roles on public.waste_records
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor'])));

drop policy if exists settings_select_member on public.settings;
drop policy if exists settings_read_members on public.settings;
create policy settings_read_canteen_roles on public.settings
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor'])));

drop policy if exists waste_reasons_read_members on public.waste_reasons;
create policy waste_reasons_read_canteen_roles on public.waste_reasons
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor'])));

drop policy if exists stock_out_reasons_read_members on public.stock_out_reasons;
create policy stock_out_reasons_read_canteen_roles on public.stock_out_reasons
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor'])));

drop policy if exists post_close_stock_outs_read_members on public.post_close_stock_outs;
create policy post_close_stock_outs_read_canteen_roles on public.post_close_stock_outs
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor'])));

drop policy if exists waste_record_photos_select_member on public.waste_record_photos;
drop policy if exists waste_record_photos_read_members on public.waste_record_photos;
create policy waste_record_photos_read_canteen_roles on public.waste_record_photos
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor'])));

drop policy if exists operational_photos_read_members on storage.objects;
drop policy if exists operational_photos_read_by_record_type on storage.objects;
create policy operational_photos_read_by_record_type on storage.objects
for select to authenticated
using (
  bucket_id = 'operational-photos'
  and case
    when name like 'receipts/%' then (select app_private.has_app_role(array['admin', 'manager']))
    when name like 'waste/%' then (select app_private.has_app_role(array['admin', 'front', 'manager', 'auditor']))
    else false
  end
);

comment on column public.waste_records.created_by_name is
  'Immutable display-name snapshot captured when the staff member records waste.';
comment on column public.post_close_stock_outs.created_by_name is
  'Immutable display-name snapshot captured when the staff member records a post-close removal.';

notify pgrst, 'reload schema';
commit;
