// Supabase returns at most `max_rows` (1000) rows per request, so long lists
// must be read page by page or later rows are silently dropped.
export const PAGE_SIZE = 1000;

export async function readAll<T>(page: (from: number, to: number) => PromiseLike<unknown>, pageSize = PAGE_SIZE) {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await page(from, from + pageSize - 1) as { data: T[] | null; error: { message: string } | null };
    if (result.error) return { data: rows, error: result.error.message };
    const pageRows = result.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return { data: rows, error: null };
  }
}
