import { useEffect, useState } from 'react';
import { ArrowDownToLine, BarChart3, CalendarRange, Filter, Image as ImageIcon, PackageOpen, ReceiptText, RotateCcw, Trash2, TrendingDown, UtensilsCrossed } from 'lucide-react';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { addCalendarDays, businessDateNow } from '../../lib/dates';
import { buildReportDateBuckets } from '../../lib/reportBuckets';
import { formatBaht, formatDate, formatFoodVariant, formatQuantity } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { signPrivatePhotos } from '../../lib/photoAttachments';
import { aggregateVariantSummary, matchesFoodFilters, previousDateRange, wasteRatePercent, type VariantQuantity } from '../../lib/reportAnalysis';
import { requireSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../../lib/i18n';

interface Batch { menu_name_snapshot: string; production_date: string; meat_options: { name: string } | null; }
interface Production { id: string; menu_name_snapshot: string; production_date: string; quantity_produced: number; expiry_date: string; meat_options: { name: string } | null; }
interface Waste { id: string; waste_date: string; quantity: number; reason: string; notes: string | null; photo_url: string | null; waste_record_photos: { file_path: string }[]; photoUrls: string[]; production_batches: Batch | null; }
interface StockOut { id: string; removal_date: string; quantity: number; reason: string; notes: string | null; production_batches: Batch | null; }
interface Expense { id: string; expense_date: string; amount_thb: number; stores: { name: string } | null; expense_categories: { name: string } | null; notes: string | null; expense_receipt_photos: { file_path: string }[]; photoUrls: string[]; }
interface Stock { id: string; menu_name: string; production_date: string; expiry_date: string; quantity_remaining: number; }
interface Activity { id: string; occurred_at: string; action: string; entity_type: string; description: string; }
interface ClosingCount { production_batch_id: string; expected_quantity: number; physical_remaining_quantity: number; calculated_sold_quantity: number; stock_adjustment_quantity: number; adjustment_reason: string | null; production_batches: Batch | null; }
interface DailyClosing { business_date: string; version: number; status: string; note: string | null; closing_batch_counts: ClosingCount[]; }
interface ReportRows { production: Production[]; waste: Waste[]; closings: DailyClosing[]; expenses: Expense[]; }
const REPORT_DETAIL_LIMIT = 100;
const PAGE_SIZE = 1000;

async function readAll<T>(page: (from: number, to: number) => PromiseLike<unknown>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await page(from, from + PAGE_SIZE - 1) as { data: T[] | null; error: { message: string } | null };
    if (result.error) return { data: rows, error: result.error.message };
    const pageRows = result.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

function latestClosingVersions(rows: DailyClosing[]) {
  const latest = new Map<string, DailyClosing>();
  for (const row of [...rows].sort((a, b) => a.version - b.version)) {
    const current = latest.get(row.business_date);
    if (!current || row.version >= current.version) latest.set(row.business_date, row);
  }
  return [...latest.values()].sort((a, b) => a.business_date.localeCompare(b.business_date));
}

function wasteLabel(row: Waste) {
  return formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name);
}

function soldVariantQuantities(closings: DailyClosing[]): VariantQuantity[] {
  return closings.flatMap((closing) => closing.status === 'closed'
    ? (closing.closing_batch_counts ?? []).map((count) => ({
      label: formatFoodVariant(count.production_batches?.menu_name_snapshot, count.production_batches?.meat_options?.name),
      quantity: Number(count.calculated_sold_quantity),
    }))
    : []);
}

function selectedFood(label: string, menu: string, meat: string) {
  return matchesFoodFilters(label, menu, meat);
}

function sumQuantity(rows: Array<{ quantity: number }>) {
  return rows.reduce((sum, row) => sum + Number(row.quantity), 0);
}

function collectPhotoPaths<T extends { photo_url?: string | null; waste_record_photos?: { file_path: string }[]; expense_receipt_photos?: { file_path: string }[] }>(rows: T[]) {
  return rows.map((row) => [...new Set([
    ...(row.waste_record_photos ?? []).map((photo) => photo.file_path),
    ...(row.expense_receipt_photos ?? []).map((photo) => photo.file_path),
    ...(row.photo_url ? [row.photo_url] : []),
  ])]);
}

function withSignedPhotoUrls<T extends { id: string }>(rows: T[], paths: string[][], signedUrls: Record<string, string>) {
  return rows.map((row, index) => ({ ...row, photoUrls: (paths[index] ?? []).map((path) => signedUrls[path]).filter(Boolean) }));
}

function getDateOptions(rows: ReportRows, stock: Stock[]) {
  const menus = new Set<string>();
  const meats = new Set<string>();
  const add = (menu: string | undefined, meat: string | undefined) => {
    if (menu) menus.add(menu);
    if (meat) meats.add(meat);
  };
  for (const row of rows.production) add(row.menu_name_snapshot, row.meat_options?.name);
  for (const row of rows.waste) add(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name);
  for (const closing of rows.closings) for (const count of closing.closing_batch_counts ?? []) add(count.production_batches?.menu_name_snapshot, count.production_batches?.meat_options?.name);
  for (const row of stock) {
    const separator = row.menu_name.lastIndexOf(' · ');
    add(separator < 0 ? row.menu_name : row.menu_name.slice(0, separator), separator < 0 ? undefined : row.menu_name.slice(separator + 3));
  }
  return { menus: [...menus].sort((a, b) => a.localeCompare(b)), meats: [...meats].sort((a, b) => a.localeCompare(b)) };
}

export function ReportsPage() {
  const { member } = useAuth();
  const { t } = useI18n();
  const canViewActivity = member?.role === 'admin';
  const today = businessDateNow();
  const [start, setStart] = useState(`${today.slice(0, 8)}01`);
  const [end, setEnd] = useState(today);
  const [menuFilter, setMenuFilter] = useState('');
  const [meatFilter, setMeatFilter] = useState('');
  const [wasteReasonFilter, setWasteReasonFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [production, setProduction] = useState<Production[]>([]);
  const [waste, setWaste] = useState<Waste[]>([]);
  const [stockOuts, setStockOuts] = useState<StockOut[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [closings, setClosings] = useState<DailyClosing[]>([]);
  const [previous, setPrevious] = useState<ReportRows>({ production: [], waste: [], closings: [], expenses: [] });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      setBusy(true);
      setError('');
      const db = requireSupabase();
      const nextDay = addCalendarDays(end, 1);
      const previousRange = previousDateRange(start, end);
      const productionQuery = (from: number, to: number, fromDate: string, toDate: string) => db.from('production_batches').select('id, menu_name_snapshot, production_date, quantity_produced, expiry_date, meat_options(name)').gte('production_date', fromDate).lte('production_date', toDate).is('deleted_at', null).order('production_date', { ascending: false }).range(from, to);
      const wasteQuery = (from: number, to: number, fromDate: string, toDate: string) => db.from('waste_records').select('id, waste_date, quantity, reason, notes, photo_url, production_batches(menu_name_snapshot, production_date, meat_options(name)), waste_record_photos(file_path)').gte('waste_date', fromDate).lte('waste_date', toDate).is('deleted_at', null).order('waste_date', { ascending: false }).range(from, to);
      const expenseQuery = (from: number, to: number, fromDate: string, toDate: string) => db.from('expenses').select('id, expense_date, amount_thb, stores(name), expense_categories(name), notes, expense_receipt_photos(file_path)').gte('expense_date', fromDate).lte('expense_date', toDate).is('deleted_at', null).order('expense_date', { ascending: false }).range(from, to);
      const closingQuery = (from: number, to: number, fromDate: string, toDate: string) => db.from('daily_closings').select('business_date, version, status, note, closing_batch_counts(production_batch_id, expected_quantity, physical_remaining_quantity, calculated_sold_quantity, stock_adjustment_quantity, adjustment_reason, production_batches(menu_name_snapshot, production_date, meat_options(name)))').gte('business_date', fromDate).lte('business_date', toDate).order('business_date').order('version').range(from, to);
      const [productionResult, wasteResult, stockOutResult, expenseResult, stockResult, activityResult, closingResult, previousProductionResult, previousWasteResult, previousExpenseResult, previousClosingResult] = await Promise.all([
        readAll<Production>((from, to) => productionQuery(from, to, start, end)),
        readAll<Waste>((from, to) => wasteQuery(from, to, start, end)),
        readAll<StockOut>((from, to) => db.from('post_close_stock_outs').select('id, removal_date, quantity, reason, notes, production_batches(menu_name_snapshot, production_date, meat_options(name))').gte('removal_date', start).lte('removal_date', end).is('deleted_at', null).order('removal_date', { ascending: false }).range(from, to)),
        readAll<Expense>((from, to) => expenseQuery(from, to, start, end)),
        readAll<Stock>((from, to) => db.from('v_stock_by_batch').select('id, menu_name, production_date, expiry_date, quantity_remaining').gt('quantity_remaining', 0).order('expiry_date').range(from, to)),
        canViewActivity
          ? readAll<Activity>((from, to) => db.from('activity_logs').select('id, occurred_at, action, entity_type, description').gte('occurred_at', `${start}T00:00:00+07:00`).lt('occurred_at', `${nextDay}T00:00:00+07:00`).order('occurred_at', { ascending: false }).range(from, to))
          : Promise.resolve({ data: [] as Activity[], error: null }),
        readAll<DailyClosing>((from, to) => closingQuery(from, to, start, end)),
        readAll<Production>((from, to) => productionQuery(from, to, previousRange.start, previousRange.end)),
        readAll<Waste>((from, to) => wasteQuery(from, to, previousRange.start, previousRange.end)),
        readAll<Expense>((from, to) => expenseQuery(from, to, previousRange.start, previousRange.end)),
        readAll<DailyClosing>((from, to) => closingQuery(from, to, previousRange.start, previousRange.end)),
      ]);
      if (!alive) return;
      const results = [productionResult, wasteResult, stockOutResult, expenseResult, stockResult, activityResult, closingResult, previousProductionResult, previousWasteResult, previousExpenseResult, previousClosingResult];
      const firstError = results.find((result) => result.error)?.error;
      if (firstError) setError(firstError);

      const wasteRows = wasteResult.data as unknown as Waste[];
      const expenseRows = expenseResult.data as unknown as Expense[];
      const recentWaste = wasteRows.slice(0, REPORT_DETAIL_LIMIT);
      const recentExpenses = expenseRows.slice(0, REPORT_DETAIL_LIMIT);
      const wastePaths = collectPhotoPaths(recentWaste);
      const expensePaths = collectPhotoPaths(recentExpenses);
      const signed = await signPrivatePhotos(db, [...wastePaths, ...expensePaths].flat());
      if (!alive) return;
      const wastePhotosById = new Map(withSignedPhotoUrls(recentWaste, wastePaths, signed).map((row) => [row.id, row.photoUrls]));
      const expensePhotosById = new Map(withSignedPhotoUrls(recentExpenses, expensePaths, signed).map((row) => [row.id, row.photoUrls]));
      setProduction(productionResult.data as unknown as Production[]);
      setWaste(wasteRows.map((row) => ({ ...row, photoUrls: wastePhotosById.get(row.id) ?? [] })));
      setStockOuts(stockOutResult.data as unknown as StockOut[]);
      setExpenses(expenseRows.map((row) => ({ ...row, photoUrls: expensePhotosById.get(row.id) ?? [] })));
      setStock(stockResult.data as unknown as Stock[]);
      setActivity(activityResult.data);
      setClosings(latestClosingVersions(closingResult.data as unknown as DailyClosing[]));
      setPrevious({
        production: previousProductionResult.data as unknown as Production[],
        waste: previousWasteResult.data as unknown as Waste[],
        expenses: previousExpenseResult.data as unknown as Expense[],
        closings: latestClosingVersions(previousClosingResult.data as unknown as DailyClosing[]),
      });
      setBusy(false);
    }
    void load();
    return () => { alive = false; };
  }, [start, end, canViewActivity]);

  const dateOptions = getDateOptions({ production: [...production, ...previous.production], waste: [...waste, ...previous.waste], closings: [...closings, ...previous.closings], expenses }, stock);
  const menus = [...new Set([...dateOptions.menus, ...(menuFilter ? [menuFilter] : [])])].sort((a, b) => a.localeCompare(b));
  const meats = [...new Set([...dateOptions.meats, ...(meatFilter ? [meatFilter] : [])])].sort((a, b) => a.localeCompare(b));
  const reasonOptions = [...new Set([...waste, ...previous.waste].map((row) => row.reason).concat(wasteReasonFilter ? [wasteReasonFilter] : []))].sort((a, b) => a.localeCompare(b));
  const storeOptions = [...new Set([...expenses, ...previous.expenses].map((row) => row.stores?.name ?? 'Other').concat(storeFilter ? [storeFilter] : []))].sort((a, b) => a.localeCompare(b));
  const filterLabel = (row: Production) => formatFoodVariant(row.menu_name_snapshot, row.meat_options?.name);
  const filteredProduction = production.filter((row) => selectedFood(filterLabel(row), menuFilter, meatFilter));
  const filteredWaste = waste.filter((row) => selectedFood(wasteLabel(row), menuFilter, meatFilter) && (!wasteReasonFilter || row.reason === wasteReasonFilter));
  const filteredStockOuts = stockOuts.filter((row) => selectedFood(formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name), menuFilter, meatFilter));
  const filteredExpenses = expenses.filter((row) => !storeFilter || (row.stores?.name ?? 'Other') === storeFilter);
  const filteredStock = stock.filter((row) => selectedFood(row.menu_name, menuFilter, meatFilter));
  const filteredClosings = closings.map((closing) => ({
    ...closing,
    closing_batch_counts: (closing.closing_batch_counts ?? []).filter((count) => selectedFood(formatFoodVariant(count.production_batches?.menu_name_snapshot, count.production_batches?.meat_options?.name), menuFilter, meatFilter)),
  }));
  const closingSold = soldVariantQuantities(filteredClosings);
  const totalProduced = sumQuantity(filteredProduction.map((row) => ({ quantity: Number(row.quantity_produced) })));
  const totalWaste = sumQuantity(filteredWaste);
  const totalStockOut = sumQuantity(filteredStockOuts);
  const totalExpenses = filteredExpenses.reduce((sum, row) => sum + Number(row.amount_thb), 0);
  const stockOnHand = sumQuantity(filteredStock.map((row) => ({ quantity: Number(row.quantity_remaining) })));
  const expiredStock = sumQuantity(filteredStock.filter((row) => row.expiry_date < today).map((row) => ({ quantity: Number(row.quantity_remaining) })));
  const totalSold = closingSold.reduce((sum, row) => sum + row.quantity, 0);
  const wasteRate = wasteRatePercent(totalWaste, totalProduced);

  const previousProduction = previous.production.filter((row) => selectedFood(filterLabel(row), menuFilter, meatFilter));
  const previousWaste = previous.waste.filter((row) => selectedFood(wasteLabel(row), menuFilter, meatFilter) && (!wasteReasonFilter || row.reason === wasteReasonFilter));
  const previousExpenses = previous.expenses.filter((row) => !storeFilter || (row.stores?.name ?? 'Other') === storeFilter);
  const previousClosings = previous.closings.map((closing) => ({
    ...closing,
    closing_batch_counts: (closing.closing_batch_counts ?? []).filter((count) => selectedFood(formatFoodVariant(count.production_batches?.menu_name_snapshot, count.production_batches?.meat_options?.name), menuFilter, meatFilter)),
  }));
  const previousSold = soldVariantQuantities(previousClosings).reduce((sum, row) => sum + row.quantity, 0);
  const previousProduced = sumQuantity(previousProduction.map((row) => ({ quantity: Number(row.quantity_produced) })));
  const previousWasteTotal = sumQuantity(previousWaste);
  const previousExpensesTotal = previousExpenses.reduce((sum, row) => sum + Number(row.amount_thb), 0);
  const previousWasteRate = wasteRatePercent(previousWasteTotal, previousProduced);
  const comparison: { label: string; value: number | null; previous: number | null; format: (amount: number) => string; suffix?: string }[] = [
    { label: 'Produced', value: totalProduced, previous: previousProduced, format: formatQuantity },
    { label: 'Waste', value: totalWaste, previous: previousWasteTotal, format: formatQuantity },
    { label: 'Waste rate', value: wasteRate, previous: previousWasteRate, format: (value: number) => `${Math.round(value)}%`, suffix: 'percentage points' },
    { label: 'Inferred sold', value: totalSold, previous: previousSold, format: formatQuantity },
    { label: 'Expenses', value: totalExpenses, previous: previousExpensesTotal, format: formatBaht },
  ];
  const changeText = (value: number | null, oldValue: number | null, format: (amount: number) => string) => {
    if (value === null) return t('Unavailable without production');
    if (oldValue === null) return t('No comparison available');
    const difference = value - oldValue;
    const sign = difference > 0 ? '+' : difference < 0 ? '−' : '';
    return `${sign}${format(Math.abs(difference))} ${t('vs previous period')}`;
  };

  const daily = buildReportDateBuckets(start, end).map((bucket) => {
    const inRange = (date: string) => date >= bucket.start && date <= bucket.end;
    return {
      ...bucket,
      produced: sumQuantity(filteredProduction.filter((row) => inRange(row.production_date)).map((row) => ({ quantity: Number(row.quantity_produced) }))),
      sold: filteredClosings.filter((closing) => closing.status === 'closed' && inRange(closing.business_date)).reduce((sum, closing) => sum + closing.closing_batch_counts.reduce((dayTotal, count) => dayTotal + Number(count.calculated_sold_quantity), 0), 0),
      waste: sumQuantity(filteredWaste.filter((row) => inRange(row.waste_date))),
      expenses: filteredExpenses.filter((row) => inRange(row.expense_date)).reduce((sum, row) => sum + Number(row.amount_thb), 0),
    };
  });
  const maxQuantity = Math.max(1, ...daily.flatMap((row) => [row.produced, row.sold, row.waste]));
  const maxExpense = Math.max(1, ...daily.map((row) => row.expenses));
  const variantSummary = aggregateVariantSummary({
    production: filteredProduction.map((row) => ({ label: filterLabel(row), quantity: Number(row.quantity_produced) })),
    sold: closingSold,
    waste: filteredWaste.map((row) => ({ label: wasteLabel(row), quantity: Number(row.quantity) })),
    stock: filteredStock.map((row) => ({ label: row.menu_name, quantity: Number(row.quantity_remaining) })),
  });
  const reasonTotals = Object.entries(filteredWaste.reduce<Record<string, number>>((totals, row) => {
    totals[row.reason] = (totals[row.reason] ?? 0) + Number(row.quantity);
    return totals;
  }, {})).sort((a, b) => b[1] - a[1]);
  const storeTotals = Object.entries(filteredExpenses.reduce<Record<string, number>>((totals, row) => {
    const key = row.stores?.name ?? 'Other';
    totals[key] = (totals[key] ?? 0) + Number(row.amount_thb);
    return totals;
  }, {})).sort((a, b) => b[1] - a[1]);
  const categoryTotals = Object.entries(filteredExpenses.reduce<Record<string, number>>((totals, row) => {
    const key = row.expense_categories?.name ?? 'Other';
    totals[key] = (totals[key] ?? 0) + Number(row.amount_thb);
    return totals;
  }, {})).sort((a, b) => b[1] - a[1]);

  const exports: { label: string; icon: typeof ReceiptText; rows: Array<Record<string, unknown>> }[] = [
    { label: 'Expenses', icon: ReceiptText, rows: filteredExpenses.map((row) => ({ date: row.expense_date, store: row.stores?.name ?? '', category: row.expense_categories?.name ?? '', amount_thb: row.amount_thb, notes: row.notes })) },
    { label: 'Production', icon: UtensilsCrossed, rows: filteredProduction.map((row) => ({ date: row.production_date, menu: formatFoodVariant(row.menu_name_snapshot, row.meat_options?.name), quantity: row.quantity_produced, expiry_date: row.expiry_date })) },
    { label: 'Waste', icon: Trash2, rows: filteredWaste.map((row) => ({ date: row.waste_date, menu: wasteLabel(row), quantity: row.quantity, reason: row.reason, notes: row.notes })) },
    { label: 'After-close stock out', icon: PackageOpen, rows: filteredStockOuts.map((row) => ({ date: row.removal_date, menu: formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name), batch_date: row.production_batches?.production_date, quantity: row.quantity, reason: row.reason, notes: row.notes })) },
    { label: 'Stock', icon: BarChart3, rows: filteredStock.map((row) => ({ menu: row.menu_name, production_date: row.production_date, expiry_date: row.expiry_date, remaining_quantity: row.quantity_remaining })) },
    { label: 'Menu analysis', icon: BarChart3, rows: variantSummary.map((row) => ({ menu_variant: row.label, produced: row.produced, inferred_sold: row.sold, waste: row.waste, waste_percent: row.wasteRate === null ? '' : Math.round(row.wasteRate), current_stock: row.currentStock })) },
    { label: 'Activity', icon: CalendarRange, rows: activity.map((row) => ({ occurred_at: row.occurred_at, action: row.action, entity_type: row.entity_type, description: row.description })) },
    { label: 'Daily closing', icon: CalendarRange, rows: filteredClosings.flatMap((day) => day.closing_batch_counts.map((count) => ({ business_date: day.business_date, closing_version: day.version, status: day.status, batch_id: count.production_batch_id, expected: count.expected_quantity, physical_remaining: count.physical_remaining_quantity, inferred_sold: count.calculated_sold_quantity, adjustment: count.stock_adjustment_quantity, adjustment_reason: count.adjustment_reason, note: day.note }))) },
  ];
  const visibleExports = exports.filter(({ label }) => label !== 'Activity' || canViewActivity);
  const allFiltersClear = !menuFilter && !meatFilter && !wasteReasonFilter && !storeFilter;
  const setCommonRange = (kind: '7' | 'week' | 'month') => {
    if (kind === '7') { setStart(addCalendarDays(today, -6)); setEnd(today); return; }
    if (kind === 'month') { setStart(`${today.slice(0, 8)}01`); setEnd(today); return; }
    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    setStart(addCalendarDays(today, -((weekday + 6) % 7)));
    setEnd(today);
  };

  return <>
    <PageTitle eyebrow="THE PATTERNS BEHIND THE DAY" title="Reports" detail="A clear look at production, waste and spending, over a date range that works for you." action={<button type="button" className="button button-quiet" onClick={() => downloadCsv(`canteen-report-${start}-to-${end}.csv`, [...exports[0]!.rows])}><ArrowDownToLine size={16} /> {t('Export expenses')}</button>} />
    {error && <Notice>{error}</Notice>}
    <section className="panel report-controls">
      <div className="report-range-title"><span className="report-range-icon"><CalendarRange size={18} /></span><span><strong>{t('Your reporting period')}</strong><small>{t('Both start and end dates are included.')}</small></span></div>
      <label>{t('From')}<input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} /></label>
      <label>{t('To')}<input type="date" value={end} min={start} max={today} onChange={(event) => setEnd(event.target.value)} /></label>
      <button type="button" className="button button-quiet" onClick={() => setCommonRange('7')}>{t('Last 7 days')}</button>
      <button type="button" className="button button-quiet" onClick={() => setCommonRange('week')}>{t('This week')}</button>
      <button type="button" className="button button-quiet" onClick={() => setCommonRange('month')}>{t('This month')}</button>
      <div className="report-filter-row"><span><Filter size={15} /> {t('Break down by')}</span>
        <label>{t('Menu')}<select value={menuFilter} onChange={(event) => setMenuFilter(event.target.value)}><option value="">{t('All menus')}</option>{menus.map((menu) => <option key={menu} value={menu}>{menu}</option>)}</select></label>
        <label>{t('Meat option')}<select value={meatFilter} onChange={(event) => setMeatFilter(event.target.value)}><option value="">{t('All meat options')}</option>{meats.map((meat) => <option key={meat} value={meat}>{meat}</option>)}</select></label>
        <label>{t('Waste reason')}<select value={wasteReasonFilter} onChange={(event) => setWasteReasonFilter(event.target.value)}><option value="">{t('All waste reasons')}</option>{reasonOptions.map((reason) => <option key={reason} value={reason}>{t(reason)}</option>)}</select></label>
        <label>{t('Store')}<select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}><option value="">{t('All stores')}</option>{storeOptions.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
        {!allFiltersClear && <button type="button" className="button button-quiet report-clear-filters" onClick={() => { setMenuFilter(''); setMeatFilter(''); setWasteReasonFilter(''); setStoreFilter(''); }}><RotateCcw size={14} /> {t('Clear filters')}</button>}
      </div>
      <p className="report-filter-hint">{t('Menu and meat filter food records; reason filters waste; store filters expenses. Stock on hand is current, even for an earlier date range.')}</p>
    </section>

    <section className="report-metrics">
      <article className="report-metric report-metric-green"><span><UtensilsCrossed size={17} /> {t('PRODUCED')}</span><strong>{busy ? '—' : formatQuantity(totalProduced)}<small>{t('boxes')}</small></strong><p>{filteredProduction.length} {t('batches recorded')}</p></article>
      <article className="report-metric report-metric-peach"><span><Trash2 size={17} /> {t('WASTE')}</span><strong>{busy ? '—' : formatQuantity(totalWaste)}<small>{t('boxes')}</small></strong><p><TrendingDown size={13} /> {wasteRate === null ? t('Unavailable without production') : `${Math.round(wasteRate)}% ${t('of produced stock')}`}</p></article>
      <article className="report-metric report-metric-green"><span><PackageOpen size={17} /> {t('TAKEN AFTER CLOSE')}</span><strong>{busy ? '—' : formatQuantity(totalStockOut)}<small>{t('boxes')}</small></strong><p>{t('Separate from actual food waste')}</p></article>
      <article className="report-metric report-metric-lilac"><span><CalendarRange size={17} /> {t('INFERRED SOLD')}</span><strong>{busy ? '—' : formatQuantity(totalSold)}<small>{t('boxes')}</small></strong><p>{filteredClosings.filter((day) => day.status === 'closed').length} {t('days closed in this range')}</p></article>
      <article className="report-metric report-metric-blue"><span><ReceiptText size={17} /> {t('EXPENSES')}</span><strong className="report-currency">{busy ? '—' : formatBaht(totalExpenses)}</strong><p>{filteredExpenses.length} {t('purchases recorded')}</p></article>
      <article className="report-metric report-metric-lilac"><span><BarChart3 size={17} /> {t('STOCK ON HAND')}</span><strong>{busy ? '—' : formatQuantity(stockOnHand)}<small>{t('boxes')}</small></strong><p>{filteredStock.length} {t('active batches today')}</p></article>
      <article className="report-metric report-metric-peach"><span><CalendarRange size={17} /> {t('EXPIRED STOCK')}</span><strong>{busy ? '—' : formatQuantity(expiredStock)}<small>{t('boxes')}</small></strong><p>{t('Current stock past its expiry date')}</p></article>
    </section>

    <section className="panel report-comparison"><div className="panel-head"><div><span className="eyebrow">{t('PERIOD OVER PERIOD')}</span><h2>{t('Compared with the previous period')}</h2><p>{t('The previous period has the same number of days, with the same filters.')}</p></div></div>
      <div className="comparison-grid">{comparison.map((item) => <article key={item.label}><span>{t(item.label)}</span><strong>{busy ? '—' : item.value === null ? '—' : item.format(item.value)}</strong><small>{busy ? '' : `${changeText(item.value, item.previous, item.format)}${item.value !== null && item.previous !== null && item.suffix ? ` ${t(item.suffix)}` : ''}`}</small></article>)}</div>
    </section>

    <div className="report-grid report-chart-grid">
      <section className="panel report-chart-panel"><div className="panel-head"><div><span className="eyebrow">{t('A GOOD WAY TO SEE A TREND')}</span><h2>{t('Production, sold & waste')}</h2></div><span className="chart-legend"><i className="legend-produced" /> {t('Produced')} <i className="legend-sold" /> {t('Sold')} <i className="legend-waste" /> {t('Waste')}</span></div>
        {busy ? <LoadingState label="Building your report…" /> : !totalProduced && !totalWaste && !totalSold ? <EmptyState title="Your chart will grow here" detail="A few days of records make trends easier to spot." /> : <div className="bar-chart" role="img" aria-label="Production, inferred sales and waste across the selected date range">{daily.map((day) => <div className="bar-day" key={day.start} title={`${formatDate(day.start)}${day.start === day.end ? '' : ` – ${formatDate(day.end)}`}: ${day.produced} produced, ${day.sold} inferred sold, ${day.waste} waste`}><div className="bar-pair"><span className="bar bar-produced" style={{ height: `${Math.max(3, day.produced / maxQuantity * 100)}%` }} /><span className="bar bar-sold" style={{ height: `${Math.max(3, day.sold / maxQuantity * 100)}%` }} /><span className="bar bar-waste" style={{ height: `${Math.max(3, day.waste / maxQuantity * 100)}%` }} /></div><small>{day.end.slice(-2)}</small></div>)}</div>}
        <div className="chart-caption"><span>{t('BOXES PER DAY')}</span><span>{formatDate(start)} – {formatDate(end)}</span></div>
      </section>
      <section className="panel report-chart-panel"><div className="panel-head"><div><span className="eyebrow">{t('SPENDING TREND')}</span><h2>{t('Expenses over time')}</h2></div></div>
        {busy ? <LoadingState label="Gathering expenses…" /> : !totalExpenses ? <EmptyState title="No expenses in this range" detail="Choose another date range or add a purchase." /> : <div className="bar-chart expense-trend-chart" role="img" aria-label="Expenses across the selected date range">{daily.map((day) => <div className="bar-day" key={day.start} title={`${formatDate(day.start)}${day.start === day.end ? '' : ` – ${formatDate(day.end)}`}: ${formatBaht(day.expenses)}`}><div className="bar-pair"><span className="bar bar-expense" style={{ height: `${Math.max(day.expenses ? 3 : 0, day.expenses / maxExpense * 100)}%` }} /></div><small>{day.end.slice(-2)}</small></div>)}</div>}
        <div className="chart-caption"><span>{t('THB BY PERIOD')}</span><span>{formatDate(start)} – {formatDate(end)}</span></div>
      </section>
    </div>

    <section className="panel report-table-panel"><div className="panel-head"><div><span className="eyebrow">{t('MENU AND MEAT BREAKDOWN')}</span><h2>{t('Where each box went')}</h2><p>{t('Waste rate is waste divided by production for the selected menu and meat option.')}</p></div><span className="count-chip">{variantSummary.length} {t('menu variants')}</span></div>
      {busy ? <LoadingState label="Building your report…" /> : variantSummary.length === 0 ? <EmptyState title="No food records in this range" detail="Try a different date range or clear some filters." /> : <div className="report-table-wrap"><table className="report-data-table"><thead><tr><th>{t('Menu / meat')}</th><th>{t('Produced')}</th><th>{t('Sold')}</th><th>{t('Waste')}</th><th>{t('Waste %')}</th><th>{t('Current stock')}</th></tr></thead><tbody>{variantSummary.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{formatQuantity(row.produced)}</td><td>{formatQuantity(row.sold)}</td><td>{formatQuantity(row.waste)}</td><td>{row.wasteRate === null ? '—' : `${Math.round(row.wasteRate)}%`}</td><td>{formatQuantity(row.currentStock)}</td></tr>)}</tbody></table></div>}
    </section>

    <div className="report-grid report-breakdown-grid">
      <section className="panel expense-breakdown"><div className="panel-head"><div><span className="eyebrow">{t('WHY FOOD WAS LOST')}</span><h2>{t('Waste by reason')}</h2></div></div>
        {busy ? <LoadingState label="Gathering waste reasons…" /> : reasonTotals.length === 0 ? <EmptyState title="No waste in this range" detail="Waste quantity by reason will appear here." /> : <div className="store-breakdown">{reasonTotals.map(([reason, quantity], index) => <div className="store-bar-row" key={reason}><div><span>{t(reason)}</span><strong>{formatQuantity(quantity)} {t('boxes')}</strong></div><span className={`store-bar-line store-bar-${index % 4}`}><i style={{ width: `${quantity / (reasonTotals[0]?.[1] || 1) * 100}%` }} /></span></div>)}</div>}
      </section>
      <section className="panel expense-breakdown"><div className="panel-head"><div><span className="eyebrow">{t('WHERE IT WENT')}</span><h2>{t('Expense by store')}</h2></div></div>
        {busy ? <LoadingState label="Gathering expenses…" /> : storeTotals.length === 0 ? <EmptyState title="No expenses in this range" detail="Choose another date range or add a purchase." /> : <div className="store-breakdown">{storeTotals.map(([store, amount], index) => <div className="store-bar-row" key={store}><div><span>{store}</span><strong>{formatBaht(amount)}</strong></div><span className={`store-bar-line store-bar-${index % 4}`}><i style={{ width: `${amount / (storeTotals[0]?.[1] || 1) * 100}%` }} /></span></div>)}</div>}
      </section>
      <section className="panel expense-breakdown"><div className="panel-head"><div><span className="eyebrow">{t('PURCHASE TYPES')}</span><h2>{t('Expense by category')}</h2></div></div>
        {busy ? <LoadingState label="Gathering expense categories…" /> : categoryTotals.length === 0 ? <EmptyState title="No expenses in this range" detail="Choose another date range or add a purchase." /> : <div className="store-breakdown">{categoryTotals.map(([category, amount], index) => <div className="store-bar-row" key={category}><div><span>{t(category)}</span><strong>{formatBaht(amount)}</strong></div><span className={`store-bar-line store-bar-${index % 4}`}><i style={{ width: `${amount / (categoryTotals[0]?.[1] || 1) * 100}%` }} /></span></div>)}</div>}
      </section>
    </div>

    <div className="report-grid report-record-grid">
      <section className="panel report-record-panel"><div className="panel-head"><div><span className="eyebrow">{t('OPEN THE SOURCE RECORD')}</span><h2>{t('Waste records')}</h2><p>{t('Includes the batch, reason, notes and private photos.')}</p></div><span className="count-chip">{filteredWaste.length}</span></div>
        {busy ? <LoadingState label="Gathering waste records…" /> : filteredWaste.length === 0 ? <EmptyState title="No waste in this range" detail="Waste records will appear here when staff logs food loss." /> : <>
          <div className="report-record-list">{filteredWaste.slice(0, REPORT_DETAIL_LIMIT).map((row) => <details className="report-source-record" key={row.id}><summary><span className="report-source-icon report-source-waste"><Trash2 size={16} /></span><span className="report-source-main"><strong>{wasteLabel(row)}</strong><small>{formatDate(row.waste_date)} · {t(row.reason)} · {row.production_batches?.production_date ? `${t('Batch made')} ${formatDate(row.production_batches.production_date)}` : t('date unavailable')}</small></span><strong className="report-source-quantity">−{formatQuantity(Number(row.quantity))} {t('boxes')}</strong></summary><div className="report-source-detail">{row.notes && <p>{row.notes}</p>}{row.photoUrls.length > 0 ? <div className="report-photo-strip">{row.photoUrls.map((url) => <a href={url} key={url} target="_blank" rel="noreferrer"><img src={url} alt={`${t('Waste photo')} · ${wasteLabel(row)}`} loading="lazy" /></a>)}</div> : <small className="report-no-photo"><ImageIcon size={14} /> {t('No photo attached')}</small>}</div></details>)}</div>
          {filteredWaste.length > REPORT_DETAIL_LIMIT && <p className="report-list-limit">{t('Showing the latest')} {REPORT_DETAIL_LIMIT} {t('of')} {filteredWaste.length} {t('records')}.</p>}
        </>}
      </section>
      <section className="panel report-record-panel"><div className="panel-head"><div><span className="eyebrow">{t('PURCHASE DETAILS')}</span><h2>{t('Expense records')}</h2><p>{t('Open a purchase to see its notes and private receipt photos.')}</p></div><span className="count-chip">{filteredExpenses.length}</span></div>
        {busy ? <LoadingState label="Gathering expense records…" /> : filteredExpenses.length === 0 ? <EmptyState title="No expenses in this range" detail="Expense details will appear here when purchases are recorded." /> : <>
          <div className="report-record-list">{filteredExpenses.slice(0, REPORT_DETAIL_LIMIT).map((row) => <details className="report-source-record" key={row.id}><summary><span className="report-source-icon report-source-expense"><ReceiptText size={16} /></span><span className="report-source-main"><strong>{row.expense_categories?.name ?? 'Other'} · {row.stores?.name ?? 'Other'}</strong><small>{formatDate(row.expense_date)}{row.notes ? ` · ${row.notes}` : ''}</small></span><strong className="report-source-quantity">{formatBaht(row.amount_thb)}</strong></summary><div className="report-source-detail">{row.notes && <p>{row.notes}</p>}{row.photoUrls.length > 0 ? <div className="report-photo-strip">{row.photoUrls.map((url) => <a href={url} key={url} target="_blank" rel="noreferrer"><img src={url} alt={`${t('Receipt photo')} · ${row.expense_categories?.name ?? ''}`} loading="lazy" /></a>)}</div> : <small className="report-no-photo"><ImageIcon size={14} /> {t('No receipt photo attached')}</small>}</div></details>)}</div>
          {filteredExpenses.length > REPORT_DETAIL_LIMIT && <p className="report-list-limit">{t('Showing the latest')} {REPORT_DETAIL_LIMIT} {t('of')} {filteredExpenses.length} {t('records')}.</p>}
        </>}
      </section>
    </div>

    <section className="panel exports-panel"><div className="panel-head"><div><span className="eyebrow">{t('YOUR RECORDS, YOURS TO KEEP')}</span><h2>{t('Download a CSV')}</h2></div><ArrowDownToLine className="panel-sparkle" size={18} /></div><div className="export-grid">{visibleExports.map(({ label, icon: Icon, rows }) => <button key={label} className="export-card" disabled={!rows.length || busy} onClick={() => downloadCsv(`canteen-${label.toLowerCase()}-${start}-to-${end}.csv`, rows)}><span className="export-card-icon"><Icon size={18} /></span><span><strong>{t(label)}</strong><small>{rows.length} {t('rows available')}</small></span><ArrowDownToLine size={16} /></button>)}</div></section>
  </>;
}
