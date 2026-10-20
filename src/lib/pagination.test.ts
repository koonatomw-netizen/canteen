import { describe, expect, it } from 'vitest';
import { readAll } from './pagination';

function pagedSource(total: number, failAtFrom?: number) {
  const requested: [number, number][] = [];
  const page = async (from: number, to: number) => {
    requested.push([from, to]);
    if (from === failAtFrom) return { data: null, error: { message: 'network down' } };
    const data = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, index) => from + index);
    return { data, error: null };
  };
  return { page, requested };
}

describe('readAll', () => {
  it('keeps reading past the per-request row limit', async () => {
    const source = pagedSource(2500);
    const result = await readAll<number>(source.page, 1000);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2500);
    expect(result.data.at(-1)).toBe(2499);
    expect(source.requested).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('asks once more when the last page is exactly full', async () => {
    const source = pagedSource(1000);
    const result = await readAll<number>(source.page, 1000);
    expect(result.data).toHaveLength(1000);
    expect(source.requested).toHaveLength(2);
  });

  it('reports a page error instead of returning a silently short list', async () => {
    const source = pagedSource(2500, 1000);
    const result = await readAll<number>(source.page, 1000);
    expect(result.error).toBe('network down');
  });
});
