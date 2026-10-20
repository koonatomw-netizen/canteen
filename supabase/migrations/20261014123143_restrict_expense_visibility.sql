-- Kitchen can submit expenses and receipt photos, while only Managers and
-- Website Admins can read financial records. Kitchen is write-only for its own
-- newly submitted expense and cannot read history, totals, or receipt images.

create or replace function app_private.can_write_expense_receipt(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select app_private.has_app_role(array['admin'])) then exists (
      select 1 from public.expenses e
      where e.id = p_expense_id and e.deleted_at is null
    )
    when (select app_private.has_app_role(array['kitchen'])) then exists (
      select 1 from public.expenses e
      where e.id = p_expense_id
        and e.created_by = (select auth.uid())
        and e.deleted_at is null
    )
    else false
  end;
$$;

revoke all on function app_private.can_write_expense_receipt(uuid) from public, anon;
grant execute on function app_private.can_write_expense_receipt(uuid) to authenticated;

drop policy if exists expenses_read_members on public.expenses;
create policy expenses_read_managers_and_admins on public.expenses
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'manager'])));

drop policy if exists expenses_write_kitchen_or_admin on public.expenses;
create policy expenses_insert_kitchen_or_admin on public.expenses
for insert to authenticated
with check (
  (select app_private.has_app_role(array['admin']))
  or (
    (select app_private.has_app_role(array['kitchen']))
    and created_by = (select auth.uid())
  )
);

drop policy if exists expenses_update_kitchen_or_admin on public.expenses;
create policy expenses_update_admin_only on public.expenses
for update to authenticated
using ((select app_private.has_app_role(array['admin'])))
with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists expense_receipt_photos_read_members on public.expense_receipt_photos;
create policy expense_receipt_photos_read_managers_and_admins on public.expense_receipt_photos
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'manager'])));

drop policy if exists expense_receipt_photos_write_kitchen_or_admin on public.expense_receipt_photos;
create policy expense_receipt_photos_insert_own_kitchen_expense_or_admin on public.expense_receipt_photos
for insert to authenticated
with check (
  file_path like 'receipts/' || expense_id::text || '/%'
  and (select app_private.can_write_expense_receipt(expense_id))
);

-- Keep private operational waste photos available to active staff, but receipts
-- are visible only to the two roles that review financial records.
drop policy if exists operational_photos_read_members on storage.objects;
create policy operational_photos_read_by_record_type on storage.objects
for select to authenticated
using (
  bucket_id = 'operational-photos'
  and case
    when name like 'receipts/%' then (select app_private.has_app_role(array['admin', 'manager']))
    when name like 'waste/%' then (select app_private.is_active_member())
    else false
  end
);

drop policy if exists operational_photos_upload_by_department on storage.objects;
create policy operational_photos_upload_by_department on storage.objects
for insert to authenticated
with check (
  bucket_id = 'operational-photos'
  and (
    (name like 'waste/%' and (select app_private.has_app_role(array['admin', 'front'])))
    or (
      name like 'receipts/%'
      and case
        when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (select app_private.can_write_expense_receipt(split_part(name, '/', 2)::uuid))
        else false
      end
    )
  )
);

-- There is no photo removal flow; keep uploaded receipts and waste photos
-- immutable until an audited reversal/removal workflow exists.
drop policy if exists operational_photos_delete_by_department on storage.objects;
drop policy if exists operational_photos_delete_members on storage.objects;

-- Expense audit rows contain amounts, notes, and receipt paths. The auditor
-- demo can inspect operational changes but must not expose these financial rows.
drop policy if exists activity_logs_read_admin_auditor on public.activity_logs;
create policy activity_logs_read_admin_auditor on public.activity_logs
for select to authenticated
using (
  (select app_private.has_app_role(array['admin']))
  or (
    (select app_private.has_app_role(array['auditor']))
    and entity_type not in ('expenses', 'expense_receipt_photos')
  )
);

notify pgrst, 'reload schema';
