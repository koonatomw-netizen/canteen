import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, ArrowDownToLine, BarChart3, CalendarRange, CircleCheck, Filter, Image as ImageIcon, PackageOpen, ReceiptText, RotateCcw, Search, Ticket, Trash2, TriangleAlert, UtensilsCrossed } from 'lucide-react';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { addCalendarDays } from '../../lib/dates';
import { useBusinessDate } from '../../lib/useBusinessDate';
import { buildReportDateBuckets } from '../../lib/reportBuckets';
import { formatBaht, formatDate, formatFoodVariant, formatQuantity } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { signPrivatePhotos } from '../../lib/photoAttachments';
import { aggregateVariantSummary, calculateStockReconciliation, matchesFoodFilters, matchesFoodSearch, previousDateRange, wasteRatePercent, type VariantQuantity } from '../../lib/reportAnalysis';
import { readAll } from '../../lib/pagination';
import { errorMessage, requireSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../../lib/i18n';
import { ColivingPage } from '../coliving/ColivingPage';
import { ArchiveReviewDialog, type ArchiveReviewTarget } from './ArchiveReviewDialog';
import { ReportControls, type RangePreset } from './ReportControls';
import { buildMenuCards, classifyProductionGuide, closedDayCount, closingInsightCounts, foodAge, lastFullWeek, latestClosingVersions, presetRange, rankMostWasted, suggestionWindow, summarizeByMeat, trendWindow, weekdaySalesGrid, weeklyWasteTrend, type InsightClosingCount, type InsightQuantity } from '../../lib/foodInsights';
import { ReportSummaryTab } from './ReportSummaryTab';
import { ReportMenuCards } from './ReportMenuCards';
import { ReportFoodAge } from './ReportFoodAge';
import { ReportTrendsTab } from './ReportTrendsTab';

interface Batch { id?: string; menu_name_snapshot: string; production_date: string; quantity_produced?: number; deleted_at?: string | null; meat_options: { name: string } | null; }
interface Production { id: string; menu_name_snapshot: string; production_date: string; quantity_produced: number; expiry_date: string; meat_options: { name: string } | null; }
interface Waste { id: string; waste_date: string; quantity: number; reason: string; notes: string | null; created_by_name: string; photo_url: string | null; waste_record_photos: { file_path: string }[]; photoUrls: string[]; production_batches: Batch | null; archiveVerified?: boolean; archiveReviewedByName?: string | null; }
interface ArchivedStockDeduction { id: string; waste_date: string; quantity: number; reason: string; notes: string | null; created_by_name: string | null; deleted_at: string; stock_ledger_preserved_on_archive: boolean; archive_review_status: 'unverified' | 'verified_waste'; archive_reviewed_at: string | null; archive_reviewed_by_name: string | null; photo_url: string | null; waste_record_photos: { file_path: string }[]; production_batches: Batch | null; }
interface RemovedArchivedWasteEffect { id: string; waste_record_id: string; waste_date: string; production_batch_id: string; quantity: number; reason: string; notes: string | null; created_by_name: string | null; archived_at: string; review_reason: string; reviewed_at: string; reviewed_by_name: string; photo_paths: string[]; source_snapshot: Record<string, unknown>; production_batches: Batch | null; }
interface StockOut { id: string; removal_date: string; quantity: number; reason: string; notes: string | null; created_by_name: string; production_batches: Batch | null; }
interface Expense { id: string; expense_date: string; amount_thb: number; stores: { name: string } | null; expense_categories: { name: string } | null; notes: string | null; expense_receipt_photos: { file_path: string }[]; photoUrls: string[]; }
interface Stock { id: string; menu_name: string; production_date: string; expiry_date: string; quantity_remaining: number; }
interface Activity { id: string; occurred_at: string; action: string; entity_type: string; description: string; }
interface ClosingCount { production_batch_id: string; expected_quantity: number; physical_remaining_quantity: number; calculated_sold_quantity: number; stock_adjustment_quantity: number; adjustment_reason: string | null; production_batches: Batch | null; }
interface DailyClosing { business_date: string; version: number; status: string; note: string | null; closing_batch_counts: ClosingCount[]; }
interface ReportRows { production: Production[]; waste: Waste[]; closings: DailyClosing[]; expenses: Expense[]; }
const REPORT_DETAIL_LIMIT = 100;
export type ReportTab = 'summary' | 'menus' | 'waste' | 'trends' | 'expenses' | 'stock';
const REPORT_TABS: Array<{ value: ReportTab; label: string }> = [
  { value: 'summary', label: 'Summary' },
  { value: 'menus', label: 'Menus' },
  { value: 'waste', label: 'Waste' },
  { value: 'trends', label: 'Trends' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'stock', label: 'Stock check' },
];
interface ReportHistory { production: InsightQuantity[]; waste: Array<InsightQuantity & { batchDate: string | null; reason: string }>; closings: InsightClosingCount[]; }
const EMPTY_HISTORY: ReportHistory = { production: [], waste: [], closings: [] };




function wasteLabel(row: Waste) {
  return formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name);
}

function formatArchivedAt(value: string, language: 'en' | 'th') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function soldVariantQuantities(closings: DailyClosing[]): VariantQuantity[] {
  return closings.flatMap((closing) => closing.status === 'closed'
    ? (closing.closing_batch_counts ?? []).map((count) => ({
      label: formatFoodVariant(count.production_batches?.menu_name_snapshot, count.production_batches?.meat_options?.name),
      quantity: Number(count.calculated_sold_quantity),
    }))
    : []);
}

function adjustmentVariantQuantities(closings: DailyClosing[]): VariantQuantity[] {
  return closings.flatMap((closing) => closing.status === 'closed'
    ? (closing.closing_batch_counts ?? []).map((count) => ({
      label: formatFoodVariant(count.production_batches?.menu_name_snapshot, count.production_batches?.meat_options?.name),
      quantity: Number(count.stock_adjustment_quantity),
    }))
    : []);
}

function selectedFood(label: string, menu: string, meat: string) {
  return matchesFoodFilters(label, menu, meat);
}

function sumQuantity(rows: Array<{ quantity: number }>) {
  return rows.reduce((sum, row) => sum + Number(row.quantity), 0);
}

