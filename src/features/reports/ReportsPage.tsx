import { useEffect, useState } from 'react';
import { ArrowDownToLine, BarChart3, CalendarRange, ReceiptText, Trash2, TrendingDown, UtensilsCrossed } from 'lucide-react';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { addCalendarDays, businessDateNow } from '../../lib/dates';
import { buildReportDateBuckets } from '../../lib/reportBuckets';
import { formatBaht, formatDate, formatQuantity } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { requireSupabase } from '../../lib/supabase';

interface Production { id: string; production_date: string; quantity_produced: number; expiry_date: string; menu_items: { name: string } | null; }
interface Waste { id: string; waste_date: string; quantity: number; reason: string; production_batches: { menu_items: { name: string } | null } | null; }
interface Expense { id: string; expense_date: string; amount_thb: number; stores: { name: string } | null; expense_categories: { name: string } | null; notes: string | null; }
interface Stock { menu_name: string; production_date: string; expiry_date: string; quantity_remaining: number; }
interface Activity { id: string; occurred_at: string; action: string; entity_type: string; description: string; }
interface DailyClosing { business_date: string; version: number; status: string; note: string | null; closing_batch_counts: { production_batch_id: string; expected_quantity: number; physical_remaining_quantity: number; calculated_sold_quantity: number; stock_adjustment_quantity: number; adjustment_reason: string | null }[]; }

