# Weekly food report — design

Date: 2026-10-20 (Asia/Bangkok)
Status: draft for owner approval

## Intent

The Reports page is read once a week by the owner and the Manager to decide
what the kitchen should cook less or more of. Today it is about fifteen
stacked panels, and the "Where each box went" table grows one row per menu ×
meat option, so the answer to "what are we wasting?" is buried. The new page
answers that question in the first screen and keeps every existing detail one
tap away.

Readers: the owner and the Manager. Front and Kitchen do not use this page for
decisions. Readers are not cooking while they read, so detail is welcome, but
every section must lead with a plain-language conclusion before numbers.

## Goals

- Opening the page shows last week (Monday–Sunday, Asia/Bangkok) compared
  with the week before.
- The first screen names the most wasted menu + meat options and gives a
  make less / about right / could make more suggestion for each option.
- "Where each box went" scales to many menus: one donut card per menu with
  its meat options inside, sorted by waste.
- Nothing the page shows today is lost; it is regrouped into tabs.
- Phone layout remains usable.

## Non-goals

- No revenue, price, or profit figures (spec §25: automatic revenue
  calculation is out of scope).
- No ฿ value of waste in this change. `estimated_cost_per_box` is marked
  future/reserved in the spec; adding it is a separate, explicitly approved
  spec change.
- No automatic changes to production quantities; suggestions are advisory.
- No new tables, views, RPCs, or migrations. No change to how stock, sales,
  waste, or closing are recorded.
- Co-living reports are untouched.

## Anti-goals (would be a failure even if it works)

- A suggestion or ranking that disagrees with the numbers shown beside it.
- Any figure that double-counts archived entries, after-close removals, or
  stock corrections differently from today's report.
- Hiding the integrity warnings (negative stock, expired stock, retained
  archived stock effect) so that problems go unnoticed.

## Constraints

- Product authority: `CANTEEN_TRACKING_SYSTEM_SPEC.md`; implementation rules:
  `AGENTS.md`.
- Business dates are `Asia/Bangkok` calendar dates; weeks run Monday–Sunday.
- All new calculations live in `src/lib/reportAnalysis.ts` (or a sibling in
  `src/lib/`), are pure and deterministic, and have unit tests. Page code
  stays in `src/features/reports/`.
- Reuse today's definitions exactly: Produced = active production only;
  Sold = `calculated_sold_quantity` from the active closing version; Waste =
  active waste records **plus archived waste records whose
  `archive_review_status` is `verified_waste`** (today's
  `verifiedArchiveAsWaste` behaviour, for every period and the history
  window); stock corrections and unverified archived effects shown separately
  as today.

## Filters and date windows (builder's calls, accepted)

- **Filters.** Search, menu and meat filters apply to every section,
  including the history-based ones. The **waste-reason filter** applies only
  to waste-reason views (Waste by reason, waste records, Food age, Most
  wasted); it never applies to Make more / Make less, the trend line, the
  key-number waste % or the donuts, because narrowing waste without narrowing
  production would change the suggestions. When a waste-reason filter is
  active, the Summary shows "Suggestions ignore the waste-reason filter."
- **"Last 4 weeks" button** = the four full Monday–Sunday weeks ending last
  Sunday. **"Last week"** = the most recent full Monday–Sunday week.
- **Suggestion window** (Make more / Make less, weekday grid) = the 28
  calendar days ending on the selected end date.
- **Trend window** = the 8 Monday-start weeks up to and including the week
  that contains the selected end date. The newest week stops at the end date
  and is drawn as "so far" if incomplete. The history load therefore starts
  on the Monday 7 weeks before the end date's week and ends on the end date;
  it never reads past the end date.
- **Weekday grid average** = boxes sold on that weekday ÷ the number of those
  weekdays on which the option was stocked at closing (`expected_quantity`
  > 0 summed over its batches), the same "days stocked" rule as Make more /
  Make less. Empty cell when that count is 0.
- Role visibility is unchanged: expense content only for roles that can see
  expenses today; archive review actions only for roles that have them today.
- Large touch targets; Thai translations for every new string.

## Page structure (approved by owner in mockup `report-organize-v1`)

### Always visible

1. **Period picker.** Buttons: Last week (default), This week, Last 4 weeks,
   This month, Custom (the existing From/To dates). Existing "Last 7 days" is
   replaced by "Last week".
2. **Filters button** opening the existing search / menu / meat / waste
   reason / store filters. A small count shows how many filters are active.
3. **Download button** opening the existing CSV exports (including the
   current header "Export expenses" action).
4. **Four key numbers:** Produced, Sold, Waste (boxes and %), Expenses (only
   if the role can see expenses). Each shows the change versus the previous
   period of equal length with the same filters. This replaces the separate
   "Compared with the previous period" panel.
5. **One warning line,** shown only when something needs attention: expired
   stock on hand, negative stock batches, or retained archived stock effect.
   It links to the Stock check tab.

### Tabs

