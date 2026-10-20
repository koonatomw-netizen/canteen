/** Customer-facing hostnames that serve only the public Podcast Room pages. */
// podcast.localhost resolves only to the local machine; it lets the booking host be tested in development.
export const BOOKING_HOSTS = ['podcast.4seas.xyz', 'podcast.localhost'] as const;

export function isBookingHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return (BOOKING_HOSTS as readonly string[]).includes(host);
}

export function isPublicBookingPath(pathname: string): boolean {
  return pathname === '/book'
    || pathname === '/my-booking'
    || pathname === '/privacy'
    || /^\/booking\/confirmation\/[^/]+$/.test(pathname);
}

/** Where a request on the booking host must go instead, or null when it may stay. */
export function bookingHostRedirect(hostname: string, pathname: string): string | null {
  if (!isBookingHost(hostname) || isPublicBookingPath(pathname)) return null;
  return '/book';
}