export function ReportsPage() {
  const today = businessDateNow();
  const [start, setStart] = useState(`${today.slice(0, 8)}01`);
  const [end, setEnd] = useState(today);
  const [production, setProduction] = useState<Production[]>([]);
  const [waste, setWaste] = useState<Waste[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [closings, setClosings] = useState<DailyClosing[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      setBusy(true); setError('');
      const db = requireSupabase(); const nextDay = addCalendarDays(end, 1);
      const [productionResult, wasteResult, expenseResult, stockResult, activityResult, closingResult] = await Promise.all([
        db.from('production_batches').select('id, production_date, quantity_produced, expiry_date, menu_items(name)').gte('production_date', start).lte('production_date', end).is('deleted_at', null),
        db.from('waste_records').select('id, waste_date, quantity, reason, production_batches(menu_items(name))').gte('waste_date', start).lte('waste_date', end).is('deleted_at', null),
        db.from('expenses').select('id, expense_date, amount_thb, stores(name), expense_categories(name), notes').gte('expense_date', start).lte('expense_date', end).is('deleted_at', null),
        db.from('v_stock_by_batch').select('menu_name, production_date, expiry_date, quantity_remaining').gt('quantity_remaining', 0),
        db.from('activity_logs').select('id, occurred_at, action, entity_type, description').gte('occurred_at', `${start}T00:00:00+07:00`).lt('occurred_at', `${nextDay}T00:00:00+07:00`).order('occurred_at', { ascending: false }).limit(1000),
        db.from('daily_closings').select('business_date, version, status, note, closing_batch_counts(production_batch_id, expected_quantity, physical_remaining_quantity, calculated_sold_quantity, stock_adjustment_quantity, adjustment_reason)').gte('business_date', start).lte('business_date', end).eq('status', 'closed').order('business_date'),
      ]);
      if (!alive) return;
      const firstError = [productionResult, wasteResult, expenseResult, stockResult, activityResult, closingResult].find((result) => result.error)?.error;
      if (firstError) setError(firstError.message);
      setProduction((productionResult.data ?? []) as unknown as Production[]); setWaste((wasteResult.data ?? []) as unknown as Waste[]);
      setExpenses((expenseResult.data ?? []) as unknown as Expense[]); setStock((stockResult.data ?? []) as Stock[]); setActivity((activityResult.data ?? []) as Activity[]);
      setClosings((closingResult.data ?? []) as unknown as DailyClosing[]);
      setBusy(false);
    }
    void load(); return () => { alive = false; };
  }, [start, end]);

  const totalProduced = production.reduce((sum, item) => sum + Number(item.quantity_produced), 0);
  const totalWaste = waste.reduce((sum, item) => sum + Number(item.quantity), 0);
  const totalExpenses = expenses.reduce((sum, item) => sum + Number(item.amount_thb), 0);
  const stockOnHand = stock.reduce((sum, item) => sum + Number(item.quantity_remaining), 0);
  const totalSold = closings.reduce((sum, day) => sum + day.closing_batch_counts.reduce((dayTotal, count) => dayTotal + Number(count.calculated_sold_quantity), 0), 0);
  const wastePercent = totalProduced ? Math.round(totalWaste / totalProduced * 100) : 0;
  const daily = buildReportDateBuckets(start, end).map((bucket) => ({
    ...bucket,
    produced: production.filter((row) => row.production_date >= bucket.start && row.production_date <= bucket.end).reduce((sum, row) => sum + Number(row.quantity_produced), 0),
    sold: closings.filter((closing) => closing.business_date >= bucket.start && closing.business_date <= bucket.end).reduce((dayTotal, closing) => dayTotal + closing.closing_batch_counts.reduce((sum, count) => sum + Number(count.calculated_sold_quantity), 0), 0),
    waste: waste.filter((row) => row.waste_date >= bucket.start && row.waste_date <= bucket.end).reduce((sum, row) => sum + Number(row.quantity), 0),
  }));
  const max = Math.max(1, ...daily.flatMap((row) => [row.produced, row.sold, row.waste]));

  const exports: { label: string; icon: typeof ReceiptText; rows: Array<Record<string, unknown>> }[] = [
    { label: 'Expenses', icon: ReceiptText, rows: expenses.map((row) => ({ date: row.expense_date, store: row.stores?.name ?? '', category: row.expense_categories?.name ?? '', amount_thb: row.amount_thb, notes: row.notes })) },
    { label: 'Production', icon: UtensilsCrossed, rows: production.map((row) => ({ date: row.production_date, menu: row.menu_items?.name ?? '', quantity: row.quantity_produced, expiry_date: row.expiry_date })) },
    { label: 'Waste', icon: Trash2, rows: waste.map((row) => ({ date: row.waste_date, menu: row.production_batches?.menu_items?.name ?? '', quantity: row.quantity, reason: row.reason })) },
    { label: 'Stock', icon: BarChart3, rows: stock.map((row) => ({ menu: row.menu_name, production_date: row.production_date, expiry_date: row.expiry_date, remaining_quantity: row.quantity_remaining })) },
    { label: 'Activity', icon: CalendarRange, rows: activity.map((row) => ({ occurred_at: row.occurred_at, action: row.action, entity_type: row.entity_type, description: row.description })) },
    { label: 'Daily closing', icon: CalendarRange, rows: closings.flatMap((day) => day.closing_batch_counts.map((count) => ({ business_date: day.business_date, closing_version: day.version, batch_id: count.production_batch_id, expected: count.expected_quantity, physical_remaining: count.physical_remaining_quantity, inferred_sold: count.calculated_sold_quantity, adjustment: count.stock_adjustment_quantity, adjustment_reason: count.adjustment_reason, note: day.note }))) },
  ];

  return <>
    <PageTitle eyebrow="THE PATTERNS BEHIND THE DAY" title="Reports" detail="A clear look at production, waste and spending, over a date range that works for you." action={<button type="button" className="button button-quiet" onClick={() => downloadCsv(`canteen-report-${start}-to-${end}.csv`, [...exports[0]!.rows])}><ArrowDownToLine size={16} /> Export expenses</button>} />
    {error && <Notice>{error}</Notice>}
    <section className="panel report-controls"><div className="report-range-title"><span className="report-range-icon"><CalendarRange size={18} /></span><span><strong>Your reporting period</strong><small>Both start and end dates are included.</small></span></div><label>From<input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} /></label><label>To<input type="date" value={end} min={start} max={today} onChange={(event) => setEnd(event.target.value)} /></label><button className="button button-quiet" onClick={() => { setStart(addCalendarDays(today, -6)); setEnd(today); }}>Last 7 days</button><button className="button button-quiet" onClick={() => { const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay(); setStart(addCalendarDays(today, -((weekday + 6) % 7))); setEnd(today); }}>This week</button><button className="button button-quiet" onClick={() => { setStart(`${today.slice(0, 8)}01`); setEnd(today); }}>This month</button></section>
    <section className="report-metrics">
      <article className="report-metric report-metric-green"><span><UtensilsCrossed size={17} /> PRODUCED</span><strong>{busy ? '—' : formatQuantity(totalProduced)}<small>boxes</small></strong><p>{production.length} batches recorded</p></article>
      <article className="report-metric report-metric-peach"><span><Trash2 size={17} /> WASTE</span><strong>{busy ? '—' : formatQuantity(totalWaste)}<small>boxes</small></strong><p><TrendingDown size={13} /> {wastePercent}% of produced stock</p></article>
      <article className="report-metric report-metric-lilac"><span><CalendarRange size={17} /> INFERRED SOLD</span><strong>{busy ? '—' : formatQuantity(totalSold)}<small>boxes</small></strong><p>{closings.length} days closed in this range</p></article>
      <article className="report-metric report-metric-blue"><span><ReceiptText size={17} /> EXPENSES</span><strong className="report-currency">{busy ? '—' : formatBaht(totalExpenses)}</strong><p>{expenses.length} purchases recorded</p></article>
      <article className="report-metric report-metric-lilac"><span><BarChart3 size={17} /> STOCK ON HAND</span><strong>{busy ? '—' : formatQuantity(stockOnHand)}<small>boxes</small></strong><p>{stock.length} active batches today</p></article>
    </section>
    <div className="report-grid">
      <section className="panel report-chart-panel"><div className="panel-head"><div><span className="eyebrow">A GOOD WAY TO SEE A TREND</span><h2>Production, sold & waste</h2></div><span className="chart-legend"><i className="legend-produced" /> Produced <i className="legend-sold" /> Sold <i className="legend-waste" /> Waste</span></div>
        {busy ? <LoadingState label="Building your report…" /> : !totalProduced && !totalWaste && !totalSold ? <EmptyState title="Your chart will grow here" detail="A few days of records make trends easier to spot." /> : <div className="bar-chart" role="img" aria-label="Production, inferred sales and waste across the selected date range">{daily.map((day) => <div className="bar-day" key={day.start} title={`${formatDate(day.start)}${day.start === day.end ? '' : ` – ${formatDate(day.end)}`}: ${day.produced} produced, ${day.sold} inferred sold, ${day.waste} waste`}><div className="bar-pair"><span className="bar bar-produced" style={{ height: `${Math.max(3, day.produced / max * 100)}%` }} /><span className="bar bar-sold" style={{ height: `${Math.max(3, day.sold / max * 100)}%` }} /><span className="bar bar-waste" style={{ height: `${Math.max(3, day.waste / max * 100)}%` }} /></div><small>{day.end.slice(-2)}</small></div>)}</div>}
        <div className="chart-caption"><span>BOXES PER DAY</span><span>{formatDate(start)} – {formatDate(end)}</span></div>
      </section>
      <section className="panel expense-breakdown"><div className="panel-head"><div><span className="eyebrow">WHERE IT WENT</span><h2>Expense by store</h2></div></div>
        {busy ? <LoadingState label="Gathering expenses…" /> : expenses.length === 0 ? <EmptyState title="No expenses in this range" detail="Choose another date range or add a purchase." /> : (() => {
          const totals = Object.entries(expenses.reduce<Record<string, number>>((byStore, expense) => { const key = expense.stores?.name ?? 'Other'; byStore[key] = (byStore[key] ?? 0) + Number(expense.amount_thb); return byStore; }, {})).sort((a, b) => b[1] - a[1]);
          const largest = totals[0]![1] || 1;
          return <div className="store-breakdown">{totals.map(([store, amount], index) => <div className="store-bar-row" key={store}><div><span>{store}</span><strong>{formatBaht(amount)}</strong></div><span className={`store-bar-line store-bar-${index % 4}`}><i style={{ width: `${amount / largest * 100}%` }} /></span></div>)}</div>;
        })()}
      </section>
    </div>
    <section className="panel exports-panel"><div className="panel-head"><div><span className="eyebrow">YOUR RECORDS, YOURS TO KEEP</span><h2>Download a CSV</h2></div><ArrowDownToLine className="panel-sparkle" size={18} /></div><div className="export-grid">{exports.map(({ label, icon: Icon, rows }) => <button key={label} className="export-card" disabled={!rows.length || busy} onClick={() => downloadCsv(`canteen-${label.toLowerCase()}-${start}-to-${end}.csv`, rows)}><span className="export-card-icon"><Icon size={18} /></span><span><strong>{label}</strong><small>{rows.length} rows available</small></span><ArrowDownToLine size={16} /></button>)}</div></section>
  </>;
}
