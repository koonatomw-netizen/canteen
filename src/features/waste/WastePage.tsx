import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Archive, PackageOpen, RotateCcw, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { PhotoAttachmentsPicker } from '../../components/PhotoAttachmentsPicker';
import { DraftStatus } from '../../components/DraftStatus';
import { formatBusinessDate, businessDateNow } from '../../lib/dates';
import { formatFoodVariant, formatQuantity } from '../../lib/format';
import { attachPrivatePhotos, signPrivatePhotos } from '../../lib/photoAttachments';
import { requireSupabase } from '../../lib/supabase';
import { readLocalDraft, useLocalDraft } from '../../lib/localDrafts';
import { useAuth } from '../auth/AuthContext';
import { isReadOnlyDemo } from '../auth/permissions';
import { useI18n } from '../../lib/i18n';
import { getStockRecordMode, type StockRecordMode } from './workflow';

interface StockRow { id: string; menu_id: string | null; menu_name: string; production_date: string; expiry_date: string; quantity_remaining: number; }
interface Reason { id: string; name: string; active: boolean; }
interface BatchName { menu_name_snapshot: string; meat_options: { name: string } | null; production_date: string; }
interface WasteRow { id: string; quantity: number; reason: string; notes: string | null; waste_date: string; photo_url: string | null; deleted_at: string | null; stock_ledger_preserved_on_archive: boolean; archive_review_status: 'unverified' | 'verified_waste'; waste_record_photos?: { file_path: string }[]; photoUrls?: string[]; production_batches: BatchName | null; }
interface StockOutRow { id: string; quantity: number; reason: string; notes: string | null; removal_date: string; deleted_at: string | null; production_batches: BatchName | null; }

type RecordMode = StockRecordMode;
type CurrentDayStatus = 'open' | 'closed' | 'unknown';
interface WasteFormDraft { batchId: string; quantity: string; reason: string; notes: string; removalDate: string; }

