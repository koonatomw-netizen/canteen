-- Podcast-room housekeeping: unanswered requests expire, and old personal data is removed.
--
-- * A pending request must be answered within 24 hours of being sent, and
--   before it starts — whichever comes first. After that it becomes 'expired'
--   and its time is free again.
-- * Six months after a booking ends, the customer's name, phone, email,
--   organisation and purpose are removed. Times and status stay for room
--   statistics. Staff names in status_changed_by_name are not customer data.
--
-- There is no scheduler: housekeeping runs whenever a customer sends a request
-- and whenever front, manager or admin staff open the bookings page. Public
-- availability and lookups also treat overdue requests as expired straight away.
--
-- Only podcast-room objects change; nothing else in the canteen schema does.

begin;

alter table public.room_bookings drop constraint room_bookings_status_check;
alter table public.room_bookings add constraint room_bookings_status_check
  check (status in ('pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'expired'));

alter table public.room_bookings
  add column personal_data_removed_at timestamptz,
  alter column customer_name drop not null,
  alter column customer_phone drop not null,
  alter column purpose drop not null,
  add constraint room_bookings_personal_data_present check (
    personal_data_removed_at is not null
    or (customer_name is not null and customer_phone is not null and purpose is not null)
  );

-- When staff must answer a request by.
create or replace function app_private.room_request_deadline(p_created_at timestamptz, p_starts_at timestamptz)
returns timestamptz
language sql immutable
set search_path = ''
as $$
  select least(p_created_at + interval '24 hours', p_starts_at);
$$;
revoke all on function app_private.room_request_deadline(timestamptz, timestamptz) from public, anon, authenticated;

-- Activity log: expiry is done by the system, so it records no actor.
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
    v_action := case new.status
      when 'confirmed' then 'approved'
      when 'rejected' then 'rejected'
      when 'cancelled' then 'cancelled'
      when 'completed' then 'completed'
      when 'expired' then 'expired'
      else 'updated' end;
  else
    v_action := 'created';
  end if;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, description, before_data, after_data)
  values (case when v_action = 'expired' then null else auth.uid() end, v_action, 'room_bookings', new.id,
          initcap(v_action) || ' podcast room booking ' || new.reference, v_old, v_new);
  return new;
end;
$$;

create or replace function app_private.expire_room_requests()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.room_bookings
  set status = 'expired', status_changed_at = now(), status_changed_by = null,
      status_changed_by_name = 'System', updated_at = now()
  where status = 'pending' and app_private.room_request_deadline(created_at, starts_at) <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function app_private.expire_room_requests() from public, anon, authenticated;

create or replace function app_private.remove_old_room_booking_personal_data()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.room_bookings
  set customer_name = null, customer_phone = null, customer_email = null, purpose = null,
      organization = null, personal_data_removed_at = now(), updated_at = now()
  where personal_data_removed_at is null
    and status <> 'pending'
    and ends_at < now() - interval '6 months';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    insert into public.activity_logs (actor_id, action, entity_type, entity_id, description, after_data)
    values (null, 'personal_data_removed', 'room_bookings', null,
            'Removed customer details from ' || v_count || ' podcast room bookings that ended over 6 months ago',
            jsonb_build_object('bookings', v_count));
  end if;
  return v_count;
end;
$$;
revoke all on function app_private.remove_old_room_booking_personal_data() from public, anon, authenticated;

-- Staff: run housekeeping when the bookings page opens. Returns how many rows changed.
create or replace function public.run_room_booking_housekeeping()
returns integer
language plpgsql security definer
set search_path = ''
as $$
begin
  if not app_private.has_app_role(array['admin', 'manager', 'front']) then
    raise exception 'Only front, manager or admin staff can run booking housekeeping.' using errcode = '42501';
  end if;
  return app_private.expire_room_requests() + app_private.remove_old_room_booking_personal_data();
end;
$$;
revoke all on function public.run_room_booking_housekeeping() from public, anon;
grant execute on function public.run_room_booking_housekeeping() to authenticated;

-- Public: busy intervals only. Overdue requests no longer hold their time.
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
    where r.slug = p_room_slug
      and (b.status = 'confirmed'
           or (b.status = 'pending' and app_private.room_request_deadline(b.created_at, b.starts_at) > now()))
      and b.starts_at < p_to and b.ends_at > p_from
    order by b.starts_at;
end;
$$;

-- Public: what a customer may see about their own booking, now with the reply deadline.
drop function public.get_room_booking_confirmation(text);
create function public.get_room_booking_confirmation(p_reference text)
returns table (reference text, starts_at timestamptz, ends_at timestamptz, duration_minutes integer, status text, respond_by timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select b.reference, b.starts_at, b.ends_at, b.duration_minutes,
         case when b.status = 'pending' and app_private.room_request_deadline(b.created_at, b.starts_at) <= now()
              then 'expired' else b.status end,
         case when b.status = 'pending' then app_private.room_request_deadline(b.created_at, b.starts_at) end
  from public.room_bookings b
  where b.reference = upper(trim(p_reference));
$$;
revoke all on function public.get_room_booking_confirmation(text) from public;
grant execute on function public.get_room_booking_confirmation(text) to anon, authenticated;

-- Public: same rules as before; housekeeping runs first so overdue requests free their time.
create or replace function public.create_room_booking(
  p_room_slug text,
  p_date date,
  p_start_time time,
  p_duration_minutes integer,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_purpose text,
  p_organization text,
  p_guest_count integer,
  p_accept_rules boolean,
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
  perform app_private.expire_room_requests();
  perform app_private.remove_old_room_booking_personal_data();

  select * into v_rules from app_private.room_booking_rules();

  select id into v_room_id from public.rooms where slug = p_room_slug and is_active;
  if v_room_id is null then raise exception 'This room cannot be booked.' using errcode = '22023'; end if;

  if p_date is null or p_start_time is null or p_duration_minutes is null then
    raise exception 'Choose a date, start time and duration.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_customer_name, '')), '') is null
     or nullif(trim(coalesce(p_customer_phone, '')), '') is null
     or nullif(trim(coalesce(p_purpose, '')), '') is null then
    raise exception 'details_required' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_organization, '')), '') is null then
    raise exception 'organization_required' using errcode = '22023';
  end if;
  if p_guest_count is null or p_guest_count not between 1 and 10 then
    raise exception 'invalid_guest_count' using errcode = '22023';
  end if;
  if p_accept_rules is not true then
    raise exception 'rules_not_accepted' using errcode = '22023';
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
        organization, guest_count, rules_accepted_at,
        starts_at, ends_at, duration_minutes, status, source
      ) values (
        v_reference, v_room_id, trim(p_customer_name), trim(p_customer_phone),
        nullif(lower(trim(coalesce(p_customer_email, ''))), ''), trim(p_purpose),
        trim(p_organization), p_guest_count, now(),
        v_starts, v_ends, p_duration_minutes, 'pending',
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

-- Staff: as before, but overdue requests expire first and cannot be approved.
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
  if p_status not in ('confirmed', 'rejected', 'cancelled', 'completed') then
    raise exception 'Choose confirmed, rejected, cancelled or completed.' using errcode = '22023';
  end if;
  perform app_private.expire_room_requests();
  select * into v_booking from public.room_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found.' using errcode = '23503'; end if;
  if p_status in ('confirmed', 'rejected') then
    if v_booking.status = 'expired' then
      raise exception 'This request expired because it was not answered in time.' using errcode = '23514';
    end if;
    if v_booking.status <> 'pending' then
      raise exception 'Only a pending request can be approved or rejected.' using errcode = '23514';
    end if;
  elsif p_status = 'cancelled' then
    if v_booking.status not in ('pending', 'confirmed') then
      raise exception 'Only a pending or confirmed booking can be cancelled.' using errcode = '23514';
    end if;
  else
    if v_booking.status <> 'confirmed' then
      raise exception 'Only a confirmed booking can be marked completed.' using errcode = '23514';
    end if;
    if v_booking.ends_at > now() then
      raise exception 'A booking can be marked completed after it ends.' using errcode = '23514';
    end if;
  end if;
  select nullif(btrim(display_name), '') into v_name from public.app_members where user_id = auth.uid();
  update public.room_bookings
  set status = p_status, status_changed_at = now(), status_changed_by = auth.uid(),
      status_changed_by_name = coalesce(v_name, 'Unknown staff'), updated_at = now()
  where id = p_booking_id;
end;
$$;

-- Requests already overdue when this runs.
select app_private.expire_room_requests();

notify pgrst, 'reload schema';
commit;