function verifiedArchiveAsWaste(row: ArchivedStockDeduction): Waste {
  return {
    id: row.id,
    waste_date: row.waste_date,
    quantity: Number(row.quantity),
    reason: row.reason,
    notes: row.notes,
    created_by_name: row.created_by_name ?? '',
    photo_url: row.photo_url,
    waste_record_photos: row.waste_record_photos ?? [],
    photoUrls: [],
    production_batches: row.production_batches,
    archiveVerified: true,
    archiveReviewedByName: row.archive_reviewed_by_name,
  };
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

function getDateOptions(rows: ReportRows, stock: Stock[], stockOuts: StockOut[] = [], archivedStockDeductions: ArchivedStockDeduction[] = [], removedArchiveEffects: RemovedArchivedWasteEffect[] = []) {
  const menus = new Set<string>();
  const meats = new Set<string>();
  const add = (menu: string | undefined, meat: string | undefined) => {
    if (menu) menus.add(menu);
    if (meat) meats.add(meat);
  };
  for (const row of rows.production) add(row.menu_name_snapshot, row.meat_options?.name);
  for (const row of rows.waste) add(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name);
  for (const row of archivedStockDeductions) add(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name);
  for (const row of removedArchiveEffects) add(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name);
  for (const row of stockOuts) add(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name);
  for (const closing of rows.closings) for (const count of closing.closing_batch_counts ?? []) add(count.production_batches?.menu_name_snapshot, count.production_batches?.meat_options?.name);
  for (const row of stock) {
    const separator = row.menu_name.lastIndexOf(' · ');
    add(separator < 0 ? row.menu_name : row.menu_name.slice(0, separator), separator < 0 ? undefined : row.menu_name.slice(separator + 3));
  }
  return { menus: [...menus].sort((a, b) => a.localeCompare(b)), meats: [...meats].sort((a, b) => a.localeCompare(b)) };
}

function CanteenReportsContent() {
  const { member } = useAuth();
  const { t, language } = useI18n();
  const canViewActivity = member?.role === 'admin' || member?.role === 'auditor';
  const canViewExpenses = member?.role === 'admin' || member?.role === 'manager';
  const canReviewArchivedWaste = member?.role === 'admin';
  const today = useBusinessDate();
  const [preset, setPreset] = useState<RangePreset>('lastWeek');
  const [start, setStart] = useState(() => lastFullWeek(today).start);
  const [end, setEnd] = useState(() => lastFullWeek(today).end);
  const [searchParams, setSearchParams] = useSearchParams();
  const [historyRows, setHistoryRows] = useState<ReportHistory>(EMPTY_HISTORY);
  const previousToday = useRef(today);
  const [menuFilter, setMenuFilter] = useState('');
  const [foodSearch, setFoodSearch] = useState('');
  const [meatFilter, setMeatFilter] = useState('');
  const [wasteReasonFilter, setWasteReasonFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [production, setProduction] = useState<Production[]>([]);
  const [waste, setWaste] = useState<Waste[]>([]);
  const [archivedStockDeductions, setArchivedStockDeductions] = useState<ArchivedStockDeduction[]>([]);
  const [removedArchiveEffects, setRemovedArchiveEffects] = useState<RemovedArchivedWasteEffect[]>([]);
  const [stockOuts, setStockOuts] = useState<StockOut[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [closings, setClosings] = useState<DailyClosing[]>([]);
  const [previous, setPrevious] = useState<ReportRows>({ production: [], waste: [], closings: [], expenses: [] });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [reviewNotice, setReviewNotice] = useState<{ kind: 'success' | 'warning'; message: string } | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [reviewTarget, setReviewTarget] = useState<ArchiveReviewTarget | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (previousToday.current === today) return;
    previousToday.current = today;
    if (preset === 'custom') return;
    const range = presetRange(preset, today);
    setStart(range.start);
    setEnd(range.end);
  }, [today, preset]);

  useEffect(() => {
    let alive = true;
    async function load() {
      setBusy(true);
      setError('');
      const db = requireSupabase();
      const nextDay = addCalendarDays(end, 1);
      const previousRange = previousDateRange(start, end);
      const history = trendWindow(end);
      const productionQuery = (from: number, to: number, fromDate: string, toDate: string) => db.from('production_batches').select('id, menu_name_snapshot, production_date, quantity_produced, expiry_date, meat_options(name)').gte('production_date', fromDate).lte('production_date', toDate).is('deleted_at', null).order('production_date', { ascending: false }).range(from, to);
      const wasteQuery = (from: number, to: number, fromDate: string, toDate: string) => db.from('waste_records').select('id, waste_date, quantity, reason, notes, created_by_name, photo_url, production_batches(menu_name_snapshot, production_date, meat_options(name)), waste_record_photos(file_path)').gte('waste_date', fromDate).lte('waste_date', toDate).is('deleted_at', null).order('waste_date', { ascending: false }).range(from, to);
      const archivedStockDeductionQuery = (from: number, to: number, fromDate: string, toDate: string) => db.from('waste_records').select('id, waste_date, quantity, reason, notes, created_by_name, deleted_at, stock_ledger_preserved_on_archive, archive_review_status, archive_reviewed_at, archive_reviewed_by_name, photo_url, waste_record_photos(file_path), production_batches(id, menu_name_snapshot, production_date, quantity_produced, deleted_at, meat_options(name))').eq('stock_ledger_preserved_on_archive', true).not('deleted_at', 'is', null).gte('waste_date', fromDate).lte('waste_date', toDate).order('waste_date', { ascending: false }).range(from, to);
      const removedArchiveEffectQuery = (from: number, to: number, fromDate: string, toDate: string) => db.from('waste_archive_reviews').select('id, waste_record_id, waste_date, production_batch_id, quantity, reason, notes, created_by_name, archived_at, review_reason, reviewed_at, reviewed_by_name, photo_paths, source_snapshot, production_batches(menu_name_snapshot, production_date, meat_options(name))').eq('outcome', 'removed').eq('stock_ledger_changed', false).gte('waste_date', fromDate).lte('waste_date', toDate).order('waste_date', { ascending: false }).range(from, to);
      const expenseQuery = (from: number, to: number, fromDate: string, toDate: string) => db.from('expenses').select('id, expense_date, amount_thb, stores(name), expense_categories(name), notes, expense_receipt_photos(file_path)').gte('expense_date', fromDate).lte('expense_date', toDate).is('deleted_at', null).order('expense_date', { ascending: false }).range(from, to);
      const closingQuery = (from: number, to: number, fromDate: string, toDate: string) => db.from('daily_closings').select('business_date, version, status, note, closing_batch_counts(production_batch_id, expected_quantity, physical_remaining_quantity, calculated_sold_quantity, stock_adjustment_quantity, adjustment_reason, production_batches(menu_name_snapshot, production_date, meat_options(name)))').gte('business_date', fromDate).lte('business_date', toDate).order('business_date').order('version').range(from, to);
      const [productionResult, wasteResult, archivedStockDeductionResult, removedArchiveEffectResult, stockOutResult, expenseResult, stockResult, activityResult, closingResult, previousProductionResult, previousWasteResult, previousArchivedStockDeductionResult, previousExpenseResult, previousClosingResult, historyProductionResult, historyWasteResult, historyArchivedResult, historyClosingResult] = await Promise.all([
        readAll<Production>((from, to) => productionQuery(from, to, start, end)),
        readAll<Waste>((from, to) => wasteQuery(from, to, start, end)),
        readAll<ArchivedStockDeduction>((from, to) => archivedStockDeductionQuery(from, to, start, end)),
        readAll<RemovedArchivedWasteEffect>((from, to) => removedArchiveEffectQuery(from, to, start, end)),
        readAll<StockOut>((from, to) => db.from('post_close_stock_outs').select('id, removal_date, quantity, reason, notes, created_by_name, production_batches(menu_name_snapshot, production_date, meat_options(name))').gte('removal_date', start).lte('removal_date', end).is('deleted_at', null).order('removal_date', { ascending: false }).range(from, to)),
        canViewExpenses ? readAll<Expense>((from, to) => expenseQuery(from, to, start, end)) : Promise.resolve({ data: [] as Expense[], error: null }),
        readAll<Stock>((from, to) => db.from('v_stock_by_batch').select('id, menu_name, production_date, expiry_date, quantity_remaining').neq('quantity_remaining', 0).order('expiry_date').range(from, to)),
        canViewActivity
          ? readAll<Activity>((from, to) => db.from('activity_logs').select('id, occurred_at, action, entity_type, description').gte('occurred_at', `${start}T00:00:00+07:00`).lt('occurred_at', `${nextDay}T00:00:00+07:00`).order('occurred_at', { ascending: false }).range(from, to))
          : Promise.resolve({ data: [] as Activity[], error: null }),
        readAll<DailyClosing>((from, to) => closingQuery(from, to, start, end)),
        readAll<Production>((from, to) => productionQuery(from, to, previousRange.start, previousRange.end)),
        readAll<Waste>((from, to) => wasteQuery(from, to, previousRange.start, previousRange.end)),
        readAll<ArchivedStockDeduction>((from, to) => archivedStockDeductionQuery(from, to, previousRange.start, previousRange.end)),
        canViewExpenses ? readAll<Expense>((from, to) => expenseQuery(from, to, previousRange.start, previousRange.end)) : Promise.resolve({ data: [] as Expense[], error: null }),
        readAll<DailyClosing>((from, to) => closingQuery(from, to, previousRange.start, previousRange.end)),
        readAll<Production>((from, to) => productionQuery(from, to, history.start, history.end)),
        readAll<Waste>((from, to) => wasteQuery(from, to, history.start, history.end)),
        readAll<ArchivedStockDeduction>((from, to) => archivedStockDeductionQuery(from, to, history.start, history.end)),
        readAll<DailyClosing>((from, to) => closingQuery(from, to, history.start, history.end)),
      ]);
      if (!alive) return;
      const results = [productionResult, wasteResult, archivedStockDeductionResult, removedArchiveEffectResult, stockOutResult, expenseResult, stockResult, activityResult, closingResult, previousProductionResult, previousWasteResult, previousArchivedStockDeductionResult, previousExpenseResult, previousClosingResult, historyProductionResult, historyWasteResult, historyArchivedResult, historyClosingResult];
      const firstError = results.find((result) => result.error)?.error;
      if (firstError) setError(firstError);

      const wasteRows = wasteResult.data as unknown as Waste[];
      const archivedRows = archivedStockDeductionResult.data as unknown as ArchivedStockDeduction[];
      const verifiedArchivedWasteRows = archivedRows.filter((row) => row.archive_review_status === 'verified_waste').map(verifiedArchiveAsWaste);
      const reportWasteRows = [...wasteRows, ...verifiedArchivedWasteRows].sort((a, b) => b.waste_date.localeCompare(a.waste_date));
      const expenseRows = expenseResult.data as unknown as Expense[];
      const recentWaste = reportWasteRows.slice(0, REPORT_DETAIL_LIMIT);
      const recentExpenses = expenseRows.slice(0, REPORT_DETAIL_LIMIT);
      const wastePaths = collectPhotoPaths(recentWaste);
      const expensePaths = collectPhotoPaths(recentExpenses);
      const signed = await signPrivatePhotos(db, [...wastePaths, ...expensePaths].flat());
      if (!alive) return;
      const wastePhotosById = new Map(withSignedPhotoUrls(recentWaste, wastePaths, signed).map((row) => [row.id, row.photoUrls]));
      const expensePhotosById = new Map(withSignedPhotoUrls(recentExpenses, expensePaths, signed).map((row) => [row.id, row.photoUrls]));
      setProduction(productionResult.data as unknown as Production[]);
      setWaste(reportWasteRows.map((row) => ({ ...row, photoUrls: wastePhotosById.get(row.id) ?? [] })));
      setArchivedStockDeductions(archivedRows);
      setRemovedArchiveEffects(removedArchiveEffectResult.data as unknown as RemovedArchivedWasteEffect[]);
      setStockOuts(stockOutResult.data as unknown as StockOut[]);
      setExpenses(expenseRows.map((row) => ({ ...row, photoUrls: expensePhotosById.get(row.id) ?? [] })));
      setStock(stockResult.data as unknown as Stock[]);
      setActivity(activityResult.data);
      setClosings(latestClosingVersions(closingResult.data as unknown as DailyClosing[]));
      const previousArchivedRows = previousArchivedStockDeductionResult.data as unknown as ArchivedStockDeduction[];
      setPrevious({
        production: previousProductionResult.data as unknown as Production[],
        waste: [
          ...(previousWasteResult.data as unknown as Waste[]),
          ...previousArchivedRows.filter((row) => row.archive_review_status === 'verified_waste').map(verifiedArchiveAsWaste),
        ],
        expenses: previousExpenseResult.data as unknown as Expense[],
        closings: latestClosingVersions(previousClosingResult.data as unknown as DailyClosing[]),
      });
      const historyWaste = [
        ...(historyWasteResult.data as unknown as Waste[]),
        ...(historyArchivedResult.data as unknown as ArchivedStockDeduction[]).filter((row) => row.archive_review_status === 'verified_waste').map(verifiedArchiveAsWaste),
      ];
      setHistoryRows({
        production: (historyProductionResult.data as unknown as Production[]).map((row) => ({ label: formatFoodVariant(row.menu_name_snapshot, row.meat_options?.name), date: row.production_date, quantity: Number(row.quantity_produced) })),
        waste: historyWaste.map((row) => ({ label: wasteLabel(row), date: row.waste_date, quantity: Number(row.quantity), batchDate: row.production_batches?.production_date ?? null, reason: row.reason })),
        closings: closingInsightCounts(latestClosingVersions(historyClosingResult.data as unknown as DailyClosing[])),
      });
      setBusy(false);
    }
    void load();
    return () => { alive = false; };
  }, [start, end, canViewActivity, canViewExpenses, refreshToken]);

  const dateOptions = getDateOptions({ production: [...production, ...previous.production], waste: [...waste, ...previous.waste], closings: [...closings, ...previous.closings], expenses }, stock, stockOuts, archivedStockDeductions, removedArchiveEffects);
  const menus = [...new Set([...dateOptions.menus, ...(menuFilter ? [menuFilter] : [])])].sort((a, b) => a.localeCompare(b));
  const meats = [...new Set([...dateOptions.meats, ...(meatFilter ? [meatFilter] : [])])].sort((a, b) => a.localeCompare(b));
  const reasonOptions = [...new Set([...waste, ...previous.waste, ...archivedStockDeductions, ...removedArchiveEffects].map((row) => row.reason).concat(wasteReasonFilter ? [wasteReasonFilter] : []))].sort((a, b) => a.localeCompare(b));
  const storeOptions = [...new Set([...expenses, ...previous.expenses].map((row) => row.stores?.name ?? 'Other').concat(storeFilter ? [storeFilter] : []))].sort((a, b) => a.localeCompare(b));
  const filterLabel = (row: Production) => formatFoodVariant(row.menu_name_snapshot, row.meat_options?.name);
  const matchesSelectedFood = (label: string) => selectedFood(label, menuFilter, meatFilter) && matchesFoodSearch(label, foodSearch);
  const filteredProduction = production.filter((row) => matchesSelectedFood(filterLabel(row)));
  const filteredWaste = waste.filter((row) => matchesSelectedFood(wasteLabel(row)) && (!wasteReasonFilter || row.reason === wasteReasonFilter));
  const filteredArchivedStockDeductions = archivedStockDeductions.filter((row) => matchesSelectedFood(formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name)) && (!wasteReasonFilter || row.reason === wasteReasonFilter));
  const filteredPendingArchiveEffects = filteredArchivedStockDeductions.filter((row) => row.archive_review_status === 'unverified');
  const filteredRemovedArchiveEffects = removedArchiveEffects.filter((row) => matchesSelectedFood(formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name)) && (!wasteReasonFilter || row.reason === wasteReasonFilter));
  const filteredStockOuts = stockOuts.filter((row) => matchesSelectedFood(formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name)));
  const filteredExpenses = expenses.filter((row) => !storeFilter || (row.stores?.name ?? 'Other') === storeFilter);
  const filteredStock = stock.filter((row) => matchesSelectedFood(row.menu_name));
  const filteredClosings = closings.map((closing) => ({
    ...closing,
    closing_batch_counts: (closing.closing_batch_counts ?? []).filter((count) => matchesSelectedFood(formatFoodVariant(count.production_batches?.menu_name_snapshot, count.production_batches?.meat_options?.name))),
  }));
  const closingSold = soldVariantQuantities(filteredClosings);
  const closingAdjustments = adjustmentVariantQuantities(filteredClosings);
  const totalProduced = sumQuantity(filteredProduction.map((row) => ({ quantity: Number(row.quantity_produced) })));
  const totalWaste = sumQuantity(filteredWaste);
  const totalArchivedStockDeduction = sumQuantity(filteredPendingArchiveEffects);
  const totalRemovedArchiveEffect = sumQuantity(filteredRemovedArchiveEffects);
  const totalRetainedArchiveEffect = totalArchivedStockDeduction + totalRemovedArchiveEffect;
  const totalStockOut = sumQuantity(filteredStockOuts);
  const totalExpenses = filteredExpenses.reduce((sum, row) => sum + Number(row.amount_thb), 0);
  const availableStock = filteredStock.filter((row) => Number(row.quantity_remaining) > 0);
  const negativeStock = filteredStock.filter((row) => Number(row.quantity_remaining) < 0);
  const stockOnHand = sumQuantity(availableStock.map((row) => ({ quantity: Number(row.quantity_remaining) })));
  const expiredStock = sumQuantity(availableStock.filter((row) => row.expiry_date < today).map((row) => ({ quantity: Number(row.quantity_remaining) })));
  const totalSold = closingSold.reduce((sum, row) => sum + row.quantity, 0);
  const totalClosingAdditions = sumQuantity(filteredClosings.filter((day) => day.status === 'closed').flatMap((day) => day.closing_batch_counts ?? []).map((count) => ({ quantity: Number(count.stock_adjustment_quantity) })));
  const currentNetStock = sumQuantity(filteredStock.map((row) => ({ quantity: Number(row.quantity_remaining) })));
  const stockReconciliation = calculateStockReconciliation({
    produced: totalProduced,
    closingAdditions: totalClosingAdditions,
    sold: totalSold,
    activeWaste: totalWaste,
    archivedStockEffect: totalRetainedArchiveEffect,
    afterClose: totalStockOut,
    currentStock: currentNetStock,
  });

  const previousProduction = previous.production.filter((row) => matchesSelectedFood(filterLabel(row)));
  const previousExpenses = previous.expenses.filter((row) => !storeFilter || (row.stores?.name ?? 'Other') === storeFilter);
  const previousClosings = previous.closings.map((closing) => ({
    ...closing,
    closing_batch_counts: (closing.closing_batch_counts ?? []).filter((count) => matchesSelectedFood(formatFoodVariant(count.production_batches?.menu_name_snapshot, count.production_batches?.meat_options?.name))),
  }));
  const previousSold = soldVariantQuantities(previousClosings).reduce((sum, row) => sum + row.quantity, 0);
  const previousProduced = sumQuantity(previousProduction.map((row) => ({ quantity: Number(row.quantity_produced) })));
  const previousExpensesTotal = previousExpenses.reduce((sum, row) => sum + Number(row.amount_thb), 0);
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
    adjustment: closingAdjustments,
    sold: closingSold,
    waste: filteredWaste.map((row) => ({ label: wasteLabel(row), quantity: Number(row.quantity) })),
    archivedDeduction: filteredPendingArchiveEffects.map((row) => ({ label: formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name), quantity: Number(row.quantity) })),
    removedArchivedEffect: filteredRemovedArchiveEffects.map((row) => ({ label: formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name), quantity: Number(row.quantity) })),
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
    ...(canViewExpenses ? [{ label: 'Expenses', icon: ReceiptText, rows: filteredExpenses.map((row) => ({ date: row.expense_date, store: row.stores?.name ?? '', category: row.expense_categories?.name ?? '', amount_thb: row.amount_thb, notes: row.notes })) }] : []),
    { label: 'Production', icon: UtensilsCrossed, rows: filteredProduction.map((row) => ({ date: row.production_date, menu: formatFoodVariant(row.menu_name_snapshot, row.meat_options?.name), quantity: row.quantity_produced, expiry_date: row.expiry_date })) },
    { label: 'Waste', icon: Trash2, rows: filteredWaste.map((row) => ({ date: row.waste_date, menu: wasteLabel(row), quantity: row.quantity, reason: row.reason, notes: row.notes })) },
    { label: 'Archived stock effect (unverified)', icon: Archive, rows: filteredPendingArchiveEffects.map((row) => ({ waste_date: row.waste_date, menu: formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name), batch_date: row.production_batches?.production_date ?? '', quantity: row.quantity, reason: row.reason, original_note: row.notes ?? '', recorded_by: row.created_by_name ?? '', archived_at: row.deleted_at, stock_deduction_retained: row.stock_ledger_preserved_on_archive })) },
    { label: 'After-close stock out', icon: PackageOpen, rows: filteredStockOuts.map((row) => ({ date: row.removal_date, menu: formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name), batch_date: row.production_batches?.production_date, quantity: row.quantity, reason: row.reason, notes: row.notes })) },
    { label: 'Stock', icon: BarChart3, rows: filteredStock.map((row) => ({ menu: row.menu_name, production_date: row.production_date, expiry_date: row.expiry_date, remaining_quantity: row.quantity_remaining })) },
    { label: 'Menu analysis', icon: BarChart3, rows: variantSummary.map((row) => ({ menu_variant: row.label, produced: row.produced, stock_correction: row.adjustment, inferred_sold: row.sold, waste: row.waste, pending_archive_stock_effect: row.archivedDeduction, removed_stock_effect_retained: row.removedArchivedEffect, total_retained_archive_stock_effect: row.archivedDeduction + row.removedArchivedEffect, waste_percent: row.wasteRate === null ? '' : Math.round(row.wasteRate), current_stock: row.currentStock })) },
    { label: 'Activity', icon: CalendarRange, rows: activity.map((row) => ({ occurred_at: row.occurred_at, action: row.action, entity_type: row.entity_type, description: row.description })) },
    { label: 'Daily closing', icon: CalendarRange, rows: filteredClosings.flatMap((day) => day.closing_batch_counts.map((count) => ({ business_date: day.business_date, closing_version: day.version, status: day.status, batch_id: count.production_batch_id, expected: count.expected_quantity, physical_remaining: count.physical_remaining_quantity, inferred_sold: count.calculated_sold_quantity, adjustment: count.stock_adjustment_quantity, adjustment_reason: count.adjustment_reason, note: day.note }))) },
  ];
  const visibleExports = exports.filter(({ label }) => label !== 'Activity' || canViewActivity);
  const allFiltersClear = !foodSearch && !menuFilter && !meatFilter && !wasteReasonFilter && !storeFilter;
  const applyPreset = (next: RangePreset) => {
    setPreset(next);
    if (next === 'custom') return;
    const range = presetRange(next, today);
    setStart(range.start);
    setEnd(range.end);
  };
  const activeFilterCount = [foodSearch, menuFilter, meatFilter, wasteReasonFilter, storeFilter].filter(Boolean).length;
  const visibleTabs = REPORT_TABS.filter((item) => item.value !== 'expenses' || canViewExpenses);
  const requestedTab = searchParams.get('tab');
  const tab: ReportTab = visibleTabs.find((item) => item.value === requestedTab)?.value ?? 'summary';
  const selectTab = (next: ReportTab) => setSearchParams((params) => {
    const updated = new URLSearchParams(params);
    if (next === 'summary') updated.delete('tab'); else updated.set('tab', next);
    return updated;
  }, { replace: true });
  // Key numbers use food filters only: the waste-reason filter never changes the waste rate.
  const foodWasteTotal = sumQuantity(waste.filter((row) => matchesSelectedFood(wasteLabel(row))));
  const previousFoodWasteTotal = sumQuantity(previous.waste.filter((row) => matchesSelectedFood(wasteLabel(row))));
  const foodWasteRate = wasteRatePercent(foodWasteTotal, totalProduced);
  const previousFoodWasteRate = wasteRatePercent(previousFoodWasteTotal, previousProduced);
  const rateDifference = foodWasteRate === null || previousFoodWasteRate === null ? null : foodWasteRate - previousFoodWasteRate;
  const wasteRateChange = rateDifference === null ? '' : ` · ${rateDifference > 0 ? '+' : rateDifference < 0 ? '−' : ''}${Math.round(Math.abs(rateDifference))} ${t('percentage points')}`;
  const keyMetrics = [
    { label: 'PRODUCED', icon: UtensilsCrossed, tone: 'report-metric-green', display: formatQuantity(totalProduced), unit: 'boxes', currency: false, change: changeText(totalProduced, previousProduced, formatQuantity) },
    { label: 'SOLD', icon: CalendarRange, tone: 'report-metric-lilac', display: formatQuantity(totalSold), unit: 'boxes', currency: false, change: `${closedDayCount(filteredClosings)} ${t('days closed in this range')} · ${changeText(totalSold, previousSold, formatQuantity)}` },
    { label: 'WASTE', icon: Trash2, tone: 'report-metric-peach', display: `${formatQuantity(foodWasteTotal)}${foodWasteRate === null ? '' : ` · ${Math.round(foodWasteRate)}%`}`, unit: 'boxes', currency: false, change: `${changeText(foodWasteTotal, previousFoodWasteTotal, formatQuantity)}${wasteRateChange}` },
    ...(canViewExpenses ? [{ label: 'EXPENSES', icon: ReceiptText, tone: 'report-metric-blue', display: formatBaht(totalExpenses), unit: '', currency: true, change: changeText(totalExpenses, previousExpensesTotal, formatBaht) }] : []),
  ];
  const history: ReportHistory = {
    production: historyRows.production.filter((row) => matchesSelectedFood(row.label)),
    waste: historyRows.waste.filter((row) => matchesSelectedFood(row.label)),
    closings: historyRows.closings.filter((row) => matchesSelectedFood(row.label)),
  };
  // Cards and the meat summary ignore the waste-reason filter; Most wasted follows it.
  const foodVariantSummary = aggregateVariantSummary({
    production: filteredProduction.map((row) => ({ label: filterLabel(row), quantity: Number(row.quantity_produced) })),
    adjustment: closingAdjustments,
    sold: closingSold,
    waste: waste.filter((row) => matchesSelectedFood(wasteLabel(row))).map((row) => ({ label: wasteLabel(row), quantity: Number(row.quantity) })),
    archivedDeduction: filteredPendingArchiveEffects.map((row) => ({ label: formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name), quantity: Number(row.quantity) })),
    removedArchivedEffect: filteredRemovedArchiveEffects.map((row) => ({ label: formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name), quantity: Number(row.quantity) })),
    stock: filteredStock.map((row) => ({ label: row.menu_name, quantity: Number(row.quantity_remaining) })),
  });
  const mostWasted = rankMostWasted(variantSummary);
  const meatSummary = summarizeByMeat(foodVariantSummary);
  const menuCards = buildMenuCards(foodVariantSummary);
  const productionGuide = classifyProductionGuide({ production: history.production, waste: history.waste, closings: history.closings, window: suggestionWindow(end) });
  // Food age follows the waste-reason filter; trends and weekday sales use food filters only.
  const foodAgeData = foodAge({
    waste: filteredWaste.map((row) => ({ wasteDate: row.waste_date, batchDate: row.production_batches?.production_date ?? null, quantity: Number(row.quantity) })),
    closings: closingInsightCounts(filteredClosings),
  });
  const weekdayRows = weekdaySalesGrid(history.closings, suggestionWindow(end));
  const wasteTrend = weeklyWasteTrend({ production: history.production, waste: history.waste, end });
  const reportWarnings = [
    ...(expiredStock > 0 ? [`${formatQuantity(expiredStock)} ${t('boxes in stock are past expiry')}`] : []),
    ...(negativeStock.length > 0 ? [`${negativeStock.length} ${t('negative stock batches')}`] : []),
    ...(totalRetainedArchiveEffect > 0 ? [`${t('Retained archived stock effect')}: −${formatQuantity(totalRetainedArchiveEffect)} ${t('boxes')}`] : []),
  ];
  const openArchiveReview = (row: ArchivedStockDeduction, action: 'verify' | 'remove') => {
    setReviewError('');
    setReviewNotice(null);
    setReviewTarget({
      action,
      id: row.id,
      foodName: formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name),
      wasteDate: row.waste_date,
      quantity: Number(row.quantity),
      reason: row.reason,
      batchId: row.production_batches?.deleted_at ? null : row.production_batches?.id ?? null,
      batchQuantity: row.production_batches?.quantity_produced ?? null,
    });
  };
  const confirmArchiveReview = async (reason: string, removeBatch: boolean) => {
    const target = reviewTarget;
    if (!target || reviewBusy) return;
    setReviewBusy(true);
    setReviewNotice(null);
    setReviewError('');
    try {
      const db = requireSupabase();
      const result = target.action === 'verify'
        ? await db.rpc('verify_archived_waste_as_waste', { p_waste_record_id: target.id })
        : removeBatch && target.batchId
          ? await db.rpc('remove_archived_waste_and_batch', { p_waste_record_id: target.id, p_reason: reason })
          : await db.rpc('remove_archived_waste_preserving_stock', { p_waste_record_id: target.id, p_reason: reason });
      if (result.error) throw result.error;
      setReviewTarget(null);
      setReviewNotice({
        kind: 'success',
        message: t(target.action === 'verify' ? 'Archived waste verified as confirmed waste.' : removeBatch ? 'Batch and related archived waste removed with audit.' : 'Archived waste row removed. Stock movements stay unchanged.'),
      });
      setRefreshToken((value) => value + 1);
    } catch (error) {
      setReviewError(`${t('Could not update this archived waste record.')} ${t(errorMessage(error))}`);
    } finally {
      setReviewBusy(false);
    }
  };

  return <>
    <PageTitle eyebrow="THE PATTERNS BEHIND THE DAY" title="Reports" detail={canViewExpenses ? 'A clear look at production, waste and spending, over a date range that works for you.' : 'A clear look at production, waste and stock, over a date range that works for you.'} />
    {reviewNotice && <Notice tone={reviewNotice.kind === 'success' ? 'success' : 'error'}>{reviewNotice.message}</Notice>}
    {error && <Notice>{error}</Notice>}
    <ReportControls preset={preset} onPreset={applyPreset} start={start} end={end} today={today} onStart={(value) => { setPreset('custom'); setStart(value); }} onEnd={(value) => { setPreset('custom'); setEnd(value); }} activeFilterCount={activeFilterCount}
      filters={<>
      <div className="report-filter-row"><span><Filter size={15} /> {t('Break down by')}</span>
        <label className="report-search-field"><span>{t('Search menu or meat')}</span><span className="report-search-input"><Search size={15} aria-hidden="true" /><input type="search" value={foodSearch} onChange={(event) => setFoodSearch(event.target.value)} placeholder={t('Type a menu or meat')} aria-label={t('Search menu or meat')} /></span></label>
        <label>{t('Menu')}<select value={menuFilter} onChange={(event) => setMenuFilter(event.target.value)}><option value="">{t('All menus')}</option>{menus.map((menu) => <option key={menu} value={menu}>{menu}</option>)}</select></label>
        <label>{t('Meat option')}<select value={meatFilter} onChange={(event) => setMeatFilter(event.target.value)}><option value="">{t('All meat options')}</option>{meats.map((meat) => <option key={meat} value={meat}>{meat}</option>)}</select></label>
        <label>{t('Waste reason')}<select value={wasteReasonFilter} onChange={(event) => setWasteReasonFilter(event.target.value)}><option value="">{t('All waste reasons')}</option>{reasonOptions.map((reason) => <option key={reason} value={reason}>{t(reason)}</option>)}</select></label>
        {canViewExpenses && <label>{t('Store')}<select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}><option value="">{t('All stores')}</option>{storeOptions.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>}
        {!allFiltersClear && <button type="button" className="button button-quiet report-clear-filters" onClick={() => { setFoodSearch(''); setMenuFilter(''); setMeatFilter(''); setWasteReasonFilter(''); setStoreFilter(''); }}><RotateCcw size={14} /> {t('Clear filters')}</button>}
      </div>
      <p className="report-filter-hint">{t(canViewExpenses ? 'Search, menu and meat filter food records; reason filters waste; store filters expenses. Stock on hand is current, even for an earlier date range.' : 'Search, menu and meat filter food records; reason filters waste. Stock on hand is current, even for an earlier date range.')}</p>
      </>}
      downloads={<div className="export-grid">{visibleExports.map(({ label, icon: Icon, rows }) => <button key={label} className="export-card" disabled={!rows.length || busy} onClick={() => downloadCsv(`canteen-${label.toLowerCase()}-${start}-to-${end}.csv`, rows)}><span className="export-card-icon"><Icon size={18} /></span><span><strong>{t(label)}</strong><small>{rows.length} {t('rows available')}</small></span><ArrowDownToLine size={16} /></button>)}</div>} />

    <section className="report-metrics report-key-metrics">{keyMetrics.map((item) => <article key={item.label} className={`report-metric ${item.tone}`}><span><item.icon size={17} /> {t(item.label)}</span><strong className={item.currency ? 'report-currency' : undefined}>{busy ? '—' : item.display}{item.unit && <small>{t(item.unit)}</small>}</strong><p>{busy ? '' : item.change}</p></article>)}</section>
    {!busy && reportWarnings.length > 0 && <div className="notice notice-info report-warning-line" role="status"><TriangleAlert size={17} aria-hidden="true" /><span><strong>{t('Things to check')}:</strong> {reportWarnings.join(' · ')}</span><button type="button" className="button button-quiet" onClick={() => selectTab('stock')}>{t('Open Stock check')}</button></div>}

    <div className="report-tabs" role="tablist" aria-label={t('Report sections')}>{visibleTabs.map((item) => <button key={item.value} type="button" role="tab" id={`report-tab-${item.value}`} aria-selected={tab === item.value} aria-controls={`report-panel-${item.value}`} className={tab === item.value ? 'active' : ''} onClick={() => selectTab(item.value)}>{t(item.label)}</button>)}</div>
    <div className="report-tab-panel" role="tabpanel" id={`report-panel-${tab}`} aria-labelledby={`report-tab-${tab}`}>
    {tab === 'summary' && <ReportSummaryTab mostWasted={mostWasted} meat={meatSummary} guide={productionGuide} busy={busy} reasonFilterActive={Boolean(wasteReasonFilter)} totalWaste={foodWasteTotal} rankedWasteTotal={totalWaste} totalProduced={totalProduced} chart={<>
      <section className="panel report-chart-panel"><div className="panel-head"><div><span className="eyebrow">{t('A GOOD WAY TO SEE A TREND')}</span><h2>{t('Production, sold & waste')}</h2></div><span className="chart-legend"><i className="legend-produced" /> {t('Produced')} <i className="legend-sold" /> {t('Sold')} <i className="legend-waste" /> {t('Waste')}</span></div>
        {busy ? <LoadingState label="Building your report…" /> : !totalProduced && !totalWaste && !totalSold ? <EmptyState title="Your chart will grow here" detail="A few days of records make trends easier to spot." /> : <div className="bar-chart" role="img" aria-label="Production, inferred sales and waste across the selected date range">{daily.map((day) => <div className="bar-day" key={day.start} title={`${formatDate(day.start)}${day.start === day.end ? '' : ` – ${formatDate(day.end)}`}: ${day.produced} produced, ${day.sold} inferred sold, ${day.waste} waste`}><div className="bar-pair"><span className="bar bar-produced" style={{ height: `${Math.max(3, day.produced / maxQuantity * 100)}%` }} /><span className="bar bar-sold" style={{ height: `${Math.max(3, day.sold / maxQuantity * 100)}%` }} /><span className="bar bar-waste" style={{ height: `${Math.max(3, day.waste / maxQuantity * 100)}%` }} /></div><small>{day.end.slice(-2)}</small></div>)}</div>}
        <div className="chart-caption"><span>{t('BOXES PER DAY')}</span><span>{formatDate(start)} – {formatDate(end)}</span></div>
      </section>
      </>} />}
    {tab === 'menus' && <ReportMenuCards cards={menuCards} busy={busy} table={<>{busy ? <LoadingState label="Building your report…" /> : variantSummary.length === 0 ? <EmptyState title="No food records in this range" detail="Try a different date range or clear some filters." /> : <div className="report-table-wrap"><table className="report-data-table"><thead><tr><th>{t('Menu / meat')}</th><th>{t('Produced')}</th><th>{t('Stock correction')}</th><th>{t('Sold')}</th><th>{t('Waste')}</th><th>{t('Retained archived stock effect')}</th><th>{t('Waste %')}</th><th>{t('Current stock')}</th></tr></thead><tbody>{variantSummary.map((row) => <tr key={row.label} className={row.currentStock < 0 ? 'report-negative-stock-row' : undefined}><th scope="row">{row.label}</th><td>{formatQuantity(row.produced)}</td><td>{row.adjustment ? `+${formatQuantity(row.adjustment)}` : '—'}</td><td>{formatQuantity(row.sold)}</td><td>{formatQuantity(row.waste)}</td><td>{row.archivedDeduction + row.removedArchivedEffect ? `−${formatQuantity(row.archivedDeduction + row.removedArchivedEffect)}` : '—'}</td><td>{row.wasteRate === null ? '—' : `${Math.round(row.wasteRate)}%`}</td><td>{formatQuantity(row.currentStock)}</td></tr>)}</tbody></table></div>}</>} />}
    {tab === 'waste' && <>
      <ReportFoodAge age={foodAgeData} busy={busy} />
      <section className="panel expense-breakdown"><div className="panel-head"><div><span className="eyebrow">{t('WHY FOOD WAS LOST')}</span><h2>{t('Waste by reason')}</h2></div></div>
        {busy ? <LoadingState label="Gathering waste reasons…" /> : reasonTotals.length === 0 ? <EmptyState title="No waste in this range" detail="Waste quantity by reason will appear here." /> : <div className="store-breakdown">{reasonTotals.map(([reason, quantity], index) => <div className="store-bar-row" key={reason}><div><span>{t(reason)}</span><strong>{formatQuantity(quantity)} {t('boxes')}</strong></div><span className={`store-bar-line store-bar-${index % 4}`}><i style={{ width: `${quantity / (reasonTotals[0]?.[1] || 1) * 100}%` }} /></span></div>)}</div>}
      </section>
      <div className="report-grid report-record-grid">
      <section className="panel report-record-panel"><div className="panel-head"><div><span className="eyebrow">{t('OPEN THE SOURCE RECORD')}</span><h2>{t('Waste records')}</h2><p>{t('Includes the batch, reason, notes and private photos.')}</p></div><span className="count-chip">{filteredWaste.length}</span></div>
        {busy ? <LoadingState label="Gathering waste records…" /> : filteredWaste.length === 0 ? <EmptyState title="No waste in this range" detail="Waste records will appear here when staff logs food loss." /> : <>
          <div className="report-record-list">{filteredWaste.slice(0, REPORT_DETAIL_LIMIT).map((row) => <details className="report-source-record" key={row.id}><summary><span className="report-source-icon report-source-waste"><Trash2 size={16} /></span><span className="report-source-main"><strong>{wasteLabel(row)}</strong><small>{formatDate(row.waste_date)} · {t(row.reason)} · {row.production_batches?.production_date ? `${t('Batch made')} ${formatDate(row.production_batches.production_date)}` : t('date unavailable')}</small><small>{t('Recorded by')}: {row.created_by_name}</small></span><strong className="report-source-quantity">−{formatQuantity(Number(row.quantity))} {t('boxes')}</strong></summary><div className="report-source-detail">{row.notes && <p>{row.notes}</p>}{row.photoUrls.length > 0 ? <div className="report-photo-strip">{row.photoUrls.map((url) => <a href={url} key={url} target="_blank" rel="noreferrer"><img src={url} alt={`${t('Waste photo')} · ${wasteLabel(row)}`} loading="lazy" /></a>)}</div> : <small className="report-no-photo"><ImageIcon size={14} /> {t('No photo attached')}</small>}</div></details>)}</div>
          {filteredWaste.length > REPORT_DETAIL_LIMIT && <p className="report-list-limit">{t('Showing the latest')} {REPORT_DETAIL_LIMIT} {t('of')} {filteredWaste.length} {t('records')}.</p>}
        </>}
      </section>
      <section className="panel report-record-panel"><div className="panel-head"><div><span className="eyebrow">{t('AFTER-CLOSE REMOVALS')}</span><h2>{t('Food taken after closing')}</h2><p>{t('See which menu was removed, the reason and the staff note.')}</p></div><span className="count-chip">{filteredStockOuts.length}</span></div>
        {busy ? <LoadingState label="Gathering after-close removals…" /> : filteredStockOuts.length === 0 ? <EmptyState title="No food taken after closing in this period" detail="A menu, reason and note will appear here when a late removal is recorded." /> : <>
          <div className="report-record-list">{filteredStockOuts.slice(0, REPORT_DETAIL_LIMIT).map((row) => <details className="report-source-record" key={row.id}><summary><span className="report-source-icon report-source-stock-out"><PackageOpen size={16} /></span><span className="report-source-main"><strong>{formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name)}</strong><small>{formatDate(row.removal_date)} · {t(row.reason)} · {row.production_batches?.production_date ? `${t('Batch made')} ${formatDate(row.production_batches.production_date)}` : t('date unavailable')}</small><small>{t('Recorded by')}: {row.created_by_name}</small></span><strong className="report-source-quantity">−{formatQuantity(Number(row.quantity))} {t('boxes')}</strong></summary><div className="report-source-detail">{row.notes ? <p>{row.notes}</p> : <small>{t('No additional note')}</small>}</div></details>)}</div>
          {filteredStockOuts.length > REPORT_DETAIL_LIMIT && <p className="report-list-limit">{t('Showing the latest')} {REPORT_DETAIL_LIMIT} {t('of')} {filteredStockOuts.length} {t('records')}.</p>}
        </>}
      </section>
      </div>
    </>}
    {tab === 'trends' && <ReportTrendsTab weekday={weekdayRows} trend={wasteTrend} busy={busy} />}
    {tab === 'expenses' && canViewExpenses && <>
      {canViewExpenses && <section className="panel report-chart-panel"><div className="panel-head"><div><span className="eyebrow">{t('SPENDING TREND')}</span><h2>{t('Expenses over time')}</h2></div></div>
        {busy ? <LoadingState label="Gathering expenses…" /> : !totalExpenses ? <EmptyState title="No expenses in this range" detail="Choose another date range or add a purchase." /> : <div className="bar-chart expense-trend-chart" role="img" aria-label="Expenses across the selected date range">{daily.map((day) => <div className="bar-day" key={day.start} title={`${formatDate(day.start)}${day.start === day.end ? '' : ` – ${formatDate(day.end)}`}: ${formatBaht(day.expenses)}`}><div className="bar-pair"><span className="bar bar-expense" style={{ height: `${Math.max(day.expenses ? 3 : 0, day.expenses / maxExpense * 100)}%` }} /></div><small>{day.end.slice(-2)}</small></div>)}</div>}
        <div className="chart-caption"><span>{t('THB BY PERIOD')}</span><span>{formatDate(start)} – {formatDate(end)}</span></div>
      </section>}
      <div className="report-grid report-breakdown-grid">
      {canViewExpenses && <section className="panel expense-breakdown"><div className="panel-head"><div><span className="eyebrow">{t('WHERE IT WENT')}</span><h2>{t('Expense by store')}</h2></div></div>
        {busy ? <LoadingState label="Gathering expenses…" /> : storeTotals.length === 0 ? <EmptyState title="No expenses in this range" detail="Choose another date range or add a purchase." /> : <div className="store-breakdown">{storeTotals.map(([store, amount], index) => <div className="store-bar-row" key={store}><div><span>{store}</span><strong>{formatBaht(amount)}</strong></div><span className={`store-bar-line store-bar-${index % 4}`}><i style={{ width: `${amount / (storeTotals[0]?.[1] || 1) * 100}%` }} /></span></div>)}</div>}
      </section>}
      {canViewExpenses && <section className="panel expense-breakdown"><div className="panel-head"><div><span className="eyebrow">{t('PURCHASE TYPES')}</span><h2>{t('Expense by category')}</h2></div></div>
        {busy ? <LoadingState label="Gathering expense categories…" /> : categoryTotals.length === 0 ? <EmptyState title="No expenses in this range" detail="Choose another date range or add a purchase." /> : <div className="store-breakdown">{categoryTotals.map(([category, amount], index) => <div className="store-bar-row" key={category}><div><span>{t(category)}</span><strong>{formatBaht(amount)}</strong></div><span className={`store-bar-line store-bar-${index % 4}`}><i style={{ width: `${amount / (categoryTotals[0]?.[1] || 1) * 100}%` }} /></span></div>)}</div>}
      </section>}
      </div>
      <div className="report-grid report-record-grid">
      {canViewExpenses && <section className="panel report-record-panel"><div className="panel-head"><div><span className="eyebrow">{t('PURCHASE DETAILS')}</span><h2>{t('Expense records')}</h2><p>{t('Open a purchase to see its notes and private receipt photos.')}</p></div><span className="count-chip">{filteredExpenses.length}</span></div>
        {busy ? <LoadingState label="Gathering expense records…" /> : filteredExpenses.length === 0 ? <EmptyState title="No expenses in this range" detail="Expense details will appear here when purchases are recorded." /> : <>
          <div className="report-record-list">{filteredExpenses.slice(0, REPORT_DETAIL_LIMIT).map((row) => <details className="report-source-record" key={row.id}><summary><span className="report-source-icon report-source-expense"><ReceiptText size={16} /></span><span className="report-source-main"><strong>{row.expense_categories?.name ?? 'Other'} · {row.stores?.name ?? 'Other'}</strong><small>{formatDate(row.expense_date)}{row.notes ? ` · ${row.notes}` : ''}</small></span><strong className="report-source-quantity">{formatBaht(row.amount_thb)}</strong></summary><div className="report-source-detail">{row.notes && <p>{row.notes}</p>}{row.photoUrls.length > 0 ? <div className="report-photo-strip">{row.photoUrls.map((url) => <a href={url} key={url} target="_blank" rel="noreferrer"><img src={url} alt={`${t('Receipt photo')} · ${row.expense_categories?.name ?? ''}`} loading="lazy" /></a>)}</div> : <small className="report-no-photo"><ImageIcon size={14} /> {t('No receipt photo attached')}</small>}</div></details>)}</div>
          {filteredExpenses.length > REPORT_DETAIL_LIMIT && <p className="report-list-limit">{t('Showing the latest')} {REPORT_DETAIL_LIMIT} {t('of')} {filteredExpenses.length} {t('records')}.</p>}
        </>}
      </section>}
      </div>
    </>}
    {tab === 'stock' && <>
      <section className="report-metrics report-stock-metrics">
      <article className="report-metric report-metric-lilac"><span><BarChart3 size={17} /> {t('STOCK ON HAND')}</span><strong>{busy ? '—' : formatQuantity(stockOnHand)}<small>{t('boxes')}</small></strong><p>{availableStock.length} {t('active batches today')}</p></article>
      <article className="report-metric report-metric-peach"><span><CalendarRange size={17} /> {t('EXPIRED STOCK')}</span><strong>{busy ? '—' : formatQuantity(expiredStock)}<small>{t('boxes')}</small></strong><p>{t('Current stock past its expiry date')}</p></article>
      <article className="report-metric report-metric-green"><span><PackageOpen size={17} /> {t('TAKEN AFTER CLOSE')}</span><strong>{busy ? '—' : formatQuantity(totalStockOut)}<small>{t('boxes')}</small></strong><p>{t('Separate from actual food waste')}</p></article>
      </section>
    {!busy && totalRetainedArchiveEffect > 0 && <div className="notice notice-info report-preserved-stock-note" role="status"><Archive size={17} aria-hidden="true" /><span><strong>{t('Retained archived stock effect')}: −{formatQuantity(totalRetainedArchiveEffect)} {t('boxes')}</strong><small>{t('Pending effect')}: −{formatQuantity(totalArchivedStockDeduction)} {t('boxes')} · {t('Removed effect retained')}: −{formatQuantity(totalRemovedArchiveEffect)} {t('boxes')} · {t('Not included in Produced or confirmed Waste')}</small></span></div>}
    {!busy && negativeStock.length > 0 && <div className="notice notice-error report-stock-integrity" role="alert"><TriangleAlert size={18} aria-hidden="true" /><span><strong>{t('Stock ledger needs review')}</strong> · {negativeStock.length} {t('negative stock batches')}: {negativeStock.map((row) => `${row.menu_name} (${formatQuantity(Number(row.quantity_remaining))} ${t('boxes')})`).join(', ')}</span></div>}
    {!busy && end === today && !wasteReasonFilter && <section className="panel report-reconciliation"><div className="panel-head"><div><span className="eyebrow">{t('CURRENT STOCK CHECK')}</span><h2>{t('Stock balance check')}</h2><p>{t('Produced includes active production only. The archive effect is shown separately and is not confirmed production or food waste.')}</p></div><span className={`count-chip${totalRetainedArchiveEffect > 0 || stockReconciliation.afterArchivedEffects !== 0 ? ' report-reconciliation-review' : ''}`}>{totalRetainedArchiveEffect > 0 ? `${t('Retained archived stock effect')}: ${formatQuantity(totalRetainedArchiveEffect)} ${t('boxes')}` : `${formatQuantity(stockReconciliation.afterArchivedEffects)} ${t('boxes')} · ${t('opening stock / other difference')}`}</span></div>
      <div className="report-reconciliation-grid"><div><span>{t('Balance before archived effects')}</span><strong>{formatQuantity(stockReconciliation.beforeArchivedEffects)} {t('boxes')}</strong><small>{t('Production + closing additions − sold − active waste − after-close − current stock')}</small></div><div><span>{t('Retained archived stock effect')}</span><strong>−{formatQuantity(totalRetainedArchiveEffect)} {t('boxes')}</strong><small>{t('Pending effect')}: −{formatQuantity(totalArchivedStockDeduction)} · {t('Removed effect retained')}: −{formatQuantity(totalRemovedArchiveEffect)} · {t('Not included in Produced or confirmed Waste')}</small></div><div><span>{t('Arithmetic remainder after archived effect')}</span><strong>{formatQuantity(stockReconciliation.afterArchivedEffects)} {t('boxes')}</strong><small>{t('This arithmetic is not proof that archived entries were correct; current stock is live and may include opening stock.')}</small></div></div>
    </section>}
      {!busy && (end !== today || wasteReasonFilter) && <section className="panel"><EmptyState title="Stock balance check needs a period ending today" detail="Choose This week or This month, and clear the waste reason filter, to compare stock with today's count." /></section>}
    {filteredArchivedStockDeductions.length > 0 && <section className="panel report-record-panel report-archived-stock-panel"><div className="panel-head"><div><span className="eyebrow">{t('STOCK HISTORY')}</span><h2>{t('Archived entries with stock effects')}</h2><p>{t('These rows are excluded from Produced and active Waste. Their stock movements remain; treat this quantity as unverified.')}</p></div><span className="count-chip">{filteredPendingArchiveEffects.length} {t('pending records')} · −{formatQuantity(totalArchivedStockDeduction)} {t('boxes')}</span></div>
      <div className="report-archive-review-list">{filteredArchivedStockDeductions.slice(0, REPORT_DETAIL_LIMIT).map((row) => {
        const label = formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name);
        const pending = row.archive_review_status === 'unverified';
        return <article className="report-archive-review-row" key={row.id}>
          <div className="report-archive-review-info"><span className="report-source-icon report-source-archived"><Archive size={16} /></span><span className="report-archive-review-copy"><strong>{label}</strong><span>{formatDate(row.waste_date)} · {t(row.reason)} · {row.production_batches?.production_date ? `${t('Batch made')} ${formatDate(row.production_batches.production_date)}` : t('date unavailable')}</span><small>{t('Archived on')} {formatArchivedAt(row.deleted_at, language)}{row.created_by_name ? ` · ${t('Recorded by')}: ${row.created_by_name}` : ''}</small>{row.notes && <small>{t('Original note')}: {row.notes}</small>}</span></div>
          <strong className="report-archive-review-quantity">−{formatQuantity(Number(row.quantity))} {t('boxes')}</strong>
          {pending && canReviewArchivedWaste ? <div className="report-archive-review-actions"><button type="button" className="button button-quiet" disabled={reviewBusy} onClick={() => openArchiveReview(row, 'verify')}><CircleCheck size={15} /> {t('Verify as waste')}</button><button type="button" className="button report-archive-remove-button" disabled={reviewBusy} onClick={() => openArchiveReview(row, 'remove')}><Trash2 size={15} /> {t('Remove')}</button></div> : <span className={`archive-review-status${pending ? '' : ' archive-review-status-verified'}`}>{t(pending ? 'Needs review' : 'Verified as waste')}</span>}
        </article>;
      })}</div>
      {filteredArchivedStockDeductions.length > REPORT_DETAIL_LIMIT && <p className="report-list-limit">{t('Showing the latest')} {REPORT_DETAIL_LIMIT} {t('of')} {filteredArchivedStockDeductions.length} {t('records.')}</p>}
    </section>}
    </>}
    </div>
    <ArchiveReviewDialog target={reviewTarget} saving={reviewBusy} error={reviewError} onConfirm={confirmArchiveReview} onDismiss={() => { if (!reviewBusy) setReviewTarget(null); }} />
  </>;
}

export function ReportsPage() {
  const { member } = useAuth();
  const { t } = useI18n();
  const [section, setSection] = useState<'canteen' | 'coliving'>('canteen');
  const canViewColiving = member?.role === 'admin' || member?.role === 'manager';
  if (!canViewColiving) return <CanteenReportsContent />;
  return <>
    <nav className="report-domain-tabs" aria-label={t('Report areas')}>
      <button type="button" className={section === 'canteen' ? 'active' : ''} aria-current={section === 'canteen' ? 'page' : undefined} onClick={() => setSection('canteen')}><BarChart3 size={16} />{t('Canteen operations')}</button>
      <button type="button" className={section === 'coliving' ? 'active' : ''} aria-current={section === 'coliving' ? 'page' : undefined} onClick={() => setSection('coliving')}><Ticket size={16} />{t('Co-living')}</button>
    </nav>
    {section === 'canteen' ? <CanteenReportsContent /> : <ColivingPage view="report" />}
  </>;
}
