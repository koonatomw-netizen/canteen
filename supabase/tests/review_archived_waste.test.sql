begin;
set local search_path = extensions, public;
select extensions.plan(23);

select extensions.ok(not has_function_privilege('anon', 'public.verify_archived_waste_as_waste(uuid)', 'EXECUTE'), 'anonymous users cannot verify archived waste');
select extensions.ok(not has_function_privilege('anon', 'public.remove_archived_waste_preserving_stock(uuid,text)', 'EXECUTE'), 'anonymous users cannot permanently remove archived waste');
select extensions.ok(not has_function_privilege('anon', 'app_private.verify_archived_waste_as_waste(uuid)', 'EXECUTE'), 'anonymous users cannot call the internal verification worker');
select extensions.ok(not has_function_privilege('anon', 'app_private.remove_archived_waste_preserving_stock(uuid,text)', 'EXECUTE'), 'anonymous users cannot call the internal removal worker');
select extensions.ok(not (select prosecdef from pg_proc where oid = 'public.verify_archived_waste_as_waste(uuid)'::regprocedure), 'the exposed verification RPC runs as invoker');
select extensions.ok(not (select prosecdef from pg_proc where oid = 'public.remove_archived_waste_preserving_stock(uuid,text)'::regprocedure), 'the exposed removal RPC runs as invoker');

insert into public.menu_items (id, name, default_shelf_life_days)
values ('00000000-0000-4000-8000-00000000c101', 'Archived waste review test menu', 3);
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000c111', 'archive-review-admin@local.test'),
  ('00000000-0000-4000-8000-00000000c112', 'archive-review-front@local.test'),
  ('00000000-0000-4000-8000-00000000c113', 'archive-review-manager@local.test');
update public.app_members set display_name = 'Archive Review Admin', role = 'admin', active = true
where user_id = '00000000-0000-4000-8000-00000000c111';
update public.app_members set display_name = 'Archive Review Front', role = 'front', active = true
where user_id = '00000000-0000-4000-8000-00000000c112';
update public.app_members set display_name = 'Archive Review Manager', role = 'manager', active = true
where user_id = '00000000-0000-4000-8000-00000000c113';

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c112', true);
insert into public.production_batches (id, menu_id, meat_option_id, production_date, quantity_produced, expiry_date)
values ('00000000-0000-4000-8000-00000000c121', '00000000-0000-4000-8000-00000000c101', (select id from public.meat_options where name = 'Beef'), timezone('Asia/Bangkok', now())::date, 10, timezone('Asia/Bangkok', now())::date + 3);
insert into public.waste_records (id, production_batch_id, waste_date, quantity, reason, notes) values
  ('00000000-0000-4000-8000-00000000c131', '00000000-0000-4000-8000-00000000c121', timezone('Asia/Bangkok', now())::date, 2, 'Other', 'Confirmed waste candidate'),
  ('00000000-0000-4000-8000-00000000c132', '00000000-0000-4000-8000-00000000c121', timezone('Asia/Bangkok', now())::date, 3, 'Other', 'Removal candidate');
insert into public.waste_record_photos (waste_record_id, file_path)
values ('00000000-0000-4000-8000-00000000c132', 'waste/archive-review-test.jpg');
insert into public.daily_closings (business_date, version, status, closed_at)
values (timezone('Asia/Bangkok', now())::date, 1, 'closed', now());

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c111', true);
select extensions.is(
  public.archive_other_waste_for_date_preserving_stock(timezone('Asia/Bangkok', now())::date, 2, 5, 'Incorrect front test entries'),
  2,
  'the fixture creates two stock-preserving archived waste rows'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c112', true);
set local role authenticated;
select extensions.throws_ok(
  $$select public.verify_archived_waste_as_waste('00000000-0000-4000-8000-00000000c131')$$::text,
  '42501'::char(5), 'Only a Website Admin can verify an archived waste record.'::text, 'front cannot verify archived waste'::text);
select extensions.throws_ok(
  $$select public.remove_archived_waste_preserving_stock('00000000-0000-4000-8000-00000000c132', 'Wrong entry')$$::text,
  '42501'::char(5), 'Only a Website Admin can remove an archived waste record.'::text, 'front cannot remove archived waste'::text);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c111', true);
select extensions.is(
  public.verify_archived_waste_as_waste('00000000-0000-4000-8000-00000000c131') ->> 'outcome',
  'verified_waste',
  'admin can confirm an archived row as waste'
);
select extensions.is((select archive_review_status from public.waste_records where id = '00000000-0000-4000-8000-00000000c131'), 'verified_waste', 'verified waste keeps its source row and review status');
select extensions.is((select count(*)::integer from public.stock_movements where source_id = '00000000-0000-4000-8000-00000000c131'), 1, 'verification does not add or reverse stock movements');
select extensions.is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-00000000c121'), 5, 'verification leaves current stock unchanged');
select extensions.ok(exists (select 1 from public.activity_logs where entity_id = '00000000-0000-4000-8000-00000000c131' and action = 'verified' and after_data ->> 'stock_ledger_changed' = 'false'), 'verification records an immutable audit event');

select extensions.throws_ok(
  $$select public.remove_archived_waste_preserving_stock('00000000-0000-4000-8000-00000000c131', 'Wrong entry')$$::text,
  '23514'::char(5), 'This archived waste record is not awaiting review.'::text, 'a verified waste row cannot be removed through the unverified-record action'::text
);
select extensions.is(
  public.remove_archived_waste_preserving_stock('00000000-0000-4000-8000-00000000c132', 'Incorrect archived waste entry') ->> 'outcome',
  'removed',
  'admin can remove an unverified operational row'
);
select extensions.ok(not exists (select 1 from public.waste_records where id = '00000000-0000-4000-8000-00000000c132'), 'removal hard-deletes the operational waste row');
select extensions.ok(not exists (select 1 from public.waste_record_photos where waste_record_id = '00000000-0000-4000-8000-00000000c132'), 'removal clears photo metadata so no operational photo rows remain');
select extensions.ok(exists (
  select 1 from public.waste_archive_reviews
  where waste_record_id = '00000000-0000-4000-8000-00000000c132'
    and outcome = 'removed'
    and review_reason = 'Incorrect archived waste entry'
    and source_snapshot -> 'photo_metadata' -> 0 ->> 'file_path' = 'waste/archive-review-test.jpg'
    and jsonb_array_length(stock_movements_snapshot) = 1
    and stock_ledger_changed = false
), 'removal preserves the source, photo metadata, stock movement and reason in its review snapshot');
select extensions.is((select count(*)::integer from public.stock_movements where source_id = '00000000-0000-4000-8000-00000000c132'), 1, 'removal retains the original stock movement');
select extensions.is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-00000000c121'), 5, 'removal leaves current stock unchanged');
select extensions.ok(exists (select 1 from public.activity_logs where entity_id = '00000000-0000-4000-8000-00000000c132' and action = 'removed' and after_data ->> 'stock_movements_preserved' = 'true'), 'removal records an audit event with the preserved stock outcome');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c113', true);
set local role authenticated;
select extensions.is((select count(*)::integer from public.waste_archive_reviews where waste_record_id in ('00000000-0000-4000-8000-00000000c131','00000000-0000-4000-8000-00000000c132')), 2, 'managers can read archive review sources in reports');
reset role;

select * from extensions.finish();
rollback;
