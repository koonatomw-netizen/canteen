-- Give Website Auditor broad inspection access while keeping every write
-- policy limited to operational staff and Website Admins.
alter table public.app_members drop constraint if exists app_members_role_check;
alter table public.app_members
  add constraint app_members_role_check
  check (role in ('admin', 'manager', 'front', 'kitchen', 'auditor'));

drop policy if exists app_members_read_self_or_admin on public.app_members;
create policy app_members_read_self_admin_auditor on public.app_members
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select app_private.has_app_role(array['admin', 'auditor']))
);

drop policy if exists activity_logs_read_admin on public.activity_logs;
create policy activity_logs_read_admin_auditor on public.activity_logs
for select to authenticated
using ((select app_private.has_app_role(array['admin', 'auditor'])));

notify pgrst, 'reload schema';
