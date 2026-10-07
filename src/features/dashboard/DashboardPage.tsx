import { useEffect, useRef, useState } from 'react';
import { Boxes, CalendarCheck, ClipboardList, ReceiptText, Trash2, UtensilsCrossed, X, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { StatusBadge } from '../../components/StatusBadge';
import { businessDateNow, formatBangkokTime, formatBusinessDate } from '../../lib/dates';
import { formatBaht, formatQuantity } from '../../lib/format';
import { getExpiryStatus } from '../../lib/stock';
import { requireSupabase } from '../../lib/supabase';

interface Production { id: string; production_date: string; expiry_date: string; quantity_produced: number; notes: string | null; created_at: string; menu_items: { name: string } | null; }
interface Waste { id: string; quantity: number; reason: string; notes: string | null; waste_date: string; created_at: string; production_batches: { production_date: string; menu_items: { name: string } | null } | null; }
interface Stock { id: string; menu_name: string; production_date: string; expiry_date: string; quantity_remaining: number; }
interface Expense { id: string; amount_thb: number; notes: string | null; created_at: string; stores: { name: string } | null; expense_categories: { name: string } | null; }
interface ClosingCount { production_batch_id: string; expected_quantity: number; physical_remaining_quantity: number; calculated_sold_quantity: number; stock_adjustment_quantity: number; adjustment_reason: string | null; production_batches: { production_date: string; menu_items: { name: string } | null } | null; }
interface Closing { status: 'open' | 'closed' | 'reopened'; version: number; closed_at: string | null; note: string | null; closing_batch_counts: ClosingCount[]; }
type DashboardDetail = 'production' | 'closing' | 'stock' | 'waste' | 'expenses';

function MetricCard({ icon: Icon, label, value, foot, tone, money = false, onClick }: { icon: LucideIcon; label: string; value: string; foot: string; tone: string; money?: boolean; onClick: () => void }) {
  return <button type="button" className={`metric-card metric-card-button metric-${tone}`} onClick={onClick} aria-haspopup="dialog" aria-label={`${label}: ${value}. Open details.`}>
    <span className="metric-label">{label}</span>
    <span className="metric-icon"><Icon size={16} /></span>
    <strong className={`metric-value${money ? ' metric-money' : ''}`}>{value}</strong>
    <span className="metric-foot">{foot}</span>
  </button>;
}

function DetailRow({ icon: Icon, title, detail, note, amount, amountLabel, tone = '' }: { icon: LucideIcon; title: string; detail: string; note?: string | null; amount: string; amountLabel: string; tone?: string }) {
  return <article className="analysis-detail-row">
    <span className={`analysis-detail-icon ${tone}`}><Icon size={16} /></span>
    <div className="analysis-detail-main">
      <strong>{title}</strong>
      <small>{detail}</small>
      {note && <small className="analysis-detail-note">{note}</small>}
    </div>
    <span className="analysis-detail-end"><strong>{amount}</strong><small>{amountLabel}</small></span>
  </article>;
}

export function DashboardPage() {
  const today = businessDateNow();
  const [production, setProduction] = useState<Production[]>([]);
  const [waste, setWaste] = useState<Waste[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [closing, setClosing] = useState<Closing | null>(null);
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
      const [productionResult, wasteResult, stockResult, expenseResult, closingResult] = await Promise.all([
        db.from('production_batches').select('id, production_date, expiry_date, quantity_produced, notes, created_at, menu_items(name)').eq('production_date', today).is('deleted_at', null).order('created_at', { ascending: false }),
        db.from('waste_records').select('id, quantity, reason, notes, waste_date, created_at, production_batches(production_date, menu_items(name))').eq('waste_date', today).is('deleted_at', null).order('created_at', { ascending: false }),
        db.from('v_stock_by_batch').select('id, menu_name, production_date, expiry_date, quantity_remaining').gt('quantity_remaining', 0).order('expiry_date'),
        db.from('expenses').select('id, amount_thb, notes, created_at, stores(name), expense_categories(name)').eq('expense_date', today).is('deleted_at', null).order('created_at', { ascending: false }),
        db.from('daily_closings').select('status, version, closed_at, note, closing_batch_counts(production_batch_id, expected_quantity, physical_remaining_quantity, calculated_sold_quantity, stock_adjustment_quantity, adjustment_reason, production_batches(production_date, menu_items(name)))').eq('business_date', today).order('version', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!alive) return;
      const firstError = [productionResult, wasteResult, stockResult, expenseResult, closingResult].find((result) => result.error)?.error;
      if (firstError) setError(firstError.message);
      setProduction((productionResult.data ?? []) as unknown as Production[]);
      setWaste((wasteResult.data ?? []) as unknown as Waste[]);
      setStock((stockResult.data ?? []) as unknown as Stock[]);
      setExpenses((expenseResult.data ?? []) as unknown as Expense[]);
      setClosing((closingResult.data as unknown as Closing | null) ?? null);
      setBusy(false);
    }
    void load();
    return () => { alive = false; };
  }, [today]);

  const producedTotal = production.reduce((sum, row) => sum + Number(row.quantity_produced), 0);
  const wasteTotal = waste.reduce((sum, row) => sum + Number(row.quantity), 0);
  const stockTotal = stock.reduce((sum, row) => sum + Number(row.quantity_remaining), 0);
  const expenseTotal = expenses.reduce((sum, row) => sum + Number(row.amount_thb), 0);
  const closingIsValid = closing?.status === 'closed';
  const soldTotal = closingIsValid ? closing.closing_batch_counts.reduce((sum, row) => sum + Number(row.calculated_sold_quantity), 0) : null;
  const wasteRate = producedTotal > 0 ? `${Math.round(wasteTotal / producedTotal * 100)}%` : '—';
  const detailTitles: Record<DashboardDetail, { eyebrow: string; title: string }> = {
    production: { eyebrow: 'MADE TODAY', title: 'Production batches' },
    closing: { eyebrow: 'END-OF-DAY COUNTS', title: 'Daily closing' },
    stock: { eyebrow: 'CURRENT BATCH BALANCES', title: 'Available stock by batch' },
    waste: { eyebrow: 'RECORDED TODAY', title: 'Waste details' },
    expenses: { eyebrow: 'PURCHASES TODAY', title: 'Expenses' },
  };
  const activeDetail = detailView ? detailTitles[detailView] : null;

  return <>
    <PageTitle eyebrow="THE DAY AT A GLANCE" title="Dashboard" detail="Daily food, waste, stock and spending, with the records behind every number." />
    {error && <Notice>{error}</Notice>}
    <section className="dashboard-summary" aria-labelledby="dashboard-summary-title">
      <div className="section-heading dashboard-section-heading"><div><span className="eyebrow">TODAY’S ANALYSIS</span><h2 id="dashboard-summary-title">{formatBusinessDate(today)}</h2></div><span className="soft-chip"><span className="live-dot" /> TAP A CARD FOR DETAILS</span></div>
      <div className="metric-grid dashboard-metric-grid">
        <MetricCard icon={UtensilsCrossed} label="Produced today" value={busy ? '—' : formatQuantity(producedTotal)} foot={`${production.length} production ${production.length === 1 ? 'batch' : 'batches'} · tap for details`} tone="green" onClick={() => setDetailView('production')} />
        <MetricCard icon={CalendarCheck} label="Inferred sold" value={busy || soldTotal === null ? '—' : formatQuantity(soldTotal)} foot={`${closingIsValid ? 'From today’s close' : 'After close'} · tap for counts`} tone="lilac" onClick={() => setDetailView('closing')} />
        <MetricCard icon={Boxes} label="Available stock" value={busy ? '—' : formatQuantity(stockTotal)} foot={`${stock.length} active ${stock.length === 1 ? 'batch' : 'batches'} · tap for details`} tone="blue" onClick={() => setDetailView('stock')} />
        <MetricCard icon={Trash2} label="Waste today" value={busy ? '—' : formatQuantity(wasteTotal)} foot={`${waste.length} waste ${waste.length === 1 ? 'record' : 'records'} · tap for details`} tone="peach" onClick={() => setDetailView('waste')} />
        <MetricCard icon={ClipboardList} label="Waste rate" value={busy ? '—' : wasteRate} foot={`${producedTotal ? 'Waste ÷ today’s production' : 'Unavailable without production'} · tap for details`} tone="lilac" onClick={() => setDetailView('waste')} />
        <MetricCard icon={ReceiptText} label="Expenses today" value={busy ? '—' : formatBaht(expenseTotal)} foot={`${expenses.length} ${expenses.length === 1 ? 'purchase' : 'purchases'} · tap for details`} tone="blue" money onClick={() => setDetailView('expenses')} />
      </div>
    </section>

    <dialog ref={detailsDialog} className="dashboard-details-dialog" aria-labelledby="dashboard-dialog-title" onClose={() => { if (!detailsDialog.current?.open) setDetailView(null); }} onClick={(event) => { if (event.target === event.currentTarget) detailsDialog.current?.close(); }}>
      <div className="dashboard-dialog-header"><div><span className="eyebrow">{activeDetail?.eyebrow}</span><h2 id="dashboard-dialog-title">{activeDetail?.title}</h2></div><button type="button" className="icon-button dashboard-dialog-close" aria-label="Close details" onClick={() => setDetailView(null)}><X size={19} /></button></div>
      <div className="dashboard-dialog-content">
      {detailView === 'production' && <section className="panel dashboard-detail-panel">
        <div className="dashboard-detail-context"><span className="count-chip">{production.length} BATCHES</span><span className="analysis-panel-note">{formatBusinessDate(today)}</span></div>
        {busy ? <LoadingState label="Loading production details…" /> : production.length === 0 ? <EmptyState title="No production recorded today" detail="Today’s batches and quantities will appear here when production is recorded." /> : <div className="analysis-detail-list">{production.map((row) => <DetailRow key={row.id} icon={UtensilsCrossed} title={row.menu_items?.name ?? 'Archived menu item'} detail={`Made ${formatBusinessDate(row.production_date)} · Best before ${formatBusinessDate(row.expiry_date)} · ${formatBangkokTime(row.created_at)}`} note={row.notes} amount={formatQuantity(Number(row.quantity_produced))} amountLabel="boxes" />)}</div>}
        <Link className="text-link dashboard-detail-link" to="/production">View production</Link>
      </section>}

      {detailView === 'waste' && <section className="panel dashboard-detail-panel">
        <div className="dashboard-detail-context"><span className="count-chip">{waste.length} RECORDS</span></div>
        {busy ? <LoadingState label="Loading waste details…" /> : waste.length === 0 ? <EmptyState title="No waste recorded today" detail="When food is recorded as waste, its batch, quantity and reason will appear here." /> : <div className="analysis-detail-list">{waste.map((row) => <DetailRow key={row.id} icon={Trash2} tone="analysis-icon-peach" title={row.production_batches?.menu_items?.name ?? 'Food batch'} detail={`${row.reason} · Batch made ${row.production_batches?.production_date ? formatBusinessDate(row.production_batches.production_date) : 'date unavailable'} · ${formatBangkokTime(row.created_at)}`} note={row.notes} amount={`−${formatQuantity(Number(row.quantity))}`} amountLabel="boxes" />)}</div>}
        {!busy && waste.length > 0 && <div className="analysis-detail-total"><span>Total wasted today</span><strong>{formatQuantity(wasteTotal)} boxes</strong></div>}
        <p className="analysis-panel-note">Waste rate is {wasteRate}{producedTotal > 0 ? `: ${formatQuantity(wasteTotal)} wasted ÷ ${formatQuantity(producedTotal)} produced.` : ' because no production was recorded today.'}</p>
        <Link className="text-link dashboard-detail-link" to="/waste">View waste records</Link>
      </section>}

      {detailView === 'closing' && <section className="panel dashboard-detail-panel">
        <div className="dashboard-detail-context"><span className={`count-chip ${closingIsValid ? 'analysis-chip-success' : ''}`}>{closing ? `V${closing.version} · ${closing.status.toUpperCase()}` : 'NOT CLOSED'}</span></div>
        {busy ? <LoadingState label="Loading closing counts…" /> : closing?.closing_batch_counts.length ? <>
          {closing.closed_at && <p className="analysis-panel-note">{closingIsValid ? 'Closed' : 'Last closed'} at {formatBangkokTime(closing.closed_at)}{closing.note ? ` · ${closing.note}` : ''}</p>}
          <div className="analysis-detail-list">{closing.closing_batch_counts.map((row) => <article className="analysis-detail-row analysis-closing-row" key={row.production_batch_id}>
            <span className="analysis-detail-icon analysis-icon-lilac"><CalendarCheck size={16} /></span>
            <div className="analysis-detail-main"><strong>{row.production_batches?.menu_items?.name ?? 'Food batch'}</strong><small>Batch made {row.production_batches?.production_date ? formatBusinessDate(row.production_batches.production_date) : 'date unavailable'}</small><small>Expected {formatQuantity(Number(row.expected_quantity))} · Counted {formatQuantity(Number(row.physical_remaining_quantity))} · Inferred sold {formatQuantity(Number(row.calculated_sold_quantity))}</small>{Number(row.stock_adjustment_quantity) !== 0 && <small className="analysis-detail-note">Adjustment {formatQuantity(Number(row.stock_adjustment_quantity))}{row.adjustment_reason ? ` · ${row.adjustment_reason}` : ''}</small>}</div>
            <span className="analysis-detail-end"><strong>{formatQuantity(Number(row.physical_remaining_quantity))}</strong><small>left</small></span>
          </article>)}</div>
          {!closingIsValid && <p className="analysis-panel-note analysis-panel-note-warning">This closing was reopened. Sales are not included in today’s summary until it is closed again.</p>}
        </> : <EmptyState title={closing ? 'No batches in this closing' : 'Today is not closed yet'} detail={closing ? 'No batch counts were saved for this closing.' : 'The per-batch physical counts and inferred sales will appear after the daily close is completed.'} />}
        <Link className="text-link dashboard-detail-link" to="/closing">View daily closing</Link>
      </section>}

      {detailView === 'expenses' && <section className="panel dashboard-detail-panel">
        <div className="dashboard-detail-context"><span className="count-chip">{expenses.length} PURCHASES</span></div>
        {busy ? <LoadingState label="Loading expense details…" /> : expenses.length === 0 ? <EmptyState title="No expenses recorded today" detail="Today’s store, category and purchase amount will appear here when logged." /> : <div className="analysis-detail-list">{expenses.map((row) => <DetailRow key={row.id} icon={ReceiptText} title={row.stores?.name ?? 'Other store'} detail={`${row.expense_categories?.name ?? 'Expense'} · ${formatBangkokTime(row.created_at)}`} note={row.notes} amount={formatBaht(row.amount_thb)} amountLabel="THB" />)}</div>}
        <Link className="text-link dashboard-detail-link" to="/expenses">View expenses</Link>
      </section>}

      {detailView === 'stock' && <section className="panel dashboard-detail-panel dashboard-stock-detail">
        <div className="dashboard-detail-context"><span className="count-chip">{stock.length} ACTIVE BATCHES</span></div>
        {busy ? <LoadingState label="Loading stock details…" /> : stock.length === 0 ? <EmptyState title="No food in stock" detail="Once production is recorded, each active batch and its remaining boxes will appear here." /> : <div className="analysis-detail-list">{stock.map((row) => <article className="analysis-detail-row" key={row.id}>
          <span className="analysis-detail-icon analysis-icon-blue"><Boxes size={16} /></span>
          <div className="analysis-detail-main"><div className="analysis-detail-title"><strong>{row.menu_name}</strong><StatusBadge status={getExpiryStatus(row.expiry_date, today)} /></div><small>Made {formatBusinessDate(row.production_date)} · Best before {formatBusinessDate(row.expiry_date)}</small><small className="analysis-detail-batch">BATCH {row.id.slice(0, 8).toUpperCase()}</small></div>
          <span className="analysis-detail-end"><strong>{formatQuantity(Number(row.quantity_remaining))}</strong><small>boxes</small></span>
        </article>)}</div>}
        <Link className="text-link dashboard-detail-link" to="/stock">View all stock</Link>
      </section>}
      </div>
    </dialog>
  </>;
}
