import { describe, expect, it } from 'vitest';
import { addCalendarDays } from './dates';

describe('addCalendarDays', () => {
  it('moves across month, year and leap-day boundaries as calendar dates', () => {
    expect(addCalendarDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('applies menu shelf life and yesterday lookups without timezone drift', () => {
    expect(addCalendarDays('2026-10-15', 3)).toBe('2026-10-18');
    expect(addCalendarDays('2026-10-15', -1)).toBe('2026-10-14');
    expect(addCalendarDays('2026-10-15', 0)).toBe('2026-10-15');
  });
});
