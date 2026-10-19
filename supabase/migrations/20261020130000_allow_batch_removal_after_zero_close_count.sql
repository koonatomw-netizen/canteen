-- A closed-day batch reference should block removal only when that closing
-- recorded stock, sales, or an adjustment for the batch. An all-zero snapshot
-- has no effect on the closing totals and may remain in place for audit.
-- Front still cannot remove a batch after closing, even when its count is zero.
create or replace function public.archive_production_batch(p_batch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.production_batches%rowtype;
  v_is_admin boolean := app_private.has_admin_role();
  v_is_front boolean := app_private.has_app_role(array['front']);
  v_reason text;
  v_balance bigint;
  v_closed_day date;
begin
  if not v_is_admin and not v_is_front then
    raise exception 'Only Front staff or a Website Admin can remove a production entry.' using errcode = '42501';
  end if;
  if v_is_front and not v_is_admin then
    v_reason := 'Front removed an incorrect production entry';
  else
    v_reason := trim(coalesce(p_reason, ''));
    if length(v_reason) < 3 or length(v_reason) > 500 then
      raise exception 'Enter a reason of 3 to 500 characters.' using errcode = '22023';
    end if;
  end if;

  select * into v_batch from public.production_batches where id = p_batch_id for update;
  if not found or v_batch.deleted_at is not null then
    raise exception 'This batch is archived or does not exist.' using errcode = '23503';
  end if;
  if v_is_front and not v_is_admin and v_batch.production_date <> timezone('Asia/Bangkok', now())::date then
    raise exception 'Front can remove only an entry from today.' using errcode = '42501';
  end if;
  if exists (select 1 from public.waste_records where production_batch_id = p_batch_id and deleted_at is null)
     or exists (select 1 from public.post_close_stock_outs where production_batch_id = p_batch_id and deleted_at is null) then
    if v_is_front and not v_is_admin then
      raise exception 'This entry has been used by waste or after-close stock records.' using errcode = '23514';
    end if;
    raise exception 'This batch has waste or after-close removals. Archive those records first.' using errcode = '23514';
  end if;

  select coalesce(sum(quantity_delta), 0) into v_balance
  from public.stock_movements where production_batch_id = p_batch_id;
  if v_balance <> v_batch.quantity_produced then
    raise exception 'This batch has already been sold or adjusted, so it cannot be archived as a wrong entry.' using errcode = '23514';
  end if;

  select max(dc.business_date) into v_closed_day
  from public.daily_closings dc
  join public.closing_batch_counts c on c.daily_closing_id = dc.id
  where c.production_batch_id = p_batch_id
    and dc.status = 'closed'
    and (
      not v_is_admin
      or c.expected_quantity <> 0
      or c.physical_remaining_quantity <> 0
      or c.calculated_sold_quantity <> 0
      or c.stock_adjustment_quantity <> 0
      or c.adjustment_reason is not null
    );
  if v_closed_day is not null then
    if v_is_front and not v_is_admin then
      raise exception 'This day is closed. Reopen it before removing production.' using errcode = '23514';
    end if;
    raise exception 'A closed day (%) already counted this batch. Reopen it first.', v_closed_day using errcode = '23514';
  end if;

  perform pg_catalog.set_config('app.batch_archive_reason', v_reason, true);
  update public.production_batches
  set deleted_at = now(), archive_reason = v_reason
  where id = p_batch_id;
  perform pg_catalog.set_config('app.batch_archive_reason', '', true);

  insert into public.activity_logs (actor_id, action, entity_type, entity_id, description, before_data, after_data)
  values (
    auth.uid(),
    'archived',
    'production_batches',
    p_batch_id,
    'Archived wrong production batch ' || left(p_batch_id::text, 8) || ': ' || v_reason,
    jsonb_build_object('quantity_remaining', v_balance, 'deleted_at', null),
    jsonb_build_object(
      'reason', v_reason,
      'menu_name', v_batch.menu_name_snapshot,
      'production_date', v_batch.production_date,
      'quantity_reversed', v_balance,
      'reversal_business_date', v_batch.production_date
    )
  );
end;
$$;

revoke all on function public.archive_production_batch(uuid, text) from public, anon;
grant execute on function public.archive_production_batch(uuid, text) to authenticated;
