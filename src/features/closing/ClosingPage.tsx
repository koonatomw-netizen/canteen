import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarCheck, CheckCircle2, ChevronRight, ClipboardCheck, LockKeyhole, RotateCcw, X } from 'lucide-react';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { DraftStatus } from '../../components/DraftStatus';
import { businessDateNow, formatBusinessDate } from '../../lib/dates';
import { formatQuantity } from '../../lib/format';
import { readLocalDraft, removeLocalDraft, writeLocalDraft, type DraftSaveStatus } from '../../lib/localDrafts';
import { calculateClosing, getBatchBalance, type ClosingResult } from '../../lib/stock';
import { requireSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../../lib/i18n';

interface BatchRow { id: string; menu_name_snapshot: string; meat_option_id: string | null; meat_options: { name: string } | null; stock_movements: { business_date: string; quantity_delta: number }[]; }
interface ClosingVariant { key: string; menu_name_snapshot: string; menu_name: string; meat_option_id: string | null; meat_name: string | null; quantity_available: number; recorded: ClosingResult | null; adjustment_reason: string | null; }
interface ClosingVariantResult extends ClosingVariant { calculation: ClosingResult | null; }
interface ClosingMenu { key: string; name: string; variants: ClosingVariantResult[]; }
interface Count { production_batch_id: string; expected_quantity: number; physical_remaining_quantity: number; calculated_sold_quantity: number; stock_adjustment_quantity: number; adjustment_reason: string | null; }
interface Closing { id: string; version: number; status: 'open' | 'closed' | 'reopened'; closed_at: string | null; note: string | null; reopen_reason: string | null; closing_batch_counts: Count[]; }
interface ClosingDraft { counts: Record<string, string>; reasons: Record<string, string>; note: string; }

function isClosingDraft(value: unknown): value is ClosingDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return Boolean(draft.counts && typeof draft.counts === 'object' && Object.values(draft.counts).every((item) => typeof item === 'string')
    && draft.reasons && typeof draft.reasons === 'object' && Object.values(draft.reasons).every((item) => typeof item === 'string')
    && typeof draft.note === 'string');
}

const adjustmentReasons = ['Counting correction', 'Staff meal', 'Complimentary', 'Missing/unrecorded', 'Other'];

