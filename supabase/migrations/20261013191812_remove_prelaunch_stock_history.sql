-- Reconcile the owner-approved one-time cleanup that was previously applied
-- directly to the hosted database. Read its immutable audit event so this
-- migration removes only those exact rows; historical backfills entered later
-- are preserved. Menu items, expenses, and prior audit events are untouched.
do $migration$
declare
  v_source_event_id uuid;
  v_batch_ids uuid[];
  v_waste_ids uuid[];
  v_movement_ids uuid[];
  v_closing_ids uuid[];
  v_closing_count_ids uuid[];
  v_post_close_ids uuid[];
  v_deleted_waste_photos integer := 0;
  v_deleted_waste integer := 0;
  v_deleted_post_close integer := 0;
  v_deleted_closing_counts integer := 0;
  v_deleted_closings integer := 0;
  v_deleted_movements integer := 0;
  v_deleted_batches integer := 0;
  v_cleanup_id uuid := gen_random_uuid();
begin
  select
    id,
    coalesce(array(select jsonb_array_elements_text(before_data #> '{record_ids,production_batches}')::uuid), array[]::uuid[]),
    coalesce(array(select jsonb_array_elements_text(before_data #> '{record_ids,waste_records}')::uuid), array[]::uuid[]),
    coalesce(array(select jsonb_array_elements_text(before_data #> '{record_ids,stock_movements}')::uuid), array[]::uuid[]),
    coalesce(array(select jsonb_array_elements_text(before_data #> '{record_ids,daily_closings}')::uuid), array[]::uuid[]),
    coalesce(array(select jsonb_array_elements_text(before_data #> '{record_ids,closing_batch_counts}')::uuid), array[]::uuid[]),
    coalesce(array(select jsonb_array_elements_text(before_data #> '{record_ids,post_close_stock_outs}')::uuid), array[]::uuid[])
  into
    v_source_event_id,
    v_batch_ids,
    v_waste_ids,
    v_movement_ids,
    v_closing_ids,
    v_closing_count_ids,
    v_post_close_ids
  from public.activity_logs
  where entity_type = 'historical_stock_cleanup'
    and action = 'purged'
    and before_data ->> 'cutoff_exclusive' = '2026-10-13'
  order by occurred_at desc
  limit 1;

  if v_source_event_id is null then
    raise exception 'The approved historical cleanup audit event is missing; no data was changed.';
  end if;

  -- The 14 waste rows include the three Oct 13 entries linked to Oct 12
  -- batches. Photo metadata follows those waste records; private storage files
  -- were not part of the recorded cleanup and no photo metadata remained.
  delete from public.waste_record_photos
  where waste_record_id = any(v_waste_ids);
  get diagnostics v_deleted_waste_photos = row_count;

  delete from public.waste_records
  where id = any(v_waste_ids);
  get diagnostics v_deleted_waste = row_count;

  delete from public.post_close_stock_outs
  where id = any(v_post_close_ids);
  get diagnostics v_deleted_post_close = row_count;

  delete from public.closing_batch_counts
  where id = any(v_closing_count_ids);
  get diagnostics v_deleted_closing_counts = row_count;

  delete from public.daily_closings
  where id = any(v_closing_ids);
  get diagnostics v_deleted_closings = row_count;

  delete from public.stock_movements
  where id = any(v_movement_ids);
  get diagnostics v_deleted_movements = row_count;

  delete from public.production_batches
  where id = any(v_batch_ids);
  get diagnostics v_deleted_batches = row_count;

  -- Preserve the original audit evidence and add a migration-run summary.
  insert into public.activity_logs (
    id, action, entity_type, entity_id, description, before_data, after_data
  ) values (
    v_cleanup_id,
    'migration_reconciled',
    'historical_stock_cleanup',
    v_source_event_id,
    case
      when v_deleted_batches + v_deleted_movements + v_deleted_waste
         + v_deleted_waste_photos + v_deleted_post_close
         + v_deleted_closings + v_deleted_closing_counts = 0
      then 'Reconciled the prior stock cleanup; its targeted rows were already absent. Menu items and expenses remain.'
      else 'Removed rows recorded by the prior stock cleanup. Menu items, expenses, and previous audit events remain.'
    end,
    jsonb_build_object(
      'source_audit_event_id', v_source_event_id,
      'cutoff_date', '2026-10-13',
      'targeted_row_counts', jsonb_build_object(
        'production_batches', cardinality(v_batch_ids),
        'stock_movements', cardinality(v_movement_ids),
        'waste_records', cardinality(v_waste_ids),
        'post_close_stock_outs', cardinality(v_post_close_ids),
        'daily_closings', cardinality(v_closing_ids),
        'closing_batch_counts', cardinality(v_closing_count_ids)
      )
    ),
    jsonb_build_object(
      'deleted_now', jsonb_build_object(
        'production_batches', v_deleted_batches,
        'stock_movements', v_deleted_movements,
        'waste_records', v_deleted_waste,
        'waste_record_photos', v_deleted_waste_photos,
        'post_close_stock_outs', v_deleted_post_close,
        'daily_closings', v_deleted_closings,
        'closing_batch_counts', v_deleted_closing_counts
      ),
      'preserved', jsonb_build_array('menu_items', 'expenses', 'existing_activity_logs')
    )
  );
end;
$migration$;
