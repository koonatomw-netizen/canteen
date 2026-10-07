-- Canteen Tracking System: single-canteen Phase 1 schema.
-- Stock is derived from immutable movements. Every exposed business table has RLS.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

create table public.app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  role text not null default 'staff' check (role in ('admin', 'manager', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function app_private.is_active_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members
    where user_id = (select auth.uid()) and active
  );
$$;

create or replace function app_private.has_admin_role()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members
    where user_id = (select auth.uid()) and active and role in ('admin', 'manager')
  );
$$;

revoke all on function app_private.is_active_member() from public, anon;
revoke all on function app_private.has_admin_role() from public, anon;
grant execute on function app_private.is_active_member() to authenticated;
grant execute on function app_private.has_admin_role() to authenticated;

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  default_shelf_life_days integer not null default 3 check (default_shelf_life_days between 1 and 30),
  active boolean not null default true,
  notes text,
  selling_price numeric(12, 2) check (selling_price is null or selling_price >= 0),
  estimated_cost_per_box numeric(12, 2) check (estimated_cost_per_box is null or estimated_cost_per_box >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index menu_items_active_name_unique on public.menu_items (lower(trim(name))) where deleted_at is null;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index stores_active_name_unique on public.stores (lower(trim(name))) where deleted_at is null;

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index expense_categories_lower_name_unique on public.expense_categories (lower(trim(name)));

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default (timezone('Asia/Bangkok', now())::date),
  store_id uuid not null references public.stores(id) on delete restrict,
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  amount_thb numeric(12, 2) not null check (amount_thb > 0),
  receipt_url text,
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  deleted_at timestamptz
);
create index expenses_expense_date_idx on public.expenses (expense_date desc) where deleted_at is null;

create table public.production_batches (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.menu_items(id) on delete restrict,
  production_date date not null default (timezone('Asia/Bangkok', now())::date),
  quantity_produced integer not null check (quantity_produced > 0),
  expiry_date date not null,
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  deleted_at timestamptz,
  constraint production_expiry_not_before_production check (expiry_date >= production_date)
);
create index production_batches_date_idx on public.production_batches (production_date desc) where deleted_at is null;
create index production_batches_menu_idx on public.production_batches (menu_id, production_date desc) where deleted_at is null;

create table public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  version integer not null default 1 check (version > 0),
  status text not null default 'closed' check (status in ('open', 'closed', 'reopened')),
  closed_at timestamptz,
  reopened_at timestamptz,
  note text check (note is null or length(note) <= 2000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_date, version),
  check ((status = 'closed' and closed_at is not null) or status <> 'closed')
);
create unique index one_active_closing_per_day on public.daily_closings (business_date) where status = 'closed';
create index daily_closings_date_idx on public.daily_closings (business_date desc, version desc);

