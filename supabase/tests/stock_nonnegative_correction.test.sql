begin;
select plan(8);

insert into public.menu_items (id, name, default_shelf_life_days)
values ('00000000-0000-4000-8000-000000009101', 'Nonnegative movement test menu', 3);

insert into public.production_batches (id, menu_id, meat_option_id, production_date, quantity_produced, expiry_date)
values (
  '00000000-0000-4000-8000-000000009201',
  '00000000-0000-4000-8000-000000009101',
  (select id from public.meat_options where name = 'Beef'),
  timezone('Asia/Bangkok', now())::date - 2,
  4,
  timezone('Asia/Bangkok', now())::date + 3
);

insert into public.waste_records (id, production_batch_id, quantity, reason)
values ('00000000-0000-4000-8000-000000009301', '00000000-0000-4000-8000-000000009201', 4, 'Expired');
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000009201'), 0, 'the batch reaches zero after recording all four available boxes as waste');

update public.waste_records set deleted_at = now() where id = '00000000-0000-4000-8000-000000009301';
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000009201'), 4, 'archiving a waste record can recover stock when its current balance is zero');

select throws_ok(
  $$insert into public.waste_records (production_batch_id, quantity, reason)
    values ('00000000-0000-4000-8000-000000009201', 5, 'Expired')$$,
  '23514', 'Only 4 boxes are available in this batch.', 'waste cannot exceed the current batch stock');

select throws_ok(
  $$insert into public.stock_movements (production_batch_id, business_date, movement_type, quantity_delta, source_id, reason)
    values ('00000000-0000-4000-8000-000000009201', timezone('Asia/Bangkok', now())::date, 'daily_closing', -5, '00000000-0000-4000-8000-000000009401', 'Attempted retroactive correction')$$,
  '23514', 'This stock movement would make the batch stock negative.', 'a later movement cannot overdraw the complete ledger');

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000009501', 'stock-admin@local.test');
update public.app_members set display_name = 'Stock admin test', role = 'admin', active = true
where user_id = '00000000-0000-4000-8000-000000009501';
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009501', true);
insert into public.daily_closings (business_date, version, status, closed_at)
values (timezone('Asia/Bangkok', now())::date - 1, 1, 'closed', now());
select lives_ok(
  $$select public.archive_production_batch('00000000-0000-4000-8000-000000009201', 'Remove pre-launch batch not included in any closing')$$,
  'an uncounted pre-launch batch can be archived without reopening unrelated closed days');
select is((select sum(quantity_delta) from public.stock_movements where production_batch_id = '00000000-0000-4000-8000-000000009201'), 0::bigint, 'archiving an empty historical batch leaves its ledger at zero');
select ok(not exists (select 1 from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000009201'), 'archived historical batches leave active stock views');
select ok(exists (select 1 from public.activity_logs where entity_type = 'production_batches' and entity_id = '00000000-0000-4000-8000-000000009201' and action = 'archived'), 'the archived batch keeps an audit event');

select * from finish();
rollback;
