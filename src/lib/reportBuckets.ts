import { addCalendarDays } from './dates';

export interface ReportDateBucket {
  start: string;
  end: string;
}

/** Divide an inclusive business-date range into at most fourteen contiguous chart buckets. */
export function buildReportDateBuckets(start: string, end: string): ReportDateBucket[] {
  const startTime = Date.parse(`${start}T00:00:00.000Z`);
  const endTime = Date.parse(`${end}T00:00:00.000Z`);
  const dayCount = Math.max(1, Math.floor((endTime - startTime) / 86_400_000) + 1);
  const bucketCount = Math.min(14, dayCount);

  return Array.from({ length: bucketCount }, (_, index) => {
    const firstOffset = Math.floor(index * dayCount / bucketCount);
    const lastOffset = Math.floor((index + 1) * dayCount / bucketCount) - 1;
    return { start: addCalendarDays(start, firstOffset), end: addCalendarDays(start, lastOffset) };
  });
}