create table public.closing_batch_counts (
  id uuid primary key default gen_random_uuid(),
  daily_closing_id uuid not null references public.daily_closings(id) on delete restrict,
  production_batch_id uuid not null references public.production_batches(id) on delete restrict,
  expected_quantity integer not null check (expected_quantity >= 0),
  physical_remaining_quantity integer not null check (physical_remaining_quantity >= 0),
  calculated_sold_quantity integer not null check (calculated_sold_quantity >= 0),
  stock_adjustment_quantity integer not null default 0 check (stock_adjustment_quantity >= 0),
  adjustment_reason text check (adjustment_reason is null or adjustment_reason in ('Counting correction', 'Staff meal', 'Complimentary', 'Missing/unrecorded', 'Other')),
  created_at timestamptz not null default now(),
  unique (daily_closing_id, production_batch_id),
  check (stock_adjustment_quantity = 0 or adjustment_reason is not null)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  production_batch_id uuid not null references public.production_batches(id) on delete restrict,
  business_date date not null,
  movement_type text not null check (movement_type in ('production', 'waste', 'waste_reversal', 'daily_closing', 'closing_reversal', 'adjustment', 'production_reversal')),
  quantity_delta integer not null check (quantity_delta <> 0),
  source_id uuid not null,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index stock_movements_batch_date_idx on public.stock_movements (production_batch_id, business_date, created_at);
create index stock_movements_source_idx on public.stock_movements (source_id, movement_type);

create table public.waste_records (
  id uuid primary key default gen_random_uuid(),
  waste_date date not null default (timezone('Asia/Bangkok', now())::date),
  production_batch_id uuid not null references public.production_batches(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  reason text not null check (reason in ('Expired', 'Spoiled', 'Damaged', 'Quality Issue', 'Other')),
  notes text check (notes is null or length(notes) <= 2000),
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  deleted_at timestamptz
);
create index waste_records_date_idx on public.waste_records (waste_date desc) where deleted_at is null;

create table public.settings (
  key text primary key check (length(trim(key)) between 1 and 100),
  value text not null check (length(value) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  description text not null,
  before_data jsonb,
  after_data jsonb
);
create index activity_logs_occurred_idx on public.activity_logs (occurred_at desc);

-- Enable the same transactional stock-ledger write for every production batch.
create or replace function app_private.track_batch_stock()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  if tg_op = 'INSERT' then
    insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
    values (new.id, new.production_date, 'production', new.quantity_produced, new.id, 'Production recorded', coalesce(new.created_by, auth.uid()));
    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    select coalesce(sum(quantity_delta), 0) into v_balance
    from public.stock_movements where production_batch_id = old.id;
    if v_balance <> 0 then
      raise exception 'A batch with stock remaining cannot be archived. Record its final count first.' using errcode = '23514';
    end if;
    insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
    values (old.id, timezone('Asia/Bangkok', now())::date, 'production_reversal', -old.quantity_produced, old.id, 'Empty batch archived', auth.uid());
  elsif old.deleted_at is not null and new.deleted_at is null then
    insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
    values (new.id, timezone('Asia/Bangkok', now())::date, 'production', new.quantity_produced, new.id, 'Batch restored', auth.uid());
  end if;
  return new;
end;
$$;

create trigger production_batches_track_stock
after insert or update of deleted_at on public.production_batches
for each row execute function app_private.track_batch_stock();

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
  return new;
end;
$$;
create trigger production_batches_validate before insert on public.production_batches
for each row execute function app_private.validate_production_batch();

-- Serialize waste against closing/count and reject a deduction larger than on-hand stock.
create or replace function app_private.guard_waste_quantity()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  perform 1 from public.production_batches where id = new.production_batch_id and deleted_at is null for update;
  if not found then raise exception 'This batch is archived or does not exist.' using errcode = '23503'; end if;
  if new.waste_date > timezone('Asia/Bangkok', now())::date then
    raise exception 'Waste cannot be recorded for a future day.' using errcode = '22023';
  end if;
  if exists (select 1 from public.daily_closings where business_date = new.waste_date and status = 'closed') then
    raise exception 'Reopen this day before changing its waste record.' using errcode = '23514';
  end if;
  select coalesce(sum(quantity_delta), 0) into v_balance
  from public.stock_movements
  where production_batch_id = new.production_batch_id and business_date <= new.waste_date;
  if new.quantity > v_balance then
    raise exception 'Only % boxes are available in this batch.', greatest(v_balance, 0) using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app_private.track_waste_stock()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_delta integer;
  v_type text;
begin
  if tg_op = 'INSERT' then
    v_delta := -new.quantity; v_type := 'waste';
    insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
    values (new.production_batch_id, new.waste_date, v_type, v_delta, new.id, new.reason, coalesce(new.created_by, auth.uid()));
    return new;
  end if;
  if old.deleted_at is null and new.deleted_at is not null then
    v_delta := old.quantity; v_type := 'waste_reversal';
    insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
    values (old.production_batch_id, old.waste_date, v_type, v_delta, old.id, 'Waste record archived', auth.uid());
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform 1 from public.production_batches where id = new.production_batch_id and deleted_at is null for update;
    if not found then raise exception 'This batch is archived or does not exist.' using errcode = '23503'; end if;
    select coalesce(sum(quantity_delta), 0) into v_delta
    from public.stock_movements where production_batch_id = new.production_batch_id;
    if new.quantity > v_delta then raise exception 'There is not enough stock to restore this waste record.' using errcode = '23514'; end if;
    insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
    values (new.production_batch_id, new.waste_date, 'waste', -new.quantity, new.id, new.reason, auth.uid());
  end if;
  return new;
end;
$$;

create trigger waste_records_guard_stock
before insert or update of deleted_at, waste_date on public.waste_records for each row execute function app_private.guard_waste_quantity();
create trigger waste_records_track_stock
after insert or update of deleted_at on public.waste_records for each row execute function app_private.track_waste_stock();

create or replace function app_private.validate_expense_date()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.expense_date > timezone('Asia/Bangkok', now())::date then
    raise exception 'Expenses cannot be recorded for a future day.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger expenses_validate_date before insert or update of expense_date on public.expenses
for each row execute function app_private.validate_expense_date();

-- Write a human-readable, immutable before/after record with the business change.
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
  if tg_op = 'UPDATE' then v_old := to_jsonb(old); end if;
  if tg_op = 'INSERT' then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then v_new := to_jsonb(new); end if;
  v_id := coalesce(
    nullif(v_new->>'id', '')::uuid,
    nullif(v_new->>'user_id', '')::uuid,
    nullif(v_old->>'id', '')::uuid,
    nullif(v_old->>'user_id', '')::uuid
  );
  if tg_op = 'INSERT' then v_action := 'created'; else v_action := 'updated'; end if;
  if tg_table_name = 'menu_items' then v_label := coalesce(v_new->>'name', v_old->>'name', 'Menu item');
  elsif tg_table_name = 'stores' or tg_table_name = 'expense_categories' then v_label := coalesce(v_new->>'name', v_old->>'name', 'List item');
  elsif tg_table_name = 'production_batches' then v_label := 'Production batch ' || left(v_id::text, 8);
  elsif tg_table_name = 'waste_records' then v_label := 'Waste record ' || left(v_id::text, 8);
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

create trigger menu_items_activity after insert or update on public.menu_items for each row execute function app_private.write_activity_log();
create trigger stores_activity after insert or update on public.stores for each row execute function app_private.write_activity_log();
create trigger expense_categories_activity after insert or update on public.expense_categories for each row execute function app_private.write_activity_log();
create trigger expenses_activity after insert or update on public.expenses for each row execute function app_private.write_activity_log();
create trigger production_batches_activity after insert or update on public.production_batches for each row execute function app_private.write_activity_log();
create trigger waste_records_activity after insert or update on public.waste_records for each row execute function app_private.write_activity_log();
create trigger daily_closings_activity after insert or update on public.daily_closings for each row execute function app_private.write_activity_log();
create trigger app_members_activity after insert or update on public.app_members for each row execute function app_private.write_activity_log();
create trigger settings_activity after insert or update on public.settings for each row execute function app_private.write_activity_log();

-- Close from an explicit physical count. Sales are derived; gains require a reason.
create or replace function public.close_canteen_day(p_business_date date, p_counts jsonb, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_existing public.daily_closings%rowtype;
  v_closing_id uuid;
  v_version integer;
  v_has_existing boolean := false;
  v_row record;
  v_expected bigint;
  v_sold integer;
  v_adjustment integer;
  v_reason text;
  v_actor uuid := auth.uid();
begin
  if not app_private.is_active_member() then raise exception 'Staff access is required.' using errcode = '42501'; end if;
  if p_business_date is null or p_business_date > timezone('Asia/Bangkok', now())::date then
    raise exception 'A future day cannot be closed.' using errcode = '22023';
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'array' then raise exception 'Batch counts must be a list.' using errcode = '22023'; end if;
  if length(coalesce(p_note, '')) > 2000 then raise exception 'The closing note is too long.' using errcode = '22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_business_date::text));
  if exists (select 1 from public.daily_closings where business_date > p_business_date and status = 'closed') then
    raise exception 'Reopen later days before changing this closing.' using errcode = '23514';
  end if;
  select * into v_existing from public.daily_closings
  where business_date = p_business_date order by version desc limit 1 for update;
  if found then v_has_existing := true; end if;
  if v_has_existing and v_existing.status = 'closed' then raise exception 'This day is already closed.' using errcode = '23505'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_counts) as x(batch_id uuid, physical_quantity integer, adjustment_reason text)
    group by batch_id having count(*) > 1
  ) then raise exception 'Each batch can be counted once.' using errcode = '22023'; end if;

  -- Lock every eligible batch so closing cannot race with a waste submission.
  perform 1 from public.production_batches
  where production_date <= p_business_date and deleted_at is null order by id for update;

  for v_row in select batch_id, physical_quantity, adjustment_reason
    from jsonb_to_recordset(p_counts) as x(batch_id uuid, physical_quantity integer, adjustment_reason text)
  loop
    if v_row.batch_id is null or v_row.physical_quantity is null or v_row.physical_quantity < 0 then
      raise exception 'Enter a whole number of zero or more for every batch.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.production_batches where id = v_row.batch_id and production_date <= p_business_date and deleted_at is null) then
      raise exception 'One of these batches is not available for this day.' using errcode = '23503';
    end if;
    select coalesce(sum(quantity_delta), 0) into v_expected
    from public.stock_movements where production_batch_id = v_row.batch_id and business_date <= p_business_date;
    if v_expected < 0 then raise exception 'A batch cannot close with negative stock.' using errcode = '23514'; end if;
    v_adjustment := greatest(v_row.physical_quantity - v_expected, 0)::integer;
    v_sold := greatest(v_expected - v_row.physical_quantity, 0)::integer;
    v_reason := nullif(trim(v_row.adjustment_reason), '');
    if v_adjustment > 0 and (v_reason is null or v_reason not in ('Counting correction', 'Staff meal', 'Complimentary', 'Missing/unrecorded', 'Other')) then
      raise exception 'Choose a valid reason for unexpected stock.' using errcode = '23514';
    end if;
  end loop;

  if exists (
    select 1 from public.production_batches b
    where b.production_date <= p_business_date and b.deleted_at is null
      and coalesce((select sum(sm.quantity_delta) from public.stock_movements sm where sm.production_batch_id = b.id and sm.business_date <= p_business_date), 0) > 0
      and not exists (select 1 from jsonb_to_recordset(p_counts) as x(batch_id uuid) where x.batch_id = b.id)
  ) then raise exception 'Count every batch with stock on hand.' using errcode = '23514'; end if;

  -- Counts were checked first; attach them to this immutable closing version.
  v_version := case when v_has_existing then v_existing.version + 1 else 1 end;
  insert into public.daily_closings (business_date, version, status, closed_at, note, created_by)
  values (p_business_date, v_version, 'closed', now(), nullif(trim(p_note), ''), v_actor)
  returning id into v_closing_id;

  for v_row in select batch_id, physical_quantity, adjustment_reason
    from jsonb_to_recordset(p_counts) as x(batch_id uuid, physical_quantity integer, adjustment_reason text)
  loop
    select coalesce(sum(quantity_delta), 0) into v_expected
    from public.stock_movements where production_batch_id = v_row.batch_id and business_date <= p_business_date;
    v_adjustment := greatest(v_row.physical_quantity - v_expected, 0)::integer;
    v_sold := greatest(v_expected - v_row.physical_quantity, 0)::integer;
    insert into public.closing_batch_counts (daily_closing_id, production_batch_id, expected_quantity, physical_remaining_quantity, calculated_sold_quantity, stock_adjustment_quantity, adjustment_reason)
    values (v_closing_id, v_row.batch_id, v_expected::integer, v_row.physical_quantity, v_sold, v_adjustment, nullif(trim(v_row.adjustment_reason), ''));
    if v_sold > 0 then
      insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
      values (v_row.batch_id, p_business_date, 'daily_closing', -v_sold, v_closing_id, 'Sold quantity inferred at closing', v_actor);
    end if;
    if v_adjustment > 0 then
      insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
      values (v_row.batch_id, p_business_date, 'adjustment', v_adjustment, v_closing_id, trim(v_row.adjustment_reason), v_actor);
    end if;
  end loop;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, description, after_data)
  values (
    v_actor,
    'closed',
    'daily_closing',
    v_closing_id,
    'Closed day ' || p_business_date::text,
    jsonb_build_object(
      'business_date', p_business_date,
      'version', v_version,
      'counts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'batch_id', c.production_batch_id,
          'expected', c.expected_quantity,
          'physical_remaining', c.physical_remaining_quantity,
          'inferred_sold', c.calculated_sold_quantity,
          'adjustment', c.stock_adjustment_quantity,
          'adjustment_reason', c.adjustment_reason
        ) order by c.production_batch_id)
        from public.closing_batch_counts c where c.daily_closing_id = v_closing_id
      ), '[]'::jsonb)
    )
  );
  return v_closing_id;
