-- Hide incorrectly entered Other waste records from current views while
-- preserving their source rows, audit trail, and stock ledger exactly as-is.

alter table public.waste_records
  add column if not exists stock_ledger_preserved_on_archive boolean not null default false;

create or replace function app_private.guard_waste_quantity()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_preserve_archive boolean := false;
begin
  if tg_op = 'UPDATE' then
    if old.deleted_at is not null and new.deleted_at is null and old.stock_ledger_preserved_on_archive then
      raise exception 'This correction archive cannot be restored. Record a new waste entry if needed.' using errcode = '23514';
    end if;
    if coalesce(current_setting('app.waste_archive_preserve_stock', true), 'false') = 'true'
       and app_private.has_app_role(array['admin'])
       and old.deleted_at is null and new.deleted_at is not null
       and lower(trim(old.reason)) = 'other'
       and old.waste_date = nullif(current_setting('app.waste_archive_preserve_date', true), '')::date then
      v_preserve_archive := true;
    end if;
  end if;

  perform 1 from public.production_batches where id = new.production_batch_id and deleted_at is null for update;
  if not found then raise exception 'This batch is archived or does not exist.' using errcode = '23503'; end if;
  if new.waste_date > timezone('Asia/Bangkok', now())::date then
    raise exception 'Waste cannot be recorded for a future day.' using errcode = '22023';
  end if;
  if v_preserve_archive then
    return new;
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
    if coalesce(current_setting('app.waste_archive_preserve_stock', true), 'false') = 'true'
       and app_private.has_app_role(array['admin'])
       and lower(trim(old.reason)) = 'other'
       and old.waste_date = nullif(current_setting('app.waste_archive_preserve_date', true), '')::date then
      return new;
    end if;
    v_delta := old.quantity; v_type := 'waste_reversal';
    insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
    values (old.production_batch_id, old.waste_date, v_type, v_delta, old.id, 'Waste record archived', auth.uid());
  elsif old.deleted_at is not null and new.deleted_at is null then
    if old.stock_ledger_preserved_on_archive then
      raise exception 'This correction archive cannot be restored. Record a new waste entry if needed.' using errcode = '23514';
    end if;
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

create or replace function public.archive_other_waste_for_date_preserving_stock(
  p_waste_date date,
  p_expected_count integer,
  p_expected_boxes integer,
  p_reason text
)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
  v_row public.waste_records%rowtype;
  v_before jsonb;
  v_archived_count integer := 0;
  v_actual_count integer;
  v_actual_boxes integer;
begin
  if not app_private.has_app_role(array['admin']) then
    raise exception 'Only a Website Admin can archive waste without changing stock.' using errcode = '42501';
  end if;
  if p_waste_date is null or p_waste_date > timezone('Asia/Bangkok', now())::date then
    raise exception 'Choose a valid waste date.' using errcode = '22023';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Enter a reason of 3 to 500 characters.' using errcode = '22023';
  end if;
  if p_expected_count is null or p_expected_count < 1 or p_expected_boxes is null or p_expected_boxes < 1 then
    raise exception 'Expected record count and box total must be positive whole numbers.' using errcode = '22023';
  end if;

  perform 1 from public.daily_closings where business_date = p_waste_date and status = 'closed' for update;
  if not found then
    raise exception 'This waste date must be closed before this correction.' using errcode = '23514';
  end if;

  perform 1
  from public.waste_records
  where waste_date = p_waste_date and deleted_at is null and lower(trim(reason)) = 'other'
  order by id for update;

  select count(*)::integer, coalesce(sum(quantity), 0)::integer
  into v_actual_count, v_actual_boxes
  from public.waste_records
  where waste_date = p_waste_date and deleted_at is null and lower(trim(reason)) = 'other';
  if v_actual_count <> p_expected_count or v_actual_boxes <> p_expected_boxes then
    raise exception 'Expected % Other records / % boxes, found % / %.', p_expected_count, p_expected_boxes, v_actual_count, v_actual_boxes using errcode = '23514';
  end if;

  perform pg_catalog.set_config('app.waste_archive_preserve_stock', 'true', true);
  perform pg_catalog.set_config('app.waste_archive_preserve_date', p_waste_date::text, true);
  for v_row in
    select * from public.waste_records
    where waste_date = p_waste_date and deleted_at is null and lower(trim(reason)) = 'other'
    order by id
  loop
    v_before := to_jsonb(v_row);
    update public.waste_records
    set deleted_at = now(), stock_ledger_preserved_on_archive = true
    where id = v_row.id;
    insert into public.activity_logs (actor_id, action, entity_type, entity_id, description, before_data, after_data)
    values (
      auth.uid(),
      'archived',
      'waste_records',
      v_row.id,
      'Archived incorrect Other waste record ' || left(v_row.id::text, 8) || ': ' || v_reason || ' (stock ledger unchanged)',
      v_before,
      jsonb_set(v_before || jsonb_build_object('correction_reason', v_reason, 'stock_ledger_changed', false), '{deleted_at}', to_jsonb(now()), true)
    );
    v_archived_count := v_archived_count + 1;
  end loop;
  perform pg_catalog.set_config('app.waste_archive_preserve_stock', '', true);
  perform pg_catalog.set_config('app.waste_archive_preserve_date', '', true);
  return v_archived_count;
end;
$$;

revoke all on function public.archive_other_waste_for_date_preserving_stock(date, integer, integer, text) from public, anon;
grant execute on function public.archive_other_waste_for_date_preserving_stock(date, integer, integer, text) to authenticated;
