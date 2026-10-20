-- Separate operational roles, admin-only configuration, and post-close stock
-- removals. Keep all stock changes in the existing batch movement ledger.

alter table public.app_members
  add column if not exists email text;

alter table public.app_members alter column role set default 'front';
alter table public.app_members drop constraint if exists app_members_role_check;
update public.app_members set role = 'front' where role = 'staff';
alter table public.app_members
  add constraint app_members_role_check check (role in ('admin', 'manager', 'front', 'kitchen'));

update public.app_members m
set email = u.email
from auth.users u
where u.id = m.user_id and m.email is distinct from u.email;

create or replace function app_private.has_app_role(p_roles text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members
    where user_id = (select auth.uid()) and active and role = any(p_roles)
  );
$$;

create or replace function app_private.has_admin_role()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app_private.has_app_role(array['admin']);
$$;

revoke all on function app_private.has_app_role(text[]) from public, anon;
revoke all on function app_private.has_admin_role() from public, anon;
grant execute on function app_private.has_app_role(text[]) to authenticated;
grant execute on function app_private.has_admin_role() to authenticated;

-- Accounts created through Supabase Auth appear as inactive requests until an
-- admin assigns a role and activates them. No privileged Auth key reaches the
-- browser.
create or replace function app_private.add_pending_app_member()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.app_members (user_id, email, display_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(coalesce(new.email, 'staff'), '@', 1)),
    'front',
    false
  )
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;
revoke all on function app_private.add_pending_app_member() from public, anon, authenticated;

drop trigger if exists add_pending_app_member_after_signup on auth.users;
create trigger add_pending_app_member_after_signup
after insert on auth.users
for each row execute function app_private.add_pending_app_member();

insert into public.app_members (user_id, email, display_name, role, active)
select u.id,
       u.email,
       coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'), ''), split_part(coalesce(u.email, 'staff'), '@', 1)),
       'front',
       false
from auth.users u
where not exists (select 1 from public.app_members m where m.user_id = u.id);

create or replace function app_private.prevent_last_admin_removal()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_other_admins integer;
begin
  if old.active and old.role = 'admin' and not (new.active and new.role = 'admin') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('canteen_active_admins'));
    select count(*) into v_other_admins
    from public.app_members
    where active and role = 'admin' and user_id <> old.user_id;
    if v_other_admins = 0 then
      raise exception 'The last active Website Admin cannot be deactivated or changed to another role.' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists app_members_protect_last_admin on public.app_members;
create trigger app_members_protect_last_admin
before update on public.app_members
for each row execute function app_private.prevent_last_admin_removal();

create table public.waste_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index waste_reasons_lower_name_unique on public.waste_reasons (lower(trim(name)));

create table public.stock_out_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index stock_out_reasons_lower_name_unique on public.stock_out_reasons (lower(trim(name)));

insert into public.waste_reasons (name) values
  ('Expired'), ('Spoiled'), ('Damaged'), ('Quality Issue'), ('Other')
on conflict do nothing;

insert into public.stock_out_reasons (name) values
  ('Owner or friend pickup'), ('Guest pickup'), ('Other')
on conflict do nothing;

alter table public.waste_records drop constraint if exists waste_records_reason_check;

create or replace function app_private.validate_waste_reason()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.reason is distinct from old.reason then
    if not exists (select 1 from public.waste_reasons where active and lower(trim(name)) = lower(trim(new.reason))) then
      raise exception 'Choose an active waste reason.' using errcode = '23514';
    end if;
  elsif not exists (select 1 from public.waste_reasons where lower(trim(name)) = lower(trim(new.reason))) then
    raise exception 'This waste reason no longer exists.' using errcode = '23514';
  end if;
  if lower(trim(new.reason)) = 'other' and nullif(trim(new.notes), '') is null then
    raise exception 'Add a note when the waste reason is Other.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists waste_records_validate_reason on public.waste_records;
create trigger waste_records_validate_reason
before insert or update of reason, notes on public.waste_records
for each row execute function app_private.validate_waste_reason();

