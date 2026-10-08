begin;
select plan(26);

select is((select count(*)::integer from public.meat_options where active), 4, 'the shared starting list has four active meat options');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.meat_options'::regclass), 'meat options have RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.waste_record_photos'::regclass), 'waste photos have RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.expense_receipt_photos'::regclass), 'receipt photos have RLS');
select ok(not has_table_privilege('anon', 'public.meat_options', 'SELECT'), 'anonymous users cannot read meat options');
select ok(not has_table_privilege('anon', 'public.waste_record_photos', 'SELECT'), 'anonymous users cannot read waste photo metadata');
select ok(not has_table_privilege('anon', 'public.expense_receipt_photos', 'SELECT'), 'anonymous users cannot read receipt photo metadata');
select ok(not has_table_privilege('authenticated', 'public.waste_record_photos', 'DELETE'), 'staff cannot delete waste photo metadata directly');
select ok(not (select public from storage.buckets where id = 'operational-photos'), 'operational photos remain in a private bucket');

insert into public.menu_items (id, name, default_shelf_life_days)
values ('00000000-0000-4000-8000-000000000101', 'Variant workflow test menu', 3);

select throws_ok(
  $$insert into public.production_batches (menu_id, production_date, quantity_produced, expiry_date)
    values ('00000000-0000-4000-8000-000000000101', timezone('Asia/Bangkok', now())::date, 1, timezone('Asia/Bangkok', now())::date + 3)$$,
  '23514', 'Choose an active meat option.', 'production requires a meat option');

update public.meat_options set active = false where name = 'Pork';
select throws_ok(
  $$insert into public.production_batches (menu_id, meat_option_id, production_date, quantity_produced, expiry_date)
    values ('00000000-0000-4000-8000-000000000101', (select id from public.meat_options where name = 'Pork'), timezone('Asia/Bangkok', now())::date, 1, timezone('Asia/Bangkok', now())::date + 3)$$,
  '23514', 'Choose an active meat option.', 'production rejects an inactive meat option');
update public.meat_options set active = true where name = 'Pork';

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000001', 'variant-workflow@local.test');
insert into public.app_members (user_id, display_name, role)
values ('00000000-0000-4000-8000-000000000001', 'Variant workflow test', 'manager');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

insert into public.production_batches (id, menu_id, meat_option_id, production_date, quantity_produced, expiry_date)
values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', (select id from public.meat_options where name = 'Beef'), timezone('Asia/Bangkok', now())::date, 10, timezone('Asia/Bangkok', now())::date + 3),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000101', (select id from public.meat_options where name = 'Chicken'), timezone('Asia/Bangkok', now())::date, 5, timezone('Asia/Bangkok', now())::date + 3),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000101', (select id from public.meat_options where name = 'Vegan'), timezone('Asia/Bangkok', now())::date - 1, 2, timezone('Asia/Bangkok', now())::date - 1);

select ok(exists (select 1 from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000203' and menu_name = 'Variant workflow test menu · Vegan' and quantity_remaining = 2), 'expired carried stock stays visible as a separate variant batch');

insert into public.waste_records (id, production_batch_id, quantity, reason)
values ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 3, 'Spoiled');
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000201'), 7, 'waste reduces only its selected batch');
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000202'), 5, 'a sibling meat variant keeps its own stock');
select throws_ok(
  $$insert into public.waste_records (production_batch_id, quantity, reason)
    values ('00000000-0000-4000-8000-000000000201', 8, 'Spoiled')$$,
  '23514', 'Only 7 boxes are available in this batch.', 'waste cannot exceed batch stock');

insert into public.waste_record_photos (waste_record_id, file_path)
values
  ('00000000-0000-4000-8000-000000000301', 'waste/00000000-0000-4000-8000-000000000301/one.jpg'),
  ('00000000-0000-4000-8000-000000000301', 'waste/00000000-0000-4000-8000-000000000301/two.jpg');
select is((select count(*)::integer from public.waste_record_photos where waste_record_id = '00000000-0000-4000-8000-000000000301'), 2, 'a waste record can have multiple private photos');

insert into public.expenses (id, store_id, category_id, amount_thb)
values (
  '00000000-0000-4000-8000-000000000401',
  (select id from public.stores order by name limit 1),
  (select id from public.expense_categories order by name limit 1),
  100
);
insert into public.expense_receipt_photos (expense_id, file_path)
values
  ('00000000-0000-4000-8000-000000000401', 'receipts/00000000-0000-4000-8000-000000000401/one.jpg'),
  ('00000000-0000-4000-8000-000000000401', 'receipts/00000000-0000-4000-8000-000000000401/two.jpg');
select is((select count(*)::integer from public.expense_receipt_photos where expense_id = '00000000-0000-4000-8000-000000000401'), 2, 'an expense can have multiple private receipt photos');

update public.waste_records set deleted_at = now() where id = '00000000-0000-4000-8000-000000000301';
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000201'), 10, 'archiving waste reverses its stock movement');
select ok(exists (
  select 1 from public.activity_logs
  where entity_type = 'waste_records' and entity_id = '00000000-0000-4000-8000-000000000301'
    and action = 'updated' and before_data->>'deleted_at' is null and after_data->>'deleted_at' is not null
), 'waste archive keeps before and after values in the audit log');
update public.waste_records set deleted_at = null where id = '00000000-0000-4000-8000-000000000301';
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000201'), 7, 'restoring waste reapplies the batch deduction');

select ok(public.close_canteen_day(
  timezone('Asia/Bangkok', now())::date,
  jsonb_build_array(
    jsonb_build_object('batch_id', '00000000-0000-4000-8000-000000000201', 'physical_quantity', 5),
    jsonb_build_object('batch_id', '00000000-0000-4000-8000-000000000202', 'physical_quantity', 6, 'adjustment_reason', 'Other'),
    jsonb_build_object('batch_id', '00000000-0000-4000-8000-000000000203', 'physical_quantity', 1)
  ), null
) is not null, 'daily closing saves counts for carried and new variant batches');
select is((select calculated_sold_quantity from public.closing_batch_counts where production_batch_id = '00000000-0000-4000-8000-000000000201'), 2, 'closing derives sold quantity from available minus physical count');
select is((select stock_adjustment_quantity from public.closing_batch_counts where production_batch_id = '00000000-0000-4000-8000-000000000202'), 1, 'closing records an explained positive discrepancy');
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000203'), 1, 'closing carries the physical remainder of an expired batch');

select throws_ok(
  $$delete from public.menu_items where id = '00000000-0000-4000-8000-000000000101'$$,
  '23503',
  'update or delete on table "menu_items" violates foreign key constraint "production_batches_menu_id_fkey" on table "production_batches"',
  'menu history prevents permanent removal');
insert into public.menu_items (id, name) values ('00000000-0000-4000-8000-000000000102', 'Unused menu');
delete from public.menu_items where id = '00000000-0000-4000-8000-000000000102';
select ok(exists (
  select 1 from public.activity_logs
  where entity_type = 'menu_items' and entity_id = '00000000-0000-4000-8000-000000000102'
    and action = 'deleted' and before_data->>'name' = 'Unused menu' and after_data is null
), 'removing an unused menu writes its before image to the audit log');

select * from finish();
rollback;
