import { addCalendarDays } from './dates';

/** Inclusive range of Asia/Bangkok business dates (YYYY-MM-DD). */
export type DateRange = { start: string; end: string };

export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addCalendarDays(date, -((weekday + 6) % 7));
}

export function lastFullWeek(today: string): DateRange {
  const start = addCalendarDays(mondayOf(today), -7);
  return { start, end: addCalendarDays(start, 6) };
}

export function lastFourFullWeeks(today: string): DateRange {
  const end = addCalendarDays(mondayOf(today), -1);
  return { start: addCalendarDays(end, -27), end };
}

export function suggestionWindow(end: string): DateRange {
  return { start: addCalendarDays(end, -27), end };
}

export function trendWindow(end: string): DateRange {
  return { start: addCalendarDays(mondayOf(end), -49), end };
}

export function trendWeeks(end: string): Array<DateRange & { partial: boolean }> {
  const first = trendWindow(end).start;
  return Array.from({ length: 8 }, (_, index) => {
    const start = addCalendarDays(first, index * 7);
    const fullEnd = addCalendarDays(start, 6);
    return fullEnd > end ? { start, end, partial: true } : { start, end: fullEnd, partial: false };
  });
}
