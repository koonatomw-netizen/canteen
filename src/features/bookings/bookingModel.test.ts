import { describe, expect, it } from 'vitest';
import {
  businessDateTimeToInstant,
  canApprove,
  canMarkCompleted,
  holdsTime,
  normalizeBookingReference,
  computeDayAvailability,
  daySchedule,
  isInRoomNow,
  toBusinessTime,
  weekDates,
  type StaffBooking,
} from './bookingModel';

const NOW = new Date('2026-10-20T02:00:00Z');
const DAY = '2026-10-21';

function booking(start: string, end: string, status: StaffBooking['status'] = 'confirmed'): StaffBooking {
  return {
    id: start,
    reference: '4S-AAAA-BBBB',
    customer_name: 'Somchai',
    customer_phone: '0812345678',
    customer_email: null,
    purpose: 'Episode',
    organization: 'Chiang Mai University',
    guest_count: 2,
    starts_at: start,
    ends_at: end,
    duration_minutes: 60,
    status,
    source: 'website',
    status_changed_by_name: null,
  };
}

describe('podcast room booking availability', () => {
  it('offers half-hour starts and limits durations at closing', () => {
    const availability = computeDayAvailability(DAY, [], NOW);
    expect(availability.slots).toHaveLength(24);
    expect(availability.slots[0].startTime).toBe('09:00');
    expect(availability.slots.at(-1)?.durations).toEqual([30]);
    expect(availability.slots.find((slot) => slot.startTime === '19:00')?.durations).toEqual([30, 60, 90, 120]);
  });

  it('blocks overlaps and allows the next booking at the exact end time', () => {
    const availability = computeDayAvailability(DAY, [{
      startsAt: businessDateTimeToInstant(DAY, '10:00'),
      endsAt: businessDateTimeToInstant(DAY, '11:00'),
    }], NOW);
    expect(availability.slots.find((slot) => slot.startTime === '10:30')?.status).toBe('booked');
    expect(availability.slots.find((slot) => slot.startTime === '09:00')?.durations).toEqual([30, 60]);
    expect(availability.slots.find((slot) => slot.startTime === '11:00')?.status).toBe('available');
  });
});

describe('podcast room staff schedule', () => {
  it('builds a Monday-to-Sunday week and interleaves free time', () => {
    expect(weekDates('2026-10-21')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    const items = daySchedule([
      booking('2026-10-21T03:00:00Z', '2026-10-21T04:00:00Z'),
      booking('2026-10-21T05:00:00Z', '2026-10-21T06:00:00Z', 'cancelled'),
      booking('2026-10-21T06:00:00Z', '2026-10-21T07:00:00Z', 'rejected'),
      booking('2026-10-21T07:00:00Z', '2026-10-21T08:00:00Z'),
      booking('2026-10-21T09:00:00Z', '2026-10-21T10:00:00Z', 'pending'),
    ], DAY);
    expect(items.map((item) => item.kind === 'free' ? `free ${item.start}-${item.end}` : `booked ${toBusinessTime(new Date(item.booking.starts_at))}`)).toEqual([
      'free 09:00-10:00', 'booked 10:00', 'free 11:00-14:00', 'booked 14:00', 'free 15:00-16:00', 'booked 16:00', 'free 17:00-21:00',
    ]);
  });

  it('lets staff approve only pending requests that have not ended', () => {
    const request = booking('2026-10-21T03:00:00Z', '2026-10-21T04:00:00Z', 'pending');
    expect(canApprove(request, new Date('2026-10-21T03:30:00Z'))).toBe(true);
    expect(canApprove(request, new Date('2026-10-21T04:00:00Z'))).toBe(false);
    expect(canApprove({ ...request, status: 'confirmed' }, new Date('2026-10-21T03:00:00Z'))).toBe(false);
    expect(isInRoomNow(request, new Date('2026-10-21T03:30:00Z'))).toBe(false);
    expect(holdsTime('pending')).toBe(true);
    expect(holdsTime('rejected')).toBe(false);
  });

  it('allows completion only after the booking ends and detects current use', () => {
    const item = booking('2026-10-21T03:00:00Z', '2026-10-21T04:00:00Z');
    expect(canMarkCompleted(item, new Date('2026-10-21T03:59:00Z'))).toBe(false);
    expect(canMarkCompleted(item, new Date('2026-10-21T04:00:00Z'))).toBe(true);
    expect(isInRoomNow(item, new Date('2026-10-21T03:30:00Z'))).toBe(true);
  });

  it('normalizes typed booking references and rejects anything else', () => {
    expect(normalizeBookingReference('4S-ABCD-EF23')).toBe('4S-ABCD-EF23');
    expect(normalizeBookingReference('  4s abcd ef23 ')).toBe('4S-ABCD-EF23');
    expect(normalizeBookingReference('abcdef23')).toBe('4S-ABCD-EF23');
    expect(normalizeBookingReference('4SABCDEF23')).toBe('4S-ABCD-EF23');
    expect(normalizeBookingReference('4S-ABCD-EF2')).toBeNull();
    expect(normalizeBookingReference('4S-ABCD-EF10')).toBeNull();
    expect(normalizeBookingReference('')).toBeNull();
  });
});
