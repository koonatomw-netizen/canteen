import { addCalendarDays } from './dates';

export interface ReportVariantSummary {
  label: string;
  produced: number;
  adjustment: number;
  sold: number;
  waste: number;
  archivedDeduction: number;
  removedArchivedEffect: number;
  currentStock: number;
  wasteRate: number | null;
}

export interface VariantQuantity {
  label: string;
  quantity: number;
}

export interface StockReconciliationInput {
  produced: number;
  closingAdditions: number;
  sold: number;
  activeWaste: number;
  archivedStockEffect: number;
  afterClose: number;
  currentStock: number;
}

export function calculateStockReconciliation(input: StockReconciliationInput) {
  const beforeArchivedEffects = input.produced + input.closingAdditions
    - input.sold - input.activeWaste - input.afterClose - input.currentStock;
  return {
    beforeArchivedEffects,
    afterArchivedEffects: beforeArchivedEffects - input.archivedStockEffect,
  };
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

export function matchesFoodSearch(label: string, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return !normalizedQuery || label.toLocaleLowerCase().includes(normalizedQuery);
}

export function aggregateVariantSummary(input: {
  production: VariantQuantity[];
  adjustment?: VariantQuantity[];
  sold: VariantQuantity[];
  waste: VariantQuantity[];
  archivedDeduction?: VariantQuantity[];
  removedArchivedEffect?: VariantQuantity[];
  stock: VariantQuantity[];
}): ReportVariantSummary[] {
  const byLabel = new Map<string, Omit<ReportVariantSummary, 'wasteRate'>>();
  const add = (items: VariantQuantity[], field: 'produced' | 'adjustment' | 'sold' | 'waste' | 'archivedDeduction' | 'removedArchivedEffect' | 'currentStock') => {
    for (const item of items) {
      const row = byLabel.get(item.label) ?? { label: item.label, produced: 0, adjustment: 0, sold: 0, waste: 0, archivedDeduction: 0, removedArchivedEffect: 0, currentStock: 0 };
      row[field] += Number(item.quantity) || 0;
      byLabel.set(item.label, row);
    }
  };
  add(input.production, 'produced');
  add(input.adjustment ?? [], 'adjustment');
  add(input.sold, 'sold');
  add(input.waste, 'waste');
  add(input.archivedDeduction ?? [], 'archivedDeduction');
  add(input.removedArchivedEffect ?? [], 'removedArchivedEffect');
  add(input.stock, 'currentStock');
  return [...byLabel.values()]
    .map((row) => ({ ...row, wasteRate: wasteRatePercent(row.waste, row.produced) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
