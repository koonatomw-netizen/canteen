begin;
select plan(21);

select ok(not has_function_privilege('anon', 'public.archive_production_batches(uuid[])', 'EXECUTE'), 'anonymous users cannot bulk archive batches');
select ok(has_function_privilege('authenticated', 'public.archive_production_batches(uuid[])', 'EXECUTE'), 'authenticated users can call the role-checked bulk function');

insert into public.menu_items (id, name, default_shelf_life_days)
values ('00000000-0000-4000-8000-000000000a01', 'Bulk archive test menu', 3);
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000a11', 'bulk-front@local.test'),
  ('00000000-0000-4000-8000-000000000a12', 'bulk-kitchen@local.test');
update public.app_members set display_name = 'Bulk Front', role = 'front', active = true
where user_id = '00000000-0000-4000-8000-000000000a11';
update public.app_members set display_name = 'Bulk Kitchen', role = 'kitchen', active = true
where user_id = '00000000-0000-4000-8000-000000000a12';

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a11', true);
select throws_ok(
  $$select public.archive_production_batches(array[]::uuid[])$$,
  '22023', 'Select between 1 and 30 batches.', 'the selection cannot be empty');
select throws_ok(
  $$select public.archive_production_batches(array[null::uuid])$$,
  '22023', 'Batch ids cannot contain null values.', 'null ids are rejected');
select throws_ok(
  $$select public.archive_production_batches(array['00000000-0000-4000-8000-000000000a51'::uuid, '00000000-0000-4000-8000-000000000a51'::uuid])$$,
  '22023', 'Do not select the same batch more than once.', 'duplicate batch ids are rejected');
select throws_ok(
  $$select public.archive_production_batches(array(select ('10000000-0000-4000-8000-' || lpad(sample::text, 12, '0'))::uuid from generate_series(1, 31) as values(sample)))$$,
  '22023', 'Select between 1 and 30 batches.', 'the selection is limited to thirty batches');
insert into public.production_batches (id, menu_id, meat_option_id, production_date, quantity_produced, expiry_date) values
  ('00000000-0000-4000-8000-000000000a51', '00000000-0000-4000-8000-000000000a01', (select id from public.meat_options where name = 'Beef'), timezone('Asia/Bangkok', now())::date, 5, timezone('Asia/Bangkok', now())::date + 3),
  ('00000000-0000-4000-8000-000000000a52', '00000000-0000-4000-8000-000000000a01', (select id from public.meat_options where name = 'Chicken'), timezone('Asia/Bangkok', now())::date, 3, timezone('Asia/Bangkok', now())::date + 3),
  ('00000000-0000-4000-8000-000000000a53', '00000000-0000-4000-8000-000000000a01', (select id from public.meat_options where name = 'Vegan'), timezone('Asia/Bangkok', now())::date, 4, timezone('Asia/Bangkok', now())::date + 3),
  ('00000000-0000-4000-8000-000000000a54', '00000000-0000-4000-8000-000000000a01', (select id from public.meat_options where name = 'Pork'), date '2020-01-02', 2, date '2020-01-05');
insert into public.waste_records (production_batch_id, quantity, reason)
values ('00000000-0000-4000-8000-000000000a53', 2, 'Spoiled');

select throws_ok(
  $$select public.archive_production_batches(array['00000000-0000-4000-8000-000000000a51'::uuid, '00000000-0000-4000-8000-000000000a53'::uuid])$$,
  '23514', 'This entry has been used by waste or after-close stock records.', 'one blocked batch rejects the whole selection');
select ok((select deleted_at is null from public.production_batches where id = '00000000-0000-4000-8000-000000000a51'), 'the earlier valid batch is not partially archived');
select is((select sum(quantity_delta)::integer from public.stock_movements where production_batch_id = '00000000-0000-4000-8000-000000000a51'), 5, 'a failed bulk operation leaves the earlier batch stock unchanged');
select ok(not exists (select 1 from public.activity_logs where entity_id = '00000000-0000-4000-8000-000000000a51' and action = 'archived'), 'a failed bulk operation creates no partial audit event');

select lives_ok(
  $$select public.archive_production_batches(array['00000000-0000-4000-8000-000000000a51'::uuid, '00000000-0000-4000-8000-000000000a52'::uuid])$$,
  'Front can bulk archive multiple untouched batches from today');
select ok((select deleted_at is not null from public.production_batches where id = '00000000-0000-4000-8000-000000000a51'), 'the first selected batch is soft-deleted');
select ok((select deleted_at is not null from public.production_batches where id = '00000000-0000-4000-8000-000000000a52'), 'the second selected batch is soft-deleted');
select is((select sum(quantity_delta)::integer from public.stock_movements where production_batch_id = '00000000-0000-4000-8000-000000000a51'), 0, 'the first selected batch is reversed from stock');
select is((select sum(quantity_delta)::integer from public.stock_movements where production_batch_id = '00000000-0000-4000-8000-000000000a52'), 0, 'the second selected batch is reversed from stock');
select is((select count(*)::integer from public.activity_logs where entity_id in ('00000000-0000-4000-8000-000000000a51', '00000000-0000-4000-8000-000000000a52') and action = 'archived' and actor_id = '00000000-0000-4000-8000-000000000a11'), 2, 'each removed batch has its own actor-attributed audit event');
select ok((select deleted_at is null from public.production_batches where id = '00000000-0000-4000-8000-000000000a53'), 'the batch with waste remains active');
select is((select sum(quantity_delta)::integer from public.stock_movements where production_batch_id = '00000000-0000-4000-8000-000000000a53'), 2, 'the blocked batch stock is untouched');
select throws_ok(
  $$select public.archive_production_batches(array['00000000-0000-4000-8000-000000000a54'::uuid])$$,
  '42501', 'Front can remove only an entry from today.', 'Front cannot bulk archive a historical batch');
select ok((select deleted_at is null from public.production_batches where id = '00000000-0000-4000-8000-000000000a54'), 'the historical batch remains active');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a12', true);
select throws_ok(
  $$select public.archive_production_batches(array['00000000-0000-4000-8000-000000000a53'::uuid])$$,
  '42501', 'Bulk removal is available to Front staff only.', 'kitchen staff cannot bulk archive production');

select * from finish();
rollback;
