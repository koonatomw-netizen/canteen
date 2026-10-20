-- Podcast-room bookings for 4Seas Nimman.
--
-- Additive only: creates new tables and functions and changes nothing that
-- already exists. Staff access uses the existing roles through
-- app_private.has_app_role():
--   admin, manager, front  view, cancel, and complete bookings
--   auditor                view only
--   kitchen, coliving      no access
-- Public customers (anon) never read booking rows. They can only see busy
-- intervals, create a booking, and look up their own booking's times.

begin;

create extension if not exists btree_gist with schema extensions;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,50}$'),
  name text not null check (length(trim(name)) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Fixed id so the booking site and this database agree on the first room.
insert into public.rooms (id, slug, name)
values ('00000000-0000-4000-8000-000000000001', 'podcast-room', 'Podcast Room')
on conflict do nothing;

create table public.room_bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^4S-[A-Z2-9]{4}-[A-Z2-9]{4}$'),
  room_id uuid not null references public.rooms(id) on delete restrict,
  customer_name text not null check (length(trim(customer_name)) between 1 and 100),
  customer_phone text not null check (
    customer_phone ~ '^[0-9+\-\s().]+$'
    and length(regexp_replace(customer_phone, '\D', '', 'g')) between 9 and 15
  ),
  customer_email text check (
    customer_email is null or (length(customer_email) <= 254 and customer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),
  purpose text not null check (length(trim(purpose)) between 1 and 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes in (30, 60, 90, 120)),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'completed')),
  source text not null default 'website' check (source in ('front_desk_qr', 'website', 'admin')),
  status_changed_at timestamptz,
  status_changed_by uuid references auth.users(id) on delete set null,
  status_changed_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_bookings_end_matches_duration check (ends_at = starts_at + make_interval(mins => duration_minutes)),
  -- Final guard against double booking, even for simultaneous requests.
  -- Half-open ranges let one booking end exactly when the next begins.
  constraint room_bookings_no_overlap exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'confirmed')
);
create index room_bookings_room_start_idx on public.room_bookings (room_id, starts_at);

-- Booking events in the shared activity log carry the reference, times and
-- status only — never the customer's name, phone, email or purpose.
create or replace function app_private.log_room_booking()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_action text;
begin
  v_new := jsonb_build_object('reference', new.reference, 'starts_at', new.starts_at, 'ends_at', new.ends_at,
                              'duration_minutes', new.duration_minutes, 'status', new.status, 'source', new.source);
  if tg_op = 'UPDATE' then
    if old.status = new.status then return new; end if;
    v_old := jsonb_build_object('reference', old.reference, 'status', old.status);
    v_action := case new.status when 'cancelled' then 'cancelled' when 'completed' then 'completed' else 'updated' end;
  else
    v_action := 'created';
  end if;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, description, before_data, after_data)
  values (auth.uid(), v_action, 'room_bookings', new.id,
          initcap(v_action) || ' podcast room booking ' || new.reference, v_old, v_new);
  return new;
end;
$$;
revoke all on function app_private.log_room_booking() from public, anon, authenticated;

create trigger room_bookings_activity after insert or update of status on public.room_bookings
for each row execute function app_private.log_room_booking();

-- Opening rules. Keep in sync with the booking site's src/config (business.ts, booking.ts).
create or replace function app_private.room_booking_rules()
returns table (open_time time, close_time time, slot_minutes integer, durations integer[], window_days integer)
language sql immutable
set search_path = ''
as $$
  select time '09:00', time '21:00', 30, array[30, 60, 90, 120], 30;
$$;
revoke all on function app_private.room_booking_rules() from public, anon, authenticated;

