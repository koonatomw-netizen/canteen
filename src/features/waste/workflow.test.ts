import { describe, expect, it } from 'vitest';
import { getStockRecordMode } from './workflow';

describe('getStockRecordMode', () => {
  it('uses Waste while the current business day is open or has no closing', () => {
    expect(getStockRecordMode(null)).toBe('waste');
    expect(getStockRecordMode('reopened')).toBe('waste');
  });

  it('uses post-close removal only after the current day is closed', () => {
    expect(getStockRecordMode('closed')).toBe('stock-out');
  });
});