end;
$$;

-- Reopen only the most recent closed day and compensate its movements.
create or replace function public.reopen_canteen_day(p_business_date date)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_closing public.daily_closings%rowtype;
  v_row record;
begin
  if not app_private.is_active_member() then raise exception 'Staff access is required.' using errcode = '42501'; end if;
  if not app_private.has_admin_role() then raise exception 'A manager must reopen a closed day.' using errcode = '42501'; end if;
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
    values (v_row.production_batch_id, p_business_date, 'closing_reversal', -v_row.closing_delta, v_closing.id, 'Closing reversed for reopening', auth.uid());
  end loop;
  update public.daily_closings set status = 'reopened', reopened_at = now(), updated_at = now() where id = v_closing.id;
  return v_closing.id;
end;
$$;

revoke all on function public.close_canteen_day(date, jsonb, text) from public, anon;
revoke all on function public.reopen_canteen_day(date) from public, anon;
grant execute on function public.close_canteen_day(date, jsonb, text) to authenticated;
grant execute on function public.reopen_canteen_day(date) to authenticated;

create or replace view public.v_stock_by_batch
with (security_invoker = true)
as
select b.id, b.menu_id, m.name as menu_name, b.production_date, b.expiry_date,
       coalesce(sum(sm.quantity_delta), 0)::integer as quantity_remaining
