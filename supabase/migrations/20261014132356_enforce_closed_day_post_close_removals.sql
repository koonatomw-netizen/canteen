-- A post-close stock removal is valid only for a business date whose latest
-- closing version is still closed. The UI uses the same status to select the
-- staff form automatically; enforce the ledger rule here as well.
create or replace function app_private.guard_post_close_stock_out()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_latest_closed_date date;
  v_removal_day_status text;
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
    select status into v_removal_day_status
    from public.daily_closings
    where business_date = new.removal_date
    order by version desc
    limit 1;
    if v_removal_day_status is distinct from 'closed' then
      raise exception 'Close this day before recording a post-close removal.' using errcode = '23514';
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
