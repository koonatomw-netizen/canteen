begin;
select plan(23);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000006101', 'front-role@local.test'),
  ('00000000-0000-4000-8000-000000006102', 'kitchen-role@local.test'),
  ('00000000-0000-4000-8000-000000006103', 'manager-role@local.test'),
  ('00000000-0000-4000-8000-000000006104', 'admin-role@local.test');

select is((select role from public.app_members where user_id = '00000000-0000-4000-8000-000000006101'), 'front', 'new accounts start with the Front role');
select is((select active from public.app_members where user_id = '00000000-0000-4000-8000-000000006101'), false, 'new accounts require admin activation');

update public.app_members set display_name = 'Front tester', role = 'front', active = true where user_id = '00000000-0000-4000-8000-000000006101';
update public.app_members set display_name = 'Kitchen tester', role = 'kitchen', active = true where user_id = '00000000-0000-4000-8000-000000006102';
update public.app_members set display_name = 'Manager tester', role = 'manager', active = true where user_id = '00000000-0000-4000-8000-000000006103';
update public.app_members set display_name = 'Admin tester', role = 'admin', active = true where user_id = '00000000-0000-4000-8000-000000006104';

insert into public.menu_items (id, name, default_shelf_life_days)
values ('00000000-0000-4000-8000-000000006201', 'Role test menu', 3);
insert into public.production_batches (id, menu_id, meat_option_id, production_date, quantity_produced, expiry_date)
values (
  '00000000-0000-4000-8000-000000006301',
  '00000000-0000-4000-8000-000000006201',
  (select id from public.meat_options where name = 'Beef'),
  timezone('Asia/Bangkok', now())::date,
  10,
  timezone('Asia/Bangkok', now())::date + 3
);

select set_config(
  'test.role_closing_counts',
  (
    select jsonb_agg(jsonb_build_object(
      'menu_name_snapshot', variants.menu_name_snapshot,
      'meat_option_id', variants.meat_option_id,
      'physical_quantity', variants.physical_quantity
    ))::text
    from (
      select b.menu_name_snapshot, b.meat_option_id,
             sum(sm.quantity_delta)::integer as physical_quantity
      from public.production_batches b
      join public.stock_movements sm on sm.production_batch_id = b.id
        and sm.business_date <= timezone('Asia/Bangkok', now())::date
      where b.production_date <= timezone('Asia/Bangkok', now())::date
        and b.deleted_at is null
      group by b.menu_name_snapshot, b.meat_option_id
      having sum(sm.quantity_delta) > 0
    ) variants
  ),
  true
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006101', true);
set local role authenticated;
select ok((select count(*) from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000006301') = 1, 'Front can read current stock');
select throws_ok(
  $$insert into public.expenses (store_id, category_id, amount_thb)
    values ((select id from public.stores limit 1), (select id from public.expense_categories limit 1), 25)$$,
  '42501', 'new row violates row-level security policy for table "expenses"', 'Front cannot create expenses');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006103', true);
set local role authenticated;
select ok((select count(*) from public.production_batches where id = '00000000-0000-4000-8000-000000006301') = 1, 'Manager can read operational data for reports');
select throws_ok(
  $$insert into public.waste_records (production_batch_id, quantity, reason)
    values ('00000000-0000-4000-8000-000000006301', 1, 'Spoiled')$$,
  '42501', 'new row violates row-level security policy for table "waste_records"', 'Manager cannot change waste or stock');
select throws_ok(
  $$select public.close_canteen_day(
    timezone('Asia/Bangkok', now())::date,
    current_setting('test.role_closing_counts')::jsonb, null
  )$$,
  '42501', 'Only Front staff or a Website Admin can close a day.', 'Manager cannot close a day');
select throws_ok(
  $$select public.reopen_canteen_day(timezone('Asia/Bangkok', now())::date, 'Manager attempted correction')$$,
  '42501', 'Only a Website Admin can reopen a closed day.', 'Manager cannot reopen a day');
update public.settings set value = '5' where key = 'default_shelf_life_days';
select is((select count(*)::integer from public.activity_logs), 0, 'Manager cannot read the admin activity log');
reset role;
select is((select value from public.settings where key = 'default_shelf_life_days'), '3', 'Manager cannot change system settings');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006101', true);
set local role authenticated;
select lives_ok(
  $$select public.close_canteen_day(
    timezone('Asia/Bangkok', now())::date,
    current_setting('test.role_closing_counts')::jsonb, null
  )$$,
  'Front can complete daily closing');
select is((select status from public.daily_closings where business_date = timezone('Asia/Bangkok', now())::date order by version desc limit 1), 'closed', 'Front closing is saved');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006102', true);
set local role authenticated;
select lives_ok(
  $$insert into public.expenses (store_id, category_id, amount_thb)
    values ((select id from public.stores limit 1), (select id from public.expense_categories limit 1), 25)$$,
  'Kitchen can create expenses');
select lives_ok(
  $$update public.expenses set amount_thb = amount_thb + 1 where amount_thb = 25$$,
  'Kitchen can edit expenses after the daily close');
update public.production_batches set expiry_date = expiry_date + 1
where id = '00000000-0000-4000-8000-000000006301';
select is((select expiry_date from public.production_batches where id = '00000000-0000-4000-8000-000000006301'), timezone('Asia/Bangkok', now())::date + 3, 'Kitchen cannot change production or stock');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006104', true);
set local role authenticated;
select lives_ok($$update public.menu_items set notes = 'Admin controlled configuration' where id = '00000000-0000-4000-8000-000000006201'$$, 'Website Admin can update shared configuration');
select lives_ok($$update public.app_members set display_name = 'Front tester updated' where user_id = '00000000-0000-4000-8000-000000006101'$$, 'Website Admin can manage member details');
select is(public.reopen_canteen_day(timezone('Asia/Bangkok', now())::date, 'The physical count was entered incorrectly'), (select id from public.daily_closings where business_date = timezone('Asia/Bangkok', now())::date order by version desc limit 1), 'Website Admin can reopen a day with a reason');
select is((select reopen_reason from public.daily_closings where business_date = timezone('Asia/Bangkok', now())::date order by version desc limit 1), 'The physical count was entered incorrectly', 'the closing stores the admin reason');
select ok(exists (select 1 from public.activity_logs where entity_type = 'daily_closings' and after_data->>'reopen_reason' = 'The physical count was entered incorrectly'), 'the before/after closing change is auditable');
select ok(exists (select 1 from public.activity_logs where entity_type = 'app_members' and after_data->>'display_name' = 'Front tester updated'), 'user permission edits are auditable');
select throws_ok(
  $$update public.settings set value = '0' where key = 'default_shelf_life_days'$$,
  '23514', 'Default shelf life must be a whole number from 1 to 30 days.', 'Database rejects shelf life below one day');
select throws_ok(
  $$update public.settings set value = '31' where key = 'default_shelf_life_days'$$,
  '23514', 'Default shelf life must be a whole number from 1 to 30 days.', 'Database rejects shelf life above thirty days');
reset role;

select * from finish();
rollback;