-- Public: busy intervals only, no customer details.
create or replace function public.get_room_busy_intervals(p_room_slug text, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '35 days' then
    raise exception 'Ask for a range of up to 35 days.' using errcode = '22023';
  end if;
  return query
    select b.starts_at, b.ends_at
    from public.room_bookings b
    join public.rooms r on r.id = b.room_id
    where r.slug = p_room_slug and b.status = 'confirmed'
      and b.starts_at < p_to and b.ends_at > p_from
    order by b.starts_at;
end;
$$;

-- Public: validate every rule and reserve the slot. Raises 23P01 when the
-- slot was taken, 22023 (message = rule code) for an invalid request.
create or replace function public.create_room_booking(
  p_room_slug text,
  p_date date,
  p_start_time time,
  p_duration_minutes integer,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_purpose text,
  p_source text default 'website'
)
returns table (reference text, starts_at timestamptz, ends_at timestamptz, duration_minutes integer, status text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_rules record;
  v_room_id uuid;
  v_today date := timezone('Asia/Bangkok', now())::date;
  v_starts timestamptz;
  v_ends timestamptz;
  v_reference text;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_byte integer;
  v_attempt integer := 0;
  v_row public.room_bookings%rowtype;
begin
  select * into v_rules from app_private.room_booking_rules();

  select id into v_room_id from public.rooms where slug = p_room_slug and is_active;
  if v_room_id is null then raise exception 'This room cannot be booked.' using errcode = '22023'; end if;

  if p_date is null or p_start_time is null or p_duration_minutes is null then
    raise exception 'Choose a date, start time and duration.' using errcode = '22023';
  end if;
  if not (p_duration_minutes = any (v_rules.durations)) then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  if p_date < v_today or p_date > v_today + (v_rules.window_days - 1) then
    raise exception 'date_out_of_window' using errcode = '22023';
  end if;
  if extract(second from p_start_time) <> 0
     or (extract(epoch from (p_start_time - v_rules.open_time))::integer / 60) % v_rules.slot_minutes <> 0 then
    raise exception 'not_on_grid' using errcode = '22023';
  end if;
  if p_start_time < v_rules.open_time then raise exception 'before_opening' using errcode = '22023'; end if;
  if p_start_time + make_interval(mins => p_duration_minutes) > v_rules.close_time
     or p_start_time + make_interval(mins => p_duration_minutes) < p_start_time then
    raise exception 'after_closing' using errcode = '22023';
  end if;

  v_starts := (p_date + p_start_time) at time zone 'Asia/Bangkok';
  v_ends := v_starts + make_interval(mins => p_duration_minutes);
  if v_starts <= now() then raise exception 'in_past' using errcode = '22023'; end if;

  loop
    v_attempt := v_attempt + 1;
    -- 8 characters from a 31-letter alphabet using the random bytes of two v4 UUIDs.
    v_bytes := decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex');
    v_reference := '';
    for i in 0 .. length(v_bytes) - 1 loop
      exit when length(v_reference) = 8;
      continue when i % 16 in (6, 8); -- UUID version/variant bytes are not random
      v_byte := get_byte(v_bytes, i);
      continue when v_byte >= 248;    -- keep the distribution even
      v_reference := v_reference || substr(v_alphabet, 1 + v_byte % 31, 1);
    end loop;
    continue when length(v_reference) < 8;
    v_reference := '4S-' || left(v_reference, 4) || '-' || right(v_reference, 4);

    begin
      insert into public.room_bookings (
        reference, room_id, customer_name, customer_phone, customer_email, purpose,
        starts_at, ends_at, duration_minutes, status, source
      ) values (
        v_reference, v_room_id, trim(p_customer_name), trim(p_customer_phone),
        nullif(lower(trim(coalesce(p_customer_email, ''))), ''), trim(p_purpose),
        v_starts, v_ends, p_duration_minutes, 'confirmed',
        case when p_source = 'front_desk_qr' then 'front_desk_qr' else 'website' end
      )
      returning * into v_row;
      exit;
    exception
      when unique_violation then
        -- Reference collision: try a new one. Anything else is a real error.
        if v_attempt >= 5 then raise; end if;
      when exclusion_violation then
        raise exception 'That time was just booked. Please choose another available slot.' using errcode = '23P01';
    end;
  end loop;

  return query select v_row.reference, v_row.starts_at, v_row.ends_at, v_row.duration_minutes, v_row.status;
end;
$$;

-- Public: what a customer may see about their own booking (no personal details).
create or replace function public.get_room_booking_confirmation(p_reference text)
returns table (reference text, starts_at timestamptz, ends_at timestamptz, duration_minutes integer, status text)
language sql stable security definer
set search_path = ''
as $$
  select b.reference, b.starts_at, b.ends_at, b.duration_minutes, b.status
  from public.room_bookings b
  where b.reference = upper(trim(p_reference));
$$;

-- Staff: cancel any time; mark completed once the booking has ended.
create or replace function public.set_room_booking_status(p_booking_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_booking public.room_bookings%rowtype;
  v_name text;
begin
  if not app_private.has_app_role(array['admin', 'manager', 'front']) then
    raise exception 'Only front, manager or admin staff can change bookings.' using errcode = '42501';
  end if;
  if p_status not in ('cancelled', 'completed') then
    raise exception 'Choose cancelled or completed.' using errcode = '22023';
  end if;
  select * into v_booking from public.room_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found.' using errcode = '23503'; end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'Only a confirmed booking can be changed.' using errcode = '23514';
  end if;
  if p_status = 'completed' and v_booking.ends_at > now() then
    raise exception 'A booking can be marked completed after it ends.' using errcode = '23514';
  end if;
  select nullif(btrim(display_name), '') into v_name from public.app_members where user_id = auth.uid();
  update public.room_bookings
  set status = p_status, status_changed_at = now(), status_changed_by = auth.uid(),
      status_changed_by_name = coalesce(v_name, 'Unknown staff'), updated_at = now()
  where id = p_booking_id;
end;
$$;

revoke all on function public.get_room_busy_intervals(text, timestamptz, timestamptz) from public;
revoke all on function public.create_room_booking(text, date, time, integer, text, text, text, text, text) from public;
revoke all on function public.get_room_booking_confirmation(text) from public;
revoke all on function public.set_room_booking_status(uuid, text) from public, anon;
grant execute on function public.get_room_busy_intervals(text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.create_room_booking(text, date, time, integer, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_room_booking_confirmation(text) to anon, authenticated;
grant execute on function public.set_room_booking_status(uuid, text) to authenticated;

alter table public.rooms enable row level security;
alter table public.room_bookings enable row level security;

grant usage on schema public to anon;
grant select on public.rooms, public.room_bookings to authenticated;

create policy rooms_read_booking_roles on public.rooms for select to authenticated
  using ((select app_private.has_app_role(array['admin', 'manager', 'front', 'auditor'])));
create policy room_bookings_read_booking_roles on public.room_bookings for select to authenticated
  using ((select app_private.has_app_role(array['admin', 'manager', 'front', 'auditor'])));

notify pgrst, 'reload schema';
commit;
