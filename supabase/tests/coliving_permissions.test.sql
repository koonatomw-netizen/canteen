begin;
select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000009101', 'coliving-role@local.test'),
  ('00000000-0000-4000-8000-000000009102', 'manager-coliving@local.test'),
  ('00000000-0000-4000-8000-000000009103', 'front-coliving@local.test'),
  ('00000000-0000-4000-8000-000000009104', 'admin-coliving@local.test'),
  ('00000000-0000-4000-8000-000000009105', 'auditor-coliving@local.test');

update public.app_members set role = 'coliving', active = true, display_name = 'Co-living tester'
where user_id = '00000000-0000-4000-8000-000000009101';
update public.app_members set role = 'manager', active = true, display_name = 'Manager tester'
where user_id = '00000000-0000-4000-8000-000000009102';
update public.app_members set role = 'front', active = true where user_id = '00000000-0000-4000-8000-000000009103';
update public.app_members set role = 'admin', active = true where user_id = '00000000-0000-4000-8000-000000009104';
update public.app_members set role = 'auditor', active = true where user_id = '00000000-0000-4000-8000-000000009105';

select is(
  (select role from public.app_members where user_id = '00000000-0000-4000-8000-000000009101'),
  'coliving', 'Co-living is an assignable application role'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009101', true);
set local role authenticated;

select lives_ok($$insert into public.coliving_meal_voucher_issues
  (id, guest_type, coupon_color, quantity, amount_thb, payment_status)
  values ('00000000-0000-4000-8000-000000009201', 'Outside Customer', 'green', 5, 850, 'paid')$$,
  'Co-living can record a paid Green package without requiring the recipient name');
select throws_ok($$insert into public.coliving_meal_voucher_issues
  (guest_type, coupon_color, quantity, amount_thb, payment_status, issue_date)
  values ('Outside Customer', 'green', 1, 180, 'paid', date '2999-01-01')$$,
  '23514', 'An issue date cannot be in the future.', 'database rejects a future voucher issue date');
select is((select created_by from public.coliving_meal_voucher_issues where id = '00000000-0000-4000-8000-000000009201'),
  '00000000-0000-4000-8000-000000009101'::uuid, 'database records the authenticated actor');
select is((select count(*)::integer from public.coliving_record_events where entity_id = '00000000-0000-4000-8000-000000009201'),
  1, 'creating an issue writes an immutable audit event');

select lives_ok($$update public.coliving_meal_voucher_issues
  set recipient = 'Room 24', change_reason = 'Added the room after confirming the guest'
  where id = '00000000-0000-4000-8000-000000009201'$$,
  'Co-living can edit a record when a reason is supplied');
select is((select reason from public.coliving_record_events where entity_id = '00000000-0000-4000-8000-000000009201' and event_type = 'updated'),
  'Added the room after confirming the guest', 'the edit reason is stored in history');
select is((select before_data->>'recipient' from public.coliving_record_events where entity_id = '00000000-0000-4000-8000-000000009201' and event_type = 'updated'),
  null, 'audit history retains the prior recipient');
select is((select after_data->>'recipient' from public.coliving_record_events where entity_id = '00000000-0000-4000-8000-000000009201' and event_type = 'updated'),
  'Room 24', 'audit history retains the updated recipient');
select throws_ok($$update public.coliving_meal_voucher_issues set quantity = 6
  where id = '00000000-0000-4000-8000-000000009201'$$,
  '23514', 'An edit reason of 1 to 500 characters is required.', 'database rejects an edit without a fresh reason');

select throws_ok($$insert into public.coliving_meal_voucher_issues
  (guest_type, coupon_color, quantity, amount_thb, payment_status, complimentary_reason)
  values ('Event', 'orange', 2, 110, 'complimentary', 'Guest of owner')$$,
  '23514', 'new row for relation "coliving_meal_voucher_issues" violates check constraint "coliving_voucher_complimentary_amount_check"',
  'complimentary vouchers must have zero actual amount');
select lives_ok($$insert into public.coliving_meal_voucher_issues
  (id, guest_type, coupon_color, quantity, amount_thb, payment_status, complimentary_reason)
  values ('00000000-0000-4000-8000-000000009202', 'Event', 'orange', 2, 0, 'complimentary', 'Guest of owner')$$,
  'complimentary vouchers can be recorded with a reason and zero amount');

select lives_ok($$insert into public.coliving_gym_pass_issues
  (id, guest_type, pass_type, quantity, amount_thb, start_date, end_date)
  values ('00000000-0000-4000-8000-000000009203', 'Coliving', 'monthly', 1, 1200, date '2026-10-14', date '2026-11-14')$$,
  'Co-living can record a monthly gym pass with its valid date range');
select throws_ok($$insert into public.coliving_gym_pass_issues
  (guest_type, pass_type, quantity, amount_thb)
  values ('Coliving', 'monthly', 1, 1200)$$,
  '23514', 'new row for relation "coliving_gym_pass_issues" violates check constraint "coliving_gym_monthly_dates_check"',
  'database requires dates for a monthly pass');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009102', true);
select is((select count(*)::integer from public.coliving_meal_voucher_issues where id = '00000000-0000-4000-8000-000000009201'),
  1, 'Manager can read voucher records');
select is((select count(*)::integer from public.coliving_gym_pass_issues where id = '00000000-0000-4000-8000-000000009203'),
  1, 'Manager can read gym pass records');
select is((select count(*)::integer from public.coliving_record_events where entity_id = '00000000-0000-4000-8000-000000009201'),
  2, 'Manager can read full source history');
select throws_ok($$insert into public.coliving_meal_voucher_issues
  (guest_type, coupon_color, quantity, amount_thb, payment_status)
  values ('Outside Customer', 'green', 1, 180, 'paid')$$,
  '42501', 'new row violates row-level security policy for table "coliving_meal_voucher_issues"',
  'Manager cannot issue or edit vouchers');
update public.coliving_meal_voucher_issues set quantity = 9, change_reason = 'Manager edit'
where id = '00000000-0000-4000-8000-000000009201';
select is((select quantity from public.coliving_meal_voucher_issues where id = '00000000-0000-4000-8000-000000009201'),
  5, 'Manager updates are rejected by row-level security');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009103', true);
select is((select count(*)::integer from public.coliving_meal_voucher_issues), 0, 'Front cannot read Co-living records');
select throws_ok($$insert into public.coliving_meal_voucher_issues
  (guest_type, coupon_color, quantity, amount_thb, payment_status)
  values ('Outside Customer', 'green', 1, 180, 'paid')$$,
  '42501', 'new row violates row-level security policy for table "coliving_meal_voucher_issues"',
  'Front cannot issue vouchers');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009105', true);
select is((select count(*)::integer from public.coliving_meal_voucher_issues), 0, 'Website Auditor cannot view Co-living financial records');
select throws_ok($$update public.coliving_record_events set reason = 'tampered'
  where entity_id = '00000000-0000-4000-8000-000000009201'$$,
  '42501', 'permission denied for table coliving_record_events', 'audit history cannot be edited by an authenticated user');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009101', true);
update public.coliving_meal_voucher_issues
set voided_at = now(), void_reason = 'Recorded twice'
where id = '00000000-0000-4000-8000-000000009201';
select is((select count(*)::integer from public.coliving_record_events where entity_id = '00000000-0000-4000-8000-000000009201' and event_type = 'voided'),
  1, 'cancellation writes an audit event');
select is((select voided_by from public.coliving_meal_voucher_issues where id = '00000000-0000-4000-8000-000000009201'),
  '00000000-0000-4000-8000-000000009101'::uuid, 'database records who cancelled the issue');
select throws_ok($$update public.coliving_meal_voucher_issues
  set recipient = 'Changed after void', change_reason = 'Attempt'
  where id = '00000000-0000-4000-8000-000000009201'$$,
  '23514', 'A voided Co-living issue cannot be edited.', 'voided records stay locked');
select throws_ok($$delete from public.coliving_meal_voucher_issues
  where id = '00000000-0000-4000-8000-000000009202'$$,
  '42501', 'permission denied for table coliving_meal_voucher_issues', 'Co-living cannot physically delete issued records');

reset role;
select * from finish();
rollback;
