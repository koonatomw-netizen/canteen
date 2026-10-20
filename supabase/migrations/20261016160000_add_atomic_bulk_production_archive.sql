-- Allow Front staff to remove several incorrect batches in one atomic action.
-- Each batch still passes through the existing stock and audit safeguards.

create or replace function public.archive_production_batches(p_batch_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_archived_count integer := 0;
begin
  if not app_private.has_app_role(array['front']) then
    raise exception 'Bulk removal is available to Front staff only.' using errcode = '42501';
  end if;

  if p_batch_ids is null or cardinality(p_batch_ids) < 1 or cardinality(p_batch_ids) > 30 then
    raise exception 'Select between 1 and 30 batches.' using errcode = '22023';
  end if;

  if exists (select 1 from pg_catalog.unnest(p_batch_ids) as selected(batch_id) where batch_id is null) then
    raise exception 'Batch ids cannot contain null values.' using errcode = '22023';
  end if;

  if (select count(*) from pg_catalog.unnest(p_batch_ids)) <>
     (select count(distinct batch_id) from pg_catalog.unnest(p_batch_ids) as selected(batch_id)) then
    raise exception 'Do not select the same batch more than once.' using errcode = '22023';
  end if;

  -- Stable lock order avoids deadlocks if two users submit overlapping selections.
  for v_batch_id in
    select selected.batch_id
    from pg_catalog.unnest(p_batch_ids) as selected(batch_id)
    order by selected.batch_id
  loop
    perform public.archive_production_batch(v_batch_id, 'Front removed an incorrect production entry');
    v_archived_count := v_archived_count + 1;
  end loop;

  return v_archived_count;
end;
$$;

revoke all on function public.archive_production_batches(uuid[]) from public, anon;
grant execute on function public.archive_production_batches(uuid[]) to authenticated;
