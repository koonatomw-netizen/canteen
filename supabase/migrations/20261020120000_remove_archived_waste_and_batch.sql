-- Let an admin remove an archived, unverified waste entry together with its
-- mistaken production batch. Every stock reversal and source snapshot is
-- recorded in the same transaction. Existing simple Remove still preserves
-- stock; this is a separate, explicit batch-level correction.

alter table public.waste_archive_reviews
  drop constraint if exists waste_archive_reviews_stock_ledger_changed_check;

alter table public.waste_archive_reviews
  add constraint waste_archive_reviews_stock_ledger_changed_check
    check (outcome = 'removed' or (outcome = 'verified_waste' and stock_ledger_changed = false));

create or replace function app_private.remove_archived_waste_and_batch(
  p_waste_record_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_batch public.production_batches%rowtype;
  v_target public.waste_records%rowtype;
  v_row public.waste_records%rowtype;
  v_movement_count integer;
  v_movements jsonb;
  v_photos jsonb;
  v_photo_paths text[];
  v_source_snapshot jsonb;
  v_movement_snapshot jsonb;
  v_reviewed_by_name text;
  v_review_id uuid;
  v_now timestamptz := clock_timestamp();
  v_removed_count integer := 0;
  v_removed_quantity bigint := 0;
  v_balance bigint;
begin
  if not app_private.has_app_role(array['admin']) then
    raise exception 'Only a Website Admin can remove an archived waste entry and its batch.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 or length(trim(coalesce(p_reason, ''))) > 500 then
    raise exception 'Enter a removal reason of 3 to 500 characters.' using errcode = '22023';
  end if;

  -- Lock the batch first, matching the order used by stock-writing triggers.
  select production_batch_id into v_batch_id
  from public.waste_records where id = p_waste_record_id;
  if not found then
    raise exception 'This archived waste record is not awaiting review.' using errcode = '23514';
  end if;
  select * into v_batch
  from public.production_batches
  where id = v_batch_id
  for update;
  if not found or v_batch.deleted_at is not null then
    raise exception 'This batch is archived or does not exist.' using errcode = '23503';
  end if;
  select * into v_target
  from public.waste_records
  where id = p_waste_record_id
  for update;
  if not found or v_target.deleted_at is null or not v_target.stock_ledger_preserved_on_archive
     or v_target.archive_review_status <> 'unverified' then
    raise exception 'This archived waste record is not awaiting review.' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.waste_records
    where production_batch_id = v_batch_id
      and stock_ledger_preserved_on_archive
      and deleted_at is not null
      and archive_review_status = 'verified_waste'
  ) then
    raise exception 'This batch has archived waste already verified as real waste.' using errcode = '23514';
  end if;

  perform 1
  from public.waste_records
  where production_batch_id = v_batch_id
    and stock_ledger_preserved_on_archive
    and deleted_at is not null
    and archive_review_status = 'unverified'
  order by id
  for update;

  if exists (
    select 1 from public.waste_records
    where production_batch_id = v_batch_id
      and stock_ledger_preserved_on_archive
      and deleted_at is not null
      and archive_review_status = 'unverified'
      and exists (select 1 from public.waste_archive_reviews ar where ar.waste_record_id = waste_records.id)
  ) then
    raise exception 'An archived waste entry for this batch was already reviewed.' using errcode = '23514';
  end if;

  select coalesce(m.display_name, 'Website Admin') into v_reviewed_by_name
  from public.app_members m where m.user_id = auth.uid();
  v_reviewed_by_name := coalesce(v_reviewed_by_name, 'Website Admin');

  for v_row in
    select * from public.waste_records
    where production_batch_id = v_batch_id
      and stock_ledger_preserved_on_archive
      and deleted_at is not null
      and archive_review_status = 'unverified'
    order by id
  loop
    select count(*)::integer,
           coalesce(jsonb_agg(to_jsonb(sm) order by sm.created_at, sm.id), '[]'::jsonb)
    into v_movement_count, v_movements
    from public.stock_movements sm
    where sm.source_id = v_row.id and sm.production_batch_id = v_batch_id;
    if v_movement_count <> 1 or not exists (
      select 1 from public.stock_movements sm
      where sm.source_id = v_row.id and sm.production_batch_id = v_batch_id
        and sm.movement_type = 'waste' and sm.quantity_delta = -v_row.quantity
    ) then
      raise exception 'An archived entry does not have one matching original stock movement.' using errcode = '23514';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'file_path', p.file_path, 'created_at', p.created_at, 'created_by', p.created_by) order by p.created_at, p.id), '[]'::jsonb)
    into v_photos
    from public.waste_record_photos p where p.waste_record_id = v_row.id;
    select coalesce(array_agg(distinct photo_path), array[]::text[])
    into v_photo_paths
    from (
      select p.file_path as photo_path from public.waste_record_photos p where p.waste_record_id = v_row.id
      union all
      select v_row.photo_url where v_row.photo_url like 'waste/%'
    ) paths;
    v_source_snapshot := to_jsonb(v_row) || jsonb_build_object(
      'photo_metadata', v_photos,
      'photo_paths', to_jsonb(v_photo_paths),
      'stock_movements', v_movements
    );

    v_review_id := gen_random_uuid();
    insert into public.stock_movements (
      production_batch_id, business_date, movement_type, quantity_delta, source_id, reason, created_by
    ) values (
      v_batch_id, v_row.waste_date, 'waste_reversal', v_row.quantity, v_review_id,
      'Archived waste reversed with mistaken batch removal: ' || trim(p_reason), auth.uid()
    );

    select coalesce(jsonb_agg(to_jsonb(sm) order by sm.created_at, sm.id), '[]'::jsonb)
    into v_movement_snapshot
    from public.stock_movements sm
    where sm.production_batch_id = v_batch_id and sm.source_id in (v_row.id, v_review_id);

    insert into public.waste_archive_reviews (
      id, waste_record_id, outcome, waste_date, production_batch_id, quantity, reason, notes,
      created_by_name, archived_at, review_reason, reviewed_at, reviewed_by, reviewed_by_name,
      photo_paths, source_snapshot, stock_movements_snapshot, stock_ledger_changed
    ) values (
      v_review_id, v_row.id, 'removed', v_row.waste_date, v_batch_id, v_row.quantity, v_row.reason, v_row.notes,
      v_row.created_by_name, v_row.deleted_at, trim(p_reason), v_now, auth.uid(), v_reviewed_by_name,
      to_jsonb(v_photo_paths), v_source_snapshot, v_movement_snapshot, true
    );

    delete from public.waste_record_photos where waste_record_id = v_row.id;
    delete from public.waste_records where id = v_row.id;
    insert into public.activity_logs (actor_id, action, entity_type, entity_id, description, before_data, after_data)
    values (
      auth.uid(), 'removed', 'waste_records', v_row.id,
      'Removed archived waste record ' || left(v_row.id::text, 8) || ' with mistaken batch ' || left(v_batch_id::text, 8) || ': ' || trim(p_reason),
      v_source_snapshot,
      jsonb_build_object('review_id', v_review_id, 'outcome', 'removed', 'review_reason', trim(p_reason),
        'reviewed_at', v_now, 'reviewed_by', auth.uid(), 'reviewed_by_name', v_reviewed_by_name,
        'stock_ledger_changed', true, 'waste_movement_reversed', true, 'production_batch_id', v_batch_id)
    );
    v_removed_count := v_removed_count + 1;
    v_removed_quantity := v_removed_quantity + v_row.quantity;
  end loop;

  if v_removed_count = 0 then
    raise exception 'This batch has no unverified archived waste entries to remove.' using errcode = '23514';
  end if;

  select coalesce(sum(quantity_delta), 0) into v_balance
  from public.stock_movements where production_batch_id = v_batch_id;
  if v_balance <> v_batch.quantity_produced then
    raise exception 'This batch has already been sold or adjusted, so it cannot be archived as a wrong entry.' using errcode = '23514';
  end if;

  -- Reuse the existing guarded batch archival workflow. It checks active waste,
  -- after-close removals and closed closing counts, then writes the final
  -- production reversal and audit event.
  perform public.archive_production_batch(v_batch_id, trim(p_reason));

  return jsonb_build_object(
    'outcome', 'batch_removed',
    'production_batch_id', v_batch_id,
    'production_quantity_reversed', v_batch.quantity_produced,
    'archived_waste_records_removed', v_removed_count,
    'archived_waste_quantity_reversed', v_removed_quantity,
    'stock_ledger_net_quantity', 0
  );
end;
$$;

create or replace function public.remove_archived_waste_and_batch(p_waste_record_id uuid, p_reason text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.remove_archived_waste_and_batch(p_waste_record_id, p_reason);
$$;

revoke all on function app_private.remove_archived_waste_and_batch(uuid, text) from public, anon;
grant execute on function app_private.remove_archived_waste_and_batch(uuid, text) to authenticated;
revoke all on function public.remove_archived_waste_and_batch(uuid, text) from public, anon;
grant execute on function public.remove_archived_waste_and_batch(uuid, text) to authenticated;

notify pgrst, 'reload schema';
