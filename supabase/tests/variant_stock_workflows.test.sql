begin;
select plan(50);

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
select is((select role from public.app_members where user_id = '00000000-0000-4000-8000-000000000001'), 'front', 'new auth accounts receive the Front role as a pending request');
select is((select active from public.app_members where user_id = '00000000-0000-4000-8000-000000000001'), false, 'new auth accounts cannot access the app until an admin activates them');
update public.app_members set display_name = 'Variant workflow test', role = 'front', active = true
where user_id = '00000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

insert into public.production_batches (id, menu_id, meat_option_id, production_date, quantity_produced, expiry_date)
values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', (select id from public.meat_options where name = 'Beef'), timezone('Asia/Bangkok', now())::date, 10, timezone('Asia/Bangkok', now())::date + 3),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000101', (select id from public.meat_options where name = 'Chicken'), timezone('Asia/Bangkok', now())::date, 5, timezone('Asia/Bangkok', now())::date + 3),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000101', (select id from public.meat_options where name = 'Vegan'), timezone('Asia/Bangkok', now())::date - 1, 2, timezone('Asia/Bangkok', now())::date - 1),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000101', (select id from public.meat_options where name = 'Beef'), timezone('Asia/Bangkok', now())::date - 1, 4, timezone('Asia/Bangkok', now())::date + 2),
  ('00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000101', (select id from public.meat_options where name = 'Chicken'), timezone('Asia/Bangkok', now())::date - 1, 2, timezone('Asia/Bangkok', now())::date + 2);

select is((select menu_name_snapshot from public.production_batches where id = '00000000-0000-4000-8000-000000000201'), 'Variant workflow test menu', 'production records snapshot the original menu name');
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

select throws_ok(
  $$select public.close_canteen_day(
    timezone('Asia/Bangkok', now())::date,
    jsonb_build_array(jsonb_build_object(
      'menu_name_snapshot', 'Variant workflow test menu',
      'meat_option_id', (select id from public.meat_options where name = 'Beef'),
      'physical_quantity', 12
    )), null
  )$$,
  '23514', 'Choose a valid reason for unexpected stock.', 'a positive closing discrepancy requires a reason');
select throws_ok(
  $$select public.close_canteen_day(
    timezone('Asia/Bangkok', now())::date,
    jsonb_build_array(jsonb_build_object(
      'menu_name_snapshot', 'Variant workflow test menu',
      'meat_option_id', (select id from public.meat_options where name = 'Beef'),
      'physical_quantity', 8
    )), null
  )$$,
  '23514', 'Count every menu and meat option with stock on hand.', 'closing requires every stocked meat option to be counted');

select set_config(
  'test.variant_closing_counts',
  (
    select jsonb_agg(jsonb_build_object(
      'menu_name_snapshot', counts.menu_name_snapshot,
      'meat_option_id', counts.meat_option_id,
      'physical_quantity', counts.physical_quantity,
      'adjustment_reason', counts.adjustment_reason
    ))::text
    from (
      select b.menu_name_snapshot, b.meat_option_id,
             sum(sm.quantity_delta)::integer as physical_quantity,
             null::text as adjustment_reason
      from public.production_batches b
      join public.stock_movements sm on sm.production_batch_id = b.id
        and sm.business_date <= timezone('Asia/Bangkok', now())::date
      where b.production_date <= timezone('Asia/Bangkok', now())::date
        and b.deleted_at is null
        and b.menu_name_snapshot <> 'Variant workflow test menu'
      group by b.menu_name_snapshot, b.meat_option_id
      having sum(sm.quantity_delta) > 0
      union all
      select 'Variant workflow test menu', (select id from public.meat_options where name = 'Beef'), 8, null::text
      union all
      select 'Variant workflow test menu', (select id from public.meat_options where name = 'Chicken'), 8, 'Other'::text
      union all
      select 'Variant workflow test menu', (select id from public.meat_options where name = 'Vegan'), 1, null::text
    ) counts
  ),
  true
);
select ok(public.close_canteen_day(
  timezone('Asia/Bangkok', now())::date,
  current_setting('test.variant_closing_counts')::jsonb,
  null
) is not null, 'daily closing accepts one total for each stocked menu and meat option');
select is((select calculated_sold_quantity from public.closing_batch_counts where production_batch_id = '00000000-0000-4000-8000-000000000204'), 3, 'closing allocates inferred sold quantity to the oldest production batch first');
select is((select physical_remaining_quantity from public.closing_batch_counts where production_batch_id = '00000000-0000-4000-8000-000000000204'), 1, 'oldest batch retains the remainder after FIFO depletion');
select is((select calculated_sold_quantity from public.closing_batch_counts where production_batch_id = '00000000-0000-4000-8000-000000000201'), 0, 'newer sibling batch is untouched while older stock covers inferred sales');
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000201'), 7, 'batch ledger retains physical stock in the newer beef batch');
select is((select stock_adjustment_quantity from public.closing_batch_counts where production_batch_id = '00000000-0000-4000-8000-000000000202'), 1, 'closing records the explained extra count on the newest chicken batch');
select is((select physical_remaining_quantity from public.closing_batch_counts where production_batch_id = '00000000-0000-4000-8000-000000000205'), 2, 'positive discrepancy is not added to the older chicken batch');
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000203'), 1, 'closing carries the physical remainder of an expired batch');

