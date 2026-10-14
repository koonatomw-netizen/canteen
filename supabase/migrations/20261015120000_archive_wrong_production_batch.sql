-- Let a Website Admin archive a production batch that was entered by mistake
-- (test entry, wrong menu, wrong quantity) while it still has stock.
--
-- Safety rules:
-- * Only a batch nobody has used yet: no active waste or after-close removal,
--   and its ledger still equals the quantity produced.
-- * No closed day may have counted it. Closings are history; reopen those days
--   first, exactly as for other corrections.
-- * The reversing movement is dated on the batch's production date, so the
--   batch nets to zero on every day and no other day's stock changes.
-- * The batch is soft-deleted, the reason is kept on the row, and an explicit
--   activity event records who archived it and why.

alter table public.production_batches
  add column if not exists archive_reason text
  check (archive_reason is null or length(trim(archive_reason)) between 3 and 500);

-- Same behaviour as before, plus one branch: when archive_production_batch()
-- sets app.batch_archive_reason for this transaction, reverse the remaining
-- balance on the production date instead of refusing.
create or replace function app_private.track_batch_stock()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_archive_reason text := nullif(current_setting('app.batch_archive_reason', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
    values (new.id, new.production_date, 'production', new.quantity_produced, new.id, 'Production recorded', coalesce(new.created_by, auth.uid()));
    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    select coalesce(sum(quantity_delta), 0) into v_balance
    from public.stock_movements where production_batch_id = old.id;
    if v_archive_reason is not null and app_private.has_admin_role() then
      if v_balance <> 0 then
        insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
        values (old.id, old.production_date, 'production_reversal', -v_balance, old.id, 'Wrong entry archived: ' || v_archive_reason, auth.uid());
      end if;
      return new;
    end if;
    if v_balance <> 0 then
      raise exception 'A batch with stock remaining cannot be archived. Record its final count first.' using errcode = '23514';
    end if;
    insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
    values (old.id, timezone('Asia/Bangkok', now())::date, 'production_reversal', -old.quantity_produced, old.id, 'Empty batch archived', auth.uid());
  elsif old.deleted_at is not null and new.deleted_at is null then
    -- Its stock was reversed on the production date; restoring it today would
    -- put boxes back on the wrong day. Record the production again instead.
    if old.archive_reason is not null then
      raise exception 'A batch archived as a wrong entry cannot be restored. Record the production again.' using errcode = '23514';
    end if;
    insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by)
    values (new.id, timezone('Asia/Bangkok', now())::date, 'production', new.quantity_produced, new.id, 'Batch restored', auth.uid());
  end if;
  return new;
end;
$$;

create or replace function public.archive_production_batch(p_batch_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch public.production_batches%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
  v_balance bigint;
  v_closed_day date;
begin
  if not app_private.has_admin_role() then
    raise exception 'Only a Website Admin can archive a production batch.' using errcode = '42501';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Enter a reason of 3 to 500 characters.' using errcode = '22023';
  end if;

  select * into v_batch from public.production_batches where id = p_batch_id for update;
  if not found or v_batch.deleted_at is not null then
    raise exception 'This batch is archived or does not exist.' using errcode = '23503';
  end if;

  if exists (select 1 from public.waste_records where production_batch_id = p_batch_id and deleted_at is null)
     or exists (select 1 from public.post_close_stock_outs where production_batch_id = p_batch_id and deleted_at is null) then
    raise exception 'This batch has waste or after-close removals. Archive those records first.' using errcode = '23514';
  end if;

  select coalesce(sum(quantity_delta), 0) into v_balance
  from public.stock_movements where production_batch_id = p_batch_id;
  if v_balance <> v_batch.quantity_produced then
    raise exception 'This batch has already been sold or adjusted, so it cannot be archived as a wrong entry.' using errcode = '23514';
  end if;

  select latest.business_date into v_closed_day
  from (
    select distinct on (business_date) business_date, status
    from public.daily_closings
    where business_date >= v_batch.production_date
    order by business_date, version desc
  ) latest
  where latest.status = 'closed'
  order by latest.business_date desc
  limit 1;
  if v_closed_day is not null then
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