alter table public.stock_movements
  drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements
  add constraint stock_movements_movement_type_check
  check (movement_type in (
    'production', 'waste', 'waste_reversal', 'daily_closing', 'closing_reversal',
    'adjustment', 'production_reversal', 'post_close_removal', 'post_close_removal_reversal'
  ));

create table public.post_close_stock_outs (
  id uuid primary key default gen_random_uuid(),
  removal_date date not null default (timezone('Asia/Bangkok', now())::date),
  production_batch_id uuid not null references public.production_batches(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  reason text not null check (length(trim(reason)) between 1 and 80),
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  deleted_at timestamptz
);
create index post_close_stock_outs_date_idx on public.post_close_stock_outs (removal_date desc) where deleted_at is null;

create or replace function app_private.guard_post_close_stock_out()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_latest_closed_date date;
begin
  if tg_op = 'INSERT' then
    if new.removal_date > timezone('Asia/Bangkok', now())::date then
      raise exception 'A removal cannot be recorded for a future day.' using errcode = '22023';
    end if;
    select max(business_date) into v_latest_closed_date
    from public.daily_closings where status = 'closed';
    if v_latest_closed_date is null then
      raise exception 'Close a day before recording a post-close removal.' using errcode = '23514';
    end if;
    if new.removal_date < v_latest_closed_date then
      raise exception 'A post-close removal cannot be backdated before the latest closed day.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.stock_out_reasons where active and lower(trim(name)) = lower(trim(new.reason))) then
      raise exception 'Choose an active stock removal reason.' using errcode = '23514';
    end if;
    if lower(trim(new.reason)) = 'other' and nullif(trim(new.notes), '') is null then
      raise exception 'Add a note when the removal reason is Other.' using errcode = '23514';
    end if;
  elsif old.deleted_at is null and new.deleted_at is not null then
    new.updated_at := now();
    return new;
  elsif old.deleted_at is not null and new.deleted_at is null then
    if lower(trim(new.reason)) = 'other' and nullif(trim(new.notes), '') is null then
      raise exception 'Add a note when the removal reason is Other.' using errcode = '23514';
    end if;
  else
    raise exception 'Post-close removal details are immutable; archive and record a corrected entry.' using errcode = '23514';
  end if;

  perform 1 from public.production_batches where id = new.production_batch_id and deleted_at is null for update;
  if not found then raise exception 'This batch is archived or does not exist.' using errcode = '23503'; end if;

  select coalesce(sum(quantity_delta), 0) into v_balance
  from public.stock_movements
  where production_batch_id = new.production_batch_id;
  if new.quantity > v_balance then
    raise exception 'Only % boxes remain in this batch.', greatest(v_balance, 0) using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app_private.track_post_close_stock_out()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_delta integer;
  v_type text;
  v_date date;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    v_delta := -new.quantity;
    v_type := 'post_close_removal';
    v_date := new.removal_date;
    v_reason := new.reason;
  elsif old.deleted_at is null and new.deleted_at is not null then
    v_delta := old.quantity;
    v_type := 'post_close_removal_reversal';
    v_date := timezone('Asia/Bangkok', now())::date;
    v_reason := 'Archived post-close removal: ' || old.reason;
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_delta := -new.quantity;
    v_type := 'post_close_removal';
    v_date := timezone('Asia/Bangkok', now())::date;
    v_reason := 'Restored post-close removal: ' || new.reason;
  else
    return new;
  end if;

  insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
  values (new.production_batch_id, v_date, v_type, v_delta, new.id, v_reason, auth.uid());
  return new;
end;
$$;

create trigger post_close_stock_outs_guard
before insert or update of deleted_at, removal_date, production_batch_id, quantity, reason, notes
on public.post_close_stock_outs for each row execute function app_private.guard_post_close_stock_out();
create trigger post_close_stock_outs_track_stock
after insert or update of deleted_at on public.post_close_stock_outs
for each row execute function app_private.track_post_close_stock_out();

-- Admin may permanently remove a menu only when no production history exists.
create or replace function public.permanently_delete_unused_menu(p_menu_id uuid)
returns text
language plpgsql security definer
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
  if exists (select 1 from public.production_batches where menu_id = p_menu_id) then
    raise exception 'This menu has production history and must be archived instead.' using errcode = '23514';
  end if;
  delete from public.menu_items where id = p_menu_id;
  return v_name;
end;
$$;
revoke all on function public.permanently_delete_unused_menu(uuid) from public, anon;
grant execute on function public.permanently_delete_unused_menu(uuid) to authenticated;

-- Keep menu deletion auditable with its complete before image.
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
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  v_id := coalesce(
    nullif(v_new->>'id', '')::uuid,
    nullif(v_new->>'user_id', '')::uuid,
    nullif(v_old->>'id', '')::uuid,
    nullif(v_old->>'user_id', '')::uuid
  );
  v_action := case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end;
  if tg_table_name = 'menu_items' then v_label := coalesce(v_new->>'name', v_old->>'name', 'Menu item');
  elsif tg_table_name in ('stores', 'expense_categories', 'waste_reasons', 'stock_out_reasons') then v_label := coalesce(v_new->>'name', v_old->>'name', 'List item');
  elsif tg_table_name = 'production_batches' then v_label := 'Production batch ' || left(v_id::text, 8);
  elsif tg_table_name = 'waste_records' then v_label := 'Waste record ' || left(v_id::text, 8);
  elsif tg_table_name = 'post_close_stock_outs' then v_label := 'Post-close removal ' || left(v_id::text, 8);
  elsif tg_table_name = 'expenses' then v_label := 'Expense ' || left(v_id::text, 8);
  elsif tg_table_name = 'daily_closings' then v_label := 'Daily closing ' || coalesce(v_new->>'business_date', v_old->>'business_date', '');
  elsif tg_table_name = 'settings' then v_label := 'Kitchen setting ' || coalesce(v_new->>'key', v_old->>'key', '');
  elsif tg_table_name = 'app_members' then v_label := 'Staff member ' || coalesce(v_new->>'display_name', v_old->>'display_name', '');
  else v_label := tg_table_name || ' ' || left(v_id::text, 8);
  end if;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, description, before_data, after_data)
  values (auth.uid(), v_action, tg_table_name, v_id, initcap(v_action) || ' ' || v_label, v_old, v_new);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists menu_items_activity on public.menu_items;
