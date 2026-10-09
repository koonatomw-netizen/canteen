import { useEffect, useRef, useState } from 'react';
import { Boxes, CalendarCheck, ClipboardList, PackageOpen, ReceiptText, Trash2, UtensilsCrossed, X, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { StatusBadge } from '../../components/StatusBadge';
import { addCalendarDays, businessDateNow, formatBangkokTime, formatBusinessDate } from '../../lib/dates';
import { formatBaht, formatFoodVariant, formatQuantity } from '../../lib/format';
import { getExpiryStatus } from '../../lib/stock';
import { requireSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../../lib/i18n';

interface Production { id: string; menu_name_snapshot: string; production_date: string; expiry_date: string; quantity_produced: number; notes: string | null; created_at: string; meat_options: { name: string } | null; }
interface Waste { id: string; quantity: number; reason: string; notes: string | null; waste_date: string; created_at: string; production_batches: { menu_name_snapshot: string; production_date: string; meat_options: { name: string } | null } | null; }
interface StockOut { id: string; quantity: number; reason: string; notes: string | null; removal_date: string; created_at: string; production_batches: { menu_name_snapshot: string; production_date: string; meat_options: { name: string } | null } | null; }
interface Stock { id: string; menu_name: string; production_date: string; expiry_date: string; quantity_remaining: number; }
interface Expense { id: string; amount_thb: number; notes: string | null; created_at: string; stores: { name: string } | null; expense_categories: { name: string } | null; }
interface ClosingCount { production_batch_id: string; expected_quantity: number; physical_remaining_quantity: number; calculated_sold_quantity: number; stock_adjustment_quantity: number; adjustment_reason: string | null; production_batches: { menu_name_snapshot: string; production_date: string; meat_options: { name: string } | null } | null; }
interface Closing { business_date: string; status: 'open' | 'closed' | 'reopened'; version: number; closed_at: string | null; note: string | null; closing_batch_counts: ClosingCount[]; }
type DashboardDetail = 'production' | 'closing' | 'stock' | 'waste' | 'stock-out' | 'expenses';
type DashboardRange = 'today' | '7days' | 'month';

function latestClosingVersions(rows: Closing[]) {
  const latest = new Map<string, Closing>();
  for (const row of [...rows].sort((a, b) => a.version - b.version)) {
    const current = latest.get(row.business_date);
    if (!current || row.version >= current.version) latest.set(row.business_date, row);
  }
  return [...latest.values()].sort((a, b) => a.business_date.localeCompare(b.business_date));
}

function MetricCard({ icon: Icon, label, value, foot, tone, money = false, onClick }: { icon: LucideIcon; label: string; value: string; foot: string; tone: string; money?: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return <button type="button" className={`metric-card metric-card-button metric-${tone}`} onClick={onClick} aria-haspopup="dialog" aria-label={`${t(label)}: ${value}. ${t('Open details')}`}>
    <span className="metric-label">{t(label)}</span>
    <span className="metric-icon"><Icon size={16} /></span>
    <strong className={`metric-value${money ? ' metric-money' : ''}`}>{value}</strong>
    <span className="metric-foot">{t(foot)}</span>
  </button>;
}

function DetailRow({ icon: Icon, title, detail, note, amount, amountLabel, tone = '' }: { icon: LucideIcon; title: string; detail: string; note?: string | null; amount: string; amountLabel: string; tone?: string }) {
  const { t } = useI18n();
  return <article className="analysis-detail-row">
    <span className={`analysis-detail-icon ${tone}`}><Icon size={16} /></span>
    <div className="analysis-detail-main">
      <strong>{title}</strong>
      <small>{detail}</small>
      {note && <small className="analysis-detail-note">{note}</small>}
    </div>
    <span className="analysis-detail-end"><strong>{amount}</strong><small>{t(amountLabel)}</small></span>
  </article>;
}

export function DashboardPage() {
  const { member } = useAuth();
  const { t } = useI18n();
  const today = businessDateNow();
  const [range, setRange] = useState<DashboardRange>('today');
  const rangeStart = range === 'today' ? today : range === '7days' ? addCalendarDays(today, -6) : `${today.slice(0, 8)}01`;
  const selectedRangeText = range === 'today' ? formatBusinessDate(today) : `${formatBusinessDate(rangeStart)} – ${formatBusinessDate(today)}`;
  const [production, setProduction] = useState<Production[]>([]);
  const [waste, setWaste] = useState<Waste[]>([]);
  const [stockOuts, setStockOuts] = useState<StockOut[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [closings, setClosings] = useState<Closing[]>([]);
  const [detailView, setDetailView] = useState<DashboardDetail | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const detailsDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = detailsDialog.current;
    if (!dialog) return;
    if (detailView && !dialog.open) dialog.showModal();
    else if (!detailView && dialog.open) dialog.close();
  }, [detailView]);

  useEffect(() => {
    let alive = true;
    async function load() {
      setBusy(true);
      setError('');
      const db = requireSupabase();
      const [productionResult, wasteResult, stockOutResult, stockResult, expenseResult, closingResult] = await Promise.all([
        db.from('production_batches').select('id, menu_name_snapshot, production_date, expiry_date, quantity_produced, notes, created_at, meat_options(name)').gte('production_date', rangeStart).lte('production_date', today).is('deleted_at', null).order('created_at', { ascending: false }),
        db.from('waste_records').select('id, quantity, reason, notes, waste_date, created_at, production_batches(menu_name_snapshot, production_date, meat_options(name))').gte('waste_date', rangeStart).lte('waste_date', today).is('deleted_at', null).order('created_at', { ascending: false }),
        db.from('post_close_stock_outs').select('id, quantity, reason, notes, removal_date, created_at, production_batches(menu_name_snapshot, production_date, meat_options(name))').gte('removal_date', rangeStart).lte('removal_date', today).is('deleted_at', null).order('created_at', { ascending: false }),
        db.from('v_stock_by_batch').select('id, menu_name, production_date, expiry_date, quantity_remaining').gt('quantity_remaining', 0).order('expiry_date'),
        db.from('expenses').select('id, amount_thb, notes, created_at, stores(name), expense_categories(name)').gte('expense_date', rangeStart).lte('expense_date', today).is('deleted_at', null).order('created_at', { ascending: false }),
        db.from('daily_closings').select('business_date, status, version, closed_at, note, closing_batch_counts(production_batch_id, expected_quantity, physical_remaining_quantity, calculated_sold_quantity, stock_adjustment_quantity, adjustment_reason, production_batches(menu_name_snapshot, production_date, meat_options(name)))').gte('business_date', rangeStart).lte('business_date', today).order('business_date').order('version'),
      ]);
      if (!alive) return;
      const firstError = [productionResult, wasteResult, stockOutResult, stockResult, expenseResult, closingResult].find((result) => result.error)?.error;
      if (firstError) setError(firstError.message);
      setProduction((productionResult.data ?? []) as unknown as Production[]);
      setWaste((wasteResult.data ?? []) as unknown as Waste[]);
      setStockOuts((stockOutResult.data ?? []) as unknown as StockOut[]);
      setStock((stockResult.data ?? []) as unknown as Stock[]);
      setExpenses((expenseResult.data ?? []) as unknown as Expense[]);
      setClosings(latestClosingVersions((closingResult.data ?? []) as unknown as Closing[]));
      setBusy(false);
    }
    void load();
    return () => { alive = false; };
  }, [today, rangeStart]);

  const producedTotal = production.reduce((sum, row) => sum + Number(row.quantity_produced), 0);
  const wasteTotal = waste.reduce((sum, row) => sum + Number(row.quantity), 0);
  const stockOutTotal = stockOuts.reduce((sum, row) => sum + Number(row.quantity), 0);
  const stockTotal = stock.reduce((sum, row) => sum + Number(row.quantity_remaining), 0);
  const expenseTotal = expenses.reduce((sum, row) => sum + Number(row.amount_thb), 0);
  const closedDays = closings.filter((day) => day.status === 'closed');
  const soldTotal = closedDays.length ? closedDays.reduce((sum, day) => sum + day.closing_batch_counts.reduce((dayTotal, row) => dayTotal + Number(row.calculated_sold_quantity), 0), 0) : null;
  const wasteRate = producedTotal > 0 ? `${Math.round(wasteTotal / producedTotal * 100)}%` : '—';
  const isToday = range === 'today';
  const detailTitles: Record<DashboardDetail, { eyebrow: string; title: string }> = {
    production: { eyebrow: isToday ? 'MADE TODAY' : 'SELECTED PERIOD', title: 'Production batches' },
    closing: { eyebrow: 'END-OF-DAY COUNTS', title: 'Daily closing' },
    stock: { eyebrow: 'CURRENT BATCH BALANCES', title: 'Available stock by batch' },
    waste: { eyebrow: isToday ? 'RECORDED TODAY' : 'SELECTED PERIOD', title: 'Waste details' },
    'stock-out': { eyebrow: 'AFTER DAILY CLOSING', title: 'Food taken from stock' },
    expenses: { eyebrow: isToday ? 'PURCHASES TODAY' : 'SELECTED PERIOD', title: 'Expenses' },
  };
  const activeDetail = detailView ? detailTitles[detailView] : null;

  return <>
    <PageTitle eyebrow="THE DAY AT A GLANCE" title="Dashboard" detail="Daily food, waste, stock and spending, with the records behind every number." />
    {error && <Notice>{error}</Notice>}
    <section className="dashboard-summary" aria-labelledby="dashboard-summary-title">
      <div className="section-heading dashboard-section-heading"><div><span className="eyebrow">{t('SELECTED PERIOD')}</span><h2 id="dashboard-summary-title">{selectedRangeText}</h2></div><span className="soft-chip"><span className="live-dot" /> {t('TAP A CARD FOR DETAILS')}</span></div>
      <div className="dashboard-range-switch" role="group" aria-label={t('Select dashboard period')}>
        {(['today', '7days', 'month'] as const).map((option) => <button type="button" key={option} className={range === option ? 'active' : ''} aria-pressed={range === option} onClick={() => setRange(option)}>{t(option === 'today' ? 'Today' : option === '7days' ? 'Last 7 days' : 'This month')}</button>)}
      </div>
      <div className="metric-grid dashboard-metric-grid">
        <MetricCard icon={UtensilsCrossed} label={isToday ? 'Produced today' : 'Produced in selected period'} value={busy ? '—' : formatQuantity(producedTotal)} foot={`${production.length} ${t(production.length === 1 ? 'production batch' : 'production batches')} · ${t('tap for details')}`} tone="green" onClick={() => setDetailView('production')} />
        <MetricCard icon={CalendarCheck} label="Inferred sold" value={busy || soldTotal === null ? '—' : formatQuantity(soldTotal)} foot={`${closedDays.length} ${t('days closed in this range')} · ${t('tap for counts')}`} tone="lilac" onClick={() => setDetailView('closing')} />
        <MetricCard icon={Boxes} label="Available stock" value={busy ? '—' : formatQuantity(stockTotal)} foot={`${stock.length} ${t(stock.length === 1 ? 'active batch' : 'active batches')} · ${t('Current stock')}`} tone="blue" onClick={() => setDetailView('stock')} />
        <MetricCard icon={Trash2} label={isToday ? 'Waste today' : 'Waste in selected period'} value={busy ? '—' : formatQuantity(wasteTotal)} foot={`${waste.length} ${t(waste.length === 1 ? 'waste record' : 'waste records')} · ${t('tap for details')}`} tone="peach" onClick={() => setDetailView('waste')} />
        <MetricCard icon={PackageOpen} label="Taken after closing" value={busy ? '—' : formatQuantity(stockOutTotal)} foot={`${stockOuts.length} ${t(stockOuts.length === 1 ? 'stock removal record' : 'stock removal records')} · ${t('excluded from waste')}`} tone="green" onClick={() => setDetailView('stock-out')} />
        <MetricCard icon={ClipboardList} label="Waste rate" value={busy ? '—' : wasteRate} foot={`${t(producedTotal ? (isToday ? 'Waste ÷ today’s production' : 'Waste ÷ production in selected period') : 'Unavailable without production')} · ${t('tap for details')}`} tone="lilac" onClick={() => setDetailView('waste')} />
        <MetricCard icon={ReceiptText} label={isToday ? 'Expenses today' : 'Expenses in selected period'} value={busy ? '—' : formatBaht(expenseTotal)} foot={`${expenses.length} ${t(expenses.length === 1 ? 'purchase' : 'purchases')} · ${t('tap for details')}`} tone="blue" money onClick={() => setDetailView('expenses')} />
      </div>
    </section>

    <dialog ref={detailsDialog} className="dashboard-details-dialog" aria-labelledby="dashboard-dialog-title" onClose={() => { if (!detailsDialog.current?.open) setDetailView(null); }} onClick={(event) => { if (event.target === event.currentTarget) detailsDialog.current?.close(); }}>
      <div className="dashboard-dialog-header"><div><span className="eyebrow">{activeDetail ? t(activeDetail.eyebrow) : ''}</span><h2 id="dashboard-dialog-title">{activeDetail ? t(activeDetail.title) : ''}</h2></div><button type="button" className="icon-button dashboard-dialog-close" aria-label={t('Close details')} onClick={() => setDetailView(null)}><X size={19} /></button></div>
      <div className="dashboard-dialog-content">
      {detailView === 'production' && <section className="panel dashboard-detail-panel">
        <div className="dashboard-detail-context"><span className="count-chip">{production.length} {t('BATCHES')}</span><span className="analysis-panel-note">{selectedRangeText}</span></div>
        {busy ? <LoadingState label="Loading production details…" /> : production.length === 0 ? <EmptyState title="No production in this period" detail="Batches and quantities for the selected dates will appear here." /> : <div className="analysis-detail-list">{production.map((row) => <DetailRow key={row.id} icon={UtensilsCrossed} title={formatFoodVariant(row.menu_name_snapshot, row.meat_options?.name)} detail={`${t('Made')} ${formatBusinessDate(row.production_date)} · ${t('Best before')} ${formatBusinessDate(row.expiry_date)} · ${formatBangkokTime(row.created_at)}`} note={row.notes} amount={formatQuantity(Number(row.quantity_produced))} amountLabel="boxes" />)}</div>}
        {member?.role === 'admin' && <Link className="text-link dashboard-detail-link" to="/production">{t('View production workflow')}</Link>}
      </section>}

      {detailView === 'waste' && <section className="panel dashboard-detail-panel">
        <div className="dashboard-detail-context"><span className="count-chip">{waste.length} {t('RECORDS')}</span><span className="analysis-panel-note">{selectedRangeText}</span></div>
        {busy ? <LoadingState label="Loading waste details…" /> : waste.length === 0 ? <EmptyState title="No waste in this period" detail="Batch, quantity and reason will appear here when staff logs waste." /> : <div className="analysis-detail-list">{waste.map((row) => <DetailRow key={row.id} icon={Trash2} tone="analysis-icon-peach" title={formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name)} detail={`${formatBusinessDate(row.waste_date)} · ${row.reason} · ${t('Batch made')} ${row.production_batches?.production_date ? formatBusinessDate(row.production_batches.production_date) : t('date unavailable')} · ${formatBangkokTime(row.created_at)}`} note={row.notes} amount={`−${formatQuantity(Number(row.quantity))}`} amountLabel="boxes" />)}</div>}
        {!busy && waste.length > 0 && <div className="analysis-detail-total"><span>{t(isToday ? 'Total wasted today' : 'Total wasted in selected period')}</span><strong>{formatQuantity(wasteTotal)} {t('boxes')}</strong></div>}
        <p className="analysis-panel-note">{t('Waste rate is')} {wasteRate}{producedTotal > 0 ? `: ${formatQuantity(wasteTotal)} ${t('wasted')} ÷ ${formatQuantity(producedTotal)} ${t('produced')}.` : ` ${t('because no production was recorded in this period.')}`}</p>
        {member?.role === 'admin' && <Link className="text-link dashboard-detail-link" to="/waste">{t('View waste workflow')}</Link>}
      </section>}

      {detailView === 'stock-out' && <section className="panel dashboard-detail-panel">
        <div className="dashboard-detail-context"><span className="count-chip">{stockOuts.length} {t('REMOVALS')}</span><span className="analysis-panel-note">{t('Not included in waste totals')} · {selectedRangeText}</span></div>
        {busy ? <LoadingState label="Loading after-close stock details…" /> : stockOuts.length === 0 ? <EmptyState title="No food taken after closing in this period" detail="A batch, quantity and reason will appear here when staff records a late pickup." /> : <div className="analysis-detail-list">{stockOuts.map((row) => <DetailRow key={row.id} icon={PackageOpen} tone="analysis-icon-green" title={formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name)} detail={`${formatBusinessDate(row.removal_date)} · ${row.reason} · ${t('Batch made')} ${row.production_batches?.production_date ? formatBusinessDate(row.production_batches.production_date) : t('date unavailable')} · ${formatBangkokTime(row.created_at)}`} note={row.notes} amount={`−${formatQuantity(Number(row.quantity))}`} amountLabel="boxes" />)}</div>}
        {!busy && stockOuts.length > 0 && <div className="analysis-detail-total"><span>{t('Removed after close')}</span><strong>{formatQuantity(stockOutTotal)} {t('boxes')}</strong></div>}
        {member?.role === 'admin' && <Link className="text-link dashboard-detail-link" to="/waste">{t('View stock-out workflow')}</Link>}
      </section>}

      {detailView === 'closing' && <section className="panel dashboard-detail-panel">
        <div className="dashboard-detail-context"><span className="count-chip">{closedDays.length} {t('days closed in this range')}</span><span className="analysis-panel-note">{selectedRangeText}</span></div>
        {busy ? <LoadingState label="Loading closing counts…" /> : closings.length ? <div className="analysis-detail-list">{closings.map((day) => <section className="analysis-closing-day" key={day.business_date}>
          <div className="analysis-closing-day-head"><strong>{formatBusinessDate(day.business_date)}</strong><span className={`count-chip ${day.status === 'closed' ? 'analysis-chip-success' : 'analysis-panel-note-warning'}`}>{t('Version')} {day.version} · {t(day.status.toUpperCase())}</span>{day.closed_at && <small>{formatBangkokTime(day.closed_at)}{day.note ? ` · ${day.note}` : ''}</small>}</div>
          {(day.closing_batch_counts ?? []).map((row) => <article className="analysis-detail-row analysis-closing-row" key={`${day.business_date}-${row.production_batch_id}`}>
            <span className="analysis-detail-icon analysis-icon-lilac"><CalendarCheck size={16} /></span>
            <div className="analysis-detail-main"><strong>{formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name)}</strong><small>{t('Batch made')} {row.production_batches?.production_date ? formatBusinessDate(row.production_batches.production_date) : t('date unavailable')}</small><small>{t('Available')} {formatQuantity(Number(row.expected_quantity))} · {t('Left')} {formatQuantity(Number(row.physical_remaining_quantity))} · {t('Sold')} {formatQuantity(Number(row.calculated_sold_quantity))}</small>{Number(row.stock_adjustment_quantity) !== 0 && <small className="analysis-detail-note">{t('Adjustment')} {formatQuantity(Number(row.stock_adjustment_quantity))}{row.adjustment_reason ? ` · ${t(row.adjustment_reason)}` : ''}</small>}</div>
            <span className="analysis-detail-end"><strong>{formatQuantity(Number(row.physical_remaining_quantity))}</strong><small>{t('left')}</small></span>
          </article>)}
          {day.status !== 'closed' && <p className="analysis-panel-note analysis-panel-note-warning">{t('This closing was reopened. Sales are not included in the summary.')}</p>}
        </section>)}</div> : <EmptyState title={isToday ? 'Today is not closed yet' : 'No closing in this period'} detail="Closing counts and inferred sales will appear here after the daily close is completed." />}
        {member?.role === 'admin' && <Link className="text-link dashboard-detail-link" to="/closing">{t('View daily closing workflow')}</Link>}
      </section>}

      {detailView === 'expenses' && <section className="panel dashboard-detail-panel">
        <div className="dashboard-detail-context"><span className="count-chip">{expenses.length} {t('PURCHASES')}</span><span className="analysis-panel-note">{selectedRangeText}</span></div>
        {busy ? <LoadingState label="Loading expense details…" /> : expenses.length === 0 ? <EmptyState title="No expenses in this period" detail="Store, category and purchase amount will appear here when logged." /> : <div className="analysis-detail-list">{expenses.map((row) => <DetailRow key={row.id} icon={ReceiptText} title={row.stores?.name ?? 'Other store'} detail={`${row.expense_categories?.name ?? 'Expense'} · ${formatBangkokTime(row.created_at)}`} note={row.notes} amount={formatBaht(row.amount_thb)} amountLabel="THB" />)}</div>}
        {member?.role === 'admin' && <Link className="text-link dashboard-detail-link" to="/expenses">{t('View expenses workflow')}</Link>}
      </section>}

      {detailView === 'stock' && <section className="panel dashboard-detail-panel dashboard-stock-detail">
        <div className="dashboard-detail-context"><span className="count-chip">{stock.length} {t('ACTIVE BATCHES')}</span></div>
        {busy ? <LoadingState label="Loading stock details…" /> : stock.length === 0 ? <EmptyState title="No food in stock" detail="Once production is recorded, each active batch and its remaining boxes will appear here." /> : <div className="analysis-detail-list">{stock.map((row) => <article className="analysis-detail-row" key={row.id}>
          <span className="analysis-detail-icon analysis-icon-blue"><Boxes size={16} /></span>
          <div className="analysis-detail-main"><div className="analysis-detail-title"><strong>{row.menu_name}</strong><StatusBadge status={getExpiryStatus(row.expiry_date, today)} /></div><small>{t('Made')} {formatBusinessDate(row.production_date)} · {t('Best before')} {formatBusinessDate(row.expiry_date)}</small><small className="analysis-detail-batch">{t('BATCH')} {row.id.slice(0, 8).toUpperCase()}</small></div>
          <span className="analysis-detail-end"><strong>{formatQuantity(Number(row.quantity_remaining))}</strong><small>{t('boxes')}</small></span>
        </article>)}</div>}
        {member?.role === 'admin' && <Link className="text-link dashboard-detail-link" to="/stock">{t('View stock workflow')}</Link>}
      </section>}
      </div>
    </dialog>
  </>;
}
