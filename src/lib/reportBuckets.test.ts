import { describe, expect, it } from 'vitest';
import { addCalendarDays } from './dates';
import { buildReportDateBuckets } from './reportBuckets';

describe('buildReportDateBuckets', () => {
  it('keeps ranges of fourteen days or less at daily resolution', () => {
    expect(buildReportDateBuckets('2024-02-27', '2024-03-02')).toEqual([
      { start: '2024-02-27', end: '2024-02-27' },
      { start: '2024-02-28', end: '2024-02-28' },
      { start: '2024-02-29', end: '2024-02-29' },
      { start: '2024-03-01', end: '2024-03-01' },
      { start: '2024-03-02', end: '2024-03-02' },
    ]);
  });

  it('covers the full long range in contiguous buckets', () => {
    const buckets = buildReportDateBuckets('2026-01-01', '2026-02-14');

    expect(buckets).toHaveLength(14);
    expect(buckets[0]?.start).toBe('2026-01-01');
    expect(buckets.at(-1)?.end).toBe('2026-02-14');
    for (let index = 1; index < buckets.length; index += 1) {
      expect(buckets[index]?.start).toBe(addCalendarDays(buckets[index - 1]!.end, 1));
    }
  });

  it('creates one bucket for a single date', () => {
    expect(buildReportDateBuckets('2026-10-07', '2026-10-07')).toEqual([
      { start: '2026-10-07', end: '2026-10-07' },
    ]);
  });
});
