begin;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000007201', 'menu-front@local.test'),
  ('00000000-0000-4000-8000-000000007202', 'menu-kitchen@local.test'),
  ('00000000-0000-4000-8000-000000007203', 'menu-manager@local.test'),
  ('00000000-0000-4000-8000-000000007204', 'menu-admin@local.test'),
  ('00000000-0000-4000-8000-000000007205', 'menu-inactive@local.test');
update public.app_members set role = 'front', active = true where user_id = '00000000-0000-4000-8000-000000007201';
update public.app_members set role = 'kitchen', active = true where user_id = '00000000-0000-4000-8000-000000007202';
update public.app_members set role = 'manager', active = true where user_id = '00000000-0000-4000-8000-000000007203';
update public.app_members set role = 'admin', active = true where user_id = '00000000-0000-4000-8000-000000007204';

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000007201', true);
set local role authenticated;
select lives_ok($$insert into public.menu_items (id, name, default_shelf_life_days, notes)
  values ('00000000-0000-4000-8000-000000007301', 'Front menu test', 3, 'Keep chilled')$$,
  'Front can create an active menu');
select is((select count(*)::integer from public.production_batches where menu_id = '00000000-0000-4000-8000-000000007301'), 0, 'menu creation does not create stock');
select is((select notes from public.menu_items where id = '00000000-0000-4000-8000-000000007301'), 'Keep chilled', 'Front can include notes');
with changed as (
  update public.menu_items set name = 'Unauthorized rename', active = false
  where id = '00000000-0000-4000-8000-000000007301' returning id
)
select is((select count(*)::integer from changed), 0, 'Front cannot edit or deactivate an existing menu');
select throws_ok($$delete from public.menu_items where id = '00000000-0000-4000-8000-000000007301'$$,
  '42501', null, 'Front cannot delete a menu');
select throws_ok($$insert into public.menu_items (name, active) values ('Inactive forbidden', false)$$,
  '42501', null, 'Front cannot create an inactive menu');
select throws_ok($$insert into public.menu_items (name, selling_price) values ('Price forbidden', 25)$$,
  '42501', null, 'Front cannot set reserved financial fields');
select throws_ok($$insert into public.menu_items (name, created_at) values ('Backdate forbidden', now() - interval '1 day')$$,
  '42501', null, 'Front cannot forge creation metadata');
select throws_ok($$insert into public.menu_items (name, notes) values ('Long note forbidden', repeat('a', 2001))$$,
  '42501', null, 'Front notes are bounded');
select throws_ok($$insert into public.menu_items (name) values (' FRONT MENU TEST ')$$,
  '23505', null, 'duplicate names are rejected ignoring case and surrounding spaces');
select throws_ok($$insert into public.menu_items (name, default_shelf_life_days) values ('Invalid shelf zero', 0)$$,
  '23514', null, 'shelf life must be at least one day');
select throws_ok($$insert into public.menu_items (name, default_shelf_life_days) values ('Invalid shelf high', 31)$$,
  '23514', null, 'shelf life cannot exceed thirty days');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000007202', true);
set local role authenticated;
select throws_ok($$insert into public.menu_items (name) values ('Kitchen forbidden')$$,
  '42501', null, 'Kitchen cannot create menus');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000007203', true);
set local role authenticated;
select throws_ok($$insert into public.menu_items (name) values ('Manager forbidden')$$,
  '42501', null, 'Manager cannot create menus');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000007205', true);
set local role authenticated;
select throws_ok($$insert into public.menu_items (name) values ('Inactive front forbidden')$$,
  '42501', null, 'inactive Front accounts cannot create menus');
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select throws_ok($$insert into public.menu_items (name) values ('Anonymous forbidden')$$,
  '42501', null, 'anonymous clients cannot create menus');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000007204', true);
set local role authenticated;
select lives_ok($$insert into public.menu_items (name, default_shelf_life_days) values ('Admin menu test', 2)$$,
  'Admin can still create menus');
reset role;
select ok(exists (
  select 1 from public.activity_logs
  where entity_type = 'menu_items' and entity_id = '00000000-0000-4000-8000-000000007301'
    and actor_id = '00000000-0000-4000-8000-000000007201'
    and after_data->>'name' = 'Front menu test'
), 'Front menu creation records the actor and menu data in the audit log');

select * from finish();
rollback;
