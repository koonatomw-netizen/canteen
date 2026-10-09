import { useEffect, useState, type FormEvent } from 'react';
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
import { useLocalDraft } from '../../lib/localDrafts';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../../lib/i18n';

interface StockRow { id: string; menu_id: string | null; menu_name: string; production_date: string; expiry_date: string; quantity_remaining: number; }
interface Reason { id: string; name: string; active: boolean; }
interface BatchName { menu_name_snapshot: string; meat_options: { name: string } | null; production_date: string; }
interface WasteRow { id: string; quantity: number; reason: string; notes: string | null; waste_date: string; photo_url: string | null; deleted_at: string | null; waste_record_photos?: { file_path: string }[]; photoUrls?: string[]; production_batches: BatchName | null; }
interface StockOutRow { id: string; quantity: number; reason: string; notes: string | null; removal_date: string; deleted_at: string | null; production_batches: BatchName | null; }

type RecordMode = 'waste' | 'stock-out';
interface WasteFormDraft { batchId: string; quantity: string; reason: string; notes: string; removalDate: string; }

function isWasteFormDraft(value: unknown): value is WasteFormDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return ['batchId', 'quantity', 'reason', 'notes', 'removalDate'].every((key) => typeof draft[key] === 'string');
}

export function WastePage() {
  const { member } = useAuth();
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<RecordMode>('waste');
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
  const [success, setSuccess] = useState('');
  const draftKey = `canteen.draft.waste:${member?.user_id ?? 'local'}:${mode}`;
  const { status: draftStatus, clearDraft } = useLocalDraft<WasteFormDraft>(draftKey, { batchId, quantity, reason, notes, removalDate }, (stored) => {
    if (!isWasteFormDraft(stored)) return;
    if (!params.get('batch')) setBatchId(stored.batchId);
    setQuantity(stored.quantity); setReason(stored.reason); setNotes(stored.notes); setRemovalDate(stored.removalDate);
  }, (value) => Boolean(value.quantity.trim() || value.notes.trim()));

  async function load() {
    setBusy(true); setError('');
    const db = requireSupabase();
    const [stockResult, wasteResult, wasteReasonResult, stockOutReasonResult, stockOutResult, closingResult] = await Promise.all([
      db.from('v_stock_by_batch').select('id, menu_id, menu_name, production_date, expiry_date, quantity_remaining').gt('quantity_remaining', 0).order('expiry_date'),
      db.from('waste_records').select('id, quantity, reason, notes, waste_date, photo_url, deleted_at, production_batches(menu_name_snapshot, meat_options(name), production_date), waste_record_photos(file_path)').order('waste_date', { ascending: false }).limit(60),
      db.from('waste_reasons').select('id, name, active').eq('active', true).order('name'),
      db.from('stock_out_reasons').select('id, name, active').eq('active', true).order('name'),
      db.from('post_close_stock_outs').select('id, quantity, reason, notes, removal_date, deleted_at, production_batches(menu_name_snapshot, meat_options(name), production_date)').order('removal_date', { ascending: false }).limit(60),
      db.from('daily_closings').select('business_date').eq('status', 'closed').order('business_date', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const firstError = [stockResult, wasteResult, wasteReasonResult, stockOutReasonResult, stockOutResult, closingResult].find((result) => result.error)?.error;
    if (firstError) setError(firstError.message);
    const available = (stockResult.data ?? []) as StockRow[];
    const records = (wasteResult.data ?? []) as unknown as WasteRow[];
    const pathsByRecord = records.map((record) => [...new Set([...(record.waste_record_photos ?? []).map((photo) => photo.file_path), ...(record.photo_url ? [record.photo_url] : [])])]);
    const signedUrls = await signPrivatePhotos(db, pathsByRecord.flat());
    const latestDate = closingResult.data?.business_date ?? null;
    setStock(available);
    setWaste(records.map((record, index) => ({ ...record, photoUrls: pathsByRecord[index]!.map((path) => signedUrls[path]).filter(Boolean) })));
    setWasteReasons((wasteReasonResult.data ?? []) as Reason[]);
    setStockOutReasons((stockOutReasonResult.data ?? []) as Reason[]);
    setStockOuts((stockOutResult.data ?? []) as unknown as StockOutRow[]);
    setLatestClosedDate(latestDate);
    setRemovalDate((current) => latestDate && current < latestDate ? latestDate : current);
    setBatchId((current) => available.some((row) => row.id === current) ? current : available[0]?.id ?? '');
    setReason((current) => mode === 'waste'
      ? (wasteReasonResult.data ?? []).some((option) => option.name === current) ? current : wasteReasonResult.data?.[0]?.name ?? ''
      : (stockOutReasonResult.data ?? []).some((option) => option.name === current) ? current : stockOutReasonResult.data?.[0]?.name ?? '');
    setBusy(false);
  }
  useEffect(() => { void load(); }, []);

  const selectedBatch = stock.find((row) => row.id === batchId);
  const activeReasons = mode === 'waste' ? wasteReasons : stockOutReasons;
  const selectedReasonIsOther = reason.trim().toLowerCase() === 'other';

  async function recordWaste(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    const db = requireSupabase();
    const { data, error: insertError } = await db.from('waste_records').insert({
      production_batch_id: batchId, quantity: Number(quantity), reason, notes: notes.trim() || null,
    }).select('id').single();
    if (insertError) { setError(insertError.message); setSaving(false); return; }
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
    const { error: insertError } = await requireSupabase().from('post_close_stock_outs').insert({
      production_batch_id: batchId, quantity: Number(quantity), reason, notes: notes.trim() || null, removal_date: removalDate,
    });
    if (insertError) setError(insertError.message);
    else { setSuccess(`${quantity} ${Number(quantity) === 1 ? 'box' : 'boxes'} removed from stock. It is excluded from waste totals.`); setQuantity(''); setNotes(''); clearDraft(); await load(); }
    setSaving(false);
  }

  async function archiveWaste(record: WasteRow) {
    if (!record.deleted_at && !window.confirm('Archive this waste record? Its boxes will be returned to the batch and the change will be audited.')) return;
    const { error: updateError } = await requireSupabase().from('waste_records').update({ deleted_at: record.deleted_at ? null : new Date().toISOString() }).eq('id', record.id);
    if (updateError) setError(updateError.message); else { setError(''); setSuccess(record.deleted_at ? 'Waste record restored.' : 'Waste record archived and stock returned.'); await load(); }
  }

  async function archiveStockOut(record: StockOutRow) {
    if (!record.deleted_at && !window.confirm('Archive this removal? Its quantity will be returned to current stock and the change will be audited.')) return;
    const { error: updateError } = await requireSupabase().from('post_close_stock_outs').update({ deleted_at: record.deleted_at ? null : new Date().toISOString() }).eq('id', record.id);
    if (updateError) setError(updateError.message); else { setError(''); setSuccess(record.deleted_at ? 'Removal restored and deducted from current stock again.' : 'Removal archived and returned to current stock.'); await load(); }
  }

  const visibleWaste = waste.filter((row) => Boolean(row.deleted_at) === showArchived);
  const visibleStockOuts = stockOuts.filter((row) => Boolean(row.deleted_at) === showArchived);
  const historyEmpty = mode === 'waste' ? visibleWaste.length === 0 : visibleStockOuts.length === 0;

  return <>
    <PageTitle eyebrow="ACCOUNT FOR EVERY BOX" title="Waste & stock out" detail="Record food that was discarded as Waste, or record food taken from stock after the day was closed." />
    {error && <Notice>{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
    <div className="record-mode-tabs" role="tablist" aria-label={t('Choose a stock record type')}>
      <button type="button" role="tab" aria-selected={mode === 'waste'} className={mode === 'waste' ? 'active' : ''} onClick={() => { setMode('waste'); setReason(wasteReasons[0]?.name ?? ''); setQuantity(''); setNotes(''); setShowArchived(false); }}><Trash2 size={17} />{t('Food discarded')} <small>{t('Counts as waste')}</small></button>
      <button type="button" role="tab" aria-selected={mode === 'stock-out'} className={mode === 'stock-out' ? 'active' : ''} onClick={() => { setMode('stock-out'); setReason(stockOutReasons[0]?.name ?? ''); setQuantity(''); setNotes(''); setShowArchived(false); }}><PackageOpen size={17} />{t('Taken after closing')} <small>{t('Stock out, not waste')}</small></button>
    </div>
    <div className="workflow-grid two-panel-grid">
      <section className="panel workflow-form-panel"><div className="panel-head"><div><span className="eyebrow">{t(mode === 'waste' ? 'CONFIRM WHAT WAS DISCARDED' : 'RECORD FOOD LEAVING STOCK')}</span><h2>{t(mode === 'waste' ? 'What went to waste?' : 'What was taken after closing?')}</h2></div><span className={`form-panel-icon ${mode === 'waste' ? 'peach' : 'green'}`}>{mode === 'waste' ? <Trash2 size={20} /> : <PackageOpen size={20} />}</span></div>
        {busy ? <LoadingState label="Checking available batches…" /> : stock.length === 0 ? <EmptyState title="No stock to record against" detail="Once food has been produced, you can record a batch-specific stock change here." /> : mode === 'stock-out' && !latestClosedDate ? <EmptyState title="Close a day first" detail="After the first daily closing, staff can record food taken from stock without changing that closing count." /> : <form className="data-form" onSubmit={mode === 'waste' ? recordWaste : recordStockOut}>
          <label>{t('Food batch')}<select required value={batchId} onChange={(event) => setBatchId(event.target.value)}>{stock.map((row) => <option key={row.id} value={row.id}>{row.menu_name} · {formatBusinessDate(row.production_date)} · {row.quantity_remaining} {t('left')}</option>)}</select></label>
          <div className="form-two-cols"><label>{t(mode === 'waste' ? 'Boxes discarded' : 'Boxes taken')}<input required type="number" min="1" max={selectedBatch?.quantity_remaining ?? 1} step="1" inputMode="numeric" placeholder={t('e.g. 2')} value={quantity} onChange={(event) => setQuantity(event.target.value)} /><small className="field-help">{t('Available in this batch:')} {formatQuantity(selectedBatch?.quantity_remaining ?? 0)} {t('boxes')}</small></label><label>{t('Reason')}<select required value={reason} onChange={(event) => setReason(event.target.value)}>{activeReasons.map((item) => <option key={item.id} value={item.name}>{t(item.name)}</option>)}</select></label></div>
          {mode === 'stock-out' && <label>{t('Date removed')}<input type="date" required min={latestClosedDate ?? undefined} max={businessDateNow()} value={removalDate} onChange={(event) => setRemovalDate(event.target.value)} /><small className="field-help">{t('Use today for a late pickup today. Earlier dates than the latest closing are blocked to protect completed counts.')}</small></label>}
          <label>{t('Note')} {selectedReasonIsOther ? <span className="required-label">{t('REQUIRED FOR OTHER')}</span> : <span className="optional-label">{t('OPTIONAL')}</span>}<textarea rows={2} required={selectedReasonIsOther} placeholder={t(mode === 'waste' ? 'Add context if it would help the next shift' : 'For example, owner’s friend picked up a meal box')} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          {mode === 'waste' && <PhotoAttachmentsPicker files={photos} onChange={setPhotos} label={photos.length ? `${photos.length} ${t('photos selected')}` : t('Add photos')} hint={t('Optional · private · compressed before upload')} />}
          <DraftStatus status={draftStatus} photosNotSaved={mode === 'waste'} />
          <button className="button button-primary" disabled={saving || !selectedBatch || !reason || (mode === 'stock-out' && !latestClosedDate)}>{mode === 'waste' ? <Trash2 size={17} /> : <PackageOpen size={17} />}{saving ? t('Saving…') : t(mode === 'waste' ? 'Record waste' : 'Record stock removal')}</button>
        </form>}
      </section>
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">{t('THE STOCK RECORD')}</span><h2>{t(mode === 'waste' ? showArchived ? 'Archived waste' : 'Waste history' : showArchived ? 'Archived removals' : 'After-close removals')}</h2></div><button className="button button-quiet button-small" onClick={() => setShowArchived(!showArchived)}>{showArchived ? <RotateCcw size={14} /> : <Archive size={14} />}{t(showArchived ? 'Show active' : 'Show archived')}</button></div>
        {busy ? <LoadingState label="Loading stock records…" /> : historyEmpty ? <EmptyState title={t(showArchived ? 'Nothing archived' : mode === 'waste' ? 'No waste records yet' : 'No after-close removals')} detail={t(showArchived ? 'Archived records can be restored here.' : mode === 'waste' ? 'Food discarded by the team will appear here.' : 'Owner, friend, or guest pickups after closing will appear here, separate from actual waste.')} /> : mode === 'waste' ? <div className="waste-history-list">{visibleWaste.map((row) => <div className={`waste-history-row${row.deleted_at ? ' row-archived' : ''}`} key={row.id}><span className="waste-history-icon"><Trash2 size={16} /></span><span><strong>{formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name)}</strong><small>{t(row.reason)} · {formatBusinessDate(row.waste_date)}{row.notes ? ` · ${row.notes}` : ''}</small>{Boolean(row.photoUrls?.length) && <div className="attachment-links">{row.photoUrls!.map((url, index) => <a href={url} key={url} target="_blank" rel="noreferrer">{t('Photo')} {index + 1}</a>)}</div>}</span><span className="waste-amount">−{formatQuantity(row.quantity)}<small>{t('boxes')}</small></span><button className="icon-button" aria-label={t(row.deleted_at ? 'Restore waste record' : 'Archive waste record')} title={t(row.deleted_at ? 'Restore waste record' : 'Archive waste record')} onClick={() => void archiveWaste(row)}>{row.deleted_at ? <RotateCcw size={15} /> : <Archive size={15} />}</button></div>)}</div> : <div className="waste-history-list">{visibleStockOuts.map((row) => <div className={`waste-history-row stock-out-history-row${row.deleted_at ? ' row-archived' : ''}`} key={row.id}><span className="waste-history-icon stock-out-history-icon"><PackageOpen size={16} /></span><span><strong>{formatFoodVariant(row.production_batches?.menu_name_snapshot, row.production_batches?.meat_options?.name)}</strong><small>{t(row.reason)} · {formatBusinessDate(row.removal_date)}{row.notes ? ` · ${row.notes}` : ''}</small></span><span className="waste-amount">−{formatQuantity(row.quantity)}<small>{t('boxes')}</small></span><button className="icon-button" aria-label={t(row.deleted_at ? 'Restore stock removal' : 'Archive stock removal')} title={t(row.deleted_at ? 'Restore stock removal' : 'Archive stock removal')} onClick={() => void archiveStockOut(row)}>{row.deleted_at ? <RotateCcw size={15} /> : <Archive size={15} />}</button></div>)}</div>}
      </section>
    </div>
    <div className="stock-disclaimer"><span className="soft-chip"><span className="live-dot" /> {t('STOCK LEDGER')}</span><span>{t('Each record changes only its selected batch. Post-close removals lower current stock and stay out of the waste rate.')}</span></div>
  </>;
}
