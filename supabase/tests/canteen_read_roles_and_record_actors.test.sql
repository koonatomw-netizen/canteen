begin;
select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000008101', 'front-reader@local.test'),
  ('00000000-0000-4000-8000-000000008102', 'kitchen-reader@local.test'),
  ('00000000-0000-4000-8000-000000008103', 'manager-reader@local.test'),
  ('00000000-0000-4000-8000-000000008104', 'admin-reader@local.test'),
  ('00000000-0000-4000-8000-000000008105', 'auditor-reader@local.test'),
  ('00000000-0000-4000-8000-000000008106', 'coliving-reader@local.test');

update public.app_members set role = 'front', active = true, display_name = 'Front Reader'
where user_id = '00000000-0000-4000-8000-000000008101';
update public.app_members set role = 'kitchen', active = true, display_name = 'Kitchen Reader'
where user_id = '00000000-0000-4000-8000-000000008102';
update public.app_members set role = 'manager', active = true, display_name = 'Manager Reader'
where user_id = '00000000-0000-4000-8000-000000008103';
update public.app_members set role = 'admin', active = true, display_name = 'Admin Reader'
where user_id = '00000000-0000-4000-8000-000000008104';
update public.app_members set role = 'auditor', active = true, display_name = 'Auditor Reader'
where user_id = '00000000-0000-4000-8000-000000008105';
update public.app_members set role = 'coliving', active = true, display_name = 'Co-living Reader'
where user_id = '00000000-0000-4000-8000-000000008106';

