import { addCalendarDays } from './dates';
import { wasteRatePercent, type ReportVariantSummary } from './reportAnalysis';

/** Inclusive range of Asia/Bangkok business dates (YYYY-MM-DD). */
export type DateRange = { start: string; end: string };

export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addCalendarDays(date, -((weekday + 6) % 7));
}

export function lastFullWeek(today: string): DateRange {
  const start = addCalendarDays(mondayOf(today), -7);
  return { start, end: addCalendarDays(start, 6) };
}

export function lastFourFullWeeks(today: string): DateRange {
  const end = addCalendarDays(mondayOf(today), -1);
  return { start: addCalendarDays(end, -27), end };
}

export function suggestionWindow(end: string): DateRange {
  return { start: addCalendarDays(end, -27), end };
}

export function trendWindow(end: string): DateRange {
  return { start: addCalendarDays(mondayOf(end), -49), end };
}

export function trendWeeks(end: string): Array<DateRange & { partial: boolean }> {
  const first = trendWindow(end).start;
  return Array.from({ length: 8 }, (_, index) => {
    const start = addCalendarDays(first, index * 7);
    const fullEnd = addCalendarDays(start, 6);
    return fullEnd > end ? { start, end, partial: true } : { start, end: fullEnd, partial: false };
  });
}

const FOOD_SEPARATOR = ' · ';

export function splitFoodLabel(label: string): { menu: string; meat: string | null } {
  const index = label.lastIndexOf(FOOD_SEPARATOR);
  return index < 0 ? { menu: label, meat: null } : { menu: label.slice(0, index), meat: label.slice(index + FOOD_SEPARATOR.length) };
}

/** Higher waste first, then higher waste rate (unknown last), then name. */
function compareWaste(a: { waste: number; wasteRate: number | null; name: string }, b: { waste: number; wasteRate: number | null; name: string }) {
  return b.waste - a.waste || (b.wasteRate ?? -1) - (a.wasteRate ?? -1) || a.name.localeCompare(b.name);
}

export type MostWastedRow = { label: string; menu: string; meat: string | null; waste: number; produced: number; sold: number; wasteRate: number | null };

export function rankMostWasted(rows: ReportVariantSummary[], limit = 5): MostWastedRow[] {
  return rows
    .filter((row) => row.waste > 0)
    .map((row) => ({ label: row.label, ...splitFoodLabel(row.label), waste: row.waste, produced: row.produced, sold: row.sold, wasteRate: wasteRatePercent(row.waste, row.produced) }))
    .sort((a, b) => compareWaste({ ...a, name: a.label }, { ...b, name: b.label }))
    .slice(0, limit);
}

export type MeatSummary = { meat: string; produced: number; sold: number; waste: number; currentStock: number; wasteRate: number | null; topMenus: string[] };

export function summarizeByMeat(rows: ReportVariantSummary[]): MeatSummary[] {
  const byMeat = new Map<string, { produced: number; sold: number; waste: number; currentStock: number; menuWaste: Map<string, number> }>();
  for (const row of rows) {
    const { menu, meat } = splitFoodLabel(row.label);
    if (!meat) continue;
    const entry = byMeat.get(meat) ?? { produced: 0, sold: 0, waste: 0, currentStock: 0, menuWaste: new Map<string, number>() };
    entry.produced += row.produced;
    entry.sold += row.sold;
    entry.waste += row.waste;
    entry.currentStock += row.currentStock;
    if (row.waste > 0) entry.menuWaste.set(menu, (entry.menuWaste.get(menu) ?? 0) + row.waste);
    byMeat.set(meat, entry);
  }
  return [...byMeat.entries()]
    .map(([meat, entry]) => ({
      meat,
      produced: entry.produced,
      sold: entry.sold,
      waste: entry.waste,
      currentStock: entry.currentStock,
      wasteRate: wasteRatePercent(entry.waste, entry.produced),
      topMenus: [...entry.menuWaste.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([menu]) => menu),
    }))
    .sort((a, b) => b.waste - a.waste || a.meat.localeCompare(b.meat));
}

export type MenuCardOption = { meat: string | null; sold: number; waste: number; currentStock: number; isWorst: boolean };
export type MenuCard = { menu: string; produced: number; sold: number; waste: number; currentStock: number; wasteRate: number | null; hasCorrections: boolean; options: MenuCardOption[] };

export function buildMenuCards(rows: ReportVariantSummary[]): { wasted: MenuCard[]; noWaste: MenuCard[] } {
  const byMenu = new Map<string, ReportVariantSummary[]>();
  for (const row of rows) {
    const { menu } = splitFoodLabel(row.label);
    byMenu.set(menu, [...(byMenu.get(menu) ?? []), row]);
  }
  const cards = [...byMenu.entries()].map(([menu, options]): MenuCard => {
    const sorted = [...options].sort((a, b) => (splitFoodLabel(a.label).meat ?? '').localeCompare(splitFoodLabel(b.label).meat ?? ''));
    const worst = sorted.reduce<ReportVariantSummary | null>((best, row) => row.waste > 0 && (!best || row.waste > best.waste) ? row : best, null);
    const produced = sorted.reduce((sum, row) => sum + row.produced, 0);
    const waste = sorted.reduce((sum, row) => sum + row.waste, 0);
    return {
      menu,
      produced,
      sold: sorted.reduce((sum, row) => sum + row.sold, 0),
      waste,
      currentStock: sorted.reduce((sum, row) => sum + row.currentStock, 0),
      wasteRate: wasteRatePercent(waste, produced),
      hasCorrections: sorted.some((row) => row.adjustment !== 0 || row.archivedDeduction + row.removedArchivedEffect !== 0),
      options: sorted.map((row) => ({ meat: splitFoodLabel(row.label).meat, sold: row.sold, waste: row.waste, currentStock: row.currentStock, isWorst: row === worst })),
    };
  });
  return {
    wasted: cards.filter((card) => card.waste > 0).sort((a, b) => compareWaste({ ...a, name: a.menu }, { ...b, name: b.menu })),
    noWaste: cards.filter((card) => card.waste <= 0).sort((a, b) => a.menu.localeCompare(b.menu)),
  };
}
