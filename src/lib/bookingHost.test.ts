import { describe, expect, it } from 'vitest';
import { bookingHostRedirect, isBookingHost, isPublicBookingPath } from './bookingHost';

describe('podcast booking host', () => {
  it('recognises the customer booking domain only', () => {
    expect(isBookingHost('podcast.4seas.xyz')).toBe(true);
    expect(isBookingHost('PODCAST.4seas.xyz.')).toBe(true);
    expect(isBookingHost('canteen-tracking-system.vercel.app')).toBe(false);
    expect(isBookingHost('localhost')).toBe(false);
    expect(isBookingHost('podcast.localhost')).toBe(true);
    expect(isBookingHost('podcast.4seas.xyz.evil.example')).toBe(false);
  });

  it('lists the public booking paths', () => {
    for (const path of ['/book', '/my-booking', '/privacy', '/booking/confirmation/4S-ABCD-EF23']) expect(isPublicBookingPath(path)).toBe(true);
    for (const path of ['/', '/login', '/reports', '/bookings', '/booking/confirmation/', '/book/extra', '/settings']) expect(isPublicBookingPath(path)).toBe(false);
  });

  it('sends every non-booking path on the booking host to /book', () => {
    expect(bookingHostRedirect('podcast.4seas.xyz', '/')).toBe('/book');
    expect(bookingHostRedirect('podcast.4seas.xyz', '/reports')).toBe('/book');
    expect(bookingHostRedirect('podcast.4seas.xyz', '/bookings')).toBe('/book');
    expect(bookingHostRedirect('podcast.4seas.xyz', '/my-booking')).toBeNull();
    expect(bookingHostRedirect('podcast.4seas.xyz', '/booking/confirmation/4S-ABCD-EF23')).toBeNull();
  });

  it('never redirects on the staff host', () => {
    expect(bookingHostRedirect('canteen-tracking-system.vercel.app', '/')).toBeNull();
    expect(bookingHostRedirect('canteen-tracking-system.vercel.app', '/reports')).toBeNull();
  });
});
