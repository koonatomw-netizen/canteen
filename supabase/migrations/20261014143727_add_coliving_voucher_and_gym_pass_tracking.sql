-- Co-living tracks vouchers and gym passes issued through this website only.
-- This is operational issuance tracking, not a redemption balance or accounting ledger.

alter table public.app_members drop constraint if exists app_members_role_check;
alter table public.app_members
  add constraint app_members_role_check
  check (role in ('admin', 'manager', 'front', 'kitchen', 'auditor', 'coliving'));

create table public.coliving_meal_voucher_issues (
  id uuid primary key default gen_random_uuid(),
  issue_date date not null default (timezone('Asia/Bangkok', now()))::date,
  guest_type text not null check (guest_type in (
    'Coliving', 'Residency', 'Longevity', 'Outside Customer',
    '4Seas Community Member', 'Event', 'Free Residency Project'
  )),
  coupon_color text not null check (coupon_color in ('green', 'orange')),
  quantity integer not null check (quantity > 0),
  amount_thb numeric(12, 2) not null check (amount_thb >= 0),
  payment_status text not null check (payment_status in ('paid', 'complimentary')),
  complimentary_reason text,
  recipient text check (recipient is null or length(trim(recipient)) <= 160),
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  updated_by uuid not null references auth.users(id),
  updated_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  change_reason text,
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  voided_by_name text,
  void_reason text,
  constraint coliving_voucher_complimentary_amount_check
    check ((payment_status = 'complimentary' and amount_thb = 0 and nullif(trim(complimentary_reason), '') is not null)
      or (payment_status = 'paid' and complimentary_reason is null)),
  constraint coliving_voucher_void_fields_check
    check ((voided_at is null and voided_by is null and voided_by_name is null and void_reason is null)
      or (voided_at is not null and voided_by is not null and nullif(trim(void_reason), '') is not null))
);

create table public.coliving_gym_pass_issues (
  id uuid primary key default gen_random_uuid(),
  issue_date date not null default (timezone('Asia/Bangkok', now()))::date,
  guest_type text not null check (guest_type in (
    'Coliving', 'Residency', 'Longevity', 'Outside Customer',
    '4Seas Community Member', 'Event', 'Free Residency Project'
  )),
  pass_type text not null check (pass_type in ('day', 'monthly')),
  quantity integer not null check (quantity > 0),
  amount_thb numeric(12, 2) not null check (amount_thb >= 0),
  start_date date,
  end_date date,
  recipient text check (recipient is null or length(trim(recipient)) <= 160),
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  updated_by uuid not null references auth.users(id),
  updated_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  change_reason text,
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  voided_by_name text,
  void_reason text,
  constraint coliving_gym_monthly_dates_check
    check ((pass_type = 'day' and start_date is null and end_date is null)
      or (pass_type = 'monthly' and start_date is not null and end_date is not null and end_date >= start_date)),
  constraint coliving_gym_void_fields_check
    check ((voided_at is null and voided_by is null and voided_by_name is null and void_reason is null)
      or (voided_at is not null and voided_by is not null and nullif(trim(void_reason), '') is not null))
);

create table public.coliving_record_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('meal_voucher', 'gym_pass')),
  entity_id uuid not null,
  event_type text not null check (event_type in ('created', 'updated', 'voided')),
  actor_id uuid references auth.users(id),
  actor_name text not null,
  reason text not null,
  occurred_at timestamptz not null default now(),
  before_data jsonb,
  after_data jsonb not null
);

create index coliving_voucher_issues_date_idx
  on public.coliving_meal_voucher_issues (issue_date desc) where voided_at is null;
create index coliving_gym_issues_date_idx
  on public.coliving_gym_pass_issues (issue_date desc) where voided_at is null;
create index coliving_record_events_entity_idx
  on public.coliving_record_events (entity_type, entity_id, occurred_at desc);

alter table public.coliving_meal_voucher_issues enable row level security;
alter table public.coliving_gym_pass_issues enable row level security;
alter table public.coliving_record_events enable row level security;

revoke all on table public.coliving_meal_voucher_issues from public, anon, authenticated;
revoke all on table public.coliving_gym_pass_issues from public, anon, authenticated;
revoke all on table public.coliving_record_events from public, anon, authenticated;
grant select, insert, update on table public.coliving_meal_voucher_issues to authenticated;
grant select, insert, update on table public.coliving_gym_pass_issues to authenticated;
grant select on table public.coliving_record_events to authenticated;
grant all on table public.coliving_meal_voucher_issues to service_role;
grant all on table public.coliving_gym_pass_issues to service_role;
grant all on table public.coliving_record_events to service_role;

create policy coliving_vouchers_read_allowed_roles
  on public.coliving_meal_voucher_issues for select to authenticated
  using ((select app_private.has_app_role(array['admin', 'manager', 'coliving'])));
create policy coliving_vouchers_insert_operators
  on public.coliving_meal_voucher_issues for insert to authenticated
  with check ((select app_private.has_app_role(array['admin', 'coliving'])));
create policy coliving_vouchers_update_operators
  on public.coliving_meal_voucher_issues for update to authenticated
  using ((select app_private.has_app_role(array['admin', 'coliving'])))
  with check ((select app_private.has_app_role(array['admin', 'coliving'])));

