-- Run only against a disposable local Supabase database with project
-- migrations applied. This transaction rolls back all fixtures.
begin;

do $$
declare
  v_today date := timezone('Asia/Bangkok', now())::date;
  v_yesterday date := timezone('Asia/Bangkok', now())::date - 1;
  v_actor_id uuid := '30000000-0000-4000-8000-000000000001';
  v_menu_id uuid := '40000000-0000-4000-8000-000000000001';
  v_meat_id uuid := '40000000-0000-4000-8000-000000000002';
  v_batch_id uuid := '50000000-0000-4000-8000-000000000001';
  v_removal_id uuid := '60000000-0000-4000-8000-000000000001';
  v_stock_out_count integer;
begin
  insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_actor_id, 'authenticated', 'authenticated', 'post-close-test@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );
  insert into public.app_members (user_id, display_name, role)
  values (v_actor_id, 'Post-close test', 'front')
  on conflict (user_id) do update
    set display_name = excluded.display_name, role = excluded.role, active = true;
  perform set_config('request.jwt.claim.sub', v_actor_id::text, true);

  insert into public.menu_items (id, name)
  values (v_menu_id, 'Post-close state test menu');
  insert into public.meat_options (id, name)
  values (v_meat_id, 'Post-close test option');

  insert into public.production_batches (id, menu_id, meat_option_id, production_date, quantity_produced, expiry_date)
  values (v_batch_id, v_menu_id, v_meat_id, v_yesterday, 3, v_today + 2);

  insert into public.daily_closings (business_date, version, status, closed_at)
  values (v_yesterday, 1, 'closed', now());

  begin
    insert into public.post_close_stock_outs (id, removal_date, production_batch_id, quantity, reason)
    values (v_removal_id, v_today, v_batch_id, 1, 'Guest pickup');
    raise exception 'An open business date accepted a post-close removal.';
  exception when check_violation then
    if sqlerrm <> 'Close this day before recording a post-close removal.' then raise; end if;
  end;

  insert into public.daily_closings (business_date, version, status, closed_at)
  values (v_today, 1, 'closed', now());

  insert into public.post_close_stock_outs (id, removal_date, production_batch_id, quantity, reason)
  values (v_removal_id, v_today, v_batch_id, 1, 'Guest pickup');

  select count(*) into v_stock_out_count
  from public.stock_movements
  where source_id = v_removal_id and movement_type = 'post_close_removal';
  if v_stock_out_count <> 1 then
    raise exception 'A closed-day removal did not create exactly one stock movement.';
  end if;

  update public.daily_closings set status = 'reopened'
  where business_date = v_today and version = 1;

  begin
    insert into public.post_close_stock_outs (id, removal_date, production_batch_id, quantity, reason)
    values ('60000000-0000-4000-8000-000000000002', v_today, v_batch_id, 1, 'Guest pickup');
    raise exception 'A reopened business date accepted a post-close removal.';
  exception when check_violation then
    if sqlerrm <> 'Close this day before recording a post-close removal.' then raise; end if;
  end;
end;
$$;

rollback;
