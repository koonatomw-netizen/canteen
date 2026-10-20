begin;
select plan(17);

select ok(not has_function_privilege('anon', 'public.archive_other_waste_for_date_preserving_stock(date,integer,integer,text)', 'EXECUTE'), 'anonymous users cannot archive waste');

insert into public.menu_items (id, name, default_shelf_life_days)
values ('00000000-0000-4000-8000-000000000b01', 'Waste correction test menu', 3);
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000b11', 'waste-correction-admin@local.test'),
  ('00000000-0000-4000-8000-000000000b12', 'waste-correction-front@local.test');
update public.app_members set display_name = 'Waste correction admin', role = 'admin', active = true
where user_id = '00000000-0000-4000-8000-000000000b11';
update public.app_members set display_name = 'Waste correction front', role = 'front', active = true
where user_id = '00000000-0000-4000-8000-000000000b12';

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000b12', true);
insert into public.production_batches (id, menu_id, meat_option_id, production_date, quantity_produced, expiry_date) values
  ('00000000-0000-4000-8000-000000000b21', '00000000-0000-4000-8000-000000000b01', (select id from public.meat_options where name = 'Beef'), timezone('Asia/Bangkok', now())::date, 10, timezone('Asia/Bangkok', now())::date + 3),
  ('00000000-0000-4000-8000-000000000b22', '00000000-0000-4000-8000-000000000b01', (select id from public.meat_options where name = 'Chicken'), timezone('Asia/Bangkok', now())::date - 1, 2, timezone('Asia/Bangkok', now())::date + 2);
insert into public.waste_records (id, production_batch_id, waste_date, quantity, reason, notes) values
  ('00000000-0000-4000-8000-000000000b31', '00000000-0000-4000-8000-000000000b21', timezone('Asia/Bangkok', now())::date, 2, 'Other', 'Mistaken entry one'),
  ('00000000-0000-4000-8000-000000000b32', '00000000-0000-4000-8000-000000000b21', timezone('Asia/Bangkok', now())::date, 3, 'Other', 'Mistaken entry two'),
  ('00000000-0000-4000-8000-000000000b33', '00000000-0000-4000-8000-000000000b21', timezone('Asia/Bangkok', now())::date, 1, 'Spoiled', 'Valid waste'),
  ('00000000-0000-4000-8000-000000000b34', '00000000-0000-4000-8000-000000000b22', timezone('Asia/Bangkok', now())::date - 1, 1, 'Other', 'Different day');
insert into public.daily_closings (business_date, version, status, closed_at)
values (timezone('Asia/Bangkok', now())::date, 1, 'closed', now());
select is((select count(*)::integer from public.waste_records where waste_date = timezone('Asia/Bangkok', now())::date and lower(trim(reason)) = 'other' and deleted_at is null), 2, 'the test scope contains exactly two active Other rows for today');

select throws_ok(
  $$select public.archive_other_waste_for_date_preserving_stock(timezone('Asia/Bangkok', now())::date, 2, 5, 'Incorrect front entries')$$,
  '42501', 'Only a Website Admin can archive waste without changing stock.', 'front cannot use stock-preserving waste correction');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000b11', true);
set local role authenticated;
select throws_ok(
  $$update public.waste_records set stock_ledger_preserved_on_archive = true where id = '00000000-0000-4000-8000-000000000b33'$$,
  '42501', 'permission denied for table waste_records', 'the stock-preservation flag cannot be set directly by an app user');
select throws_ok(
  $$select public.archive_other_waste_for_date_preserving_stock(timezone('Asia/Bangkok', now())::date, 2, 5, 'x')$$,
  '22023', 'Enter a reason of 3 to 500 characters.', 'a correction reason is required');
select throws_ok(
  $$select public.archive_other_waste_for_date_preserving_stock(timezone('Asia/Bangkok', now())::date, 99, 5, 'Expected data no longer matches')$$,
  '23514', 'Expected 99 Other records / 5 boxes, found 2 / 5.', 'the exact count and box total must still match before archiving');
select is(
  public.archive_other_waste_for_date_preserving_stock(timezone('Asia/Bangkok', now())::date, 2, 5, 'Front entered these Other records by mistake'),
  2,
  'the admin archives exactly the two matching Other rows after close');
select is((select count(*)::integer from public.waste_records where waste_date = timezone('Asia/Bangkok', now())::date and lower(trim(reason)) = 'other' and deleted_at is null), 0, 'matching Other records no longer appear as active');
select is((select count(*)::integer from public.waste_records where id in ('00000000-0000-4000-8000-000000000b31','00000000-0000-4000-8000-000000000b32') and deleted_at is not null), 2, 'the source rows remain archived in the database');
select is((select count(*)::integer from public.waste_records where id in ('00000000-0000-4000-8000-000000000b31','00000000-0000-4000-8000-000000000b32') and stock_ledger_preserved_on_archive), 2, 'stock-preserving correction is marked on each archived row');
select throws_ok(
  $$update public.waste_records set deleted_at = null where id = '00000000-0000-4000-8000-000000000b31'$$,
  '23514', 'This correction archive cannot be restored. Record a new waste entry if needed.', 'a later restore cannot double-deduct the same stock');
select is((select count(*)::integer from public.waste_records where id = '00000000-0000-4000-8000-000000000b33' and deleted_at is null), 1, 'other waste reasons remain active');
select is((select count(*)::integer from public.waste_records where id = '00000000-0000-4000-8000-000000000b34' and deleted_at is null), 1, 'Other rows from other dates remain active');
select is((select count(*)::integer from public.stock_movements where production_batch_id in ('00000000-0000-4000-8000-000000000b21','00000000-0000-4000-8000-000000000b22')), 6, 'the correction writes no stock movements');
select is((select sum(quantity_remaining)::integer from public.v_stock_by_batch where id in ('00000000-0000-4000-8000-000000000b21','00000000-0000-4000-8000-000000000b22')), 5, 'current stock remains unchanged');
select is((
  select count(*)::integer from public.activity_logs
  where entity_id in ('00000000-0000-4000-8000-000000000b31','00000000-0000-4000-8000-000000000b32')
    and action = 'archived' and actor_id = '00000000-0000-4000-8000-000000000b11'
    and after_data ->> 'stock_ledger_changed' = 'false'
    and after_data ->> 'correction_reason' = 'Front entered these Other records by mistake'
), 2, 'both archives record the actor, reason, and unchanged ledger');
select throws_ok(
  $$update public.waste_records set deleted_at = now() where id = '00000000-0000-4000-8000-000000000b33'$$,
  '23514', 'Reopen this day before changing its waste record.', 'ordinary waste archival still requires reopening a closed day');

reset role;
select * from finish();
rollback;
