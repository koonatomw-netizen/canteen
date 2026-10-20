import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarRange, Check, Dumbbell, Edit3, Ticket, Trash2, Users } from 'lucide-react';
import { LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { businessDateNow } from '../../lib/dates';
import { formatBaht, formatDate, formatQuantity } from '../../lib/format';
import { requireSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../../lib/i18n';
import {
  defaultMonthlyEndDate, guestTypes, greenPackages, normalizeGymPassInput,
  normalizeVoucherInput, suggestCouponColor, suggestedVoucherAmount,
  validateGymPassInput, validateVoucherInput,
  type CouponColor, type GymPassInput, type GymPassType, type GuestType,
  type PaymentStatus, type VoucherInput,
} from './colivingModel';

type VoucherRow = VoucherInput & {
  id: string; created_by_name: string; created_at: string; updated_by_name: string;
  voided_at: string | null; voided_by_name: string | null; void_reason: string | null;
};
type GymRow = GymPassInput & {
  id: string; created_by_name: string; created_at: string; updated_by_name: string;
  voided_at: string | null; voided_by_name: string | null; void_reason: string | null;
};
type EventRow = {
  id: string; entity_type: 'meal_voucher' | 'gym_pass'; entity_id: string;
  event_type: 'created' | 'updated' | 'voided'; actor_name: string; reason: string;
  occurred_at: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown>;
};
type FormMode = 'voucher' | 'gym' | null;

const pageSize = 500;
const voucherSelect = 'id, issue_date, guest_type, coupon_color, quantity, amount_thb, payment_status, complimentary_reason, recipient, notes, created_by_name, created_at, updated_by_name, voided_at, voided_by_name, void_reason';
const gymSelect = 'id, issue_date, guest_type, pass_type, quantity, amount_thb, start_date, end_date, recipient, notes, created_by_name, created_at, updated_by_name, voided_at, voided_by_name, void_reason';

async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await query(from, from + pageSize - 1);
    if (result.error) return { rows, error: result.error.message };
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { rows, error: null };
  }
}

function todayRange() {
  const today = businessDateNow();
  return { start: `${today.slice(0, 8)}01`, end: today };
}

function blankVoucher(date: string): VoucherInput & { change_reason: string } {
  return {
    issue_date: date, guest_type: 'Outside Customer', coupon_color: 'green', quantity: 1,
    amount_thb: 180, payment_status: 'paid', complimentary_reason: null, recipient: null,
    notes: null, change_reason: '',
  };
}

function blankGym(date: string): GymPassInput & { change_reason: string } {
  return {
    issue_date: date, guest_type: 'Coliving', pass_type: 'day', quantity: 1,
    amount_thb: 0, start_date: null, end_date: null, recipient: null, notes: null, change_reason: '',
  };
}

function amountValue(value: string): number {
  return Number(value);
}

export type ColivingPageView = 'dashboard' | 'records' | 'report';

function ColivingEmptyState({ title, action }: { title: string; action?: { to: string; label: string } }) {
  return <div className="coliving-empty-state"><span>{title}</span>{action && <Link className="coliving-empty-link" to={action.to}>{action.label}</Link>}</div>;
}