from public.production_batches b
join public.menu_items m on m.id = b.menu_id
left join public.stock_movements sm on sm.production_batch_id = b.id
where b.deleted_at is null
group by b.id, b.menu_id, m.name, b.production_date, b.expiry_date;

alter table public.app_members enable row level security;
alter table public.menu_items enable row level security;
alter table public.stores enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.production_batches enable row level security;
alter table public.daily_closings enable row level security;
alter table public.closing_batch_counts enable row level security;
alter table public.stock_movements enable row level security;
alter table public.waste_records enable row level security;
alter table public.settings enable row level security;
alter table public.activity_logs enable row level security;

-- Exposed `public` tables receive explicit role grants and member-specific RLS.
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.app_members to authenticated;
grant select on public.menu_items, public.stores, public.expense_categories, public.expenses,
  public.production_batches, public.waste_records, public.settings to authenticated;
grant insert on public.menu_items, public.stores, public.expense_categories, public.expenses,
  public.production_batches, public.waste_records, public.settings to authenticated;
grant update (name, default_shelf_life_days, active, notes, selling_price, estimated_cost_per_box, deleted_at) on public.menu_items to authenticated;
grant update (name, active, deleted_at) on public.stores to authenticated;
grant update (name, active) on public.expense_categories to authenticated;
grant update (expense_date, store_id, category_id, amount_thb, receipt_url, notes, deleted_at) on public.expenses to authenticated;
grant update (expiry_date, notes, deleted_at) on public.production_batches to authenticated;
grant update (notes, photo_url, deleted_at) on public.waste_records to authenticated;
grant update (value) on public.settings to authenticated;
grant select on public.daily_closings, public.closing_batch_counts, public.stock_movements, public.activity_logs to authenticated;
grant select on public.v_stock_by_batch to authenticated;

