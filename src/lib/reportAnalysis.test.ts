import { describe, expect, it } from 'vitest';
import { aggregateVariantSummary, calculateStockReconciliation, matchesFoodFilters, matchesFoodSearch, previousDateRange, wasteRatePercent } from './reportAnalysis';

describe('report analysis helpers', () => {
  it('builds an immediately preceding range with the same inclusive length', () => {
    expect(previousDateRange('2026-10-01', '2026-10-07')).toEqual({ start: '2026-09-24', end: '2026-09-30' });
    expect(previousDateRange('2024-03-01', '2024-03-01')).toEqual({ start: '2024-02-29', end: '2024-02-29' });
  });

  it('uses the waste divided by production formula and leaves an empty denominator unavailable', () => {
    expect(wasteRatePercent(2, 8)).toBe(25);
    expect(wasteRatePercent(2, 0)).toBeNull();
  });

  it('keeps archived stock effects separate from produced and shows the remaining balance', () => {
    expect(calculateStockReconciliation({
      produced: 89,
      closingAdditions: 0,
      sold: 45,
      activeWaste: 12,
      archivedStockEffect: 21,
      afterClose: 1,
      currentStock: 10,
    })).toEqual({ beforeArchivedEffects: 21, afterArchivedEffects: 0 });
  });

  it('moves verified archived entries into waste or leaves removed entries as a separate retained stock effect', () => {
    const verified = calculateStockReconciliation({
      produced: 89, closingAdditions: 0, sold: 45, activeWaste: 33,
      archivedStockEffect: 0, afterClose: 1, currentStock: 10,
    });
    const removed = calculateStockReconciliation({
      produced: 89, closingAdditions: 0, sold: 45, activeWaste: 12,
      archivedStockEffect: 21, afterClose: 1, currentStock: 10,
    });
    expect(verified).toEqual({ beforeArchivedEffects: 0, afterArchivedEffects: 0 });
    expect(removed).toEqual({ beforeArchivedEffects: 21, afterArchivedEffects: 0 });
  });

  it('aggregates production, closing corrections, inferred sold, confirmed waste, unverified and removed stock effects by menu variant', () => {
    const summary = aggregateVariantSummary({
      production: [{ label: 'Hummus · Beef', quantity: 4 }, { label: 'Hummus · Beef', quantity: 2 }],
      adjustment: [{ label: 'Hummus · Beef', quantity: 1 }],
      sold: [{ label: 'Hummus · Beef', quantity: 3 }],
      waste: [{ label: 'Hummus · Beef', quantity: 1 }],
      archivedDeduction: [{ label: 'Hummus · Beef', quantity: 2 }],
      removedArchivedEffect: [{ label: 'Hummus · Beef', quantity: 3 }],
      stock: [{ label: 'Hummus · Beef', quantity: 2 }, { label: 'Rice', quantity: 5 }],
    });
    expect(summary[0]).toMatchObject({ label: 'Hummus · Beef', produced: 6, adjustment: 1, sold: 3, waste: 1, archivedDeduction: 2, removedArchivedEffect: 3, currentStock: 2 });
    expect(summary[0]!.wasteRate).toBeCloseTo(100 / 6);
    expect(summary[1]).toEqual({ label: 'Rice', produced: 0, adjustment: 0, sold: 0, waste: 0, archivedDeduction: 0, removedArchivedEffect: 0, currentStock: 5, wasteRate: null });
  });

  it('matches menu and meat filters against formatted variant labels', () => {
    expect(matchesFoodFilters('Hummus · Beef', 'Hummus', 'Beef')).toBe(true);
    expect(matchesFoodFilters('Hummus · Beef', 'Hummus', 'Pork')).toBe(false);
    expect(matchesFoodFilters('Rice', 'Rice', '')).toBe(true);
    expect(matchesFoodFilters('Rice', 'Hummus', '')).toBe(false);
  });

  it('searches menu and meat labels without case or surrounding-space sensitivity', () => {
    expect(matchesFoodSearch('4seas Mix Veges Bowl · Chicken', '  veges ')).toBe(true);
    expect(matchesFoodSearch('4seas Mix Veges Bowl · Chicken', 'CHICKEN')).toBe(true);
    expect(matchesFoodSearch('4seas Mix Veges Bowl · Chicken', 'pork')).toBe(false);
    expect(matchesFoodSearch('Rice', '   ')).toBe(true);
  });
});
