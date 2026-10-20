begin;
set local search_path = extensions, public;
select plan(25);

select extensions.ok(not has_function_privilege('anon', 'public.remove_archived_waste_and_batch(uuid,text)', 'EXECUTE'), 'anonymous users cannot remove a batch through the waste review');
select extensions.ok(not has_function_privilege('anon', 'app_private.remove_archived_waste_and_batch(uuid,text)', 'EXECUTE'), 'anonymous users cannot call the internal batch removal worker');
select extensions.ok(not (select prosecdef from pg_proc where oid = 'public.remove_archived_waste_and_batch(uuid,text)'::regprocedure), 'the exposed batch removal RPC runs as invoker');

insert into public.menu_items (id, name, default_shelf_life_days)
values ('00000000-0000-4000-8000-00000000c201', 'Remove archived batch test menu', 3);
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000c211', 'remove-batch-admin@local.test'),
  ('00000000-0000-4000-8000-00000000c212', 'remove-batch-front@local.test');
update public.app_members set display_name = 'Remove Batch Admin', role = 'admin', active = true
where user_id = '00000000-0000-4000-8000-00000000c211';
update public.app_members set display_name = 'Remove Batch Front', role = 'front', active = true
where user_id = '00000000-0000-4000-8000-00000000c212';

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c212', true);
insert into public.production_batches (id, menu_id, meat_option_id, production_date, quantity_produced, expiry_date) values
  ('00000000-0000-4000-8000-00000000c221', '00000000-0000-4000-8000-00000000c201', (select id from public.meat_options where name = 'Beef'), timezone('Asia/Bangkok', now())::date, 10, timezone('Asia/Bangkok', now())::date + 3),
  ('00000000-0000-4000-8000-00000000c222', '00000000-0000-4000-8000-00000000c201', (select id from public.meat_options where name = 'Chicken'), timezone('Asia/Bangkok', now())::date - 1, 10, timezone('Asia/Bangkok', now())::date + 2);
insert into public.waste_records (id, production_batch_id, waste_date, quantity, reason, notes) values
  ('00000000-0000-4000-8000-00000000c231', '00000000-0000-4000-8000-00000000c221', timezone('Asia/Bangkok', now())::date, 2, 'Other', 'Incorrect first row'),
  ('00000000-0000-4000-8000-00000000c232', '00000000-0000-4000-8000-00000000c221', timezone('Asia/Bangkok', now())::date, 3, 'Other', 'Incorrect second row'),
  ('00000000-0000-4000-8000-00000000c233', '00000000-0000-4000-8000-00000000c222', timezone('Asia/Bangkok', now())::date - 1, 2, 'Other', 'Waste for used batch');
insert into public.waste_record_photos (waste_record_id, file_path)
values ('00000000-0000-4000-8000-00000000c232', 'waste/remove-batch-test.jpg');
insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason)
values ('00000000-0000-4000-8000-00000000c222', timezone('Asia/Bangkok', now())::date - 1, 'daily_closing', -1, '00000000-0000-4000-8000-00000000c299', 'Simulated sale before correction');
insert into public.daily_closings (business_date, version, status, closed_at) values
  (timezone('Asia/Bangkok', now())::date, 1, 'closed', now()),
  (timezone('Asia/Bangkok', now())::date - 1, 1, 'closed', now());
