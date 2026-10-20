import { describe, expect, it } from 'vitest';
import { buildMenuCards, lastFourFullWeeks, lastFullWeek, mondayOf, rankMostWasted, splitFoodLabel, suggestionWindow, summarizeByMeat, trendWeeks, trendWindow } from './foodInsights';
import { wasteRatePercent, type ReportVariantSummary } from './reportAnalysis';

function variant(label: string, produced: number, sold: number, waste: number, currentStock = 0, extra: Partial<ReportVariantSummary> = {}): ReportVariantSummary {
  return { label, produced, adjustment: 0, sold, waste, archivedDeduction: 0, removedArchivedEffect: 0, currentStock, wasteRate: wasteRatePercent(waste, produced), ...extra };
}

const screenshotRows = [
  variant('4seas Mix Veges Bowl · Beef', 7, 6, 1),
  variant('4seas Mix Veges Bowl · Chicken', 7, 3, 4),
  variant('4seas Mix Veges Bowl · Vegan', 3, 3, 0),
  variant('Green colors bowl · Beef', 4, 4, 0),
  variant('Green colors bowl · Chicken', 4, 1, 4, 0, { adjustment: 1 }),
  variant('Green colors bowl · Vegan', 3, 1, 1),
  variant('Happymood Veges Bowl · Beef', 4, 4, 0),
  variant('Pesto Vegas bowl · Chicken', 4, 2, 2),
];

describe('wasted food summaries', () => {
  it('splits a food label on the last separator', () => {
    expect(splitFoodLabel('Green colors bowl · Chicken')).toEqual({ menu: 'Green colors bowl', meat: 'Chicken' });
    expect(splitFoodLabel('Soup')).toEqual({ menu: 'Soup', meat: null });
  });

  it('ranks by boxes wasted, then waste rate, and drops options with no waste', () => {
    const ranked = rankMostWasted(screenshotRows);
    expect(ranked.map((row) => row.label)).toEqual([
      'Green colors bowl · Chicken',
      '4seas Mix Veges Bowl · Chicken',
      'Pesto Vegas bowl · Chicken',
      'Green colors bowl · Vegan',
      '4seas Mix Veges Bowl · Beef',
    ]);
    expect(ranked[0]).toMatchObject({ menu: 'Green colors bowl', meat: 'Chicken', waste: 4, produced: 4, sold: 1, wasteRate: 100 });
    expect(rankMostWasted(screenshotRows, 2)).toHaveLength(2);
  });

  it('summarises waste by meat option with its top menus', () => {
    const chicken = summarizeByMeat(screenshotRows).find((row) => row.meat === 'Chicken');
    expect(chicken).toMatchObject({ meat: 'Chicken', produced: 15, sold: 6, waste: 10, topMenus: ['4seas Mix Veges Bowl', 'Green colors bowl'] });
    expect(summarizeByMeat(screenshotRows)[0].meat).toBe('Chicken');
  });

  it('never reports a waste rate without production', () => {
    const rows = [variant('Soup · Beef', 0, 0, 2)];
    expect(summarizeByMeat(rows)[0].wasteRate).toBeNull();
    expect(buildMenuCards(rows).wasted[0].wasteRate).toBeNull();
  });

  it('groups options into menu cards sorted by waste', () => {
    const cards = buildMenuCards([...screenshotRows, variant('Soup', 3, 2, 1)]);
    expect(cards.wasted.map((card) => card.menu)).toEqual(['Green colors bowl', '4seas Mix Veges Bowl', 'Pesto Vegas bowl', 'Soup']);
    expect(cards.noWaste.map((card) => card.menu)).toEqual(['Happymood Veges Bowl']);
    const green = cards.wasted.find((card) => card.menu === 'Green colors bowl');
    expect(green).toMatchObject({ produced: 11, sold: 6, waste: 5, hasCorrections: true });
    expect(green?.options.filter((option) => option.isWorst).map((option) => option.meat)).toEqual(['Chicken']);
    expect(cards.wasted.find((card) => card.menu === 'Soup')?.options).toEqual([{ meat: null, sold: 2, waste: 1, currentStock: 0, isWorst: true }]);
    expect(cards.noWaste[0].options.some((option) => option.isWorst)).toBe(false);
  });
});

describe('report date windows', () => {
  it('finds the Monday of any day in the week', () => {
    expect(mondayOf('2026-10-21')).toBe('2026-10-19');
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
  });

  it('picks the last full Monday–Sunday week and the last four full weeks', () => {
    expect(lastFullWeek('2026-10-20')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(lastFullWeek('2026-10-19')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(lastFourFullWeeks('2026-10-20')).toEqual({ start: '2026-09-21', end: '2026-10-18' });
  });

  it('uses 28 days for suggestions and 8 Monday-start weeks for the trend', () => {
    expect(suggestionWindow('2026-10-18')).toEqual({ start: '2026-09-21', end: '2026-10-18' });
    expect(trendWindow('2026-10-21')).toEqual({ start: '2026-08-31', end: '2026-10-21' });
  });

  it('clips the newest trend week at the end date and marks it partial', () => {
    const weeks = trendWeeks('2026-10-21');
    expect(weeks).toHaveLength(8);
    expect(weeks[0]).toEqual({ start: '2026-08-31', end: '2026-09-06', partial: false });
    expect(weeks[7]).toEqual({ start: '2026-10-19', end: '2026-10-21', partial: true });
    expect(trendWeeks('2026-10-25')[7].partial).toBe(false);
  });
});