create policy app_members_read_self on public.app_members for select to authenticated using (user_id = (select auth.uid()));

create policy menu_items_select_member on public.menu_items for select to authenticated using ((select app_private.is_active_member()));
create policy menu_items_insert_member on public.menu_items for insert to authenticated with check ((select app_private.is_active_member()));
create policy menu_items_update_member on public.menu_items for update to authenticated using ((select app_private.is_active_member())) with check ((select app_private.is_active_member()));

create policy stores_select_member on public.stores for select to authenticated using ((select app_private.is_active_member()));
create policy stores_insert_member on public.stores for insert to authenticated with check ((select app_private.is_active_member()));
create policy stores_update_member on public.stores for update to authenticated using ((select app_private.is_active_member())) with check ((select app_private.is_active_member()));

create policy expense_categories_select_member on public.expense_categories for select to authenticated using ((select app_private.is_active_member()));
create policy expense_categories_insert_member on public.expense_categories for insert to authenticated with check ((select app_private.is_active_member()));
create policy expense_categories_update_member on public.expense_categories for update to authenticated using ((select app_private.is_active_member())) with check ((select app_private.is_active_member()));

create policy expenses_select_member on public.expenses for select to authenticated using ((select app_private.is_active_member()));
create policy expenses_insert_member on public.expenses for insert to authenticated with check ((select app_private.is_active_member()));
create policy expenses_update_member on public.expenses for update to authenticated using ((select app_private.is_active_member())) with check ((select app_private.is_active_member()));