create policy coliving_gym_passes_read_allowed_roles
  on public.coliving_gym_pass_issues for select to authenticated
  using ((select app_private.has_app_role(array['admin', 'manager', 'coliving'])));
create policy coliving_gym_passes_insert_operators
  on public.coliving_gym_pass_issues for insert to authenticated
  with check ((select app_private.has_app_role(array['admin', 'coliving'])));
create policy coliving_gym_passes_update_operators
  on public.coliving_gym_pass_issues for update to authenticated
  using ((select app_private.has_app_role(array['admin', 'coliving'])))
  with check ((select app_private.has_app_role(array['admin', 'coliving'])));

create policy coliving_events_read_allowed_roles
  on public.coliving_record_events for select to authenticated
  using ((select app_private.has_app_role(array['admin', 'manager', 'coliving'])));

create or replace function app_private.set_coliving_issue_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
begin
  if v_actor is null then
    raise exception 'An authenticated Co-living member is required.' using errcode = '42501';
  end if;
  if new.issue_date > (timezone('Asia/Bangkok', now()))::date then
    raise exception 'An issue date cannot be in the future.' using errcode = '23514';
  end if;

  select coalesce(nullif(trim(m.display_name), ''), nullif(trim(m.email), ''), 'Team member')
    into v_actor_name
  from public.app_members m where m.user_id = v_actor and m.active;
  if v_actor_name is null then
    raise exception 'An active Co-living member is required.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.voided_at is not null or new.voided_by is not null or new.void_reason is not null then
      raise exception 'A new issue cannot start voided.' using errcode = '23514';
    end if;
    new.created_by := v_actor;
    new.created_by_name := v_actor_name;
    new.updated_by := v_actor;
    new.updated_by_name := v_actor_name;
    new.created_at := now();
    new.updated_at := new.created_at;
    new.change_reason := null;
    return new;
  end if;

  if old.voided_at is not null then
    raise exception 'A voided Co-living issue cannot be edited.' using errcode = '23514';
  end if;
  if new.id is distinct from old.id
    or new.created_by is distinct from old.created_by
    or new.created_by_name is distinct from old.created_by_name
    or new.created_at is distinct from old.created_at then
    raise exception 'Issue creation history is immutable.' using errcode = '23514';
  end if;
  if new.voided_at is not null then
    if nullif(trim(new.void_reason), '') is null or length(trim(new.void_reason)) > 500 then
      raise exception 'A cancellation reason of 1 to 500 characters is required.' using errcode = '23514';
    end if;
    perform set_config('app.coliving_change_reason', trim(new.void_reason), true);
    new.voided_at := now();
    new.voided_by := v_actor;
    new.voided_by_name := v_actor_name;
    new.updated_by := v_actor;
    new.updated_by_name := v_actor_name;
    new.updated_at := now();
    new.change_reason := null;
    return new;
  end if;
  if nullif(trim(new.change_reason), '') is null or length(trim(new.change_reason)) > 500 then
    raise exception 'An edit reason of 1 to 500 characters is required.' using errcode = '23514';
  end if;
  perform set_config('app.coliving_change_reason', trim(new.change_reason), true);
  new.change_reason := null;
  new.voided_at := null;
  new.voided_by := null;
  new.voided_by_name := null;
  new.void_reason := null;
  new.updated_by := v_actor;
  new.updated_by_name := v_actor_name;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app_private.audit_coliving_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_type text := case when tg_table_name = 'coliving_meal_voucher_issues' then 'meal_voucher' else 'gym_pass' end;
  v_event_type text;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'created';
    v_reason := 'Issue recorded';
    insert into public.coliving_record_events (entity_type, entity_id, event_type, actor_id, actor_name, reason, after_data)
    values (v_entity_type, new.id, v_event_type, new.created_by, new.created_by_name, v_reason, to_jsonb(new));
    return new;
  end if;
  v_event_type := case when new.voided_at is not null then 'voided' else 'updated' end;
  v_reason := current_setting('app.coliving_change_reason', true);
  insert into public.coliving_record_events
    (entity_type, entity_id, event_type, actor_id, actor_name, reason, before_data, after_data)
  values (v_entity_type, new.id, v_event_type, new.updated_by, new.updated_by_name, v_reason, to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;

revoke all on function app_private.set_coliving_issue_actor() from public, anon, authenticated;
revoke all on function app_private.audit_coliving_issue() from public, anon, authenticated;

create trigger coliving_voucher_set_actor
  before insert or update on public.coliving_meal_voucher_issues
  for each row execute function app_private.set_coliving_issue_actor();
create trigger coliving_voucher_audit
  after insert or update on public.coliving_meal_voucher_issues
  for each row execute function app_private.audit_coliving_issue();
create trigger coliving_gym_set_actor
  before insert or update on public.coliving_gym_pass_issues
  for each row execute function app_private.set_coliving_issue_actor();
create trigger coliving_gym_audit
  after insert or update on public.coliving_gym_pass_issues
  for each row execute function app_private.audit_coliving_issue();

notify pgrst, 'reload schema';
