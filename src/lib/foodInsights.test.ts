import { describe, expect, it } from 'vitest';
import { buildMenuCards, classifyProductionGuide, type InsightClosingCount, type InsightQuantity, lastFourFullWeeks, lastFullWeek, mondayOf, rankMostWasted, splitFoodLabel, suggestionWindow, summarizeByMeat, trendWeeks, trendWindow } from './foodInsights';
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

const WINDOW = { start: '2026-09-21', end: '2026-10-18' };
const LABEL = 'Green colors bowl · Chicken';

/** Closing counts on consecutive days from 2026-10-01; `soldOutDays` of them end at 0. */
function stockedDays(days: number, soldOutDays: number, label = LABEL): InsightClosingCount[] {
  return Array.from({ length: days }, (_, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, '0')}`,
    label,
    batchDate: `2026-10-${String(index + 1).padStart(2, '0')}`,
    expected: 5,
    remaining: index < soldOutDays ? 0 : 2,
    sold: 3,
  }));
}

function quantity(amount: number, label = LABEL, date = '2026-10-05'): InsightQuantity {
  return { label, date, quantity: amount };
}

function guide(production: number, waste: number, closings: InsightClosingCount[]) {
  return classifyProductionGuide({ production: [quantity(production)], waste: waste ? [quantity(waste)] : [], closings, window: WINDOW })[0];
}

describe('make more / make less guide', () => {
  it('needs at least five stocked days', () => {
    expect(guide(10, 5, stockedDays(4, 0)).verdict).toBe('not_enough_data');
  });

  it('suggests making less when waste is at least 20% and it rarely sells out', () => {
    expect(guide(30, 6, stockedDays(6, 1))).toMatchObject({ verdict: 'make_less', stockedDays: 6, soldOutDays: 1, wastePercent: 20 });
    expect(guide(30, 6, stockedDays(6, 2)).verdict).toBe('about_right');
  });

  it('suggests making more when it often sells out with little waste', () => {
    expect(guide(40, 3, stockedDays(10, 4)).verdict).toBe('could_make_more');
    expect(guide(40, 4, stockedDays(10, 4)).verdict).toBe('about_right');
  });

  it('treats several batches of one option on the same day as one day', () => {
    const day = (remaining: number[]): InsightClosingCount[] => remaining.map((left) => ({ date: '2026-10-10', label: LABEL, batchDate: '2026-10-09', expected: 3, remaining: left, sold: 3 - left }));
    expect(classifyProductionGuide({ production: [], waste: [], closings: day([0, 2]), window: WINDOW })[0]).toMatchObject({ stockedDays: 1, soldOutDays: 0 });
    expect(classifyProductionGuide({ production: [], waste: [], closings: day([0, 0]), window: WINDOW })[0]).toMatchObject({ stockedDays: 1, soldOutDays: 1 });
  });

  it('ignores days that were not stocked and rows outside the window', () => {
    const closings = [...stockedDays(5, 0), { date: '2026-09-20', label: LABEL, batchDate: null, expected: 5, remaining: 0, sold: 5 }, { date: '2026-10-12', label: LABEL, batchDate: null, expected: 0, remaining: 0, sold: 0 }];
    expect(classifyProductionGuide({ production: [quantity(20), quantity(50, LABEL, '2026-09-01')], waste: [], closings, window: WINDOW })[0]).toMatchObject({ stockedDays: 5, soldOutDays: 0, produced: 20 });
  });

  it('never reports a waste percentage without production', () => {
    expect(guide(0, 3, stockedDays(6, 0))).toMatchObject({ wastePercent: null, verdict: 'about_right' });
  });

  it('lists make less first, then could make more, about right and not enough data', () => {
    const rows = classifyProductionGuide({
      production: [quantity(30, 'A · Beef'), quantity(40, 'B · Beef'), quantity(30, 'C · Beef'), quantity(30, 'D · Beef')],
      waste: [quantity(1, 'A · Beef'), quantity(1, 'B · Beef'), quantity(9, 'C · Beef')],
      closings: [...stockedDays(6, 0, 'A · Beef'), ...stockedDays(10, 5, 'B · Beef'), ...stockedDays(6, 0, 'C · Beef'), ...stockedDays(2, 0, 'D · Beef')],
      window: WINDOW,
    });
    expect(rows.map((row) => [row.label, row.verdict])).toEqual([
      ['C · Beef', 'make_less'], ['B · Beef', 'could_make_more'], ['A · Beef', 'about_right'], ['D · Beef', 'not_enough_data'],
    ]);
  });
});
