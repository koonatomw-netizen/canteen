import { addCalendarDays } from './dates';

export interface ReportVariantSummary {
  label: string;
  produced: number;
  sold: number;
  waste: number;
  currentStock: number;
  wasteRate: number | null;
}

export interface VariantQuantity {
  label: string;
  quantity: number;
}

export function previousDateRange(start: string, end: string) {
  const startTime = Date.parse(`${start}T00:00:00.000Z`);
  const endTime = Date.parse(`${end}T00:00:00.000Z`);
  const length = Math.max(1, Math.floor((endTime - startTime) / 86_400_000) + 1);
  const previousEnd = addCalendarDays(start, -1);
  return { start: addCalendarDays(previousEnd, -(length - 1)), end: previousEnd };
}

export function wasteRatePercent(waste: number, produced: number): number | null {
  return produced > 0 ? waste / produced * 100 : null;
}

export function matchesFoodFilters(label: string, menu: string, meat: string): boolean {
  const matchesMenu = !menu || label === menu || label.startsWith(`${menu} · `);
  const matchesMeat = !meat || label.endsWith(` · ${meat}`);
  return matchesMenu && matchesMeat;
}

export function aggregateVariantSummary(input: {
  production: VariantQuantity[];
  sold: VariantQuantity[];
  waste: VariantQuantity[];
  stock: VariantQuantity[];
}): ReportVariantSummary[] {
  const byLabel = new Map<string, Omit<ReportVariantSummary, 'wasteRate'>>();
  const add = (items: VariantQuantity[], field: 'produced' | 'sold' | 'waste' | 'currentStock') => {
    for (const item of items) {
      const row = byLabel.get(item.label) ?? { label: item.label, produced: 0, sold: 0, waste: 0, currentStock: 0 };
      row[field] += Number(item.quantity) || 0;
      byLabel.set(item.label, row);
    }
  };
  add(input.production, 'produced');
  add(input.sold, 'sold');
  add(input.waste, 'waste');
  add(input.stock, 'currentStock');
  return [...byLabel.values()]
    .map((row) => ({ ...row, wasteRate: wasteRatePercent(row.waste, row.produced) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
