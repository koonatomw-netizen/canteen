# Weekly Food Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise the canteen Reports page for a weekly owner/Manager review: last week by default, a decision-first Summary tab (Most wasted, Waste by meat, Make more / Make less), donut cards per menu, and new Food age / weekday / trend analysis, with every existing section kept in a tab.

**Architecture:** All new numbers come from one new pure module, `src/lib/foodInsights.ts`, fed by plain row objects that `ReportsPage.tsx` builds from data it already loads plus one extra 8-week history load. New UI lives in small tab components under `src/features/reports/`; existing panels are moved into tabs unchanged. No database, RPC, or migration changes.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest, Supabase JS client, lucide-react, existing `src/styles.css`.

**Spec:** `docs/superpowers/specs/2026-10-20-weekly-food-report-design.md`

## Global Constraints

- Business dates are `Asia/Bangkok` calendar strings (`YYYY-MM-DD`); weeks run Monday–Sunday. Use `addCalendarDays` from `src/lib/dates.ts`; never convert dates through local time.
- Produced = active production; Sold = `calculated_sold_quantity` of closed, latest-version closings (`latestClosingVersions`); Waste = active waste **plus** `verified_waste` archived rows (`verifiedArchiveAsWaste`), for every window.
- Search / menu / meat filters apply to every section. The waste-reason filter applies only to Waste by reason, waste records, Food age and Most wasted; never to Make more / Make less, trend, key-number waste %, or donuts. When it is active, Summary shows "Suggestions ignore the waste-reason filter."
- Guide thresholds: minimum 5 stocked days; Make less = waste ≥ 20% and sold-out days ≤ 1; Could make more = sold-out days ≥ 40% of stocked days and waste < 10%; else About right.
- No revenue/price/profit, no ฿ waste value, no automatic production changes, no new chart library.
- Role visibility unchanged: expenses only where `canViewExpenses`; archive review actions only where `canReviewArchivedWaste`; Activity export only where `canViewActivity`.
- Every new UI string goes through `t()` with a Thai entry in `src/lib/i18n.tsx`. Touch targets ≥ 44px; one-column phone layout.
- After each task: `npx vitest run` and `npx tsc -p tsconfig.app.json --noEmit` pass. Final task also runs `npm run build`.

## Review Focus

1. A menu with no meat option (label without ` · `) must still form its own menu card and guide row — test in Task 2 (`splitFoodLabel`, `buildMenuCards`).
2. A reopened day must count only its latest closed version; earlier versions or `status !== 'closed'` rows never count as sold-out or sold — test in Task 3 (`classifyProductionGuide` ignores non-closed input; page passes `latestClosingVersions`).
3. A period with waste but zero production shows waste % as "—", never Infinity/NaN, everywhere (cards, meat summary, trend, guide) — tests in Tasks 2, 3, 4.
4. An end date that is not a Sunday makes the newest trend week partial and marked `partial: true`; no query reads past the end date — test in Task 1 and Task 4.
5. One option split across several batches on the same day is one stocked day, sold out only if all its batches reach 0 — test in Task 3.

---

### Task 1: Report date windows

**Files:**
- Create: `src/lib/foodInsights.ts`
- Test: `src/lib/foodInsights.test.ts`

**Interfaces:**
- Produces:
  - `type DateRange = { start: string; end: string }`
  - `mondayOf(date: string): string`
  - `lastFullWeek(today: string): DateRange` — previous Monday–Sunday not containing `today`.
  - `lastFourFullWeeks(today: string): DateRange` — four full weeks ending last Sunday.
  - `suggestionWindow(end: string): DateRange` — `{ start: end − 27 days, end }`.
  - `trendWindow(end: string): DateRange` — `{ start: mondayOf(end) − 49 days, end }`.
  - `trendWeeks(end: string): Array<DateRange & { partial: boolean }>` — 8 Monday-start weeks, last one clipped to `end`, `partial` when clipped.

- [ ] **Step 1: Write the failing tests** in `describe('report date windows')`:

