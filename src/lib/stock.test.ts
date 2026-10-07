import { describe, expect, it } from 'vitest';
import { calculateClosing, getBatchBalance, getExpiryStatus, hasNegativeStock } from './stock';

describe('batch stock rules', () => {
  it('carries movements through the selected business date only', () => {
    const movements = [
      { business_date: '2026-10-06', quantity_delta: 10 },
      { business_date: '2026-10-07', quantity_delta: -2 },
      { business_date: '2026-10-08', quantity_delta: -3 },
    ];
    expect(getBatchBalance(movements, '2026-10-07')).toBe(8);
    expect(getBatchBalance(movements)).toBe(5);
  });

  it('derives sales from a smaller closing count and surfaces unexpected stock', () => {
    expect(calculateClosing(20, 8)).toEqual({ expected: 20, physical: 8, sold: 12, adjustment: 0, difference: -12 });
    expect(calculateClosing(8, 9)).toEqual({ expected: 8, physical: 9, sold: 0, adjustment: 1, difference: 1 });
  });

  it('labels expiry relative to a business date', () => {
    expect(getExpiryStatus('2026-10-06', '2026-10-07')).toBe('expired');
    expect(getExpiryStatus('2026-10-07', '2026-10-07')).toBe('today');
    expect(getExpiryStatus('2026-10-08', '2026-10-07')).toBe('tomorrow');
    expect(getExpiryStatus('2026-10-09', '2026-10-07')).toBe('normal');
  });

  it('detects a ledger balance below zero', () => {
    expect(hasNegativeStock([{ business_date: '2026-10-07', quantity_delta: -1 }])).toBe(true);
    expect(hasNegativeStock([{ business_date: '2026-10-07', quantity_delta: 1 }])).toBe(false);
  });
});