export function ClosingPage() {
  const { member } = useAuth();
  const { t } = useI18n();
  const [businessDate, setBusinessDate] = useState(businessDateNow());
  const [stock, setStock] = useState<ClosingVariant[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [selectedMenuKey, setSelectedMenuKey] = useState<string | null>(null);
  const [closing, setClosing] = useState<Closing | null>(null);
  const [note, setNote] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [showReopenForm, setShowReopenForm] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formLoadedDate, setFormLoadedDate] = useState('');
  const [draftStatus, setDraftStatus] = useState<DraftSaveStatus>('idle');
  const draftKey = `canteen.draft.closing:${member?.user_id ?? 'local'}:${businessDate}`;

  async function load() {
    setBusy(true); setError('');
    const db = requireSupabase();
    const [stockResult, closingResult] = await Promise.all([
      db.from('production_batches').select('id, menu_name_snapshot, meat_option_id, meat_options(name), stock_movements!inner(business_date, quantity_delta)').lte('production_date', businessDate).lte('stock_movements.business_date', businessDate).is('deleted_at', null),
      db.from('daily_closings').select('id, version, status, closed_at, note, reopen_reason, closing_batch_counts(production_batch_id, expected_quantity, physical_remaining_quantity, calculated_sold_quantity, stock_adjustment_quantity, adjustment_reason)').eq('business_date', businessDate).order('version', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (stockResult.error || closingResult.error) setError(stockResult.error?.message ?? closingResult.error?.message ?? 'Could not load the closing count.');
    const latest = (closingResult.data as unknown as Closing | null) ?? null;
    const savedDraft = latest?.status === 'closed' ? null : readLocalDraft<unknown>(draftKey);
    const draft = isClosingDraft(savedDraft) ? savedDraft : null;
    const recordedCounts = latest?.status === 'closed'
      ? new Map((latest.closing_batch_counts ?? []).map((row) => [row.production_batch_id, row]))
      : new Map<string, Count>();
    const variants = new Map<string, ClosingVariant>();
    for (const batch of (stockResult.data ?? []) as unknown as BatchRow[]) {
      const recorded = recordedCounts.get(batch.id);
      if (latest?.status === 'closed' && !recorded) continue;
      const quantityAvailable = recorded?.expected_quantity ?? getBatchBalance(batch.stock_movements, businessDate);
      if (quantityAvailable <= 0 && !recorded) continue;
      const key = JSON.stringify([batch.menu_name_snapshot, batch.meat_option_id]);
      const existing = variants.get(key);
      const batchRecorded = recorded ? {
        expected: Number(recorded.expected_quantity),
        physical: Number(recorded.physical_remaining_quantity),
        sold: Number(recorded.calculated_sold_quantity),
        adjustment: Number(recorded.stock_adjustment_quantity),
        difference: Number(recorded.physical_remaining_quantity) - Number(recorded.expected_quantity),
      } : null;
      if (existing) {
        existing.quantity_available += quantityAvailable;
        if (batchRecorded && !existing.recorded) existing.recorded = { expected: 0, physical: 0, sold: 0, adjustment: 0, difference: 0 };
        if (batchRecorded && existing.recorded) {
          existing.recorded.expected += batchRecorded.expected;
          existing.recorded.physical += batchRecorded.physical;
          existing.recorded.sold += batchRecorded.sold;
          existing.recorded.adjustment += batchRecorded.adjustment;
          existing.recorded.difference += batchRecorded.difference;
        }
        existing.adjustment_reason ??= recorded?.adjustment_reason ?? null;
      } else {
        variants.set(key, {
          key,
          menu_name_snapshot: batch.menu_name_snapshot,
          menu_name: batch.menu_name_snapshot,
          meat_option_id: batch.meat_option_id,
          meat_name: batch.meat_options?.name ?? null,
          quantity_available: quantityAvailable,
          recorded: batchRecorded,
          adjustment_reason: recorded?.adjustment_reason ?? null,
        });
      }
    }
    const variantRows = Array.from(variants.values()).sort((a, b) =>
      a.menu_name.localeCompare(b.menu_name) || (a.meat_name ?? '').localeCompare(b.meat_name ?? ''),
    );
    setStock(variantRows);
    setClosing(latest);
    setCounts(Object.fromEntries(variantRows.map((variant) => [variant.key, variant.recorded ? String(variant.recorded.physical) : draft?.counts[variant.key] ?? ''])));
    setReasons(Object.fromEntries(variantRows.map((variant) => [variant.key, variant.adjustment_reason ?? draft?.reasons[variant.key] ?? ''])));
    setSelectedMenuKey(null);
    setNote(latest?.note ?? draft?.note ?? '');
    setFormLoadedDate(businessDate);
    setDraftStatus(draft && latest?.status !== 'closed' ? 'saved' : 'idle');
    setBusy(false);
  }
  const alreadyClosed = closing?.status === 'closed';
  useEffect(() => { void load(); }, [businessDate]);

  useEffect(() => {
    if (busy || formLoadedDate !== businessDate) return;
    const hasContent = Object.values(counts).some((value) => value !== '') || note.trim().length > 0;
    if (alreadyClosed || !hasContent) {
      removeLocalDraft(draftKey); setDraftStatus('idle'); return;
    }
    setDraftStatus('saving');
    const timer = window.setTimeout(() => {
      setDraftStatus(writeLocalDraft(draftKey, { counts, reasons, note }) ? 'saved' : 'idle');
    }, 450);
    return () => window.clearTimeout(timer);
  }, [businessDate, counts, reasons, note, alreadyClosed, busy, formLoadedDate, draftKey]);

  const results = useMemo(() => {
    return stock.map((variant) => {
      const calculation = alreadyClosed
        ? variant.recorded
        : counts[variant.key] === undefined || counts[variant.key] === ''
          ? null
          : calculateClosing(Number(variant.quantity_available), Number(counts[variant.key]));
      return { ...variant, calculation };
    });
  }, [stock, counts, alreadyClosed]);
  const menuGroups = useMemo(() => {
    const groups = new Map<string, ClosingMenu>();
    for (const variant of results) {
      const key = variant.menu_name_snapshot;
      const existing = groups.get(key);
      if (existing) existing.variants.push(variant);
      else groups.set(key, { key, name: variant.menu_name, variants: [variant] });
    }
    return Array.from(groups.values());
  }, [results]);
  const selectedMenu = menuGroups.find((menu) => menu.key === selectedMenuKey) ?? null;
  useEffect(() => {
    if (!selectedMenuKey) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedMenuKey(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedMenuKey]);
  const allCountsEntered = stock.every((variant) => counts[variant.key] !== undefined && counts[variant.key] !== '' && Number.isInteger(Number(counts[variant.key])) && Number(counts[variant.key]) >= 0);
  const adjustmentMissing = results.some((row) => row.calculation && row.calculation.adjustment > 0 && !reasons[row.key]);
  const inferredSales = alreadyClosed
    ? (closing?.closing_batch_counts ?? []).reduce((sum, row) => sum + Number(row.calculated_sold_quantity), 0)
    : results.reduce((sum, row) => sum + (row.calculation?.sold ?? 0), 0);
  const adjustments = alreadyClosed
    ? (closing?.closing_batch_counts ?? []).reduce((sum, row) => sum + Number(row.stock_adjustment_quantity), 0)
    : results.reduce((sum, row) => sum + (row.calculation?.adjustment ?? 0), 0);
  const remaining = alreadyClosed
    ? (closing?.closing_batch_counts ?? []).reduce((sum, row) => sum + Number(row.physical_remaining_quantity), 0)
    : results.reduce((sum, row) => sum + Number(counts[row.key] || 0), 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess('');
    if (alreadyClosed) return;
    if (!allCountsEntered) { setError(t('Enter the physical count for every menu and meat option before closing.')); return; }
    if (adjustmentMissing) { setError(t('Add a reason for each option where you counted more than expected.')); return; }
    setSaving(true);
    const payload = stock.map((variant) => ({
      menu_name_snapshot: variant.menu_name_snapshot,
      meat_option_id: variant.meat_option_id,
      physical_quantity: Number(counts[variant.key]),
      adjustment_reason: reasons[variant.key] || null,
    }));
    const { error: closeError } = await requireSupabase().rpc('close_canteen_day', { p_business_date: businessDate, p_counts: payload, p_note: note.trim() || null });
    if (closeError) setError(closeError.message);
    else { removeLocalDraft(draftKey); setDraftStatus('idle'); setSuccess(t('Today’s closing is saved, and stock is ready for tomorrow.')); await load(); }
    setSaving(false);
  }

  async function reopen() {
    if (!closing || !reopenReason.trim()) { setError(t('Add a reason before reopening this day.')); return; }
    if (!window.confirm(`${t('Reopen the closing for')} ${formatBusinessDate(businessDate)}? ${t('Your reason and the original count will be kept in the activity log.')}`)) return;
    setError(''); setSuccess(''); setSaving(true);
    const { error: reopenError } = await requireSupabase().rpc('reopen_canteen_day', { p_business_date: businessDate, p_reason: reopenReason.trim() });
    if (reopenError) setError(reopenError.message);
    else { setSuccess(t('Day reopened. The reason and previous closing are in the activity history.')); setShowReopenForm(false); setReopenReason(''); await load(); }
    setSaving(false);
  }

  return <>
    <PageTitle eyebrow="THE LAST THING BEFORE HOME" title="Daily closing" detail="Count what’s still in the kitchen. Enter one total for each menu and meat option." />
    {error && <Notice>{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
    <div className="closing-date-row"><label>{t('Business day')}<input type="date" value={businessDate} max={businessDateNow()} onChange={(event) => setBusinessDate(event.target.value)} /></label><span className={alreadyClosed ? 'closing-state closed' : 'closing-state'}>{alreadyClosed ? <><CheckCircle2 size={16} /> {t('Day closed')} · {t('version')} {closing.version}</> : <><CalendarCheck size={16} /> {t(closing?.status === 'reopened' ? 'Reopened · please count again' : 'Ready to count')}</>}</span></div>
    {busy ? <section className="panel"><LoadingState label="Preparing this day’s count…" /></section> : <div className="closing-layout">
      <form className="panel closing-form" onSubmit={submit}>
        <div className="panel-head"><div><span className="eyebrow">{t('PHYSICAL STOCK COUNT')}</span><h2>{t('How many are left?')}</h2></div><span className="form-panel-icon green"><ClipboardCheck size={20} /></span></div>
        {stock.length === 0 ? <EmptyState title="No stock to count" detail="You can close this day with no remaining stock, or record production and return here." /> : <>
          <p className="closing-count-instruction">{t('Choose a menu to count. Only options with stock available today are shown.')}</p>
          <div className="closing-menu-list">{menuGroups.map((menu) => {
            const counted = menu.variants.filter((variant) => counts[variant.key] !== undefined && counts[variant.key] !== '').length;
            const available = menu.variants.reduce((sum, variant) => sum + variant.quantity_available, 0);
            return <button className="closing-menu-row" type="button" key={menu.key} onClick={() => setSelectedMenuKey(menu.key)}>
              <span className="closing-menu-mark"><CalendarCheck size={17} /></span>
              <span className="closing-menu-info"><strong>{menu.name}</strong><small>{menu.variants.length} {t(menu.variants.length === 1 ? 'option' : 'options')} {t('in stock')}</small></span>
              <span className="closing-menu-available"><strong>{formatQuantity(available)}</strong><small>{t('boxes')}</small></span>
              <span className={`closing-menu-progress${counted === menu.variants.length ? ' is-complete' : ''}`}>{counted}/{menu.variants.length} {t('counted')} <ChevronRight size={16} /></span>
            </button>;
          })}</div>
        </>}
        <DraftStatus status={draftStatus} />
        <label className="closing-note">{t('Note')} <span className="optional-label">{t('OPTIONAL')}</span><textarea rows={2} placeholder={t('Anything unusual about today?')} value={note} onChange={(event) => setNote(event.target.value)} disabled={alreadyClosed} /></label>
        {!alreadyClosed && <button className="button button-primary closing-submit" disabled={saving || !allCountsEntered || adjustmentMissing}><LockKeyhole size={17} />{saving ? t('Saving closing…') : t('Close this day')}</button>}
      </form>
      <aside className="closing-summary">
        <section className="panel close-totals"><span className="eyebrow">{t('END OF DAY')}</span><h2>{t('Here’s the picture.')}</h2><div className="close-total"><span>{t('Boxes still here')}</span><strong>{formatQuantity(remaining)}</strong></div><div className="close-total"><span>{t('Inferred sold')}</span><strong>{formatQuantity(inferredSales)}</strong></div><div className="close-total"><span>{t('Stock adjustments')}</span><strong>{formatQuantity(adjustments)}</strong></div><div className="close-equation">{t('Available stock')} <span>−</span> {t('count')} = {t('sold')}</div>
          {!alreadyClosed && <div className="closing-footnote"><AlertTriangle size={15} /><span>{t('Unrecorded losses may look like sales. Record known meals and other losses before closing.')}</span></div>}
          {alreadyClosed && closing?.closed_at && <p className="closed-at">Closed at {new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(new Date(closing.closed_at))} ICT</p>}
          {alreadyClosed && member?.role === 'admin' && (showReopenForm ? <form className="reopen-reason-form" onSubmit={(event) => { event.preventDefault(); void reopen(); }}><label>{t('Why does this closing need correction?')}<textarea rows={3} maxLength={1000} minLength={3} required value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder={t('Describe what was counted incorrectly')} /></label><div className="reopen-reason-actions"><button type="button" className="button button-quiet" onClick={() => { setShowReopenForm(false); setReopenReason(''); }}>{t('Cancel')}</button><button className="button button-primary" disabled={saving || reopenReason.trim().length < 3}><RotateCcw size={15} />{saving ? t('Reopening…') : t('Reopen with reason')}</button></div></form> : <button className="button button-quiet reopen-button" onClick={() => setShowReopenForm(true)} disabled={saving}><RotateCcw size={16} /> {t('Reopen day')}</button>)}
          {closing?.status === 'reopened' && closing.reopen_reason && <p className="closing-reopen-note"><strong>{t('Reopened because:')}</strong> {closing.reopen_reason}</p>}
        </section>
        <section className="closing-tip"><span className="tip-number">1</span><span><strong>{t('Count each menu option once.')}</strong><small>{t('All production batches of that option are counted together.')}</small></span></section>
        <section className="closing-tip"><span className="tip-number">2</span><span><strong>{t('Oldest stock is used first.')}</strong><small>{t('Sold boxes are allocated to the oldest production batches automatically.')}</small></span></section>
      </aside>
    </div>}
    {!busy && selectedMenu && <div className="closing-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMenuKey(null); }}>
      <section className="closing-modal" role="dialog" aria-modal="true" aria-labelledby="closing-modal-title">
        <header className="closing-modal-head"><div><span className="eyebrow">{t('MENU STOCK')}</span><h2 id="closing-modal-title">{selectedMenu.name}</h2><p>{t('Count all boxes of each option together.')}</p></div><button type="button" className="icon-button" aria-label={t('Close count window')} onClick={() => setSelectedMenuKey(null)}><X size={18} /></button></header>
        <div className="closing-count-head"><span>{t('MEAT OPTION')}</span><span>{t('AVAILABLE')}</span><span>{t('LEFT AT CLOSE')}</span><span>{t('SOLD')}</span></div>
        <div className="closing-modal-list">{selectedMenu.variants.map((variant) => {
          const hasPhysicalCount = alreadyClosed || (counts[variant.key] !== undefined && counts[variant.key] !== '');
          const calculation = variant.calculation;
          return <article className="closing-batch-row" key={variant.key}>
            <span className="closing-batch-mark"><CalendarCheck size={16} /></span>
            <div className="closing-batch-info"><strong>{variant.meat_name ?? t('Unspecified option')}</strong><small>{t('All batches combined')}</small></div>
            <div className="closing-quantity-cell"><small>{t('AVAILABLE')}</small><strong>{formatQuantity(variant.quantity_available)}</strong><span>{t('boxes')}</span></div>
            <label className="closing-count-label"><span>{t('LEFT AT CLOSE')}</span><input aria-label={`${t('Boxes left for')} ${selectedMenu.name} ${variant.meat_name ?? t('option')}`} type="number" min="0" step="1" inputMode="numeric" value={counts[variant.key] ?? ''} onChange={(event) => setCounts((current) => ({ ...current, [variant.key]: event.target.value }))} disabled={alreadyClosed || saving} /><small>{t('boxes')}</small></label>
            <div className="closing-quantity-cell closing-sold-cell"><small>{t('SOLD')}</small><strong>{hasPhysicalCount ? formatQuantity(calculation?.sold ?? 0) : '—'}</strong><span>{t('boxes')}</span></div>
            {calculation && calculation.adjustment > 0 && <div className="adjustment-inline"><AlertTriangle size={15} /><span>{t('Found')} {formatQuantity(calculation.adjustment)} {t('extra. Why?')}</span><select required aria-label={`${t('Reason for extra')} ${selectedMenu.name} ${variant.meat_name ?? t('option')} ${t('stock')}`} value={reasons[variant.key] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [variant.key]: event.target.value }))} disabled={alreadyClosed || saving}><option value="">{t('Choose a reason')}</option>{adjustmentReasons.map((reason) => <option key={reason}>{t(reason)}</option>)}</select></div>}
          </article>;
        })}</div>
        <footer className="closing-modal-footer"><span>{selectedMenu.variants.filter((variant) => counts[variant.key] !== undefined && counts[variant.key] !== '').length} {t('of')} {selectedMenu.variants.length} {t('options counted')}</span><button type="button" className="button button-primary" onClick={() => setSelectedMenuKey(null)}>{t(alreadyClosed ? 'Done' : 'Save counts')}</button></footer>
      </section>
    </div>}
  </>;
}
