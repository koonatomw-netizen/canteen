import { describe, expect, it } from 'vitest';
import { parseMenuInput } from './menuValidation';

describe('new menu input', () => {
  it('normalizes staff text and converts whole shelf-life days', () => {
    expect(parseMenuInput({ name: '  Hummus  ', default_shelf_life_days: '3', notes: '  Keep chilled  ' }))
      .toEqual({ name: 'Hummus', default_shelf_life_days: 3, notes: 'Keep chilled' });
  });
  it('rejects empty names, oversized notes, and invalid shelf-life days', () => {
    const input = { name: 'Hummus', default_shelf_life_days: '3', notes: '' };
    for (const days of ['', '0', '31', '1.5', 'not a number']) {
      expect(parseMenuInput({ ...input, default_shelf_life_days: days })).toBeNull();
    }
    expect(parseMenuInput({ ...input, name: '  ' })).toBeNull();
    expect(parseMenuInput({ ...input, name: 'a'.repeat(101) })).toBeNull();
    expect(parseMenuInput({ ...input, notes: 'a'.repeat(2001) })).toBeNull();
  });
});
