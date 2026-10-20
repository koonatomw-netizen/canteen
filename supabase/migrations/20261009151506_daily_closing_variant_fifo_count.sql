-- Staff enter one physical count per menu-name snapshot and meat option.
-- Inferred sales are allocated to the oldest production batch first; a
-- positive stock discrepancy is attributed to the newest batch.
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
  v_batch record;
  v_batch_count integer;
  v_expected bigint;
  v_sold_remaining bigint;
  v_adjustment integer;
  v_batch_sold integer;
  v_batch_adjustment integer;
  v_batch_physical integer;
  v_reason text;
  v_latest_batch_id uuid;
  v_actor uuid := auth.uid();
begin
  if not app_private.is_active_member() then raise exception 'Staff access is required.' using errcode = '42501'; end if;
  if p_business_date is null or p_business_date > timezone('Asia/Bangkok', now())::date then
    raise exception 'A future day cannot be closed.' using errcode = '22023';
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'array' then raise exception 'Menu and meat counts must be a list.' using errcode = '22023'; end if;
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
    select 1
    from jsonb_to_recordset(p_counts) as x(menu_name_snapshot text, meat_option_id uuid, physical_quantity integer, adjustment_reason text)
    group by menu_name_snapshot, meat_option_id
    having count(*) > 1
  ) then raise exception 'Each menu and meat option can be counted once.' using errcode = '22023'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_counts) as x(menu_name_snapshot text, meat_option_id uuid, physical_quantity integer, adjustment_reason text)
    where nullif(trim(menu_name_snapshot), '') is null or physical_quantity is null or physical_quantity < 0
  ) then raise exception 'Enter a whole number of zero or more for every menu and meat option.' using errcode = '22023'; end if;

  -- Lock eligible batches so closing cannot race with waste or other stock movements.
  perform 1 from public.production_batches b
  where b.production_date <= p_business_date and b.deleted_at is null
  order by b.id for update;

  if exists (
    select 1 from public.production_batches b
    where b.production_date <= p_business_date and b.deleted_at is null
      and coalesce((
        select sum(sm.quantity_delta) from public.stock_movements sm
        where sm.production_batch_id = b.id and sm.business_date <= p_business_date
      ), 0) < 0
  ) then raise exception 'A batch cannot close with negative stock.' using errcode = '23514'; end if;

  -- Validate every submitted menu/variant and require a reason for gains.
  for v_row in
    select menu_name_snapshot, meat_option_id, physical_quantity, adjustment_reason
    from jsonb_to_recordset(p_counts) as x(menu_name_snapshot text, meat_option_id uuid, physical_quantity integer, adjustment_reason text)
  loop
    select count(*)::integer,
           coalesce(sum((
             select coalesce(sum(sm.quantity_delta), 0)
             from public.stock_movements sm
             where sm.production_batch_id = b.id and sm.business_date <= p_business_date
           )), 0)
      into v_batch_count, v_expected
    from public.production_batches b
    where b.production_date <= p_business_date and b.deleted_at is null
      and b.menu_name_snapshot = v_row.menu_name_snapshot
      and b.meat_option_id is not distinct from v_row.meat_option_id;

    if v_batch_count = 0 then raise exception 'One of these menu and meat options is not available for this day.' using errcode = '23503'; end if;

    v_adjustment := greatest(v_row.physical_quantity - v_expected, 0)::integer;
    v_reason := nullif(trim(v_row.adjustment_reason), '');
    if v_adjustment > 0 and (v_reason is null or v_reason not in ('Counting correction', 'Staff meal', 'Complimentary', 'Missing/unrecorded', 'Other')) then
      raise exception 'Choose a valid reason for unexpected stock.' using errcode = '23514';
    end if;
  end loop;

  -- Every variant with ledger stock on hand must have exactly one aggregate count.
  if exists (
    select 1
    from (
      select b.menu_name_snapshot, b.meat_option_id,
             coalesce(sum((
               select coalesce(sum(sm.quantity_delta), 0)
               from public.stock_movements sm
               where sm.production_batch_id = b.id and sm.business_date <= p_business_date
             )), 0) as quantity_available
      from public.production_batches b
      where b.production_date <= p_business_date and b.deleted_at is null
      group by b.menu_name_snapshot, b.meat_option_id
    ) variants
    where variants.quantity_available > 0
      and not exists (
        select 1
        from jsonb_to_recordset(p_counts) as x(menu_name_snapshot text, meat_option_id uuid, physical_quantity integer, adjustment_reason text)
        where x.menu_name_snapshot = variants.menu_name_snapshot
          and x.meat_option_id is not distinct from variants.meat_option_id
      )
  ) then raise exception 'Count every menu and meat option with stock on hand.' using errcode = '23514'; end if;

  -- Counts were checked first; attach them to this immutable closing version.
  v_version := case when v_has_existing then v_existing.version + 1 else 1 end;
  insert into public.daily_closings (business_date, version, status, closed_at, note, created_by)
  values (p_business_date, v_version, 'closed', now(), nullif(trim(p_note), ''), v_actor)
  returning id into v_closing_id;

  for v_row in
    select menu_name_snapshot, meat_option_id, physical_quantity, adjustment_reason
    from jsonb_to_recordset(p_counts) as x(menu_name_snapshot text, meat_option_id uuid, physical_quantity integer, adjustment_reason text)
  loop
    select coalesce(sum((
             select coalesce(sum(sm.quantity_delta), 0)
             from public.stock_movements sm
             where sm.production_batch_id = b.id and sm.business_date <= p_business_date
           )), 0)
      into v_expected
    from public.production_batches b
    where b.production_date <= p_business_date and b.deleted_at is null
      and b.menu_name_snapshot = v_row.menu_name_snapshot
      and b.meat_option_id is not distinct from v_row.meat_option_id;

    v_sold_remaining := greatest(v_expected - v_row.physical_quantity, 0);
    v_adjustment := greatest(v_row.physical_quantity - v_expected, 0)::integer;
    v_reason := nullif(trim(v_row.adjustment_reason), '');

    select b.id into v_latest_batch_id
    from public.production_batches b
    where b.production_date <= p_business_date and b.deleted_at is null
      and b.menu_name_snapshot = v_row.menu_name_snapshot
      and b.meat_option_id is not distinct from v_row.meat_option_id
    order by b.production_date desc, b.created_at desc, b.id desc
    limit 1;

    -- FIFO applies only to closing-inferred sales. Physical counts stay
    -- aggregate in the UI, while the ledger still records movements by batch.
    for v_batch in
      select b.id as batch_id, b.production_date, b.created_at,
             coalesce(sum(sm.quantity_delta), 0)::bigint as expected_quantity
      from public.production_batches b
      left join public.stock_movements sm
        on sm.production_batch_id = b.id and sm.business_date <= p_business_date
      where b.production_date <= p_business_date and b.deleted_at is null
        and b.menu_name_snapshot = v_row.menu_name_snapshot
        and b.meat_option_id is not distinct from v_row.meat_option_id
      group by b.id, b.production_date, b.created_at
      order by b.production_date, b.created_at, b.id
    loop
      v_batch_sold := least(v_batch.expected_quantity, v_sold_remaining)::integer;
      v_sold_remaining := v_sold_remaining - v_batch_sold;
      v_batch_adjustment := case when v_batch.batch_id = v_latest_batch_id then v_adjustment else 0 end;
      v_batch_physical := (v_batch.expected_quantity - v_batch_sold + v_batch_adjustment)::integer;

      insert into public.closing_batch_counts (daily_closing_id, production_batch_id, expected_quantity, physical_remaining_quantity, calculated_sold_quantity, stock_adjustment_quantity, adjustment_reason)
      values (
        v_closing_id,
        v_batch.batch_id,
        v_batch.expected_quantity::integer,
        v_batch_physical,
        v_batch_sold,
        v_batch_adjustment,
        case when v_batch_adjustment > 0 then v_reason else null end
      );

      if v_batch_sold > 0 then
        insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
        values (v_batch.batch_id, p_business_date, 'daily_closing', -v_batch_sold, v_closing_id, 'Sold quantity inferred at closing (oldest batch first)', v_actor);
      end if;
      if v_batch_adjustment > 0 then
        insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
        values (v_batch.batch_id, p_business_date, 'adjustment', v_batch_adjustment, v_closing_id, trim(v_reason), v_actor);
      end if;
    end loop;

    if v_sold_remaining <> 0 then raise exception 'Could not allocate the inferred sold quantity to batches.' using errcode = '23514'; end if;
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
      'counting_method', 'menu_and_meat_variant_total',
      'sales_allocation', 'oldest_production_batch_first',
      'positive_adjustment_allocation', 'newest_production_batch',
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

revoke all on function public.close_canteen_day(date, jsonb, text) from public, anon;
grant execute on function public.close_canteen_day(date, jsonb, text) to authenticated;