insert into public.menu_items (id, name, default_shelf_life_days)
values ('00000000-0000-4000-8000-000000008201', 'Read isolation test menu', 3);
insert into public.expenses (id, store_id, category_id, amount_thb)
values (
  '00000000-0000-4000-8000-000000008701',
  (select id from public.stores order by created_at limit 1),
  (select id from public.expense_categories order by created_at limit 1),
  123
);
insert into public.production_batches (id, menu_id, meat_option_id, production_date, quantity_produced, expiry_date)
values (
  '00000000-0000-4000-8000-000000008301',
  '00000000-0000-4000-8000-000000008201',
  (select id from public.meat_options where name = 'Beef' limit 1),
  timezone('Asia/Bangkok', now())::date,
  5,
  timezone('Asia/Bangkok', now())::date + 3
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000008101', true);
set local role authenticated;
insert into public.waste_records (id, production_batch_id, quantity, reason, created_by, created_by_name)
values (
  '00000000-0000-4000-8000-000000008401',
  '00000000-0000-4000-8000-000000008301',
  1,
  'Spoiled',
  '00000000-0000-4000-8000-000000008104',
  'Spoofed Admin'
);
select is((select created_by from public.waste_records where id = '00000000-0000-4000-8000-000000008401'),
  '00000000-0000-4000-8000-000000008101'::uuid, 'waste stores the authenticated actor, not a client-supplied user id');
select is((select created_by_name from public.waste_records where id = '00000000-0000-4000-8000-000000008401'),
  'Front Reader', 'waste snapshots the staff display name at creation');
select throws_ok($$update public.waste_records set created_by_name = 'Spoofed Name' where id = '00000000-0000-4000-8000-000000008401'$$,
  '42501', 'permission denied for table waste_records', 'staff cannot edit the actor snapshot');
reset role;

insert into public.daily_closings (id, business_date, status, closed_at)
values ('00000000-0000-4000-8000-000000008501', timezone('Asia/Bangkok', now())::date, 'closed', now());
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000008101', true);
set local role authenticated;
insert into public.post_close_stock_outs (id, removal_date, production_batch_id, quantity, reason, created_by, created_by_name)
values (
  '00000000-0000-4000-8000-000000008601',
  timezone('Asia/Bangkok', now())::date,
  '00000000-0000-4000-8000-000000008301',
  1,
  'Owner or friend pickup',
  '00000000-0000-4000-8000-000000008104',
  'Spoofed Admin'
);
select is((select created_by from public.post_close_stock_outs where id = '00000000-0000-4000-8000-000000008601'),
  '00000000-0000-4000-8000-000000008101'::uuid, 'post-close stock out stores the authenticated actor');
select is((select created_by_name from public.post_close_stock_outs where id = '00000000-0000-4000-8000-000000008601'),
  'Front Reader', 'post-close stock out snapshots the staff display name');
select throws_ok($$update public.post_close_stock_outs set created_by_name = 'Spoofed Name' where id = '00000000-0000-4000-8000-000000008601'$$,
  '42501', 'permission denied for table post_close_stock_outs', 'staff cannot edit the actor snapshot');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000008102', true);
set local role authenticated;
select is((select count(*)::integer from public.production_batches where id = '00000000-0000-4000-8000-000000008301'), 0, 'Kitchen cannot read production');
select is((select count(*)::integer from public.stock_movements where production_batch_id = '00000000-0000-4000-8000-000000008301'), 0, 'Kitchen cannot read stock movements');
select is((select count(*)::integer from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000008301'), 0, 'Kitchen cannot read stock balances');
select is((select count(*)::integer from public.waste_records where id = '00000000-0000-4000-8000-000000008401'), 0, 'Kitchen cannot read waste records');
select is((select count(*)::integer from public.post_close_stock_outs where id = '00000000-0000-4000-8000-000000008601'), 0, 'Kitchen cannot read after-close removals');
select is((select count(*)::integer from public.expenses where id = '00000000-0000-4000-8000-000000008701'), 0, 'Kitchen cannot read expense history');
select ok((select count(*) > 0 from public.stores), 'Kitchen can read store choices for its expense form');
select ok((select count(*) > 0 from public.expense_categories), 'Kitchen can read expense categories');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000008106', true);
set local role authenticated;
select is((select count(*)::integer from public.menu_items where id = '00000000-0000-4000-8000-000000008201'), 0, 'Co-living cannot read canteen menus');
select is((select count(*)::integer from public.production_batches where id = '00000000-0000-4000-8000-000000008301'), 0, 'Co-living cannot read canteen production');
select is((select count(*)::integer from public.waste_records where id = '00000000-0000-4000-8000-000000008401'), 0, 'Co-living cannot read canteen waste');
select is((select count(*)::integer from public.post_close_stock_outs where id = '00000000-0000-4000-8000-000000008601'), 0, 'Co-living cannot read after-close removals');
select is((select count(*)::integer from public.stores), 0, 'Co-living cannot read canteen store configuration');
select is((select count(*)::integer from public.expenses where id = '00000000-0000-4000-8000-000000008701'), 0, 'Co-living cannot read canteen expenses');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000008103', true);
set local role authenticated;
select is((select count(*)::integer from public.production_batches where id = '00000000-0000-4000-8000-000000008301'), 1, 'Manager can read canteen reports');
select is((select count(*)::integer from public.waste_records where id = '00000000-0000-4000-8000-000000008401' and created_by_name = 'Front Reader'), 1, 'Manager can read the recorded-by name');
select is((select count(*)::integer from public.post_close_stock_outs where id = '00000000-0000-4000-8000-000000008601' and created_by_name = 'Front Reader'), 1, 'Manager can read after-close actor details');
select is((select count(*)::integer from public.expenses where id = '00000000-0000-4000-8000-000000008701'), 1, 'Manager can read canteen expenses');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000008105', true);
set local role authenticated;
select is((select count(*)::integer from public.production_batches where id = '00000000-0000-4000-8000-000000008301'), 1, 'Auditor retains read-only canteen report access');
select is((select count(*)::integer from public.expenses), 0, 'Auditor cannot read expense records');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000008101', true);
set local role authenticated;
select is((select count(*)::integer from public.expenses where id = '00000000-0000-4000-8000-000000008701'), 0, 'Front cannot read canteen expenses');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000008104', true);
set local role authenticated;
select is((select count(*)::integer from public.production_batches where id = '00000000-0000-4000-8000-000000008301'), 1, 'Website Admin retains full canteen read access');
reset role;

select * from finish();
rollback;