insert into public.closing_batch_counts (daily_closing_id, production_batch_id, expected_quantity, physical_remaining_quantity, calculated_sold_quantity)
select id, '00000000-0000-4000-8000-00000000c221', 0, 0, 0
from public.daily_closings where business_date = timezone('Asia/Bangkok', now())::date;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c211', true);
select extensions.is(
  public.archive_other_waste_for_date_preserving_stock(timezone('Asia/Bangkok', now())::date, 2, 5, 'Incorrect front entries'),
  2,
  'the mistaken batch has two stock-preserving archived waste entries'
);
select extensions.is(
  public.archive_other_waste_for_date_preserving_stock(timezone('Asia/Bangkok', now())::date - 1, 1, 2, 'Incorrect front entry'),
  1,
  'the used batch has a stock-preserving archived waste entry'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c212', true);
set local role authenticated;
select extensions.throws_ok(
  $$select public.remove_archived_waste_and_batch('00000000-0000-4000-8000-00000000c231', 'Wrong production batch')$$,
  '42501'::char(5), 'Only a Website Admin can remove an archived waste entry and its batch.'::text,
  'Front cannot remove a batch through archived waste review'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c211', true);
select extensions.is(
  public.remove_archived_waste_and_batch('00000000-0000-4000-8000-00000000c231', 'Incorrect batch entered by mistake') ->> 'outcome',
  'batch_removed',
  'admin can remove a batch whose closed-day snapshot contains only zero quantities'
);
select extensions.is((select count(*)::integer from public.closing_batch_counts c join public.daily_closings dc on dc.id = c.daily_closing_id where c.production_batch_id = '00000000-0000-4000-8000-00000000c221' and dc.status = 'closed'), 1, 'removal preserves the zero-valued closing snapshot for audit');
select extensions.is((select count(*)::integer from public.waste_records where id in ('00000000-0000-4000-8000-00000000c231','00000000-0000-4000-8000-00000000c232')), 0, 'linked operational waste rows are removed');
select extensions.is((select count(*)::integer from public.waste_record_photos where waste_record_id = '00000000-0000-4000-8000-00000000c232'), 0, 'linked operational photo metadata is removed');
select extensions.is((select count(*)::integer from public.waste_archive_reviews where waste_record_id in ('00000000-0000-4000-8000-00000000c231','00000000-0000-4000-8000-00000000c232')), 2, 'both removed waste rows retain audit snapshots');
select extensions.ok((select bool_and(stock_ledger_changed) from public.waste_archive_reviews where waste_record_id in ('00000000-0000-4000-8000-00000000c231','00000000-0000-4000-8000-00000000c232')), 'audit snapshots report that the waste stock effects were reversed');
select extensions.ok(exists (select 1 from public.waste_archive_reviews where waste_record_id = '00000000-0000-4000-8000-00000000c232' and source_snapshot -> 'photo_metadata' -> 0 ->> 'file_path' = 'waste/remove-batch-test.jpg'), 'the removed row retains its private photo metadata in audit');
select extensions.ok(exists (select 1 from public.waste_archive_reviews where waste_record_id = '00000000-0000-4000-8000-00000000c231' and jsonb_array_length(stock_movements_snapshot) = 2), 'the audit snapshot includes the original waste movement and its reversal');
select extensions.ok((select deleted_at is not null and archive_reason = 'Incorrect batch entered by mistake' from public.production_batches where id = '00000000-0000-4000-8000-00000000c221'), 'the production batch is archived with the removal reason');
select extensions.is((select sum(quantity_delta)::integer from public.stock_movements where production_batch_id = '00000000-0000-4000-8000-00000000c221'), 0, 'the removed batch stock ledger nets to zero');
select extensions.ok(not exists (select 1 from public.v_stock_by_batch where id = '00000000-0000-4000-8000-00000000c221'), 'the removed batch leaves current stock');
select extensions.is((select count(*)::integer from public.production_batches where id = '00000000-0000-4000-8000-00000000c221' and deleted_at is null), 0, 'the removed batch is excluded from Produced');
select extensions.is((select count(*)::integer from public.activity_logs where entity_id in ('00000000-0000-4000-8000-00000000c231','00000000-0000-4000-8000-00000000c232') and action = 'removed'), 2, 'each removed waste row has an activity audit entry');
select extensions.ok(exists (select 1 from public.activity_logs where entity_id = '00000000-0000-4000-8000-00000000c221' and action = 'archived' and after_data ->> 'reason' = 'Incorrect batch entered by mistake'), 'the batch removal is separately audited');

select extensions.throws_ok(
  $$select public.remove_archived_waste_and_batch('00000000-0000-4000-8000-00000000c233', 'Incorrect batch entered by mistake')$$,
  '23514'::char(5), 'This batch has already been sold or adjusted, so it cannot be archived as a wrong entry.'::text,
  'a batch with consumed stock cannot be removed'
);
select extensions.ok((select deleted_at is null from public.production_batches where id = '00000000-0000-4000-8000-00000000c222'), 'a used batch remains active after its removal is rejected');
select extensions.ok(exists (select 1 from public.waste_records where id = '00000000-0000-4000-8000-00000000c233' and deleted_at is not null), 'a rejected batch removal leaves its archived waste row intact');
select extensions.ok(not exists (select 1 from public.waste_archive_reviews where waste_record_id = '00000000-0000-4000-8000-00000000c233'), 'a rejected batch removal writes no review row');
select extensions.is((select sum(quantity_delta)::integer from public.stock_movements where production_batch_id = '00000000-0000-4000-8000-00000000c222'), 7, 'a rejected batch removal leaves stock movements unchanged');

select * from extensions.finish();
rollback;