insert into public.post_close_stock_outs (id, removal_date, production_batch_id, quantity, reason, notes)
values ('00000000-0000-4000-8000-000000000501', timezone('Asia/Bangkok', now())::date, '00000000-0000-4000-8000-000000000201', 2, 'Owner or friend pickup', 'Owner friend collected meal boxes');
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000201'), 5, 'post-close removal reduces only current batch stock');
select is((select quantity::integer from public.waste_records where id = '00000000-0000-4000-8000-000000000301'), 3, 'post-close removal leaves the original waste record and waste total untouched');
select throws_ok(
  $$insert into public.post_close_stock_outs (production_batch_id, quantity, reason, notes)
    values ('00000000-0000-4000-8000-000000000201', 6, 'Owner or friend pickup', 'Too many')$$,
  '23514', 'Only 5 boxes remain in this batch.', 'post-close removal cannot make stock negative');
select throws_ok(
  $$insert into public.post_close_stock_outs (removal_date, production_batch_id, quantity, reason, notes)
    values (timezone('Asia/Bangkok', now())::date - 1, '00000000-0000-4000-8000-000000000201', 1, 'Owner or friend pickup', 'Backdated')$$,
  '23514', 'A post-close removal cannot be backdated before the latest closed day.', 'post-close removal cannot alter a previous closed day');
update public.post_close_stock_outs set deleted_at = now() where id = '00000000-0000-4000-8000-000000000501';
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000201'), 7, 'archiving a stock removal returns it to current stock with an inverse movement');
select ok(exists (
  select 1 from public.activity_logs
  where entity_type = 'post_close_stock_outs' and entity_id = '00000000-0000-4000-8000-000000000501'
    and action = 'updated' and before_data->>'deleted_at' is null and after_data->>'deleted_at' is not null
), 'stock removal archive keeps before and after values in the audit log');
update public.post_close_stock_outs set deleted_at = null where id = '00000000-0000-4000-8000-000000000501';
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000201'), 5, 'restoring a stock removal deducts its quantity again');
select is((select physical_remaining_quantity from public.closing_batch_counts where production_batch_id = '00000000-0000-4000-8000-000000000201'), 7, 'post-close removal does not rewrite the saved physical closing count');

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000002', 'admin-workflow@local.test');
select is((select active from public.app_members where user_id = '00000000-0000-4000-8000-000000000002'), false, 'new admin account also begins as a pending signup');
update public.app_members set display_name = 'Test Website Admin', role = 'admin', active = true
where user_id = '00000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select is(public.permanently_delete_menu('00000000-0000-4000-8000-000000000101'), 'Variant workflow test menu', 'admin can permanently remove a menu with production history');
select is((select menu_id from public.production_batches where id = '00000000-0000-4000-8000-000000000201'), null, 'removing a menu detaches, but keeps, historical batches');
select is((select menu_name_snapshot from public.production_batches where id = '00000000-0000-4000-8000-000000000201'), 'Variant workflow test menu', 'historical batches retain their original menu name after removal');
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000201'), 5, 'stock remains visible after its menu is removed');
select ok(not exists (select 1 from public.menu_items where id = '00000000-0000-4000-8000-000000000101'), 'removed menu configuration is deleted from the database');
select ok(exists (
  select 1 from public.activity_logs
  where entity_type = 'menu_items' and entity_id = '00000000-0000-4000-8000-000000000101'
    and action = 'deleted' and before_data->>'name' = 'Variant workflow test menu' and after_data is null
), 'permanent removal of a menu with history keeps the complete before image in the audit log');
insert into public.menu_items (id, name) values ('00000000-0000-4000-8000-000000000102', 'Unused menu');
select is(public.permanently_delete_menu('00000000-0000-4000-8000-000000000102'), 'Unused menu', 'admin permanently removes an unused menu through the audited workflow');
select ok(exists (
  select 1 from public.activity_logs
  where entity_type = 'menu_items' and entity_id = '00000000-0000-4000-8000-000000000102'
    and action = 'deleted' and before_data->>'name' = 'Unused menu' and after_data is null
), 'removing an unused menu writes its before image to the audit log');

select * from finish();
rollback;
