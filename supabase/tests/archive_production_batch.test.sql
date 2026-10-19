begin;
select plan(23);

select ok(not has_function_privilege('anon', 'public.archive_production_batch(uuid,text)', 'EXECUTE'), 'anonymous users cannot archive batches');

insert into public.menu_items (id, name, default_shelf_life_days)
values ('00000000-0000-4000-8000-000000000a01', 'Archive test menu', 3);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000a11', 'archive-admin@local.test'),
  ('00000000-0000-4000-8000-000000000a12', 'archive-front@local.test');
update public.app_members set display_name = 'Archive admin', role = 'admin', active = true
where user_id = '00000000-0000-4000-8000-000000000a11';
update public.app_members set display_name = 'Archive front', role = 'front', active = true
where user_id = '00000000-0000-4000-8000-000000000a12';

-- Front staff record four batches: a removable same-day mistake, one with
-- waste, an untouched entry that Front may not directly archive, and one old
-- day that gets closed.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a12', true);
insert into public.production_batches (id, menu_id, meat_option_id, production_date, quantity_produced, expiry_date) values
  ('00000000-0000-4000-8000-000000000a21', '00000000-0000-4000-8000-000000000a01', (select id from public.meat_options where name = 'Beef'), timezone('Asia/Bangkok', now())::date, 12, timezone('Asia/Bangkok', now())::date + 3),
  ('00000000-0000-4000-8000-000000000a22', '00000000-0000-4000-8000-000000000a01', (select id from public.meat_options where name = 'Chicken'), timezone('Asia/Bangkok', now())::date, 6, timezone('Asia/Bangkok', now())::date + 3),
  ('00000000-0000-4000-8000-000000000a23', '00000000-0000-4000-8000-000000000a01', (select id from public.meat_options where name = 'Vegan'), date '2020-01-02', 4, date '2020-01-05'),
  ('00000000-0000-4000-8000-000000000a24', '00000000-0000-4000-8000-000000000a01', (select id from public.meat_options where name = 'Pork'), timezone('Asia/Bangkok', now())::date, 3, timezone('Asia/Bangkok', now())::date + 3);
insert into public.waste_records (production_batch_id, quantity, reason)
values ('00000000-0000-4000-8000-000000000a22', 1, 'Spoiled');
insert into public.daily_closings (business_date, version, status, closed_at)
values (date '2020-01-02', 1, 'closed', now());

select throws_ok(
  $$update public.production_batches set deleted_at = now() where id = '00000000-0000-4000-8000-000000000a21'$$,
  '42501', 'Front staff must use the remove-entry action.', 'front staff cannot archive a batch directly');
select lives_ok(
  $$select public.archive_production_batch('00000000-0000-4000-8000-000000000a24', 'ignored by Front')$$,
  'front staff can remove an untouched batch from today');
select ok((select deleted_at is not null from public.production_batches where id = '00000000-0000-4000-8000-000000000a24'), 'the front correction is soft-deleted');
select is((select sum(quantity_delta)::integer from public.stock_movements where production_batch_id = '00000000-0000-4000-8000-000000000a24'), 0, 'the wrong same-day entry is removed from stock');
select ok(exists (
  select 1 from public.activity_logs
  where entity_id = '00000000-0000-4000-8000-000000000a24' and action = 'archived'
    and actor_id = '00000000-0000-4000-8000-000000000a12'
    and after_data ->> 'reason' = 'Front removed an incorrect production entry'
), 'the front correction is attributed and audited');
select throws_ok(
  $$select public.archive_production_batch('00000000-0000-4000-8000-000000000a23', 'ignored by Front')$$,
  '42501', 'Front can remove only an entry from today.', 'front cannot remove a historical batch');
select ok((select deleted_at is null from public.production_batches where id = '00000000-0000-4000-8000-000000000a23'), 'the historical batch remains active');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a11', true);
select throws_ok(
  $$select public.archive_production_batch('00000000-0000-4000-8000-000000000a21', 'x')$$,
  '22023', 'Enter a reason of 3 to 500 characters.', 'a reason is required');
select throws_ok(
  $$select public.archive_production_batch('00000000-0000-4000-8000-000000000a22', 'Wrong menu')$$,
  '23514', 'This batch has waste or after-close removals. Archive those records first.', 'a batch with waste is not a wrong entry');
select throws_ok(
  $$select public.archive_production_batch('00000000-0000-4000-8000-000000000a23', 'Wrong menu')$$,
  '23514', null, 'a batch counted by a closed day is protected');
select ok((select deleted_at is null from public.production_batches where id = '00000000-0000-4000-8000-000000000a23'), 'the closed-day batch stays active');

select lives_ok(
  $$select public.archive_production_batch('00000000-0000-4000-8000-000000000a21', '  Test entry, not real food  ')$$,
  'an admin archives an untouched wrong entry');
select ok((select deleted_at is not null from public.production_batches where id = '00000000-0000-4000-8000-000000000a21'), 'the batch is soft-deleted, not removed');
select is((select archive_reason from public.production_batches where id = '00000000-0000-4000-8000-000000000a21'), 'Test entry, not real food', 'the trimmed reason is kept on the batch');
select is((select sum(quantity_delta)::integer from public.stock_movements where production_batch_id = '00000000-0000-4000-8000-000000000a21'), 0, 'the batch ledger nets to zero');
select is(
  (select business_date from public.stock_movements where production_batch_id = '00000000-0000-4000-8000-000000000a21' and movement_type = 'production_reversal'),
  timezone('Asia/Bangkok', now())::date,
  'the reversal is dated on the production date');
select ok(not exists (select 1 from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000a21'), 'the batch leaves current stock');
select is((select quantity_remaining from public.v_stock_by_batch where id = '00000000-0000-4000-8000-000000000a22'), 5, 'other batches keep their stock');
select ok(exists (
  select 1 from public.activity_logs
  where entity_id = '00000000-0000-4000-8000-000000000a21' and action = 'archived'
    and actor_id = '00000000-0000-4000-8000-000000000a11'
    and after_data ->> 'reason' = 'Test entry, not real food'
    and (after_data ->> 'quantity_reversed')::integer = 12
), 'the archive is logged with who, why, and how many boxes');

select throws_ok(
  $$select public.archive_production_batch('00000000-0000-4000-8000-000000000a21', 'Again')$$,
  '23503', 'This batch is archived or does not exist.', 'a batch cannot be archived twice');
select throws_ok(
  $$update public.production_batches set deleted_at = null where id = '00000000-0000-4000-8000-000000000a21'$$,
  '23514', 'A batch archived as a wrong entry cannot be restored. Record the production again.', 'a wrong entry cannot be restored onto the wrong day');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a12', true);
set local role authenticated;
select throws_ok(
  $$update public.production_batches set archive_reason = 'edited' where id = '00000000-0000-4000-8000-000000000a22'$$,
  '42501', null, 'staff cannot write the archive reason directly');

select * from finish();
rollback;
