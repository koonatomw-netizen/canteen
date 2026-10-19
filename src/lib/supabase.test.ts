import { describe, expect, it } from 'vitest';
import { errorMessage } from './supabase';

describe('errorMessage', () => {
  it('returns a normal Error message', () => {
    expect(errorMessage(new Error('Request failed'))).toBe('Request failed');
  });

  it('returns the message from Supabase-style error objects', () => {
    expect(errorMessage({ code: '23514', message: 'A closed day already counted this batch.' }))
      .toBe('A closed day already counted this batch.');
  });

  it('uses the fallback for errors without a usable message', () => {
    expect(errorMessage({ code: 'NETWORK_ERROR' })).toBe('Something went wrong. Please try again.');
    expect(errorMessage(null)).toBe('Something went wrong. Please try again.');
  });
});