create trigger menu_items_activity after insert or update or delete on public.menu_items
for each row execute function app_private.write_activity_log();
drop trigger if exists waste_reasons_activity on public.waste_reasons;
create trigger waste_reasons_activity after insert or update on public.waste_reasons
for each row execute function app_private.write_activity_log();
drop trigger if exists stock_out_reasons_activity on public.stock_out_reasons;
create trigger stock_out_reasons_activity after insert or update on public.stock_out_reasons
for each row execute function app_private.write_activity_log();
drop trigger if exists post_close_stock_outs_activity on public.post_close_stock_outs;
create trigger post_close_stock_outs_activity after insert or update on public.post_close_stock_outs
for each row execute function app_private.write_activity_log();

-- Closing creation is Front/Admin only. Reopening is Admin only and requires a reason.
create or replace function app_private.guard_daily_closing_role()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not app_private.has_app_role(array['admin', 'front']) then
    raise exception 'Only Front staff or a Website Admin can close a day.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists daily_closings_role_guard on public.daily_closings;
create trigger daily_closings_role_guard before insert on public.daily_closings
for each row execute function app_private.guard_daily_closing_role();

alter table public.daily_closings add column if not exists reopen_reason text;
alter table public.daily_closings add constraint daily_closings_reopen_reason_length
  check (reopen_reason is null or length(trim(reopen_reason)) between 1 and 1000);