| Tab | Contents |
|-----|----------|
| **Summary** (default) | Most wasted · Waste by meat option · Make more / Make less · Produced, sold & waste by day chart (existing) |
| **Menus** | Donut card per menu (below) · "Show as table" switch revealing the existing "Where each box went" table unchanged |
| **Waste** | Waste by reason (existing) · Food age (new) · Waste records with photos (existing) · Food taken after closing (existing) |
| **Trends** | Weekday × menu sales grid (new) · Weekly waste-rate line (new) |
| **Expenses** | Expenses over time · by store · by category · expense records (all existing; tab hidden for roles without expense access) |
| **Stock check** | Stock balance check · Archived entries with stock effects and their review actions (existing) · Stock on hand, Expired stock, Taken after close numbers (moved from the metric row) |

The selected tab is kept in the URL (`?tab=`) so a link opens the same view.

## New sections — behaviour

### Most wasted (Summary)

- Ranks menu + meat options in the selected period by **boxes wasted**,
  highest first; ties broken by higher waste %, then name. Shows the top 5.
- Each row: menu · meat, boxes wasted, made, sold, % of made wasted.
- Options with zero waste never appear. If nothing was wasted, show a short
  positive empty state.

### Waste by meat option (Summary)

- One bar per meat option across all menus: sold / waste / still in stock,
  plus boxes wasted and waste %.
- One generated sentence naming the meat option with the most wasted boxes
  and its share of all waste, plus the one or two menus that contributed the
  most to it. Shown only when total waste ≥ 3 boxes.

### Make more / Make less (Summary)

- Always uses the **4 weeks ending on the selected end date**, labelled
  "last 4 weeks", regardless of the selected period, so a one-week view still
  has enough history.
- Per menu + meat option, over closed days in that window where the option had
  stock at closing time (`expected_quantity` > 0 summed over its batches):
  - *days stocked* = number of such days;
  - *sold-out days* = days where summed `physical_remaining_quantity` is 0;
  - *waste %* = waste ÷ produced in the window.
- Label rules, applied in order:
  1. days stocked < 5 → **Not enough data yet**
  2. waste % ≥ 20% and sold-out days ≤ 1 → **Make less**
  3. sold-out days ≥ 40% of days stocked and waste % < 10% → **Could make more**
  4. otherwise → **About right**
- Each label shows the numbers that produced it (e.g. "wasted 9 of 30 ·
  sold out 1 of 12 days"). Lists Make less and Could make more by name;
  About right and Not enough data are collapsed to a count that expands.
- Thresholds are constants in `src/lib/` so they can be tuned later.

### Menus tab — donut cards

- One card per menu (grouped by menu name snapshot) in the selected period.
- Donut segments: sold, waste, still in stock (current stock, as today).
- Centre: menu waste %. Header: made and wasted counts.
- Under the donut, one line per meat option: sold · waste · left, with the
  option that has the most waste highlighted.
- Sorted by boxes wasted, highest first. The top three menus with any waste
  get a highlighted border; the first gets a "Most wasted" badge.
- Menus with zero waste fold into one line ("✓ N menus with no waste ·
  Show").
- Stock correction and retained archived effect are not drawn in the donut;
  they stay in the table view, and a card shows a small "has corrections"
  note when either is non-zero.
- One column on phones, a responsive grid on wider screens.

### Food age (Waste tab)

- Waste: days between batch `production_date` and `waste_date`, grouped as
  day 0 (same day), day 1, day 2, day 3+. Shown as boxes per group.
- Sold: days between batch `production_date` and the closing
  `business_date`, weighted by `calculated_sold_quantity`, same groups. Label
  it "estimated", because sales are allocated to the oldest batch first.
- One generated sentence, e.g. "Most waste was food on its 3rd day or older."

### Weekday × menu grid (Trends tab)

- Uses the same 4-week window as Make more / Make less.
- Rows: menu + meat options (respecting filters); columns: Mon–Sun; cell:
  average boxes sold on that weekday over closed days. Shade cells by value.
- Empty cell when the option had no closed day on that weekday.

### Weekly waste-rate line (Trends tab)

- The 8 full weeks ending on the week containing the selected end date.
- One point per week: waste ÷ produced. Weeks with no production show a gap.

## Data loading

- The selected period keeps today's queries.
- One additional history load covers the trend window defined above
  (production batches, active and verified-archived waste, closings with batch counts), using
  the same columns and filters the page already uses. It powers Make more /
  Make less, the weekday grid, and the trend line. Load it alongside the
  main queries; show the sections' own loading states.

## Verification

- Unit tests for every new pure function: week boundaries in Bangkok time,
  ranking and tie-breaks, meat summary, label rules at each threshold edge,
  sold-out detection across multiple batches of one option, food-age
  grouping, weekday averages, weekly trend gaps.
- Existing report and stock/date rules tests still pass; production build
  passes.
- Browser check at phone and desktop width with real data on the dev server.

## Builder's discretion

- Component split inside `src/features/reports/`, chart rendering (CSS or
  inline SVG; no new chart library unless clearly justified), exact colours
  within the existing app palette, and copy wording for empty states.
