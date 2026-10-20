import { describe, expect, it } from 'vitest';
import { lastFourFullWeeks, lastFullWeek, mondayOf, suggestionWindow, trendWeeks, trendWindow } from './foodInsights';

describe('report date windows', () => {
  it('finds the Monday of any day in the week', () => {
    expect(mondayOf('2026-10-21')).toBe('2026-10-19');
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
  });

  it('picks the last full Monday–Sunday week and the last four full weeks', () => {
    expect(lastFullWeek('2026-10-20')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(lastFullWeek('2026-10-19')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(lastFourFullWeeks('2026-10-20')).toEqual({ start: '2026-09-21', end: '2026-10-18' });
  });

  it('uses 28 days for suggestions and 8 Monday-start weeks for the trend', () => {
    expect(suggestionWindow('2026-10-18')).toEqual({ start: '2026-09-21', end: '2026-10-18' });
    expect(trendWindow('2026-10-21')).toEqual({ start: '2026-08-31', end: '2026-10-21' });
  });

  it('clips the newest trend week at the end date and marks it partial', () => {
    const weeks = trendWeeks('2026-10-21');
    expect(weeks).toHaveLength(8);
    expect(weeks[0]).toEqual({ start: '2026-08-31', end: '2026-09-06', partial: false });
    expect(weeks[7]).toEqual({ start: '2026-10-19', end: '2026-10-21', partial: true });
    expect(trendWeeks('2026-10-25')[7].partial).toBe(false);
  });
});
