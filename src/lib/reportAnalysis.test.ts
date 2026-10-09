import { describe, expect, it } from 'vitest';
import { aggregateVariantSummary, matchesFoodFilters, previousDateRange, wasteRatePercent } from './reportAnalysis';

describe('report analysis helpers', () => {
  it('builds an immediately preceding range with the same inclusive length', () => {
    expect(previousDateRange('2026-10-01', '2026-10-07')).toEqual({ start: '2026-09-24', end: '2026-09-30' });
    expect(previousDateRange('2024-03-01', '2024-03-01')).toEqual({ start: '2024-02-29', end: '2024-02-29' });
  });

  it('uses the waste divided by production formula and leaves an empty denominator unavailable', () => {
    expect(wasteRatePercent(2, 8)).toBe(25);
    expect(wasteRatePercent(2, 0)).toBeNull();
  });

  it('aggregates production, inferred sold, waste and current ledger stock by menu variant', () => {
    const summary = aggregateVariantSummary({
      production: [{ label: 'Hummus · Beef', quantity: 4 }, { label: 'Hummus · Beef', quantity: 2 }],
      sold: [{ label: 'Hummus · Beef', quantity: 3 }],
      waste: [{ label: 'Hummus · Beef', quantity: 1 }],
      stock: [{ label: 'Hummus · Beef', quantity: 2 }, { label: 'Rice', quantity: 5 }],
    });
    expect(summary[0]).toMatchObject({ label: 'Hummus · Beef', produced: 6, sold: 3, waste: 1, currentStock: 2 });
    expect(summary[0]!.wasteRate).toBeCloseTo(100 / 6);
    expect(summary[1]).toEqual({ label: 'Rice', produced: 0, sold: 0, waste: 0, currentStock: 5, wasteRate: null });
  });

  it('matches menu and meat filters against formatted variant labels', () => {
    expect(matchesFoodFilters('Hummus · Beef', 'Hummus', 'Beef')).toBe(true);
    expect(matchesFoodFilters('Hummus · Beef', 'Hummus', 'Pork')).toBe(false);
    expect(matchesFoodFilters('Rice', 'Rice', '')).toBe(true);
    expect(matchesFoodFilters('Rice', 'Hummus', '')).toBe(false);
  });
});