async function readClosingSnapshot(businessDate: string): Promise<{ currentStatus: CurrentDayStatus; latestClosedDate: string | null; error: string }> {
  const db = requireSupabase();
  const [currentResult, latestResult] = await Promise.all([
    db.from('daily_closings').select('status, version').eq('business_date', businessDate).order('version', { ascending: false }).limit(1).maybeSingle(),
    db.from('daily_closings').select('business_date').eq('status', 'closed').order('business_date', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const error = currentResult.error?.message ?? latestResult.error?.message ?? '';
  return {
    currentStatus: error ? 'unknown' : currentResult.data?.status === 'closed' ? 'closed' : 'open',
    latestClosedDate: latestResult.data?.business_date ?? null,
    error,
  };
}

function isWasteFormDraft(value: unknown): value is WasteFormDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return ['batchId', 'quantity', 'reason', 'notes', 'removalDate'].every((key) => typeof draft[key] === 'string');
}

export function WastePage({ embedded = false }: { embedded?: boolean }) {
  const { member } = useAuth();
  const { t } = useI18n();
  const canEdit = member?.role === 'admin' || member?.role === 'front';
  const isAuditor = isReadOnlyDemo(member?.role);
  const showWriteControls = canEdit || isAuditor;
  const [params] = useSearchParams();
  const [historyMode, setHistoryMode] = useState<RecordMode>('waste');
  const [currentBusinessDate, setCurrentBusinessDate] = useState(businessDateNow());
  const [currentDayStatus, setCurrentDayStatus] = useState<CurrentDayStatus>('unknown');
  const [stock, setStock] = useState<StockRow[]>([]);
  const [waste, setWaste] = useState<WasteRow[]>([]);
  const [stockOuts, setStockOuts] = useState<StockOutRow[]>([]);
  const [wasteReasons, setWasteReasons] = useState<Reason[]>([]);
  const [stockOutReasons, setStockOutReasons] = useState<Reason[]>([]);
  const [latestClosedDate, setLatestClosedDate] = useState<string | null>(null);
  const [batchId, setBatchId] = useState(params.get('batch') ?? '');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [removalDate, setRemovalDate] = useState(businessDateNow());
  const [photos, setPhotos] = useState<File[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [success, setSuccess] = useState('');
  const mode: RecordMode = canEdit
    ? getStockRecordMode(currentDayStatus === 'closed' ? 'closed' : null)
    : historyMode;
  const draftKey = `canteen.draft.waste:${member?.user_id ?? 'local'}:${mode}`;
  const { status: draftStatus, clearDraft } = useLocalDraft<WasteFormDraft>(draftKey, { batchId, quantity, reason, notes, removalDate }, (stored) => {
    if (!isWasteFormDraft(stored) || stored.removalDate !== currentBusinessDate) return;
    if (!params.get('batch')) setBatchId(stored.batchId);
    setQuantity(stored.quantity); setReason(stored.reason); setNotes(stored.notes); setRemovalDate(stored.removalDate);
  }, (value) => Boolean(value.quantity.trim() || value.notes.trim()));

  async function load() {
    setBusy(true); setError(''); setStatusError('');
    const db = requireSupabase();
    const [stockResult, wasteResult, wasteReasonResult, stockOutReasonResult, stockOutResult, closingSnapshot] = await Promise.all([
      db.from('v_stock_by_batch').select('id, menu_id, menu_name, production_date, expiry_date, quantity_remaining').gt('quantity_remaining', 0).order('expiry_date'),
      db.from('waste_records').select('id, quantity, reason, notes, waste_date, photo_url, deleted_at, stock_ledger_preserved_on_archive, archive_review_status, production_batches(menu_name_snapshot, meat_options(name), production_date), waste_record_photos(file_path)').order('waste_date', { ascending: false }).limit(60),
      db.from('waste_reasons').select('id, name, active').eq('active', true).order('name'),
      db.from('stock_out_reasons').select('id, name, active').eq('active', true).order('name'),
      db.from('post_close_stock_outs').select('id, quantity, reason, notes, removal_date, deleted_at, production_batches(menu_name_snapshot, meat_options(name), production_date)').order('removal_date', { ascending: false }).limit(60),
      readClosingSnapshot(currentBusinessDate),
    ]);
    const firstError = [stockResult, wasteResult, wasteReasonResult, stockOutReasonResult, stockOutResult].find((result) => result.error)?.error;
    if (firstError) setError(firstError.message);
    setStatusError(closingSnapshot.error);
    const available = (stockResult.data ?? []) as StockRow[];
    const records = (wasteResult.data ?? []) as unknown as WasteRow[];
    const pathsByRecord = records.map((record) => [...new Set([...(record.waste_record_photos ?? []).map((photo) => photo.file_path), ...(record.photo_url ? [record.photo_url] : [])])]);
    const signedUrls = await signPrivatePhotos(db, pathsByRecord.flat());
    setStock(available);
    setWaste(records.map((record, index) => ({ ...record, photoUrls: pathsByRecord[index]!.map((path) => signedUrls[path]).filter(Boolean) })));
    setWasteReasons((wasteReasonResult.data ?? []) as Reason[]);
    setStockOutReasons((stockOutReasonResult.data ?? []) as Reason[]);
    setStockOuts((stockOutResult.data ?? []) as unknown as StockOutRow[]);
    setLatestClosedDate(closingSnapshot.latestClosedDate);
    setCurrentDayStatus(closingSnapshot.currentStatus);
    setRemovalDate((current) => closingSnapshot.latestClosedDate && current < closingSnapshot.latestClosedDate ? closingSnapshot.latestClosedDate : current);
    setBatchId((current) => available.some((row) => row.id === current) ? current : available[0]?.id ?? '');
    setBusy(false);
  }
  useEffect(() => { void load(); }, [currentBusinessDate]);

  useEffect(() => {
    let active = true;
    const refreshDayStatus = async () => {
      if (document.visibilityState === 'hidden') return;
      const date = businessDateNow();
      setCurrentBusinessDate(date);
      const snapshot = await readClosingSnapshot(date);
      if (!active) return;
      setCurrentDayStatus(snapshot.currentStatus);
      setLatestClosedDate(snapshot.latestClosedDate);
      setStatusError(snapshot.error);
    };
    const onVisibilityChange = () => { if (!document.hidden) void refreshDayStatus(); };
    const timer = window.setInterval(() => { void refreshDayStatus(); }, 30_000);
    window.addEventListener('focus', refreshDayStatus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshDayStatus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const selectedBatch = stock.find((row) => row.id === batchId);
  const requestedQuantity = Number(quantity);
  const selectedAvailability = Number(selectedBatch?.quantity_remaining ?? 0);
  const quantityExceedsStock = quantity.trim() !== '' && Number.isFinite(requestedQuantity) && requestedQuantity > selectedAvailability;
  const activeReasons = mode === 'waste' ? wasteReasons : stockOutReasons;
  const selectedReasonIsOther = reason.trim().toLowerCase() === 'other';
  const previousMode = useRef(mode);
  const previousBusinessDate = useRef(currentBusinessDate);

  useEffect(() => {
    if (previousBusinessDate.current === currentBusinessDate) return;
    previousBusinessDate.current = currentBusinessDate;
    setQuantity('');
    setNotes('');
    setPhotos([]);
    setRemovalDate(currentBusinessDate);
    setShowArchived(false);
  }, [currentBusinessDate]);

  useEffect(() => {
    if (previousMode.current === mode) return;
    previousMode.current = mode;
    setShowArchived(false);
    setPhotos([]);
    const savedDraft = readLocalDraft<unknown>(draftKey);
    if (isWasteFormDraft(savedDraft) && savedDraft.removalDate === currentBusinessDate) {
      if (!params.get('batch')) setBatchId(savedDraft.batchId);
      setQuantity(savedDraft.quantity);
      setReason(savedDraft.reason);
      setNotes(savedDraft.notes);
      setRemovalDate(savedDraft.removalDate);
      return;
    }
    setQuantity('');
    setNotes('');
    setReason(activeReasons[0]?.name ?? '');
  }, [mode, draftKey, currentBusinessDate, activeReasons, params]);

  useEffect(() => {
    if (activeReasons.length && !activeReasons.some((item) => item.name === reason)) setReason(activeReasons[0]!.name);
  }, [mode, activeReasons, reason]);

  useEffect(() => {
    if (currentDayStatus === 'closed') setRemovalDate(currentBusinessDate);
  }, [currentDayStatus, currentBusinessDate]);

  async function recordWaste(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    if (!canEdit) { setSaving(false); return; }
    if (currentDayStatus !== 'open' || mode !== 'waste') {
      setError(currentDayStatus === 'unknown' ? t('Could not confirm whether today has been closed. Refresh and try again.') : t('This day is closed. Record a post-close removal instead.'));
      setSaving(false); return;
    }
    const db = requireSupabase();
    if (!selectedBatch || !Number.isInteger(requestedQuantity) || requestedQuantity < 1) {
      setError(t('Enter a whole number of boxes above zero.')); setSaving(false); return;
    }
    const { data: balance, error: balanceError } = await db.from('v_stock_by_batch').select('quantity_remaining').eq('id', batchId).maybeSingle();
    if (balanceError) { setError(t('Stock changed while you were recording. Refresh the batch and enter no more than the available quantity.')); setSaving(false); return; }
    const currentAvailability = Number(balance?.quantity_remaining ?? 0);
    if (!balance || requestedQuantity > currentAvailability) {
      setStock((current) => current.filter((row) => row.id !== batchId || currentAvailability > 0).map((row) => row.id === batchId ? { ...row, quantity_remaining: currentAvailability } : row));
      setError(!currentAvailability ? t('This batch has no stock available.') : t('Requested quantity cannot exceed the available stock.'));
      setSaving(false); return;
    }
    const { data, error: insertError } = await db.from('waste_records').insert({
      production_batch_id: batchId, quantity: requestedQuantity, reason, notes: notes.trim() || null,
    }).select('id').single();
    if (insertError) {
      setError(insertError.message.includes('negative stock') || insertError.message.includes('boxes remain')
        ? t('Stock changed while you were recording. Refresh the batch and enter no more than the available quantity.')
        : insertError.message);
      setSaving(false); return;
    }
    let photoError = '';
    if (photos.length) {
      try { await attachPrivatePhotos(db, 'waste', data.id, photos); }
      catch (uploadError) { photoError = `Waste was saved, but its photos could not be attached: ${uploadError instanceof Error ? uploadError.message : 'unknown error'}`; }
    }
    if (photoError) setError(photoError); else setSuccess(`${quantity} ${Number(quantity) === 1 ? 'box' : 'boxes'} recorded as waste: ${reason}.`);
    setQuantity(''); setNotes(''); setPhotos([]); clearDraft(); await load(); setSaving(false);
  }

  async function recordStockOut(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    if (!canEdit) { setSaving(false); return; }
    if (currentDayStatus !== 'closed' || mode !== 'stock-out') {
      setError(currentDayStatus === 'unknown' ? t('Could not confirm whether today has been closed. Refresh and try again.') : t('Close this day before recording a post-close removal.'));
      setSaving(false); return;
    }
    const db = requireSupabase();
    if (!selectedBatch || !Number.isInteger(requestedQuantity) || requestedQuantity < 1) {
      setError(t('Enter a whole number of boxes above zero.')); setSaving(false); return;
    }
    const { data: balance, error: balanceError } = await db.from('v_stock_by_batch').select('quantity_remaining').eq('id', batchId).maybeSingle();
    if (balanceError) { setError(t('Stock changed while you were recording. Refresh the batch and enter no more than the available quantity.')); setSaving(false); return; }
    const currentAvailability = Number(balance?.quantity_remaining ?? 0);
    if (!balance || requestedQuantity > currentAvailability) {
      setStock((current) => current.filter((row) => row.id !== batchId || currentAvailability > 0).map((row) => row.id === batchId ? { ...row, quantity_remaining: currentAvailability } : row));
      setError(!currentAvailability ? t('This batch has no stock available.') : t('Requested quantity cannot exceed the available stock.'));
      setSaving(false); return;
    }
    const { error: insertError } = await db.from('post_close_stock_outs').insert({
      production_batch_id: batchId, quantity: requestedQuantity, reason, notes: notes.trim() || null, removal_date: removalDate,
    });
    if (insertError) setError(insertError.message.includes('negative stock') || insertError.message.includes('boxes remain')
      ? t('Stock changed while you were recording. Refresh the batch and enter no more than the available quantity.')
      : insertError.message);
    else { setSuccess(`${quantity} ${Number(quantity) === 1 ? 'box' : 'boxes'} removed from stock. It is excluded from waste totals.`); setQuantity(''); setNotes(''); clearDraft(); await load(); }
    setSaving(false);
  }

  async function archiveWaste(record: WasteRow) {
    if (!canEdit) return;
    if (record.deleted_at && record.stock_ledger_preserved_on_archive) {
      setError(t('This stock-preserving correction cannot be restored from Waste history.'));
      return;
    }
    if (!record.deleted_at && !window.confirm('Archive this waste record? Its boxes will be returned to the batch and the change will be audited.')) return;
    const { error: updateError } = await requireSupabase().from('waste_records').update({ deleted_at: record.deleted_at ? null : new Date().toISOString() }).eq('id', record.id);
    if (updateError) setError(updateError.message); else { setError(''); setSuccess(record.deleted_at ? 'Waste record restored.' : 'Waste record archived and stock returned.'); await load(); }
  }

  async function archiveStockOut(record: StockOutRow) {
    if (!canEdit) return;
    if (!record.deleted_at && !window.confirm('Archive this removal? Its quantity will be returned to current stock and the change will be audited.')) return;
    const { error: updateError } = await requireSupabase().from('post_close_stock_outs').update({ deleted_at: record.deleted_at ? null : new Date().toISOString() }).eq('id', record.id);
    if (updateError) setError(updateError.message); else { setError(''); setSuccess(record.deleted_at ? 'Removal restored and deducted from current stock again.' : 'Removal archived and returned to current stock.'); await load(); }
  }

  const visibleWaste = showWriteControls ? waste.filter((row) => Boolean(row.deleted_at) === showArchived) : waste;
  const visibleStockOuts = showWriteControls ? stockOuts.filter((row) => Boolean(row.deleted_at) === showArchived) : stockOuts;
  const historyEmpty = mode === 'waste' ? visibleWaste.length === 0 : visibleStockOuts.length === 0;

  return <>
    {!embedded && <PageTitle eyebrow="ACCOUNT FOR EVERY BOX" title="Waste & stock out" detail={canEdit ? 'Record food that was discarded as Waste, or record food taken from stock after the day was closed.' : isAuditor ? t('View-only demo: changes are disabled.') : 'Review waste and after-close stock removal records. This account cannot change them.'} />}
    {error && <Notice>{error}</Notice>}{statusError && <Notice>{statusError}</Notice>}{success && <Notice tone="success">{success}</Notice>}
    {canEdit ? <section className={`record-day-status ${currentDayStatus}`} aria-live="polite">
      <span className="record-day-status-icon">{mode === 'stock-out' ? <PackageOpen size={20} /> : <Trash2 size={20} />}</span>
      <div className="record-day-status-copy">
        <span className="eyebrow">{t(currentDayStatus === 'closed' ? 'DAY CLOSED' : currentDayStatus === 'open' ? 'DAY OPEN' : 'CHECKING DAY STATUS')}</span>
        <h2>{t(mode === 'waste' ? 'Food discarded' : 'Taken after closing')}</h2>
        <p>{t(currentDayStatus === 'closed' ? 'This day is closed. Record food taken out here.' : currentDayStatus === 'open' ? 'Record discarded food during the open day.' : 'Checking the day status before allowing a stock change.')}</p>
      </div>
      <span className="record-day-date">{formatBusinessDate(currentBusinessDate)}</span>
    </section> : <section className="record-mode-selector" aria-labelledby="record-mode-title">
      <div className="record-mode-heading">
        <span className="eyebrow">{t('RECORD HISTORY')}</span>
        <h2 id="record-mode-title">{t('Choose a record type to review.')}</h2>
      </div>
      <div className="record-mode-options" role="group" aria-label={t('Choose a stock record type')}>
        <button type="button" aria-pressed={mode === 'waste'} className={`record-mode-option waste${mode === 'waste' ? ' active' : ''}`} onClick={() => { setHistoryMode('waste'); setShowArchived(false); }}>
          <span className="record-mode-icon"><Trash2 size={20} /></span>
          <span className="record-mode-copy"><strong>{t('Food discarded')}</strong><small>{t('Waste history')}</small><span className="record-mode-impact">{t('Counts as waste')}</span></span>
          <span className="record-mode-check" aria-hidden="true">{mode === 'waste' ? '✓' : ''}</span>
        </button>
        <button type="button" aria-pressed={mode === 'stock-out'} className={`record-mode-option stock-out${mode === 'stock-out' ? ' active' : ''}`} onClick={() => { setHistoryMode('stock-out'); setShowArchived(false); }}>
          <span className="record-mode-icon"><PackageOpen size={20} /></span>
          <span className="record-mode-copy"><strong>{t('Taken after closing')}</strong><small>{t('After-close removals')}</small><span className="record-mode-impact">{t('Stock out, not waste')}</span></span>
          <span className="record-mode-check" aria-hidden="true">{mode === 'stock-out' ? '✓' : ''}</span>
        </button>
      </div>
    </section>}
    <div className="workflow-grid two-panel-grid">
      {showWriteControls && <section className="panel workflow-form-panel"><div className="panel-head"><div><span className="eyebrow">{t(mode === 'waste' ? 'CONFIRM WHAT WAS DISCARDED' : 'RECORD FOOD LEAVING STOCK')}</span><h2>{t(mode === 'waste' ? 'What went to waste?' : 'What was taken after closing?')}</h2></div><span className={`form-panel-icon ${mode === 'waste' ? 'peach' : 'green'}`}>{mode === 'waste' ? <Trash2 size={20} /> : <PackageOpen size={20} />}</span></div>
        {busy ? <LoadingState label="Checking available batches…" /> : canEdit && currentDayStatus === 'unknown' ? <EmptyState title={t('Could not confirm day status')} detail={t('Reconnect and refresh before recording a stock change.')} /> : stock.length === 0 ? <EmptyState title="No stock to record against" detail="Once food has been produced, you can record a batch-specific stock change here." /> : mode === 'stock-out' && !latestClosedDate ? <EmptyState title="Close a day first" detail="After the first daily closing, staff can record food taken from stock without changing that closing count." /> : <form className="data-form" onSubmit={mode === 'waste' ? recordWaste : recordStockOut}>
          <label>{t('Food batch')}<select required value={batchId} disabled={!canEdit} onChange={(event) => setBatchId(event.target.value)}>{stock.map((row) => <option key={row.id} value={row.id}>{row.menu_name} · {formatBusinessDate(row.production_date)} · {row.quantity_remaining} {t('left')}</option>)}</select></label>
          <div className="form-two-cols"><label>{t(mode === 'waste' ? 'Boxes discarded' : 'Boxes taken')}<input required type="number" min="1" max={selectedAvailability || undefined} step="1" inputMode="numeric" placeholder={t('e.g. 2')} value={quantity} disabled={!canEdit} aria-invalid={quantityExceedsStock} onChange={(event) => setQuantity(event.target.value)} /><small className="field-help">{t('Available in this batch:')} {formatQuantity(selectedAvailability)} {t('boxes')}</small>{quantityExceedsStock && <small className="field-error" role="alert">{t('Requested quantity cannot exceed the available stock.')}</small>}</label><label>{t('Reason')}<select required value={reason} disabled={!canEdit} onChange={(event) => setReason(event.target.value)}>{activeReasons.map((item) => <option key={item.id} value={item.name}>{t(item.name)}</option>)}</select></label></div>
          {mode === 'stock-out' && <label>{t('Date removed')}<input type="date" required min={latestClosedDate ?? undefined} max={currentBusinessDate} value={removalDate} disabled={!canEdit} onChange={(event) => setRemovalDate(event.target.value)} /><small className="field-help">{t('Use today for a late pickup today. Earlier dates than the latest closing are blocked to protect completed counts.')}</small></label>}
          <label>{t('Note')} {selectedReasonIsOther ? <span className="required-label">{t('REQUIRED FOR OTHER')}</span> : <span className="optional-label">{t('OPTIONAL')}</span>}<textarea rows={2} required={selectedReasonIsOther} placeholder={t(mode === 'waste' ? 'Add context if it would help the next shift' : 'For example, owner’s friend picked up a meal box')} value={notes} disabled={!canEdit} onChange={(event) => setNotes(event.target.value)} /></label>
          {mode === 'waste' && <PhotoAttachmentsPicker files={photos} onChange={setPhotos} disabled={!canEdit} label={photos.length ? `${photos.length} ${t('photos selected')}` : t('Add photos')} hint={t('Optional · private · compressed before upload')} />}
          {canEdit && <DraftStatus status={draftStatus} photosNotSaved={mode === 'waste'} />}
          <button className="button button-primary" disabled={!canEdit || saving || !selectedBatch || !reason || quantityExceedsStock || (mode === 'stock-out' && !latestClosedDate)}>{mode === 'waste' ? <Trash2 size={17} /> : <PackageOpen size={17} />}{saving ? t('Saving…') : t(mode === 'waste' ? 'Record waste' : 'Record stock removal')}</button>
        </form>}
      </section>}
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">{t('THE STOCK RECORD')}</span><h2>{t(!showWriteControls ? mode === 'waste' ? 'Waste history' : 'After-close removals' : mode === 'waste' ? showArchived ? 'Archived waste' : 'Waste history' : showArchived ? 'Archived removals' : 'After-close removals')}</h2></div>{showWriteControls && <button className="button button-quiet button-small" onClick={() => setShowArchived(!showArchived)}>{showArchived ? <RotateCcw size={14} /> : <Archive size={14} />}{t(showArchived ? 'Show active' : 'Show archived')}</button>}</div>
        {busy ? <LoadingState label="Loading stock records…" /> : historyEmpty ? <EmptyState title={t(showArchived ? 'Nothing archived' : mode === 'waste' ? 'No waste records yet' : 'No after-close removals')} detail={t(showArchived ? 'Archived records can be restored here.' : mode === 'waste' ? 'Food discarded by the team will appear here.' : 'Owner, friend, or guest pickups after closing will appear here, separate from actual waste.')} /> : mode === 'waste' ? <div className="waste-history-list">{visibleWaste.map((row) => <div className={`waste-history-row${row.deleted_at ? ' row-archived' : ''}`} key={row.id}><span className="waste-history-icon"><Trash2 size={16} /></span><span><strong>{formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name)}</strong><small>{t(row.reason)} · {formatBusinessDate(row.waste_date)}{row.notes ? ` · ${row.notes}` : ''}{row.archive_review_status === 'verified_waste' ? ` · ${t('Verified as waste')}` : !canEdit && row.deleted_at ? ` · ${t('Archived')}` : ''}</small>{Boolean(row.photoUrls?.length) && <div className="attachment-links">{row.photoUrls!.map((url, index) => <a href={url} key={url} target="_blank" rel="noreferrer">{t('Photo')} {index + 1}</a>)}</div>}</span><span className="waste-amount">−{formatQuantity(row.quantity)}<small>{t('boxes')}</small></span>{showWriteControls && <button className="icon-button" aria-label={t(row.deleted_at ? 'Restore waste record' : 'Archive waste record')} title={t(row.deleted_at ? 'Restore waste record' : 'Archive waste record')} disabled={!canEdit || Boolean(row.deleted_at && row.stock_ledger_preserved_on_archive)} onClick={() => void archiveWaste(row)}>{row.deleted_at ? <RotateCcw size={15} /> : <Archive size={15} />}</button>}</div>)}</div> : <div className="waste-history-list">{visibleStockOuts.map((row) => <div className={`waste-history-row stock-out-history-row${row.deleted_at ? ' row-archived' : ''}`} key={row.id}><span className="waste-history-icon stock-out-history-icon"><PackageOpen size={16} /></span><span><strong>{formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name)}</strong><small>{t(row.reason)} · {formatBusinessDate(row.removal_date)}{row.notes ? ` · ${row.notes}` : ''}{!canEdit && row.deleted_at ? ` · ${t('Archived')}` : ''}</small></span><span className="waste-amount">−{formatQuantity(row.quantity)}<small>{t('boxes')}</small></span>{showWriteControls && <button className="icon-button" aria-label={t(row.deleted_at ? 'Restore stock removal' : 'Archive stock removal')} title={t(row.deleted_at ? 'Restore stock removal' : 'Archive stock removal')} disabled={!canEdit} onClick={() => void archiveStockOut(row)}>{row.deleted_at ? <RotateCcw size={15} /> : <Archive size={15} />}</button>}</div>)}</div>}
      </section>
    </div>
    <div className="stock-disclaimer"><span className="soft-chip"><span className="live-dot" /> {t('STOCK LEDGER')}</span><span>{t('Each record changes only its selected batch. Post-close removals lower current stock and stay out of the waste rate.')}</span></div>
  </>;
}