```ts
expect(mondayOf('2026-10-21')).toBe('2026-10-19');      // Wednesday
expect(mondayOf('2026-10-19')).toBe('2026-10-19');      // Monday
expect(mondayOf('2026-10-25')).toBe('2026-10-19');      // Sunday
expect(lastFullWeek('2026-10-20')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
expect(lastFullWeek('2026-10-19')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
expect(lastFourFullWeeks('2026-10-20')).toEqual({ start: '2026-09-21', end: '2026-10-18' });
expect(suggestionWindow('2026-10-18')).toEqual({ start: '2026-09-21', end: '2026-10-18' });
expect(trendWindow('2026-10-21')).toEqual({ start: '2026-08-31', end: '2026-10-21' });
const weeks = trendWeeks('2026-10-21');
expect(weeks).toHaveLength(8);
expect(weeks[0]).toEqual({ start: '2026-08-31', end: '2026-09-06', partial: false });
expect(weeks[7]).toEqual({ start: '2026-10-19', end: '2026-10-21', partial: true });
expect(trendWeeks('2026-10-25')[7].partial).toBe(false);
```

- [ ] **Step 2: Run** `npx vitest run src/lib/foodInsights.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the functions above. Weekday from `new Date(\`${date}T00:00:00.000Z\`).getUTCDay()` as the existing `setCommonRange` does.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/foodInsights.ts src/lib/foodInsights.test.ts && git commit -m "feat: add weekly report date windows"`

### Task 2: Most wasted, meat summary, menu cards

**Files:**
- Modify: `src/lib/foodInsights.ts`
- Test: `src/lib/foodInsights.test.ts`

**Interfaces:**
- Consumes: `ReportVariantSummary` from `src/lib/reportAnalysis.ts`; `wasteRatePercent`.
- Produces:
  - `splitFoodLabel(label: string): { menu: string; meat: string | null }` — split on the last `' · '`.
  - `type MostWastedRow = { label: string; menu: string; meat: string | null; waste: number; produced: number; sold: number; wasteRate: number | null }`
  - `rankMostWasted(rows: ReportVariantSummary[], limit = 5): MostWastedRow[]` — waste > 0 only; order by waste desc, then wasteRate desc (null last), then label.
  - `type MeatSummary = { meat: string; produced: number; sold: number; waste: number; currentStock: number; wasteRate: number | null; topMenus: string[] }` — `topMenus` = up to 2 menus with the most waste of that meat. Rows without a meat use meat `''` and are excluded.
  - `summarizeByMeat(rows: ReportVariantSummary[]): MeatSummary[]` — sorted by waste desc, then meat.
  - `type MenuCard = { menu: string; produced: number; sold: number; waste: number; currentStock: number; wasteRate: number | null; hasCorrections: boolean; options: Array<{ meat: string | null; sold: number; waste: number; currentStock: number; isWorst: boolean }> }`
  - `buildMenuCards(rows: ReportVariantSummary[]): { wasted: MenuCard[]; noWaste: MenuCard[] }` — `wasted` sorted by waste desc, then wasteRate desc, then menu; `isWorst` marks the single option with the most waste (none when card waste is 0); `hasCorrections` when any option has `adjustment` or `archivedDeduction + removedArchivedEffect` ≠ 0; options ordered by meat name.

- [ ] **Step 1: Write failing tests** using a `variant(label, produced, sold, waste, stock = 0, extra = {})` helper building `ReportVariantSummary`:
  - `splitFoodLabel('Green colors bowl · Chicken')` → `{ menu: 'Green colors bowl', meat: 'Chicken' }`; `splitFoodLabel('Soup')` → `{ menu: 'Soup', meat: null }`.
  - Ranking from the screenshot data: Green·Chicken (4, 4 produced) ranks before 4seas·Chicken (4, 7 produced); zero-waste rows absent; `limit` respected.
  - `summarizeByMeat` on Chicken rows 4seas(7,3,4) + Green(4,1,4) + Pesto(4,2,2) → `{ meat: 'Chicken', produced: 15, sold: 6, waste: 10, topMenus: ['4seas Mix Veges Bowl', 'Green colors bowl'] }` (tie on 4 broken by menu name).
  - Produced 0 with waste 2 → `wasteRate` is `null` in both `summarizeByMeat` and `buildMenuCards`.
  - `buildMenuCards`: a no-meat row `'Soup'` forms its own card with one option `meat: null`; a menu with all-zero waste lands in `noWaste`; `isWorst` true only on Green·Chicken in the Green card; `hasCorrections` true when one option has `adjustment: 1`.
- [ ] **Step 2: Run** `npx vitest run src/lib/foodInsights.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the functions.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: rank wasted food and group menu cards"`

### Task 3: Make more / Make less guide

**Files:**
- Modify: `src/lib/foodInsights.ts`
- Test: `src/lib/foodInsights.test.ts`

**Interfaces:**
- Produces:
  - `type InsightClosingCount = { date: string; label: string; batchDate: string | null; expected: number; remaining: number; sold: number }` — the page passes only counts from closed, latest-version closings.
  - `type InsightQuantity = { label: string; date: string; quantity: number }`
  - `export const GUIDE_RULES = { minStockedDays: 5, makeLessWastePercent: 20, makeLessMaxSoldOutDays: 1, makeMoreSoldOutShare: 0.4, makeMoreMaxWastePercent: 10 } as const`
  - `type GuideLabel = 'not_enough_data' | 'make_less' | 'could_make_more' | 'about_right'`
  - `type GuideRow = { label: string; verdict: GuideLabel; stockedDays: number; soldOutDays: number; produced: number; waste: number; wastePercent: number | null }`
  - `classifyProductionGuide(input: { production: InsightQuantity[]; waste: InsightQuantity[]; closings: InsightClosingCount[]; window: DateRange }): GuideRow[]` — only rows whose `date` is inside `window`; one row per label seen in any input; sorted make_less, could_make_more, about_right, not_enough_data, then label.

Algorithm (not fully fixed by the signature):

```text
per label:
  group closings by date → stocked if Σexpected > 0; soldOut if stocked and Σremaining == 0
  produced = Σ production.quantity; waste = Σ waste.quantity; pct = wasteRatePercent(waste, produced)
  verdict:
    stockedDays < 5                                   → not_enough_data
    pct !== null && pct >= 20 && soldOutDays <= 1     → make_less
    soldOutDays >= 0.4 * stockedDays && (pct ?? 0) < 10 → could_make_more
    else                                              → about_right
```

- [ ] **Step 1: Write failing tests** (window `2026-09-21..2026-10-18`):
  - 4 stocked days → `not_enough_data` even with 50% waste.
  - 6 stocked days, produced 30, waste 6 (20%), 1 sold-out day → `make_less`; same with 2 sold-out days → `about_right`.
  - 10 stocked days, 4 sold-out, produced 40, waste 3 (7.5%) → `could_make_more`; waste 4 (10%) → `about_right`.
  - Two batches of one label on the same date: remaining 0 and 2 → 1 stocked day, 0 sold-out; remaining 0 and 0 → 1 sold-out day.
  - A closing count dated `2026-09-20` (outside window) is ignored.
  - waste with produced 0 → `wastePercent: null` and never `make_less` from the percentage rule.
  - Sort order follows verdict order.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `classifyProductionGuide` and `GUIDE_RULES`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: classify make more / make less guide"`

### Task 4: Food age, weekday grid, weekly trend

**Files:**
- Modify: `src/lib/foodInsights.ts`
- Test: `src/lib/foodInsights.test.ts`

**Interfaces:**
- Consumes: `InsightClosingCount`, `InsightQuantity`, `DateRange`, `trendWeeks`, `wasteRatePercent`.
- Produces:
  - `type AgeBucket = 'day0' | 'day1' | 'day2' | 'day3plus'`
  - `foodAge(input: { waste: Array<{ wasteDate: string; batchDate: string | null; quantity: number }>; closings: InsightClosingCount[] }): { waste: Record<AgeBucket, number>; sold: Record<AgeBucket, number>; unknownWaste: number; dominantWasteBucket: AgeBucket | null }` — age = whole days between dates; negative or missing batch date counts into `unknownWaste`; `dominantWasteBucket` null when total aged waste is 0.
  - `weekdaySalesGrid(closings: InsightClosingCount[], window: DateRange): Array<{ label: string; averages: Array<number | null> }>` — index 0 = Monday … 6 = Sunday; average = Σsold on that weekday ÷ stocked days (Σexpected > 0) on that weekday; `null` when 0 stocked days; rows sorted by label.
  - `weeklyWasteTrend(input: { production: InsightQuantity[]; waste: InsightQuantity[]; end: string }): Array<{ start: string; end: string; partial: boolean; produced: number; waste: number; wastePercent: number | null }>` — buckets from `trendWeeks(end)`.

- [ ] **Step 1: Write failing tests:**
  - Waste made 2026-10-15, wasted 2026-10-15 → `day0`; wasted 2026-10-18 → `day3plus`; batchDate null → `unknownWaste` 1; dominant bucket is the largest.
  - Sold 3 from a batch made 2026-10-16 on closing 2026-10-17 → `sold.day1 === 3`.
  - Weekday grid: Chicken stocked on two Mondays selling 2 and 4 → Monday average 3; a Monday with `expected: 0` is not counted; Tuesday with no counts → `null`.
  - Trend for end `2026-10-21`: 8 rows, last `partial: true`; a week with waste 2 and produced 0 → `wastePercent: null`; waste dated after `end` is excluded.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the three functions.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: add food age, weekday and trend analysis"`

### Task 5: Page frame — period, key numbers, warning line, tabs, history load

**Files:**
- Modify: `src/features/reports/ReportsPage.tsx` (state 131–175, load effect 176–249, controls/metrics/comparison 421–461, layout 463–524)
- Create: `src/features/reports/ReportControls.tsx` (period buttons, Filters disclosure, Download disclosure)
- Modify: `src/styles.css` (report section), `src/lib/i18n.tsx`

**Interfaces:**
- Consumes: `lastFullWeek`, `lastFourFullWeeks`, `trendWindow` (Task 1); `InsightClosingCount`, `InsightQuantity` (Task 3).
- Produces (inside `CanteenReportsContent`, used by Tasks 6–7):
  - `type ReportTab = 'summary' | 'menus' | 'waste' | 'trends' | 'expenses' | 'stock'`, read from and written to `?tab=` via `useSearchParams`; invalid or forbidden values (`expenses` without `canViewExpenses`) fall back to `'summary'`.
  - `history: { production: InsightQuantity[]; waste: Array<InsightQuantity & { batchDate: string | null; reason: string }>; closings: InsightClosingCount[] }` — loaded for `trendWindow(end)` with the existing `productionQuery`, `wasteQuery` + `archivedStockDeductionQuery` (verified rows only, via `verifiedArchiveAsWaste`), and `closingQuery` → `latestClosingVersions` → closed only; then filtered by `matchesSelectedFood` (never by waste reason).
  - `historyBusy: boolean`.

- [ ] **Step 1: Default period.** Initial `start/end` = `lastFullWeek(today)`. `setCommonRange` kinds become `'lastWeek' | 'week' | 'last4' | 'month'`; remove `'7'`. Update the day-rollover effect so it only moves `end` when the current range is "This week"/"This month" (track the active preset in state; Custom and Last week stay fixed).
- [ ] **Step 2: History load.** Add the history queries to the existing `Promise.all` (or a second effect keyed on `end` and `refreshToken`) and map rows to the `history` shape with `formatFoodVariant` labels.
- [ ] **Step 3: Controls.** `ReportControls` renders: preset buttons (Last week, This week, Last 4 weeks, This month, Custom → reveals the existing From/To inputs), a "Filters" button with active-count badge revealing the existing filter row unchanged, and a "Download" button revealing the existing `export-grid` (move the header "Export expenses" action there; `PageTitle` keeps no action).
- [ ] **Step 4: Key numbers.** Replace the seven metric cards and the comparison panel with four cards: Produced, Sold, Waste (`N · X%`), Expenses (only `canViewExpenses`), each with `changeText` against the previous period (waste % change in percentage points). Waste % here uses waste **without** the reason filter (Global Constraints).
- [ ] **Step 5: Warning line.** One `role="status"` line listing present issues — expired stock (`expiredStock > 0`), negative stock batches, retained archived effect — each linking to `?tab=stock`. Hidden when none.
- [ ] **Step 6: Tabs.** Tab bar (`role="tablist"`, buttons `role="tab"` `aria-selected`) and panels. Move existing JSX unchanged:
  - `waste`: Waste by reason, Waste records, Food taken after closing.
  - `expenses`: both expense charts' expense part (Expenses over time), Expense by store, Expense by category, Expense records.
  - `stock`: Stock balance check, Archived entries with stock effects, plus small cards for Stock on hand, Expired stock, Taken after close (moved from the old metric row).
  - `summary`: Produced, sold & waste chart (Task 6 adds the rest).
  - `menus`: the existing "Where each box went" table (Task 6 adds cards and a "Show as table" switch).
  - `trends`: placeholder empty state until Task 7.
- [ ] **Step 7: Translations and styles.** Thai entries for every new string; tab bar scrolls horizontally on phones; buttons ≥ 44px.
- [ ] **Step 8: Verify** `npx vitest run` and `npx tsc -p tsconfig.app.json --noEmit` pass; on the dev server the page opens on last week, every old section is reachable in a tab, archive review actions still work for admin, and `?tab=expenses` falls back to Summary for a role without expenses.
- [ ] **Step 9: Commit** `git commit -am "feat: reorganise reports into weekly view with tabs"`

### Task 6: Summary and Menus tabs

**Files:**
- Create: `src/features/reports/ReportSummaryTab.tsx`, `src/features/reports/ReportMenuCards.tsx`
- Modify: `src/features/reports/ReportsPage.tsx`, `src/styles.css`, `src/lib/i18n.tsx`

**Interfaces:**
- Consumes: `rankMostWasted`, `summarizeByMeat`, `buildMenuCards` (Task 2); `classifyProductionGuide`, `suggestionWindow` (Tasks 1, 3); `history`, `historyBusy` (Task 5).
- Produces: `ReportSummaryTab(props: { mostWasted: MostWastedRow[]; meat: MeatSummary[]; guide: GuideRow[]; guideBusy: boolean; reasonFilterActive: boolean; totalWaste: number; chart: ReactNode })`; `ReportMenuCards(props: { cards: { wasted: MenuCard[]; noWaste: MenuCard[] }; table: ReactNode })`.

- [ ] **Step 1: Summary tab.** Most wasted list (rank, menu · meat, "N boxes", "made X · sold Y", "Z% of made"; positive empty state when none). Waste by meat bars (sold / waste / stock) with counts; insight sentence only when `totalWaste >= 3`: "{meat} caused {n} of the {total} wasted boxes, mostly in {menu1} and {menu2}." Guide card titled "Make more / Make less · last 4 weeks": Make less and Could make more listed by name with "wasted A of B · sold out C of D days"; About right and Not enough data as expandable counts; "Suggestions ignore the waste-reason filter." when `reasonFilterActive`. Existing chart below.
- [ ] **Step 2: Menu cards.** CSS `conic-gradient` donut (sold, waste, stock) with centre waste % ("—" when null), header "made X · wasted Y", option lines "sold · waste · left" with `isWorst` highlighted, top three wasted cards highlighted, first with a "Most wasted" badge, "has corrections" note, folded "✓ N menus with no waste · Show" line, and a "Show as table" switch rendering the passed table. Donut has `role="img"` and an `aria-label` with the three numbers.
- [ ] **Step 3: Wire** both into `ReportsPage` with variant data from the existing `variantSummary` (for Most wasted, pass a variant summary built with the reason-filtered waste; for meat summary and cards, the reason-unfiltered one) and guide data from `history` with `suggestionWindow(end)`.
- [ ] **Step 4: Verify** tests/typecheck pass; on the dev server at 375px and desktop the Summary and Menus tabs match mockup `report-organize-v1` / `breakdown-donut-v4`, with no horizontal scroll.
- [ ] **Step 5: Commit** `git commit -am "feat: add report summary and menu donut cards"`

### Task 7: Food age and Trends tabs, final verification

**Files:**
- Create: `src/features/reports/ReportTrendsTab.tsx`, `src/features/reports/ReportFoodAge.tsx`
- Modify: `src/features/reports/ReportsPage.tsx`, `src/styles.css`, `src/lib/i18n.tsx`

**Interfaces:**
- Consumes: `foodAge`, `weekdaySalesGrid`, `weeklyWasteTrend`, `suggestionWindow` (Tasks 1, 4); `history` (Task 5); `filteredWaste` and `filteredClosings` from the page for Food age (selected period, reason filter applies).

- [ ] **Step 1: Food age** in the Waste tab above Waste by reason: two rows of four buckets (Waste, Sold "estimated"), sentence from `dominantWasteBucket` ("Most waste was food on its {n} day or older." for day3plus, otherwise "Most waste was food on day {n}."), and "{n} boxes without a batch date" when `unknownWaste > 0`.
- [ ] **Step 2: Trends tab.** Weekday grid (rows = labels, columns Mon–Sun, cell shaded by value relative to the row max, empty for null, horizontally scrollable on phones) titled "Average sold by weekday · last 4 weeks". Weekly line as inline SVG with 8 points, gaps for null, last point hollow and labelled "so far" when partial, each point with a `<title>` tooltip.
- [ ] **Step 3: Verify** `npx vitest run`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run build` all pass; browser check on the dev server at 375px and desktop in English and Thai across all six tabs with real data; no console errors.
- [ ] **Step 4: Commit** `git commit -am "feat: add food age and trends to reports"`