create policy production_batches_select_member on public.production_batches for select to authenticated using ((select app_private.is_active_member()));
create policy production_batches_insert_member on public.production_batches for insert to authenticated with check ((select app_private.is_active_member()));
create policy production_batches_update_member on public.production_batches for update to authenticated using ((select app_private.is_active_member())) with check ((select app_private.is_active_member()));

create policy daily_closings_select_member on public.daily_closings for select to authenticated using ((select app_private.is_active_member()));
create policy closing_batch_counts_select_member on public.closing_batch_counts for select to authenticated using ((select app_private.is_active_member()));
create policy stock_movements_select_member on public.stock_movements for select to authenticated using ((select app_private.is_active_member()));
create policy waste_records_select_member on public.waste_records for select to authenticated using ((select app_private.is_active_member()));
create policy waste_records_insert_member on public.waste_records for insert to authenticated with check ((select app_private.is_active_member()));
create policy waste_records_update_member on public.waste_records for update to authenticated using ((select app_private.is_active_member())) with check ((select app_private.is_active_member()));
create policy settings_select_member on public.settings for select to authenticated using ((select app_private.is_active_member()));
create policy settings_insert_member on public.settings for insert to authenticated with check ((select app_private.is_active_member()));
create policy settings_update_member on public.settings for update to authenticated using ((select app_private.is_active_member())) with check ((select app_private.is_active_member()));
create policy activity_logs_select_member on public.activity_logs for select to authenticated using ((select app_private.is_active_member()));

-- Private photos: members can view/upload/delete only within the app bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('operational-photos', 'operational-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;
create policy operational_photos_read_members on storage.objects for select to authenticated
  using (bucket_id = 'operational-photos' and (select app_private.is_active_member()));
create policy operational_photos_upload_members on storage.objects for insert to authenticated
  with check (bucket_id = 'operational-photos' and (select app_private.is_active_member()));
create policy operational_photos_delete_members on storage.objects for delete to authenticated
  using (bucket_id = 'operational-photos' and (select app_private.is_active_member()));

-- Create only the small, predictable canteen lists. No operational records are seeded.
insert into public.stores (name) values
  ('Makro'), ('Rimping'), ('7-Eleven'), ('Lotus Go Fresh'), ('Online Shopping'), ('Other')
on conflict do nothing;
insert into public.expense_categories (name) values ('Ingredients'), ('Packaging'), ('Other')
on conflict do nothing;
insert into public.settings (key, value) values
  ('kitchen_closing_time', '19:00'),
  ('default_shelf_life_days', '3'),
  ('timezone', 'Asia/Bangkok'),
  ('currency', 'THB')
on conflict (key) do nothing;
delete from public.activity_logs where actor_id is null and entity_type in ('stores', 'expense_categories', 'settings');

-- Keep future tables private unless a later reviewed migration adds grants and RLS.
alter default privileges in schema public revoke all on tables from anon, authenticated;
