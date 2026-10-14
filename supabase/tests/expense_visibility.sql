-- Run only against a disposable local Supabase database with the project
-- migrations applied. The transaction rolls back all test fixtures.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'expense-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'expense-manager@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'expense-kitchen@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'expense-front@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'expense-auditor@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

update public.app_members
set active = true,
    role = case user_id
      when '00000000-0000-4000-8000-000000000001'::uuid then 'admin'
      when '00000000-0000-4000-8000-000000000002'::uuid then 'manager'
      when '00000000-0000-4000-8000-000000000003'::uuid then 'kitchen'
      when '00000000-0000-4000-8000-000000000004'::uuid then 'front'
      else 'auditor'
    end
where user_id between '00000000-0000-4000-8000-000000000001'::uuid
                   and '00000000-0000-4000-8000-000000000005'::uuid;

insert into public.stores (id, name)
values ('20000000-0000-4000-8000-000000000001', 'RLS test store');
insert into public.expense_categories (id, name)
values ('30000000-0000-4000-8000-000000000001', 'RLS test category');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

-- Kitchen can submit its own expense and attach private receipt metadata/file.
insert into public.expenses (id, store_id, category_id, amount_thb, notes)
values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  123.45,
  'Kitchen submission test'
);
insert into public.expense_receipt_photos (expense_id, file_path)
values (
  '10000000-0000-4000-8000-000000000001',
  'receipts/10000000-0000-4000-8000-000000000001/test.jpg'
);
insert into storage.objects (bucket_id, name, owner)
values (
  'operational-photos',
  'receipts/10000000-0000-4000-8000-000000000001/test.jpg',
  '00000000-0000-4000-8000-000000000003'
);

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.expenses;
  if v_rows <> 0 then raise exception 'Kitchen can read expense records'; end if;
  select count(*) into v_rows from public.expense_receipt_photos;
  if v_rows <> 0 then raise exception 'Kitchen can read receipt metadata'; end if;
  select count(*) into v_rows from storage.objects where name like 'receipts/%';
  if v_rows <> 0 then raise exception 'Kitchen can read receipt storage objects'; end if;
  update public.expenses set amount_thb = 999 where id = '10000000-0000-4000-8000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Kitchen can update an expense after submission'; end if;
  begin
    insert into public.expenses (id, store_id, category_id, amount_thb, created_by)
    values (
      '10000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      1,
      '00000000-0000-4000-8000-000000000001'
    );
    raise exception 'Kitchen could spoof another expense creator';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.expenses;
  if v_rows <> 1 then raise exception 'Manager cannot read the expense report row'; end if;
  select count(*) into v_rows from public.expense_receipt_photos;
  if v_rows <> 1 then raise exception 'Manager cannot read receipt metadata'; end if;
  select count(*) into v_rows from storage.objects where name like 'receipts/%';
  if v_rows <> 1 then raise exception 'Manager cannot read private receipt file'; end if;
  update public.expenses set amount_thb = 999 where id = '10000000-0000-4000-8000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Manager can edit an expense'; end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.expenses;
  if v_rows <> 0 then raise exception 'Front can read expense records'; end if;
  select count(*) into v_rows from public.expense_receipt_photos;
  if v_rows <> 0 then raise exception 'Front can read receipt metadata'; end if;
  select count(*) into v_rows from storage.objects where name like 'receipts/%';
  if v_rows <> 0 then raise exception 'Front can read receipt file'; end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.expenses;
  if v_rows <> 0 then raise exception 'Auditor can read expense records'; end if;
  select count(*) into v_rows from public.expense_receipt_photos;
  if v_rows <> 0 then raise exception 'Auditor can read receipt metadata'; end if;
  select count(*) into v_rows from storage.objects where name like 'receipts/%';
  if v_rows <> 0 then raise exception 'Auditor can read receipt file'; end if;
  select count(*) into v_rows from public.activity_logs where entity_type in ('expenses', 'expense_receipt_photos');
  if v_rows <> 0 then raise exception 'Auditor can read financial audit rows'; end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.expenses;
  if v_rows <> 1 then raise exception 'Website Admin cannot read the expense'; end if;
  select count(*) into v_rows from public.expense_receipt_photos;
  if v_rows <> 1 then raise exception 'Website Admin cannot read receipt metadata'; end if;
  select count(*) into v_rows from storage.objects where name like 'receipts/%';
  if v_rows <> 1 then raise exception 'Website Admin cannot read the private receipt file'; end if;
end;
$$;

reset role;
rollback;

select 'PASS: expense records, receipt access, and post-submit edit policies match each role' as result;