function ColivingEntrySummary({ mode, voucher, gym, t }: {
  mode: Exclude<FormMode, null>;
  voucher: VoucherInput;
  gym: GymPassInput;
  t: (text: string) => string;
}) {
  const isVoucher = mode === 'voucher';
  const quantity = isVoucher ? voucher.quantity : gym.quantity;
  const amount = isVoucher ? voucher.amount_thb : gym.amount_thb;
  const details = isVoucher
    ? [
        [t('Guest type'), t(voucher.guest_type)],
        [t('Coupon color'), t(voucher.coupon_color === 'green' ? 'Green ticket' : 'Orange ticket')],
        [t('Payment'), t(voucher.payment_status)],
      ]
    : [
        [t('Guest type'), t(gym.guest_type)],
        [t('Pass type'), t(gym.pass_type === 'monthly' ? 'Monthly pass' : 'Day pass')],
        ...(gym.pass_type === 'monthly' && gym.start_date && gym.end_date
          ? [[t('Valid dates'), `${formatDate(gym.start_date)} – ${formatDate(gym.end_date)}`]]
          : []),
      ];

  return <aside className={`coliving-entry-summary ${isVoucher ? 'voucher' : 'gym'}`} aria-live="polite">
    <div className="coliving-entry-summary-head">
      <span className="coliving-entry-summary-icon">{isVoucher ? <Ticket size={18} /> : <Dumbbell size={18} />}</span>
      <div><span className="eyebrow">{t('Entry summary')}</span><h3>{t(isVoucher ? 'Meal vouchers' : 'Gym passes')}</h3></div>
    </div>
    <div className="coliving-entry-summary-totals">
      <div><span>{t('Quantity')}</span><strong>{formatQuantity(Number(quantity) || 0)} {t(quantity === 1 ? (isVoucher ? 'voucher' : 'pass') : (isVoucher ? 'vouchers' : 'passes'))}</strong></div>
      <div><span>{t('Amount')}</span><strong>{formatBaht(amount)}</strong></div>
    </div>
    <dl className="coliving-entry-summary-details">
      {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  </aside>;
}

export function ColivingPage({ view = 'dashboard' }: { view?: ColivingPageView }) {
  const { member } = useAuth();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManage = member?.role === 'admin' || member?.role === 'coliving';
  const initialRange = todayRange();
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [gymPasses, setGymPasses] = useState<GymRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [voucherForm, setVoucherForm] = useState(blankVoucher(initialRange.end));
  const [gymForm, setGymForm] = useState(blankGym(initialRange.end));
  const [formError, setFormError] = useState('');
  const [voidTarget, setVoidTarget] = useState<{ type: 'voucher' | 'gym'; id: string } | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [recordFilter, setRecordFilter] = useState<'all' | 'voucher' | 'gym'>('all');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    const db = requireSupabase();
    const [voucherResult, gymResult] = await Promise.all([
      readAll<VoucherRow>((from, to) => db.from('coliving_meal_voucher_issues').select(voucherSelect).gte('issue_date', start).lte('issue_date', end).order('issue_date', { ascending: false }).range(from, to)),
      readAll<GymRow>((from, to) => db.from('coliving_gym_pass_issues').select(gymSelect).gte('issue_date', start).lte('issue_date', end).order('issue_date', { ascending: false }).range(from, to)),
    ]);
    if (voucherResult.error || gymResult.error) {
      setError(voucherResult.error ?? gymResult.error ?? t('Could not load Co-living records. Check database access and try again.'));
      setVouchers(voucherResult.rows);
      setGymPasses(gymResult.rows);
      setEvents([]);
      setBusy(false);
      return;
    }
    setVouchers(voucherResult.rows);
    setGymPasses(gymResult.rows);
    const entityIds = [...voucherResult.rows.map((row) => row.id), ...gymResult.rows.map((row) => row.id)];
    if (entityIds.length) {
      const eventResult = await readAll<EventRow>((from, to) => db.from('coliving_record_events').select('id, entity_type, entity_id, event_type, actor_name, reason, occurred_at, before_data, after_data').in('entity_id', entityIds).order('occurred_at', { ascending: false }).range(from, to));
      if (eventResult.error) setError(eventResult.error);
      setEvents(eventResult.rows);
    } else setEvents([]);
    setBusy(false);
  }, [end, start, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (view !== 'records' || !canManage) return;
    const requestedForm = searchParams.get('new');
    if (requestedForm !== 'voucher' && requestedForm !== 'gym') return;
    if (requestedForm === 'voucher') openNewVoucher();
    else openNewGym();
    setSearchParams({}, { replace: true });
  }, [canManage, searchParams, setSearchParams, view]);

  const activeVouchers = useMemo(() => vouchers.filter((row) => !row.voided_at), [vouchers]);
  const activeGymPasses = useMemo(() => gymPasses.filter((row) => !row.voided_at), [gymPasses]);
  const voucherCount = activeVouchers.reduce((sum, row) => sum + Number(row.quantity), 0);
  const greenCount = activeVouchers.filter((row) => row.coupon_color === 'green').reduce((sum, row) => sum + Number(row.quantity), 0);
  const orangeCount = activeVouchers.filter((row) => row.coupon_color === 'orange').reduce((sum, row) => sum + Number(row.quantity), 0);
  const voucherAmount = activeVouchers.reduce((sum, row) => sum + Number(row.amount_thb), 0);
  const gymCount = activeGymPasses.reduce((sum, row) => sum + Number(row.quantity), 0);
  const gymAmount = activeGymPasses.reduce((sum, row) => sum + Number(row.amount_thb), 0);
  const dayGymCount = activeGymPasses.filter((row) => row.pass_type === 'day').reduce((sum, row) => sum + Number(row.quantity), 0);
  const monthlyGymCount = activeGymPasses.filter((row) => row.pass_type === 'monthly').reduce((sum, row) => sum + Number(row.quantity), 0);
  const guestTotals = guestTypes.map((guestType) => ({
    guestType,
    vouchers: activeVouchers.filter((row) => row.guest_type === guestType).reduce((sum, row) => sum + Number(row.quantity), 0),
    gym: activeGymPasses.filter((row) => row.guest_type === guestType).reduce((sum, row) => sum + Number(row.quantity), 0),
  })).filter((row) => row.vouchers || row.gym);

  function openNewVoucher() {
    setFormMode('voucher'); setEditId(null); setVoucherForm(blankVoucher(end)); setFormError(''); setMessage('');
  }
  function openNewGym() {
    setFormMode('gym'); setEditId(null); setGymForm(blankGym(end)); setFormError(''); setMessage('');
  }
  function startVoucherEdit(row: VoucherRow) {
    setFormMode('voucher'); setEditId(row.id); setFormError(''); setMessage('');
    setVoucherForm({ ...row, quantity: Number(row.quantity), amount_thb: Number(row.amount_thb), change_reason: '' });
  }
  function startGymEdit(row: GymRow) {
    setFormMode('gym'); setEditId(row.id); setFormError(''); setMessage('');
    setGymForm({ ...row, quantity: Number(row.quantity), amount_thb: Number(row.amount_thb), change_reason: '' });
  }

  async function saveVoucher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(''); setMessage('');
    const payload = normalizeVoucherInput({
      issue_date: voucherForm.issue_date, guest_type: voucherForm.guest_type,
      coupon_color: voucherForm.coupon_color, quantity: Number(voucherForm.quantity),
      amount_thb: amountValue(String(voucherForm.amount_thb)), payment_status: voucherForm.payment_status,
      complimentary_reason: voucherForm.complimentary_reason, recipient: voucherForm.recipient, notes: voucherForm.notes,
    });
    const validation = validateVoucherInput(payload);
    if (validation) { setFormError(validation); return; }
    if (editId && !voucherForm.change_reason.trim()) { setFormError(t('Enter why this record is changing.')); return; }
    setSaving(true);
    const db = requireSupabase();
    const result = editId
      ? await db.from('coliving_meal_voucher_issues').update({ ...payload, change_reason: voucherForm.change_reason.trim() }).eq('id', editId).select('id').maybeSingle()
      : await db.from('coliving_meal_voucher_issues').insert(payload).select('id').single();
    setSaving(false);
    if (result.error) { setFormError(result.error.message); return; }
    if (!result.data) { setFormError(t('No record was changed. Refresh and check your access.')); return; }
    setFormMode(null); setEditId(null); setMessage(t(editId ? 'Co-living record updated.' : 'Voucher issue recorded.'));
    await load();
  }

  async function saveGym(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(''); setMessage('');
    const payload = normalizeGymPassInput({
      issue_date: gymForm.issue_date, guest_type: gymForm.guest_type,
      pass_type: gymForm.pass_type, quantity: Number(gymForm.quantity), amount_thb: amountValue(String(gymForm.amount_thb)),
      start_date: gymForm.start_date, end_date: gymForm.end_date, recipient: gymForm.recipient, notes: gymForm.notes,
    });
    const validation = validateGymPassInput(payload);
    if (validation) { setFormError(validation); return; }
    if (editId && !gymForm.change_reason.trim()) { setFormError(t('Enter why this record is changing.')); return; }
    setSaving(true);
    const db = requireSupabase();
    const result = editId
      ? await db.from('coliving_gym_pass_issues').update({ ...payload, change_reason: gymForm.change_reason.trim() }).eq('id', editId).select('id').maybeSingle()
      : await db.from('coliving_gym_pass_issues').insert(payload).select('id').single();
    setSaving(false);
    if (result.error) { setFormError(result.error.message); return; }
    if (!result.data) { setFormError(t('No record was changed. Refresh and check your access.')); return; }
    setFormMode(null); setEditId(null); setMessage(t(editId ? 'Co-living record updated.' : 'Gym pass issue recorded.'));
    await load();
  }

  async function voidRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!voidTarget || !voidReason.trim()) return;
    setSaving(true); setFormError('');
    const table = voidTarget.type === 'voucher' ? 'coliving_meal_voucher_issues' : 'coliving_gym_pass_issues';
    const result = await requireSupabase().from(table).update({ voided_at: new Date().toISOString(), void_reason: voidReason.trim() }).eq('id', voidTarget.id).select('id').maybeSingle();
    setSaving(false);
    if (result.error) { setFormError(result.error.message); return; }
    if (!result.data) { setFormError(t('No record was changed. Refresh and check your access.')); return; }
    setVoidTarget(null); setVoidReason(''); setMessage(t('Co-living record cancelled. It remains in the audit history.'));
    await load();
  }

  const shownVouchers = recordFilter === 'gym' ? [] : vouchers;
  const shownGymPasses = recordFilter === 'voucher' ? [] : gymPasses;
  const records = [
    ...shownVouchers.map((row) => ({ type: 'voucher' as const, id: row.id, date: row.issue_date, row })),
    ...shownGymPasses.map((row) => ({ type: 'gym' as const, id: row.id, date: row.issue_date, row })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const eventsByEntity = new Map<string, EventRow[]>();
  for (const event of events) eventsByEntity.set(event.entity_id, [...(eventsByEntity.get(event.entity_id) ?? []), event]);

  const showAnalytics = view !== 'records';
  const showRecords = view !== 'dashboard';

  return <>
    <PageTitle
      eyebrow={view === 'report' ? 'MANAGER REPORTS' : 'COLIVING OPERATIONS'}
      title={view === 'dashboard' ? 'Co-living Dashboard' : view === 'records' ? 'Co-living Records' : 'Co-living report'}
      action={view === 'dashboard' && canManage ? <div className="coliving-actions"><Link className="button coliving-entry-button coliving-entry-voucher" to="/coliving/records?new=voucher"><Ticket size={16} />{t('Record meal vouchers')}</Link><Link className="button coliving-entry-button coliving-entry-gym" to="/coliving/records?new=gym"><Dumbbell size={16} />{t('Record gym passes')}</Link></div> : view === 'records' && canManage ? <div className="coliving-actions"><button className={`button coliving-entry-button coliving-entry-voucher${formMode === 'voucher' ? ' is-active' : ''}`} type="button" aria-pressed={formMode === 'voucher'} onClick={() => { if (formMode !== 'voucher') openNewVoucher(); }}><Ticket size={16} />{t('Record meal vouchers')}{formMode === 'voucher' && <Check size={15} aria-hidden="true" />}</button><button className={`button coliving-entry-button coliving-entry-gym${formMode === 'gym' ? ' is-active' : ''}`} type="button" aria-pressed={formMode === 'gym'} onClick={() => { if (formMode !== 'gym') openNewGym(); }}><Dumbbell size={16} />{t('Record gym passes')}{formMode === 'gym' && <Check size={15} aria-hidden="true" />}</button></div> : undefined}
    />
    {error && <Notice>{error}</Notice>}
    {message && <Notice tone="success">{message}</Notice>}
    <section className="panel coliving-range">
      <span className="coliving-range-title"><CalendarRange size={18} /><span><strong>{t('Selected period')}</strong><small>{t('Saved, active records only.')}</small></span></span>
      <label>{t('From')}<input aria-label={t('From')} type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} /></label>
      <label>{t('To')}<input aria-label={t('To')} type="date" value={end} min={start} max={businessDateNow()} onChange={(event) => setEnd(event.target.value)} /></label>
    </section>

    {showAnalytics && <section className="coliving-summary-grid" aria-label={t('Co-living overview')}>
      <article className="coliving-summary-card voucher-summary">
        <header className="coliving-summary-head"><span className="coliving-summary-title"><Ticket size={17} />{t('Meal vouchers')}</span><span className="coliving-summary-total"><strong>{busy ? '—' : formatQuantity(voucherCount)}</strong><small>{t('vouchers')}</small></span></header>
        <div className="coliving-summary-stats"><div><span>{t('Green tickets')}</span><strong>{busy ? '—' : formatQuantity(greenCount)}</strong></div><div><span>{t('Orange tickets')}</span><strong>{busy ? '—' : formatQuantity(orangeCount)}</strong></div><div><span>{t('Amount')}</span><strong>{busy ? '—' : formatBaht(voucherAmount)}</strong></div></div>
      </article>
      <article className="coliving-summary-card gym-summary">
        <header className="coliving-summary-head"><span className="coliving-summary-title"><Dumbbell size={17} />{t('Gym passes')}</span><span className="coliving-summary-total"><strong>{busy ? '—' : formatQuantity(gymCount)}</strong><small>{t('passes')}</small></span></header>
        <div className="coliving-summary-stats"><div><span>{t('Day passes')}</span><strong>{busy ? '—' : formatQuantity(dayGymCount)}</strong></div><div><span>{t('Monthly passes')}</span><strong>{busy ? '—' : formatQuantity(monthlyGymCount)}</strong></div><div><span>{t('Amount')}</span><strong>{busy ? '—' : formatBaht(gymAmount)}</strong></div></div>
      </article>
    </section>}

    {showAnalytics && <div className="coliving-dashboard-grid">
      <section className="panel coliving-table-panel"><div className="panel-head"><div><span className="eyebrow">{t('ISSUED BY GUEST TYPE')}</span><h2>{t('By guest type')}</h2></div><Users size={18} /></div>
        {busy ? <LoadingState label="Loading your workspace…" /> : guestTotals.length === 0 ? <ColivingEmptyState title={t('No Co-living records in this period')} action={view === 'dashboard' && canManage ? { to: '/coliving/records', label: t('Open records') } : undefined} /> : <div className="report-table-wrap"><table className="report-data-table"><thead><tr><th>{t('Guest type')}</th><th>{t('Meal vouchers')}</th><th>{t('Gym passes')}</th></tr></thead><tbody>{guestTotals.map((row) => <tr key={row.guestType}><th scope="row">{t(row.guestType)}</th><td>{formatQuantity(row.vouchers)}</td><td>{formatQuantity(row.gym)}</td></tr>)}</tbody></table></div>}
      </section>
    </div>}

    {view === 'records' && canManage && formMode && <section className="panel coliving-form-panel">
      <div className="panel-head"><div><span className="eyebrow">{editId ? t('CORRECT A SAVED RECORD') : formMode === 'voucher' ? t('NEW MEAL VOUCHER ISSUE') : t('NEW GYM PASS ISSUE')}</span><h2>{editId ? t('Update this issue') : formMode === 'voucher' ? t('Record meal vouchers') : t('Record gym passes')}</h2></div><button className="button button-quiet" type="button" onClick={() => { setFormMode(null); setEditId(null); }} disabled={saving}>{t('Close form')}</button></div>
      <div className="coliving-form-layout">
      {formMode === 'voucher' ? <form className="data-form coliving-form" onSubmit={(event) => void saveVoucher(event)}>
        <div className="form-two-cols"><label>{t('Issue date')}<input type="date" required max={businessDateNow()} value={voucherForm.issue_date} onChange={(event) => setVoucherForm((old) => ({ ...old, issue_date: event.target.value }))} /></label><label>{t('Guest type')}<select value={voucherForm.guest_type} onChange={(event) => { const guestType = event.target.value as GuestType; const color = suggestCouponColor(guestType); setVoucherForm((old) => ({ ...old, guest_type: guestType, coupon_color: color, amount_thb: old.payment_status === 'complimentary' ? 0 : suggestedVoucherAmount(color, Number(old.quantity)) })); }}>{guestTypes.map((type) => <option key={type} value={type}>{t(type)}</option>)}</select></label></div>
        <div className="coliving-field"><span>{t('Coupon color')}</span><div className="coliving-choice-row">{(['green', 'orange'] as CouponColor[]).map((color) => {
          const selected = voucherForm.coupon_color === color;
          return <button key={color} type="button" aria-pressed={selected} className={`coliving-choice coliving-choice-${color}${selected ? ' selected' : ''}`} onClick={() => setVoucherForm((old) => ({ ...old, coupon_color: color, amount_thb: old.payment_status === 'complimentary' ? 0 : suggestedVoucherAmount(color, Number(old.quantity)) }))}><span>{color === 'green' ? t('Green ticket') : t('Orange ticket')}</span>{selected && <Check size={15} aria-hidden="true" />}</button>;
        })}</div></div>
        {voucherForm.coupon_color === 'green' && <div className="coliving-field"><span>{t('Green packages')}</span><div className="coliving-choice-row coliving-package-row">{greenPackages.map((pack) => {
          const selected = voucherForm.payment_status === 'paid' && Number(voucherForm.quantity) === pack.quantity && Number(voucherForm.amount_thb) === pack.amount;
          return <button key={pack.quantity} type="button" aria-pressed={selected} className={`coliving-package-card${selected ? ' selected' : ''}`} onClick={() => setVoucherForm((old) => ({ ...old, quantity: pack.quantity, amount_thb: old.payment_status === 'complimentary' ? 0 : pack.amount }))}><span className="coliving-package-quantity"><strong>{pack.quantity}</strong><small>{t('vouchers')}</small></span><span className="coliving-package-price"><small>{t('Package price')}</small><strong>{formatBaht(pack.amount)}</strong></span>{selected && <Check className="coliving-package-check" size={16} aria-hidden="true" />}</button>;
        })}</div></div>}
        <div className="form-two-cols"><label>{t('Vouchers issued')}<input type="number" inputMode="numeric" min="1" step="1" max="100000" required value={voucherForm.quantity} onChange={(event) => { const quantity = Number(event.target.value); setVoucherForm((old) => ({ ...old, quantity, amount_thb: old.payment_status === 'complimentary' ? 0 : suggestedVoucherAmount(old.coupon_color, quantity) })); }} /></label><label>{t('Payment')}<select value={voucherForm.payment_status} onChange={(event) => { const payment_status = event.target.value as PaymentStatus; setVoucherForm((old) => ({ ...old, payment_status, amount_thb: payment_status === 'complimentary' ? 0 : suggestedVoucherAmount(old.coupon_color, Number(old.quantity)), complimentary_reason: payment_status === 'complimentary' ? old.complimentary_reason : null })); }}><option value="paid">{t('Paid')}</option><option value="complimentary">{t('Complimentary')}</option></select></label></div>
        {voucherForm.payment_status === 'complimentary' && <label>{t('Complimentary reason')}<input required maxLength={300} value={voucherForm.complimentary_reason ?? ''} onChange={(event) => setVoucherForm((old) => ({ ...old, complimentary_reason: event.target.value }))} /></label>}
        <div className="form-two-cols"><label>{t('Actual amount received (THB)')}<input type="number" inputMode="decimal" min="0" step="0.01" required readOnly={voucherForm.payment_status === 'complimentary'} value={voucherForm.payment_status === 'complimentary' ? 0 : voucherForm.amount_thb} onChange={(event) => setVoucherForm((old) => ({ ...old, amount_thb: Number(event.target.value) }))} /><small>{t('Suggested package amount; adjust to the actual amount.')}</small></label><label>{t('Recipient name, room or project')}<input maxLength={160} placeholder={t('Optional; can be added later')} value={voucherForm.recipient ?? ''} onChange={(event) => setVoucherForm((old) => ({ ...old, recipient: event.target.value }))} /></label></div>
        <label>{t('Notes')}<textarea maxLength={2000} value={voucherForm.notes ?? ''} onChange={(event) => setVoucherForm((old) => ({ ...old, notes: event.target.value }))} /></label>
        {editId && <label>{t('Reason for this change')}<input required maxLength={500} value={voucherForm.change_reason} onChange={(event) => setVoucherForm((old) => ({ ...old, change_reason: event.target.value }))} /></label>}
        {formError && <Notice>{formError}</Notice>}
        <button className="button button-primary" disabled={saving}><Check size={16} />{saving ? t('Saving…') : editId ? t('Save changes') : t('Record voucher issue')}</button>
      </form> : <form className="data-form coliving-form" onSubmit={(event) => void saveGym(event)}>
        <div className="form-two-cols"><label>{t('Issue date')}<input type="date" required max={businessDateNow()} value={gymForm.issue_date} onChange={(event) => setGymForm((old) => ({ ...old, issue_date: event.target.value }))} /></label><label>{t('Guest type')}<select value={gymForm.guest_type} onChange={(event) => setGymForm((old) => ({ ...old, guest_type: event.target.value as GuestType }))}>{guestTypes.map((type) => <option key={type} value={type}>{t(type)}</option>)}</select></label></div>
        <div className="form-two-cols"><label>{t('Pass type')}<select value={gymForm.pass_type} onChange={(event) => { const pass_type = event.target.value as GymPassType; const startDate = pass_type === 'monthly' ? (gymForm.start_date ?? gymForm.issue_date) : null; setGymForm((old) => ({ ...old, pass_type, start_date: startDate, end_date: pass_type === 'monthly' && startDate ? defaultMonthlyEndDate(startDate) : null })); }}><option value="day">{t('Day pass')}</option><option value="monthly">{t('Monthly pass')}</option></select></label><label>{t('Quantity')}<input type="number" inputMode="numeric" min="1" step="1" max="100000" required value={gymForm.quantity} onChange={(event) => setGymForm((old) => ({ ...old, quantity: Number(event.target.value) }))} /></label></div>
        {gymForm.pass_type === 'monthly' && <div className="form-two-cols"><label>{t('Valid from')}<input type="date" required value={gymForm.start_date ?? ''} onChange={(event) => setGymForm((old) => ({ ...old, start_date: event.target.value, end_date: defaultMonthlyEndDate(event.target.value) }))} /></label><label>{t('Valid through')}<input type="date" required min={gymForm.start_date ?? undefined} value={gymForm.end_date ?? ''} onChange={(event) => setGymForm((old) => ({ ...old, end_date: event.target.value }))} /></label></div>}
        <div className="form-two-cols"><label>{t('Actual amount received (THB)')}<input type="number" inputMode="decimal" min="0" step="0.01" required value={gymForm.amount_thb} onChange={(event) => setGymForm((old) => ({ ...old, amount_thb: Number(event.target.value) }))} /></label><label>{t('Recipient name, room or project')}<input maxLength={160} placeholder={t('Optional; can be added later')} value={gymForm.recipient ?? ''} onChange={(event) => setGymForm((old) => ({ ...old, recipient: event.target.value }))} /></label></div>
        <label>{t('Notes')}<textarea maxLength={2000} value={gymForm.notes ?? ''} onChange={(event) => setGymForm((old) => ({ ...old, notes: event.target.value }))} /></label>
        {editId && <label>{t('Reason for this change')}<input required maxLength={500} value={gymForm.change_reason} onChange={(event) => setGymForm((old) => ({ ...old, change_reason: event.target.value }))} /></label>}
        {formError && <Notice>{formError}</Notice>}
        <button className="button button-primary" disabled={saving}><Check size={16} />{saving ? t('Saving…') : editId ? t('Save changes') : t('Record gym pass issue')}</button>
      </form>}
      <ColivingEntrySummary mode={formMode} voucher={voucherForm} gym={gymForm} t={t} />
      </div>
    </section>}

    {view === 'records' && canManage && voidTarget && <section className="panel coliving-void-panel"><form className="data-form" onSubmit={(event) => void voidRecord(event)}><div className="panel-head"><div><span className="eyebrow">{t('CANCELLATION IS AUDITED')}</span><h2>{t('Cancel this record?')}</h2></div></div><label>{t('Cancellation reason')}<input required maxLength={500} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} /></label>{formError && <Notice>{formError}</Notice>}<div className="coliving-actions"><button className="button button-remove" disabled={saving}><Trash2 size={15} />{t('Confirm cancellation')}</button><button className="button button-quiet" type="button" onClick={() => { setVoidTarget(null); setVoidReason(''); setFormError(''); }}>{t('Keep record')}</button></div></form></section>}

    {showRecords && <section className="panel coliving-record-panel">
      <div className="panel-head"><div><span className="eyebrow">{t('SOURCE RECORDS AND HISTORY')}</span><h2>{t('Issued records')}</h2></div><span className="count-chip">{records.length} {t('records')}</span></div>
      <div className="coliving-record-filters" role="group" aria-label={t('Filter record type')}>{(['all', 'voucher', 'gym'] as const).map((filter) => <button type="button" key={filter} aria-pressed={recordFilter === filter} className={`button${recordFilter === filter ? ' active' : ''}`} onClick={() => setRecordFilter(filter)}>{t(filter === 'all' ? 'All records' : filter === 'voucher' ? 'Meal vouchers' : 'Gym passes')}</button>)}</div>
      {busy ? <LoadingState /> : records.length === 0 ? <ColivingEmptyState title={t('No Co-living records in this period')} /> : <div className="coliving-record-list">
        {records.map(({ type, id, date, row }) => {
          const isVoucher = type === 'voucher';
          const voucher = isVoucher ? row as VoucherRow : null;
          const gym = !isVoucher ? row as GymRow : null;
          const history = eventsByEntity.get(id) ?? [];
          const voided = Boolean(row.voided_at);
          return <details className={`coliving-record${voided ? ' coliving-record-voided' : ''}`} key={id}>
            <summary><span className={`coliving-record-icon ${isVoucher ? 'voucher' : 'gym'}`}>{isVoucher ? <Ticket size={17} /> : <Dumbbell size={17} />}</span><span className="coliving-record-main"><strong>{isVoucher ? t('Meal vouchers') : t('Gym pass')} · {t(row.guest_type)}</strong><small>{formatDate(date)} · {row.recipient?.trim() || t('Recipient not added yet')} · {t('Entered by')} {row.created_by_name}</small></span><span className="coliving-record-quantity"><strong>{formatQuantity(row.quantity)}</strong><small>{isVoucher ? t('vouchers') : t('passes')}</small></span><strong className="coliving-record-amount">{formatBaht(row.amount_thb)}</strong><span className={`coliving-status${voided ? ' is-voided' : ''}`}>{voided ? t('Cancelled') : isVoucher ? t(voucher?.coupon_color === 'green' ? 'Green' : 'Orange') : t(gym?.pass_type === 'monthly' ? 'Monthly' : 'Day')}</span></summary>
            <div className="coliving-record-details">
              <div className="coliving-record-info"><span>{t('Actual amount')}: <strong>{formatBaht(row.amount_thb)}</strong></span>{voucher && <span>{t('Payment')}: <strong>{t(voucher.payment_status)}</strong></span>}{voucher?.complimentary_reason && <span>{t('Complimentary reason')}: <strong>{voucher.complimentary_reason}</strong></span>}{gym?.pass_type === 'monthly' && <span>{t('Valid dates')}: <strong>{gym.start_date ? formatDate(gym.start_date) : ''} – {gym.end_date ? formatDate(gym.end_date) : ''}</strong></span>}{row.notes && <span>{t('Notes')}: <strong>{row.notes}</strong></span>}{voided && <span>{t('Cancelled by')}: <strong>{row.voided_by_name} · {row.void_reason}</strong></span>}</div>
              {view === 'records' && canManage && !voided && <div className="coliving-actions"><button className="button button-quiet button-small" onClick={(event) => { event.preventDefault(); isVoucher ? startVoucherEdit(voucher!) : startGymEdit(gym!); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Edit3 size={14} />{t('Edit')}</button><button className="button button-remove button-small" onClick={(event) => { event.preventDefault(); setVoidTarget({ type, id }); setVoidReason(''); setFormError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Trash2 size={14} />{t('Cancel record')}</button></div>}
              <div className="coliving-history"><strong>{t('Change history')}</strong>{history.length ? history.map((event) => <article key={event.id}><span className={`coliving-history-mark ${event.event_type}`} /> <div><strong>{t(event.event_type)} · {event.actor_name}</strong><small>{new Date(event.occurred_at).toLocaleString()} · {event.reason}</small>{event.event_type !== 'created' && event.before_data && <small>{t('Before')}: {JSON.stringify(event.before_data)}<br />{t('After')}: {JSON.stringify(event.after_data)}</small>}</div></article>) : <small>{t('No history available.')}</small>}</div>
            </div>
          </details>;
        })}
      </div>}
    </section>}
  </>;
}
