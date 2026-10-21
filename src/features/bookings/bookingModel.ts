import { addCalendarDays, businessDateNow, BUSINESS_TIME_ZONE } from '../../lib/dates';

export const BOOKING_OPEN_TIME = '09:00';
export const BOOKING_CLOSE_TIME = '21:00';
export const BOOKING_SLOT_MINUTES = 30;
export const BOOKING_WINDOW_DAYS = 30;
export const BOOKING_DURATIONS = [30, 60, 90, 120] as const;
export const PODCAST_ROOM_SLUG = 'podcast-room';
export const BOOKING_MAX_GUESTS = 10;
// The room holds expensive equipment, so every booker accepts these before requesting.
export const BOOKING_ROOM_RULES = [
  'The person who booked must be present for the whole booking and show an ID card or passport at the front desk.',
  'Do not move, unplug or take any equipment out of the room. Ask staff if something needs changing.',
  'No food or drinks near the equipment. Closed water bottles only.',
  'Report any damage or problem to staff straight away. The booker is responsible for damage or loss during the booking.',
  'Finish on time and leave the room as you found it.',
] as const;

export type BookingStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'completed';
export type BookingSource = 'front_desk_qr' | 'website' | 'admin';

export interface StaffBooking {
  id: string;
  reference: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  purpose: string;
  /** Empty for bookings made before staff approval was required. */
  organization: string | null;
  guest_count: number | null;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  status: BookingStatus;
  source: BookingSource;
  status_changed_by_name: string | null;
}

export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
}

export interface TimeSlot {
  startTime: string;
  status: 'available' | 'booked' | 'past';
  durations: number[];
}

export interface DayAvailability {
  date: string;
  bookable: boolean;
  slots: TimeSlot[];
}

export interface DateSummary {
  date: string;
  availableStarts: number;
}

