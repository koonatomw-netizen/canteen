-- Resolve archived waste entries that retained their original stock movement.
-- Verification reclassifies the record as confirmed waste; removal deletes the
-- operational row but preserves an immutable review snapshot and stock ledger.

alter table public.waste_records
  add column archive_review_status text not null default 'unverified'
    check (archive_review_status in ('unverified', 'verified_waste')),
  add column archive_reviewed_at timestamptz,
  add column archive_reviewed_by uuid,
  add column archive_reviewed_by_name text,
  add constraint waste_records_archive_review_metadata_check check (
    (archive_review_status = 'unverified'
      and archive_reviewed_at is null
      and archive_reviewed_by is null
      and archive_reviewed_by_name is null)
    or
    (archive_review_status = 'verified_waste'
      and stock_ledger_preserved_on_archive
      and deleted_at is not null
      and archive_reviewed_at is not null
      and archive_reviewed_by is not null
      and archive_reviewed_by_name is not null)
  );

create table public.waste_archive_reviews (
  id uuid primary key default gen_random_uuid(),
  waste_record_id uuid not null unique,
  outcome text not null check (outcome in ('verified_waste', 'removed')),
  waste_date date not null,
  production_batch_id uuid not null references public.production_batches(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  reason text not null,
  notes text,
  created_by_name text,
  archived_at timestamptz not null,
  review_reason text,
  reviewed_at timestamptz not null default now(),
  reviewed_by uuid not null,
  reviewed_by_name text not null,
  photo_paths jsonb not null default '[]'::jsonb check (jsonb_typeof(photo_paths) = 'array'),
  source_snapshot jsonb not null,
  stock_movements_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(stock_movements_snapshot) = 'array'),
  stock_ledger_changed boolean not null default false check (stock_ledger_changed = false),
  constraint waste_archive_reviews_reason_check check (
    (outcome = 'verified_waste' and review_reason is null)
    or (outcome = 'removed' and length(trim(coalesce(review_reason, ''))) between 3 and 500)
  )
);

create index waste_archive_reviews_date_idx on public.waste_archive_reviews (waste_date desc, outcome);
alter table public.waste_archive_reviews enable row level security;
revoke all on public.waste_archive_reviews from anon, authenticated;
grant select on public.waste_archive_reviews to authenticated;
create policy waste_archive_reviews_read_reports on public.waste_archive_reviews
  for select to authenticated
  using ((select app_private.has_app_role(array['admin', 'manager', 'auditor'])));

comment on table public.waste_archive_reviews is
  'Immutable decision snapshots for archived waste corrections; removed source rows and their stock movements remain auditable.';

