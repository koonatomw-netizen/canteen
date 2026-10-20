-- Restrict photo attachment metadata to matching operational records and
-- prevent department roles from deleting the underlying private objects.
drop policy if exists waste_record_photos_write_front_or_admin on public.waste_record_photos;
create policy waste_record_photos_write_front_or_admin on public.waste_record_photos
  for insert to authenticated
  with check (
    (select app_private.has_app_role(array['admin', 'front']))
    and file_path like 'waste/' || waste_record_id::text || '/%'
    and exists (
      select 1 from public.waste_records w
      where w.id = waste_record_id and w.deleted_at is null
    )
  );

drop policy if exists expense_receipt_photos_write_kitchen_or_admin on public.expense_receipt_photos;
create policy expense_receipt_photos_write_kitchen_or_admin on public.expense_receipt_photos
  for insert to authenticated
  with check (
    (select app_private.has_app_role(array['admin', 'kitchen']))
    and file_path like 'receipts/' || expense_id::text || '/%'
    and exists (
      select 1 from public.expenses e
      where e.id = expense_id and e.deleted_at is null
    )
  );

-- There is no photo-delete workflow in the app. Keep each photo and its
-- metadata together until a reviewed, auditable removal flow exists.
drop policy if exists operational_photos_delete_by_department on storage.objects;

create or replace function app_private.validate_default_shelf_life_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.key = 'default_shelf_life_days' then
    if new.value !~ '^[0-9]+$' then
      raise exception 'Default shelf life must be a whole number from 1 to 30 days.' using errcode = '23514';
    end if;
    if new.value::integer < 1 or new.value::integer > 30 then
      raise exception 'Default shelf life must be a whole number from 1 to 30 days.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists settings_validate_default_shelf_life on public.settings;
create trigger settings_validate_default_shelf_life
before insert or update of key, value on public.settings
for each row execute function app_private.validate_default_shelf_life_setting();
