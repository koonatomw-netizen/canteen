function escapeCell(value: unknown): string {
  const text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>): void {
  if (!rows.length) return;
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const contents = [headers.map(escapeCell).join(','), ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(','))].join('\r\n');
  const blob = new Blob(['\uFEFF', contents], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}