drop function if exists public.reopen_canteen_day(date);
create or replace function public.reopen_canteen_day(p_business_date date, p_reason text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_closing public.daily_closings%rowtype;
  v_row record;
begin
  if not app_private.has_app_role(array['admin']) then
    raise exception 'Only a Website Admin can reopen a closed day.' using errcode = '42501';
  end if;
  if p_business_date is null or nullif(trim(p_reason), '') is null or length(trim(p_reason)) > 1000 then
    raise exception 'Enter a reason of 1 to 1000 characters.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_business_date::text));
  if exists (select 1 from public.daily_closings where business_date > p_business_date and status = 'closed') then
    raise exception 'Reopen later days before changing this closing.' using errcode = '23514';
  end if;
  select * into v_closing from public.daily_closings
  where business_date = p_business_date and status = 'closed'
  order by version desc limit 1 for update;
  if not found then raise exception 'This day is not currently closed.' using errcode = '23514'; end if;

  for v_row in
    select production_batch_id, sum(quantity_delta)::integer as closing_delta
    from public.stock_movements
    where source_id = v_closing.id and movement_type in ('daily_closing', 'closing_reversal', 'adjustment')
    group by production_batch_id having sum(quantity_delta) <> 0
  loop
    insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
    values (v_row.production_batch_id, p_business_date, 'closing_reversal', -v_row.closing_delta, v_closing.id, 'Closing reversed for reopening: ' || trim(p_reason), auth.uid());
  end loop;
  update public.daily_closings
  set status = 'reopened', reopened_at = now(), reopen_reason = trim(p_reason), updated_at = now()
  where id = v_closing.id;
  return v_closing.id;
end;
$$;
revoke all on function public.reopen_canteen_day(date, text) from public, anon;
grant execute on function public.reopen_canteen_day(date, text) to authenticated;

-- Rewrite grants and policies to enforce department permissions in Postgres.
alter table public.waste_reasons enable row level security;
alter table public.stock_out_reasons enable row level security;
alter table public.post_close_stock_outs enable row level security;

revoke all on public.app_members, public.menu_items, public.meat_options, public.stores,
  public.expense_categories, public.expenses, public.production_batches, public.waste_records,
  public.daily_closings, public.closing_batch_counts, public.stock_movements, public.settings,
  public.activity_logs, public.waste_record_photos, public.expense_receipt_photos,
  public.waste_reasons, public.stock_out_reasons, public.post_close_stock_outs
from anon, authenticated;

grant select on public.app_members, public.menu_items, public.meat_options, public.stores,
  public.expense_categories, public.expenses, public.production_batches, public.waste_records,
  public.daily_closings, public.closing_batch_counts, public.stock_movements, public.settings,
  public.waste_record_photos, public.expense_receipt_photos, public.waste_reasons,
  public.stock_out_reasons, public.post_close_stock_outs to authenticated;
grant select on public.activity_logs to authenticated;
grant select on public.v_stock_by_batch to authenticated;

grant update (display_name, role, active) on public.app_members to authenticated;
grant insert, update (name, default_shelf_life_days, active, notes, selling_price, estimated_cost_per_box, deleted_at)
  on public.menu_items to authenticated;
grant insert, update (name, active) on public.meat_options, public.stores, public.expense_categories,
  public.waste_reasons, public.stock_out_reasons to authenticated;
grant insert, update (expense_date, store_id, category_id, amount_thb, receipt_url, notes, deleted_at)
  on public.expenses to authenticated;
grant insert, update (expiry_date, notes, deleted_at) on public.production_batches to authenticated;
grant insert, update (notes, photo_url, deleted_at) on public.waste_records to authenticated;
grant insert on public.post_close_stock_outs to authenticated;
grant update (deleted_at) on public.post_close_stock_outs to authenticated;
grant insert, update (value) on public.settings to authenticated;
grant insert on public.waste_record_photos, public.expense_receipt_photos to authenticated;
revoke delete on public.menu_items, public.post_close_stock_outs from authenticated;

drop policy if exists app_members_read_self on public.app_members;
create policy app_members_read_self_or_admin on public.app_members for select to authenticated
  using (user_id = (select auth.uid()) or (select app_private.has_app_role(array['admin'])));
create policy app_members_update_admin on public.app_members for update to authenticated
  using ((select app_private.has_app_role(array['admin'])))
  with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists menu_items_select_member on public.menu_items;
drop policy if exists menu_items_insert_member on public.menu_items;
drop policy if exists menu_items_update_member on public.menu_items;
drop policy if exists menu_items_delete_member on public.menu_items;
create policy menu_items_read_members on public.menu_items for select to authenticated using ((select app_private.is_active_member()));
create policy menu_items_write_admin on public.menu_items for all to authenticated
  using ((select app_private.has_app_role(array['admin']))) with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists meat_options_select_member on public.meat_options;
drop policy if exists meat_options_insert_member on public.meat_options;
drop policy if exists meat_options_update_member on public.meat_options;
create policy meat_options_read_members on public.meat_options for select to authenticated using ((select app_private.is_active_member()));
create policy meat_options_write_admin on public.meat_options for all to authenticated
  using ((select app_private.has_app_role(array['admin']))) with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists stores_select_member on public.stores;
drop policy if exists stores_insert_member on public.stores;
drop policy if exists stores_update_member on public.stores;
create policy stores_read_members on public.stores for select to authenticated using ((select app_private.is_active_member()));
create policy stores_write_admin on public.stores for all to authenticated
  using ((select app_private.has_app_role(array['admin']))) with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists expense_categories_select_member on public.expense_categories;
drop policy if exists expense_categories_insert_member on public.expense_categories;
drop policy if exists expense_categories_update_member on public.expense_categories;
create policy expense_categories_read_members on public.expense_categories for select to authenticated using ((select app_private.is_active_member()));
create policy expense_categories_write_admin on public.expense_categories for all to authenticated
  using ((select app_private.has_app_role(array['admin']))) with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists expenses_select_member on public.expenses;
drop policy if exists expenses_insert_member on public.expenses;
drop policy if exists expenses_update_member on public.expenses;
create policy expenses_read_members on public.expenses for select to authenticated using ((select app_private.is_active_member()));
create policy expenses_write_kitchen_or_admin on public.expenses for insert to authenticated
  with check ((select app_private.has_app_role(array['admin', 'kitchen'])));
create policy expenses_update_kitchen_or_admin on public.expenses for update to authenticated
  using ((select app_private.has_app_role(array['admin', 'kitchen'])))
  with check ((select app_private.has_app_role(array['admin', 'kitchen'])));

drop policy if exists production_batches_select_member on public.production_batches;
drop policy if exists production_batches_insert_member on public.production_batches;
drop policy if exists production_batches_update_member on public.production_batches;
create policy production_batches_read_members on public.production_batches for select to authenticated using ((select app_private.is_active_member()));
create policy production_batches_write_front_or_admin on public.production_batches for insert to authenticated
  with check ((select app_private.has_app_role(array['admin', 'front'])));
create policy production_batches_update_front_or_admin on public.production_batches for update to authenticated
  using ((select app_private.has_app_role(array['admin', 'front'])))
  with check ((select app_private.has_app_role(array['admin', 'front'])));

drop policy if exists daily_closings_select_member on public.daily_closings;
drop policy if exists closing_batch_counts_select_member on public.closing_batch_counts;
drop policy if exists stock_movements_select_member on public.stock_movements;
create policy daily_closings_read_members on public.daily_closings for select to authenticated using ((select app_private.is_active_member()));
create policy closing_batch_counts_read_members on public.closing_batch_counts for select to authenticated using ((select app_private.is_active_member()));
create policy stock_movements_read_members on public.stock_movements for select to authenticated using ((select app_private.is_active_member()));

drop policy if exists waste_records_select_member on public.waste_records;
drop policy if exists waste_records_insert_member on public.waste_records;
drop policy if exists waste_records_update_member on public.waste_records;
create policy waste_records_read_members on public.waste_records for select to authenticated using ((select app_private.is_active_member()));
create policy waste_records_write_front_or_admin on public.waste_records for insert to authenticated
  with check ((select app_private.has_app_role(array['admin', 'front'])));
create policy waste_records_update_front_or_admin on public.waste_records for update to authenticated
  using ((select app_private.has_app_role(array['admin', 'front'])))
  with check ((select app_private.has_app_role(array['admin', 'front'])));

drop policy if exists settings_select_member on public.settings;
drop policy if exists settings_insert_member on public.settings;
drop policy if exists settings_update_member on public.settings;
create policy settings_read_members on public.settings for select to authenticated using ((select app_private.is_active_member()));
create policy settings_write_admin on public.settings for all to authenticated
  using ((select app_private.has_app_role(array['admin']))) with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists activity_logs_select_member on public.activity_logs;
create policy activity_logs_read_admin on public.activity_logs for select to authenticated
  using ((select app_private.has_app_role(array['admin'])));

create policy waste_reasons_read_members on public.waste_reasons for select to authenticated using ((select app_private.is_active_member()));
create policy waste_reasons_write_admin on public.waste_reasons for all to authenticated
  using ((select app_private.has_app_role(array['admin']))) with check ((select app_private.has_app_role(array['admin'])));
create policy stock_out_reasons_read_members on public.stock_out_reasons for select to authenticated using ((select app_private.is_active_member()));
create policy stock_out_reasons_write_admin on public.stock_out_reasons for all to authenticated
  using ((select app_private.has_app_role(array['admin']))) with check ((select app_private.has_app_role(array['admin'])));
create policy post_close_stock_outs_read_members on public.post_close_stock_outs for select to authenticated using ((select app_private.is_active_member()));
create policy post_close_stock_outs_insert_front_or_admin on public.post_close_stock_outs for insert to authenticated
  with check ((select app_private.has_app_role(array['admin', 'front'])));
create policy post_close_stock_outs_update_front_or_admin on public.post_close_stock_outs for update to authenticated
  using ((select app_private.has_app_role(array['admin', 'front'])))
  with check ((select app_private.has_app_role(array['admin', 'front'])));

drop policy if exists waste_record_photos_select_member on public.waste_record_photos;
drop policy if exists waste_record_photos_insert_member on public.waste_record_photos;
drop policy if exists expense_receipt_photos_select_member on public.expense_receipt_photos;
drop policy if exists expense_receipt_photos_insert_member on public.expense_receipt_photos;
create policy waste_record_photos_read_members on public.waste_record_photos for select to authenticated
  using ((select app_private.is_active_member()));
create policy waste_record_photos_write_front_or_admin on public.waste_record_photos for insert to authenticated
  with check ((select app_private.has_app_role(array['admin', 'front'])));
create policy expense_receipt_photos_read_members on public.expense_receipt_photos for select to authenticated
  using ((select app_private.is_active_member()));
create policy expense_receipt_photos_write_kitchen_or_admin on public.expense_receipt_photos for insert to authenticated
  with check ((select app_private.has_app_role(array['admin', 'kitchen'])));

drop policy if exists operational_photos_read_members on storage.objects;
drop policy if exists operational_photos_upload_members on storage.objects;
drop policy if exists operational_photos_delete_members on storage.objects;
create policy operational_photos_read_members on storage.objects for select to authenticated
  using (bucket_id = 'operational-photos' and (select app_private.is_active_member()));
create policy operational_photos_upload_by_department on storage.objects for insert to authenticated
  with check (
    bucket_id = 'operational-photos'
    and (
      (name like 'waste/%' and (select app_private.has_app_role(array['admin', 'front'])))
      or (name like 'receipts/%' and (select app_private.has_app_role(array['admin', 'kitchen'])))
    )
  );
create policy operational_photos_delete_by_department on storage.objects for delete to authenticated
  using (bucket_id = 'operational-photos' and (select app_private.has_app_role(array['admin', 'front', 'kitchen'])));
