begin;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000008101', 'auditor-role@local.test'),
  ('00000000-0000-4000-8000-000000008102', 'pending-role@local.test');

select is((select role from public.app_members where user_id = '00000000-0000-4000-8000-000000008101'), 'front', 'new Auth accounts still default to Front before approval');
select is((select active from public.app_members where user_id = '00000000-0000-4000-8000-000000008101'), false, 'new Auth accounts remain inactive until approved');

update public.app_members set display_name = 'Read-only auditor', role = 'auditor', active = true
where user_id = '00000000-0000-4000-8000-000000008101';

insert into public.menu_items (id, name, default_shelf_life_days)
values ('00000000-0000-4000-8000-000000008201', 'Auditor test menu', 3);
insert into public.production_batches (id, menu_id, meat_option_id, production_date, quantity_produced, expiry_date)
values (
  '00000000-0000-4000-8000-000000008301',
  '00000000-0000-4000-8000-000000008201',
  (select id from public.meat_options where name = 'Beef'),
  date '2026-10-13', 2, date '2026-10-16'
);
insert into public.activity_logs (actor_id, action, entity_type, entity_id, description)
values (
  '00000000-0000-4000-8000-000000008102', 'updated', 'settings',
  '00000000-0000-4000-8000-000000008401', 'Auditor permission fixture'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000008101', true);
set local role authenticated;

select is((select count(*)::integer from public.app_members), 2, 'auditor can inspect all member access records');
select ok((select app_private.has_app_role(array['auditor'])), 'auditor role is recognized by the database helper');
select ok((select count(*) > 0 from public.activity_logs), 'auditor can inspect the read-only activity log');
select is((select count(*)::integer from public.production_batches where id = '00000000-0000-4000-8000-000000008301'), 1, 'auditor can read production history');

select throws_ok(
  $$insert into public.menu_items (name, default_shelf_life_days) values ('Forbidden auditor menu', 3)$$,
  '42501', 'new row violates row-level security policy for table "menu_items"', 'auditor cannot create menus'
);
select throws_ok(
  $$insert into public.production_batches (menu_id, meat_option_id, production_date, quantity_produced, expiry_date)
    values ('00000000-0000-4000-8000-000000008201', (select id from public.meat_options where name = 'Beef'), date '2026-10-13', 1, date '2026-10-16')$$,
  '42501', 'new row violates row-level security policy for table "production_batches"', 'auditor cannot record production'
);
select throws_ok(
  $$insert into public.expenses (store_id, category_id, amount_thb)
    values ((select id from public.stores limit 1), (select id from public.expense_categories limit 1), 25)$$,
  '42501', 'new row violates row-level security policy for table "expenses"', 'auditor cannot create expenses'
);
select throws_ok(
  $$insert into public.waste_records (production_batch_id, quantity, reason)
    values ('00000000-0000-4000-8000-000000008301', 1, 'Spoiled')$$,
  '42501', 'new row violates row-level security policy for table "waste_records"', 'auditor cannot record waste'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('operational-photos', 'waste/auditor-attempt.jpg', '00000000-0000-4000-8000-000000008101', '{}'::jsonb)$$,
  '42501', 'new row violates row-level security policy for table "objects"', 'auditor cannot upload operational photos'
);

update public.settings set value = '9' where key = 'default_shelf_life_days';
update public.app_members set display_name = 'Changed by auditor' where user_id = '00000000-0000-4000-8000-000000008102';
select throws_ok(
  $$delete from public.menu_items where id = '00000000-0000-4000-8000-000000008201'$$,
  '42501', 'permission denied for table menu_items', 'auditor cannot directly delete a menu'
);
select throws_ok(
  $$select public.close_canteen_day(date '2000-01-01', '[]'::jsonb, null)$$,
  '42501', 'Only Front staff or a Website Admin can close a day.', 'auditor cannot close a day through the RPC'
);
select throws_ok(
  $$select public.reopen_canteen_day(date '2000-01-01', 'Auditor attempted reopen')$$,
  '42501', 'Only a Website Admin can reopen a closed day.', 'auditor cannot reopen a day'
);
select throws_ok(
  $$select public.permanently_delete_menu('00000000-0000-4000-8000-000000008201')$$,
  '42501', 'Only a Website Admin can permanently remove a menu.', 'auditor cannot call the permanent menu removal RPC'
);

reset role;
select is((select value from public.settings where key = 'default_shelf_life_days'), '3', 'auditor settings update was rejected');
select is((select display_name from public.app_members where user_id = '00000000-0000-4000-8000-000000008102'), 'pending-role', 'auditor member update was rejected');

select * from finish();
rollback;