create or replace function app_private.verify_archived_waste_as_waste(p_waste_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.waste_records%rowtype;
  v_movement_count integer;
  v_movements jsonb;
  v_photos jsonb;
  v_photo_paths text[];
  v_snapshot jsonb;
  v_reviewed_by_name text;
  v_review_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if not app_private.has_app_role(array['admin']) then
    raise exception 'Only a Website Admin can verify an archived waste record.' using errcode = '42501';
  end if;

  select * into v_row
  from public.waste_records
  where id = p_waste_record_id
  for update;
  if not found or v_row.deleted_at is null or not v_row.stock_ledger_preserved_on_archive
     or v_row.archive_review_status <> 'unverified' then
    raise exception 'This archived waste record is not awaiting review.' using errcode = '23514';
  end if;

  select count(*)::integer,
         coalesce(jsonb_agg(to_jsonb(sm) order by sm.created_at, sm.id), '[]'::jsonb)
  into v_movement_count, v_movements
  from public.stock_movements sm
  where sm.source_id = v_row.id;
  if v_movement_count <> 1
     or not exists (
       select 1 from public.stock_movements sm
       where sm.source_id = v_row.id
         and sm.movement_type = 'waste'
         and sm.quantity_delta = -v_row.quantity
     ) then
    raise exception 'The archived entry does not have one matching original stock movement.' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'file_path', p.file_path, 'created_at', p.created_at, 'created_by', p.created_by) order by p.created_at, p.id), '[]'::jsonb)
  into v_photos
  from public.waste_record_photos p
  where p.waste_record_id = v_row.id;
  select coalesce(array_agg(distinct photo_path), array[]::text[])
  into v_photo_paths
  from (
    select p.file_path as photo_path from public.waste_record_photos p where p.waste_record_id = v_row.id
    union all
    select v_row.photo_url where v_row.photo_url like 'waste/%'
  ) paths;
  v_snapshot := to_jsonb(v_row) || jsonb_build_object(
    'photo_metadata', v_photos,
    'photo_paths', to_jsonb(v_photo_paths),
    'stock_movements', v_movements
  );

  select coalesce(m.display_name, 'Website Admin') into v_reviewed_by_name
  from public.app_members m where m.user_id = auth.uid();
  v_reviewed_by_name := coalesce(v_reviewed_by_name, 'Website Admin');

  insert into public.waste_archive_reviews (
    waste_record_id, outcome, waste_date, production_batch_id, quantity, reason, notes,
    created_by_name, archived_at, reviewed_at, reviewed_by, reviewed_by_name,
    photo_paths, source_snapshot, stock_movements_snapshot, stock_ledger_changed
  ) values (
    v_row.id, 'verified_waste', v_row.waste_date, v_row.production_batch_id, v_row.quantity, v_row.reason, v_row.notes,
    v_row.created_by_name, v_row.deleted_at, v_now, auth.uid(), v_reviewed_by_name,
    to_jsonb(v_photo_paths), v_snapshot, v_movements, false
  ) returning id into v_review_id;

  update public.waste_records
  set archive_review_status = 'verified_waste', archive_reviewed_at = v_now,
      archive_reviewed_by = auth.uid(), archive_reviewed_by_name = v_reviewed_by_name
  where id = v_row.id;

  insert into public.activity_logs (actor_id, action, entity_type, entity_id, description, before_data, after_data)
  values (
    auth.uid(), 'verified', 'waste_records', v_row.id,
    'Verified archived waste record ' || left(v_row.id::text, 8) || ' as confirmed waste (stock ledger unchanged)',
    v_snapshot,
    jsonb_build_object('review_id', v_review_id, 'outcome', 'verified_waste', 'reviewed_at', v_now,
      'reviewed_by', auth.uid(), 'reviewed_by_name', v_reviewed_by_name, 'stock_ledger_changed', false)
  );

  return jsonb_build_object('review_id', v_review_id, 'outcome', 'verified_waste', 'stock_ledger_changed', false);
end;
$$;