export type ScheduleItem =
  | { kind: 'free'; start: string; end: string }
  | { kind: 'booking'; booking: StaffBooking };

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function businessDateTimeToInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+07:00`);
}

export function toBusinessDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function toBusinessTime(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

export function businessDayBounds(date: string): { start: Date; end: Date } {
  return {
    start: businessDateTimeToInstant(date, '00:00'),
    end: businessDateTimeToInstant(addCalendarDays(date, 1), '00:00'),
  };
}

function isValidDate(date: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isValidTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function checkSlotRules(date: string, startTime: string, durationMinutes: number, now: Date = new Date()): string[] {
  if (!isValidDate(date)) return ['INVALID_DATE'];
  if (!isValidTime(startTime)) return ['INVALID_TIME'];
  const issues: string[] = [];
  const today = businessDateNow(now);
  const lastDate = addCalendarDays(today, BOOKING_WINDOW_DAYS - 1);
  const start = timeToMinutes(startTime);
  const open = timeToMinutes(BOOKING_OPEN_TIME);
  const close = timeToMinutes(BOOKING_CLOSE_TIME);

  if (!(BOOKING_DURATIONS as readonly number[]).includes(durationMinutes)) issues.push('INVALID_DURATION');
  if (date < today || date > lastDate) issues.push('DATE_OUT_OF_WINDOW');
  if ((start - open) % BOOKING_SLOT_MINUTES !== 0) issues.push('NOT_ON_GRID');
  if (start < open) issues.push('BEFORE_OPENING');
  if (start >= close || start + durationMinutes > close) issues.push('AFTER_CLOSING');
  if (businessDateTimeToInstant(date, startTime).getTime() <= now.getTime()) issues.push('IN_PAST');
  return issues;
}

export function computeDayAvailability(date: string, busy: BusyInterval[], now: Date = new Date()): DayAvailability {
  const bookable = date >= businessDateNow(now) && date <= addCalendarDays(businessDateNow(now), BOOKING_WINDOW_DAYS - 1);
  const slots: TimeSlot[] = [];
  const open = timeToMinutes(BOOKING_OPEN_TIME);
  const close = timeToMinutes(BOOKING_CLOSE_TIME);

  for (let start = open; start + BOOKING_SLOT_MINUTES <= close; start += BOOKING_SLOT_MINUTES) {
    const startTime = minutesToTime(start);
    const startsAt = businessDateTimeToInstant(date, startTime);
    const firstBlockEnd = new Date(startsAt.getTime() + BOOKING_SLOT_MINUTES * 60_000);
    let status: TimeSlot['status'] = 'available';
    if (busy.some((item) => intervalsOverlap(startsAt, firstBlockEnd, item.startsAt, item.endsAt))) status = 'booked';
    else if (startsAt.getTime() < now.getTime()) status = 'past';

    const durations = status === 'available' && bookable
      ? BOOKING_DURATIONS.filter((duration) => {
          if (checkSlotRules(date, startTime, duration, now).length > 0) return false;
          const endsAt = new Date(startsAt.getTime() + duration * 60_000);
          return !busy.some((item) => intervalsOverlap(startsAt, endsAt, item.startsAt, item.endsAt));
        })
      : [];
    slots.push({ startTime, status, durations: [...durations] });
  }
  return { date, bookable, slots };
}

export function computeWindowSummary(busy: BusyInterval[], now: Date = new Date()): DateSummary[] {
  const first = businessDateNow(now);
  return Array.from({ length: BOOKING_WINDOW_DAYS }, (_, index) => {
    const date = addCalendarDays(first, index);
    const bounds = businessDayBounds(date);
    const dayBusy = busy.filter((item) => intervalsOverlap(bounds.start, bounds.end, item.startsAt, item.endsAt));
    return {
      date,
      availableStarts: computeDayAvailability(date, dayBusy, now).slots.filter((slot) => slot.durations.length > 0).length,
    };
  });
}

export function weekDates(date: string): string[] {
  const mondayOffset = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addCalendarDays(date, -mondayOffset);
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(monday, index));
}

export function daySchedule(bookings: StaffBooking[], date: string): ScheduleItem[] {
  const active = bookings
    .filter((booking) => holdsTime(booking.status) && toBusinessDate(new Date(booking.starts_at)) === date)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const items: ScheduleItem[] = [];
  let cursor = timeToMinutes(BOOKING_OPEN_TIME);
  for (const booking of active) {
    const start = timeToMinutes(toBusinessTime(new Date(booking.starts_at)));
    const end = timeToMinutes(toBusinessTime(new Date(booking.ends_at))) || 24 * 60;
    if (start > cursor) items.push({ kind: 'free', start: minutesToTime(cursor), end: minutesToTime(start) });
    items.push({ kind: 'booking', booking });
    cursor = Math.max(cursor, end);
  }
  const close = timeToMinutes(BOOKING_CLOSE_TIME);
  if (cursor < close) items.push({ kind: 'free', start: minutesToTime(cursor), end: minutesToTime(close) });
  return items;
}

/** Whether a booking takes up its time on the schedule (rejected and cancelled ones free it). */
export function holdsTime(status: BookingStatus): boolean {
  return status === 'pending' || status === 'confirmed' || status === 'completed';
}

export function canApprove(booking: StaffBooking, now: Date): boolean {
  return booking.status === 'pending' && new Date(booking.ends_at).getTime() > now.getTime();
}

export function canMarkCompleted(booking: StaffBooking, now: Date): boolean {
  return booking.status === 'confirmed' && new Date(booking.ends_at).getTime() <= now.getTime();
}

export function isInRoomNow(booking: StaffBooking, now: Date): boolean {
  return booking.status === 'confirmed'
    && new Date(booking.starts_at).getTime() <= now.getTime()
    && now.getTime() < new Date(booking.ends_at).getTime();
}

/** Accepts a booking reference as people type it (any case, spaces, with or without the 4S- prefix). */
export function normalizeBookingReference(input: string): string | null {
  let code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length === 10 && code.startsWith('4S')) code = code.slice(2);
  if (!/^[A-Z2-9]{8}$/.test(code)) return null;
  return `4S-${code.slice(0, 4)}-${code.slice(4)}`;
}
