-- Podcast-room request limits, so nobody can fill the calendar with fake requests.
--
-- * One phone number can have at most 2 requests waiting for approval at once.
--   Thai numbers written as 08x… and +66 8x… count as the same number.
-- * At most 20 new requests per hour across the whole site.
--
-- Requests are checked one at a time (transaction advisory lock), so
-- simultaneous submissions cannot slip past a limit.
--
-- Only podcast-room objects change; nothing else in the canteen schema does.

begin;

-- Digits only, with a Thai +66 prefix written as a leading 0.
create or replace function app_private.normalize_room_phone(p_phone text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when d ~ '^66[0-9]{8,9}$' then '0' || substr(d, 3)
    else d
  end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) digits;
$$;
revoke all on function app_private.normalize_room_phone(text) from public, anon, authenticated;

-- Public: same rules as before, plus the request limits.
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
  v_phone text;
begin
  -- One request at a time, so the limits below hold for simultaneous submissions.
  perform pg_advisory_xact_lock(hashtext('public.create_room_booking'));

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

  v_phone := app_private.normalize_room_phone(p_customer_phone);
  if (select count(*) from public.room_bookings b
      where b.status = 'pending' and app_private.normalize_room_phone(b.customer_phone) = v_phone) >= 2 then
    raise exception 'too_many_pending_for_phone' using errcode = '22023';
  end if;
  if (select count(*) from public.room_bookings b where b.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too_many_requests' using errcode = '22023';
  end if;

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

notify pgrst, 'reload schema';
commit;
