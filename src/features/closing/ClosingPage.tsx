import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarCheck, CheckCircle2, ClipboardCheck, LockKeyhole, RotateCcw } from 'lucide-react';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { businessDateNow, formatBusinessDate } from '../../lib/dates';
import { formatFoodVariant, formatQuantity } from '../../lib/format';
import { calculateClosing, getBatchBalance } from '../../lib/stock';
import { requireSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';

interface BatchRow { id: string; production_date: string; expiry_date: string; menu_items: { name: string } | null; meat_options: { name: string } | null; stock_movements: { business_date: string; quantity_delta: number }[]; }
interface Batch { id: string; menu_name: string; production_date: string; expiry_date: string; quantity_available: number; }
interface Count { production_batch_id: string; expected_quantity: number; physical_remaining_quantity: number; calculated_sold_quantity: number; stock_adjustment_quantity: number; adjustment_reason: string | null; }
interface Closing { id: string; version: number; status: 'open' | 'closed' | 'reopened'; closed_at: string | null; note: string | null; closing_batch_counts: Count[]; }

const adjustmentReasons = ['Counting correction', 'Staff meal', 'Complimentary', 'Missing/unrecorded', 'Other'];

export function ClosingPage() {
  const { member } = useAuth();
  const [businessDate, setBusinessDate] = useState(businessDateNow());
  const [stock, setStock] = useState<Batch[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [closing, setClosing] = useState<Closing | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    setBusy(true); setError('');
    const db = requireSupabase();
    const [stockResult, closingResult] = await Promise.all([
      db.from('production_batches').select('id, production_date, expiry_date, menu_items(name), meat_options(name), stock_movements!inner(business_date, quantity_delta)').lte('production_date', businessDate).lte('stock_movements.business_date', businessDate).is('deleted_at', null).order('expiry_date'),
      db.from('daily_closings').select('id, version, status, closed_at, note, closing_batch_counts(production_batch_id, expected_quantity, physical_remaining_quantity, calculated_sold_quantity, stock_adjustment_quantity, adjustment_reason)').eq('business_date', businessDate).order('version', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (stockResult.error || closingResult.error) setError(stockResult.error?.message ?? closingResult.error?.message ?? 'Could not load the closing count.');
    const latest = (closingResult.data as unknown as Closing | null) ?? null;
    const recordedCounts = latest?.status === 'closed'
      ? new Map((latest.closing_batch_counts ?? []).map((row) => [row.production_batch_id, row]))
      : new Map<string, Count>();
    const batches = ((stockResult.data ?? []) as unknown as BatchRow[]).map((batch) => ({
      id: batch.id,
      menu_name: formatFoodVariant(batch.menu_items?.name, batch.meat_options?.name),
      production_date: batch.production_date,
      expiry_date: batch.expiry_date,
      quantity_available: recordedCounts.get(batch.id)?.expected_quantity ?? getBatchBalance(batch.stock_movements, businessDate),
    })).filter((batch) => batch.quantity_available > 0 || recordedCounts.has(batch.id));
    setStock(batches);
    setClosing(latest);
    const priorCounts = latest?.status === 'closed'
      ? new Map((latest.closing_batch_counts ?? []).map((row) => [row.production_batch_id, row]))
      : new Map<string, Count>();
    setCounts(Object.fromEntries(batches.map((batch) => [batch.id, priorCounts.has(batch.id) ? String(priorCounts.get(batch.id)!.physical_remaining_quantity) : ''])));
    setReasons(Object.fromEntries((latest?.status === 'closed' ? latest.closing_batch_counts : []).map((row) => [row.production_batch_id, row.adjustment_reason ?? ''])));
    setNote(latest?.note ?? '');
    setBusy(false);
  }
  useEffect(() => { void load(); }, [businessDate]);

  const alreadyClosed = closing?.status === 'closed';
  const results = useMemo(() => {
    const recordedCounts = new Map((closing?.closing_batch_counts ?? []).map((row) => [row.production_batch_id, row]));
    return stock.map((batch) => {
      const recorded = alreadyClosed ? recordedCounts.get(batch.id) : undefined;
      const calculation = recorded
        ? {
            expected: recorded.expected_quantity,
            physical: recorded.physical_remaining_quantity,
            sold: recorded.calculated_sold_quantity,
            adjustment: recorded.stock_adjustment_quantity,
            difference: recorded.physical_remaining_quantity - recorded.expected_quantity,
          }
        : counts[batch.id] === undefined || counts[batch.id] === ''
          ? null
          : calculateClosing(Number(batch.quantity_available), Number(counts[batch.id]));
      return { ...batch, calculation };
    });
  }, [stock, counts, closing, alreadyClosed]);
  const allCountsEntered = stock.every((batch) => counts[batch.id] !== undefined && counts[batch.id] !== '' && Number.isInteger(Number(counts[batch.id])) && Number(counts[batch.id]) >= 0);
  const adjustmentMissing = results.some((row) => row.calculation && row.calculation.adjustment > 0 && !reasons[row.id]);
  const inferredSales = alreadyClosed
    ? (closing?.closing_batch_counts ?? []).reduce((sum, row) => sum + Number(row.calculated_sold_quantity), 0)
    : results.reduce((sum, row) => sum + (row.calculation?.sold ?? 0), 0);
  const adjustments = alreadyClosed
    ? (closing?.closing_batch_counts ?? []).reduce((sum, row) => sum + Number(row.stock_adjustment_quantity), 0)
    : results.reduce((sum, row) => sum + (row.calculation?.adjustment ?? 0), 0);
  const remaining = alreadyClosed
    ? (closing?.closing_batch_counts ?? []).reduce((sum, row) => sum + Number(row.physical_remaining_quantity), 0)
    : results.reduce((sum, row) => sum + Number(counts[row.id] || 0), 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess('');
    if (alreadyClosed) return;
    if (!allCountsEntered) { setError('Enter the physical count for every batch before closing.'); return; }
    if (adjustmentMissing) { setError('Add a reason for each batch where you counted more than expected.'); return; }
    setSaving(true);
    const payload = stock.map((batch) => ({
      batch_id: batch.id,
      physical_quantity: Number(counts[batch.id]),
      adjustment_reason: reasons[batch.id] || null,
    }));
    const { error: closeError } = await requireSupabase().rpc('close_canteen_day', { p_business_date: businessDate, p_counts: payload, p_note: note.trim() || null });
    if (closeError) setError(closeError.message);
    else { setSuccess('Today’s closing is saved, and batch stock is ready for tomorrow.'); await load(); }
    setSaving(false);
  }

  async function reopen() {
    if (!closing || !window.confirm(`Reopen the closing for ${formatBusinessDate(businessDate)}? This will reverse its stock movements and keep an audit record.`)) return;
    setError(''); setSuccess(''); setSaving(true);
    const { error: reopenError } = await requireSupabase().rpc('reopen_canteen_day', { p_business_date: businessDate });
    if (reopenError) setError(reopenError.message);
    else { setSuccess('Day reopened. The previous closing remains in activity history.'); await load(); }
    setSaving(false);
  }

  return <>
    <PageTitle eyebrow="THE LAST THING BEFORE HOME" title="Daily closing" detail="Count what’s still in the kitchen. We’ll calculate sold quantities from your batch stock." />
    {error && <Notice>{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
    <div className="closing-date-row"><label>Business day<input type="date" value={businessDate} max={businessDateNow()} onChange={(event) => setBusinessDate(event.target.value)} /></label><span className={alreadyClosed ? 'closing-state closed' : 'closing-state'}>{alreadyClosed ? <><CheckCircle2 size={16} /> Day closed · version {closing.version}</> : <><CalendarCheck size={16} /> {closing?.status === 'reopened' ? 'Reopened · please count again' : 'Ready to count'}</>}</span></div>
    {busy ? <section className="panel"><LoadingState label="Preparing this day’s count…" /></section> : <div className="closing-layout">
      <form className="panel closing-form" onSubmit={submit}>
        <div className="panel-head"><div><span className="eyebrow">PHYSICAL BATCH COUNT</span><h2>How many are left?</h2></div><span className="form-panel-icon green"><ClipboardCheck size={20} /></span></div>
        {stock.length === 0 ? <EmptyState title="No stock to count" detail="You can close this day with no remaining batches, or record production and return here." /> : <>
          <div className="closing-count-head"><span>FOOD BATCH</span><span>AVAILABLE</span><span>LEFT AT CLOSE</span><span>SOLD</span></div>
          <div className="closing-batch-list">{results.map((batch) => {
            const hasPhysicalCount = alreadyClosed || (counts[batch.id] !== undefined && counts[batch.id] !== '');
            const calculation = batch.calculation;
            return <article className="closing-batch-row" key={batch.id}><span className="closing-batch-mark"><CalendarCheck size={16} /></span><div className="closing-batch-info"><strong>{batch.menu_name}</strong><small>{formatBusinessDate(batch.production_date)} · expires {formatBusinessDate(batch.expiry_date)}</small></div>
              <div className="closing-quantity-cell"><small>AVAILABLE</small><strong>{formatQuantity(batch.quantity_available)}</strong><span>boxes</span></div>
              <label className="closing-count-label"><span>LEFT AT CLOSE</span><input type="number" min="0" step="1" inputMode="numeric" value={counts[batch.id] ?? ''} onChange={(event) => setCounts((current) => ({ ...current, [batch.id]: event.target.value }))} disabled={alreadyClosed} required /><small>boxes</small></label>
              <div className="closing-quantity-cell closing-sold-cell"><small>SOLD</small><strong>{hasPhysicalCount ? formatQuantity(calculation?.sold ?? 0) : '—'}</strong><span>boxes</span></div>
              {calculation && calculation.adjustment > 0 && <div className="adjustment-inline"><AlertTriangle size={15} /><span>Found {formatQuantity(calculation.adjustment)} extra. Why?</span><select required aria-label={`Reason for extra stock in ${batch.menu_name}`} value={reasons[batch.id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [batch.id]: event.target.value }))} disabled={alreadyClosed}><option value="">Choose a reason</option>{adjustmentReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></div>}
            </article>;
          })}</div>
        </>}
        <label className="closing-note">Note <span className="optional-label">OPTIONAL</span><textarea rows={2} placeholder="Anything unusual about today?" value={note} onChange={(event) => setNote(event.target.value)} disabled={alreadyClosed} /></label>
        {!alreadyClosed && <button className="button button-primary closing-submit" disabled={saving || !allCountsEntered || adjustmentMissing}><LockKeyhole size={17} />{saving ? 'Saving closing…' : 'Close this day'}</button>}
      </form>
      <aside className="closing-summary">
        <section className="panel close-totals"><span className="eyebrow">END OF DAY</span><h2>Here’s the picture.</h2><div className="close-total"><span>Boxes still here</span><strong>{formatQuantity(remaining)}</strong></div><div className="close-total"><span>Inferred sold</span><strong>{formatQuantity(inferredSales)}</strong></div><div className="close-total"><span>Stock adjustments</span><strong>{formatQuantity(adjustments)}</strong></div><div className="close-equation">Available stock <span>−</span> count = sold</div>
          {!alreadyClosed && <div className="closing-footnote"><AlertTriangle size={15} /><span>Unrecorded losses may look like sales. Record known meals and other losses before closing.</span></div>}
          {alreadyClosed && closing?.closed_at && <p className="closed-at">Closed at {new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(new Date(closing.closed_at))} ICT</p>}
          {alreadyClosed && (member?.role === 'admin' || member?.role === 'manager') && <button className="button button-quiet reopen-button" onClick={() => void reopen()} disabled={saving}><RotateCcw size={16} /> {saving ? 'Reopening…' : 'Reopen day'}</button>}
        </section>
        <section className="closing-tip"><span className="tip-number">1</span><span><strong>Pick the actual batch.</strong><small>No FIFO assumptions. The team knows what it is counting.</small></span></section>
        <section className="closing-tip"><span className="tip-number">2</span><span><strong>Enter what you see.</strong><small>Quantities cannot go below zero. Differences stay visible.</small></span></section>
      </aside>
    </div>}
  </>;
}