create or replace function app_private.remove_archived_waste_preserving_stock(p_waste_record_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
  v_row public.waste_records%rowtype;
  v_movement_count integer;
  v_movements jsonb;
  v_photos jsonb;
  v_photo_paths text[];
  v_snapshot jsonb;
  v_reviewed_by_name text;
  v_review_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if not app_private.has_app_role(array['admin']) then
    raise exception 'Only a Website Admin can remove an archived waste record.' using errcode = '42501';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Enter a removal reason of 3 to 500 characters.' using errcode = '22023';
  end if;

  select * into v_row
  from public.waste_records
  where id = p_waste_record_id
  for update;
  if not found or v_row.deleted_at is null or not v_row.stock_ledger_preserved_on_archive
     or v_row.archive_review_status <> 'unverified' then
    raise exception 'This archived waste record is not awaiting review.' using errcode = '23514';
  end if;

  select count(*)::integer,
         coalesce(jsonb_agg(to_jsonb(sm) order by sm.created_at, sm.id), '[]'::jsonb)
  into v_movement_count, v_movements
  from public.stock_movements sm
  where sm.source_id = v_row.id;
  if v_movement_count <> 1
     or not exists (
       select 1 from public.stock_movements sm
       where sm.source_id = v_row.id
         and sm.movement_type = 'waste'
         and sm.quantity_delta = -v_row.quantity
     ) then
    raise exception 'The archived entry does not have one matching original stock movement.' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'file_path', p.file_path, 'created_at', p.created_at, 'created_by', p.created_by) order by p.created_at, p.id), '[]'::jsonb)
  into v_photos
  from public.waste_record_photos p
  where p.waste_record_id = v_row.id;
  select coalesce(array_agg(distinct photo_path), array[]::text[])
  into v_photo_paths
  from (
    select p.file_path as photo_path from public.waste_record_photos p where p.waste_record_id = v_row.id
    union all
    select v_row.photo_url where v_row.photo_url like 'waste/%'
  ) paths;
  v_snapshot := to_jsonb(v_row) || jsonb_build_object(
    'photo_metadata', v_photos,
    'photo_paths', to_jsonb(v_photo_paths),
    'stock_movements', v_movements
  );

  select coalesce(m.display_name, 'Website Admin') into v_reviewed_by_name
  from public.app_members m where m.user_id = auth.uid();
  v_reviewed_by_name := coalesce(v_reviewed_by_name, 'Website Admin');

  insert into public.waste_archive_reviews (
    waste_record_id, outcome, waste_date, production_batch_id, quantity, reason, notes,
    created_by_name, archived_at, review_reason, reviewed_at, reviewed_by, reviewed_by_name,
    photo_paths, source_snapshot, stock_movements_snapshot, stock_ledger_changed
  ) values (
    v_row.id, 'removed', v_row.waste_date, v_row.production_batch_id, v_row.quantity, v_row.reason, v_row.notes,
    v_row.created_by_name, v_row.deleted_at, v_reason, v_now, auth.uid(), v_reviewed_by_name,
    to_jsonb(v_photo_paths), v_snapshot, v_movements, false
  ) returning id into v_review_id;

  delete from public.waste_record_photos where waste_record_id = v_row.id;
  delete from public.waste_records where id = v_row.id;

  insert into public.activity_logs (actor_id, action, entity_type, entity_id, description, before_data, after_data)
  values (
    auth.uid(), 'removed', 'waste_records', v_row.id,
    'Removed archived waste record ' || left(v_row.id::text, 8) || ': ' || v_reason || ' (stock ledger unchanged)',
    v_snapshot,
    jsonb_build_object('review_id', v_review_id, 'outcome', 'removed', 'review_reason', v_reason,
      'reviewed_at', v_now, 'reviewed_by', auth.uid(), 'reviewed_by_name', v_reviewed_by_name,
      'stock_ledger_changed', false, 'stock_movements_preserved', true)
  );

  return jsonb_build_object(
    'review_id', v_review_id,
    'outcome', 'removed',
    'stock_ledger_changed', false,
    'photo_paths', to_jsonb(v_photo_paths)
  );
end;
$$;

-- Keep the privileged workers in the non-exposed schema. The public RPC
-- endpoints run as invokers and delegate only after authenticated callers
-- pass the explicit admin-role check inside the workers.
create or replace function public.verify_archived_waste_as_waste(p_waste_record_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.verify_archived_waste_as_waste(p_waste_record_id);
$$;

create or replace function public.remove_archived_waste_preserving_stock(p_waste_record_id uuid, p_reason text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.remove_archived_waste_preserving_stock(p_waste_record_id, p_reason);
$$;

revoke all on function app_private.verify_archived_waste_as_waste(uuid) from public, anon;
grant execute on function app_private.verify_archived_waste_as_waste(uuid) to authenticated;
revoke all on function app_private.remove_archived_waste_preserving_stock(uuid, text) from public, anon;
grant execute on function app_private.remove_archived_waste_preserving_stock(uuid, text) to authenticated;
revoke all on function public.verify_archived_waste_as_waste(uuid) from public, anon;
grant execute on function public.verify_archived_waste_as_waste(uuid) to authenticated;
revoke all on function public.remove_archived_waste_preserving_stock(uuid, text) from public, anon;
grant execute on function public.remove_archived_waste_preserving_stock(uuid, text) to authenticated;

notify pgrst, 'reload schema';
