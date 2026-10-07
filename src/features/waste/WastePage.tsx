import { useEffect, useState, type FormEvent } from 'react';
import { Archive, ImagePlus, RotateCcw, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { formatBusinessDate } from '../../lib/dates';
import { formatQuantity } from '../../lib/format';
import { compressImage } from '../../lib/compressImage';
import { requireSupabase } from '../../lib/supabase';

interface StockRow { id: string; menu_id: string; menu_name: string; production_date: string; expiry_date: string; quantity_remaining: number; }
interface WasteRow { id: string; quantity: number; reason: string; notes: string | null; waste_date: string; photo_url: string | null; deleted_at: string | null; production_batches: { menu_items: { name: string } | null; production_date: string } | null; }

const reasons = ['Expired', 'Spoiled', 'Damaged', 'Quality Issue', 'Other'];

export function WastePage() {
  const [params] = useSearchParams();
  const [stock, setStock] = useState<StockRow[]>([]);
  const [waste, setWaste] = useState<WasteRow[]>([]);
  const [batchId, setBatchId] = useState(params.get('batch') ?? '');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState(reasons[0]);
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    setBusy(true);
    const db = requireSupabase();
    const [stockResult, wasteResult] = await Promise.all([
      db.from('v_stock_by_batch').select('id, menu_id, menu_name, production_date, expiry_date, quantity_remaining').gt('quantity_remaining', 0).order('expiry_date'),
      db.from('waste_records').select('id, quantity, reason, notes, waste_date, photo_url, deleted_at, production_batches(menu_items(name), production_date)').order('waste_date', { ascending: false }).limit(60),
    ]);
    if (stockResult.error || wasteResult.error) setError(stockResult.error?.message ?? wasteResult.error?.message ?? 'Could not load waste records.');
    const available = (stockResult.data ?? []) as StockRow[];
    setStock(available); setWaste((wasteResult.data ?? []) as unknown as WasteRow[]);
    setBatchId((current) => available.some((row) => row.id === current) ? current : available[0]?.id ?? '');
    setBusy(false);
  }
  useEffect(() => { void load(); }, []);

  const selectedBatch = stock.find((row) => row.id === batchId);

  async function recordWaste(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    const db = requireSupabase();
    const { data, error: insertError } = await db.from('waste_records').insert({
      production_batch_id: batchId, quantity: Number(quantity), reason, notes: notes.trim() || null,
    }).select('id').single();
    if (insertError) { setError(insertError.message); setSaving(false); return; }
    let photoError = '';
    if (photo) {
      try {
        const prepared = await compressImage(photo);
        const path = `waste/${data.id}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await db.storage.from('operational-photos').upload(path, prepared, { contentType: 'image/jpeg', upsert: false });
        if (uploadError) throw uploadError;
        const { error: linkError } = await db.from('waste_records').update({ photo_url: path }).eq('id', data.id);
        if (linkError) { await db.storage.from('operational-photos').remove([path]); throw linkError; }
      } catch (uploadError) {
        photoError = `Waste was saved, but the photo could not be attached: ${uploadError instanceof Error ? uploadError.message : 'unknown error'}`;
      }
    }
    if (photoError) setError(photoError); else setSuccess(`${quantity} ${Number(quantity) === 1 ? 'box' : 'boxes'} recorded as ${reason.toLowerCase()}.`);
    setQuantity(''); setNotes(''); setPhoto(null); await load(); setSaving(false);
  }

  async function archiveWaste(record: WasteRow) {
    if (!record.deleted_at && !window.confirm('Archive this waste record? Its boxes will be returned to the batch and the change will be audited.')) return;
    const { error: updateError } = await requireSupabase().from('waste_records').update({ deleted_at: record.deleted_at ? null : new Date().toISOString() }).eq('id', record.id);
    if (updateError) setError(updateError.message); else { setError(''); setSuccess(record.deleted_at ? 'Waste record restored.' : 'Waste record archived and stock returned.'); await load(); }
  }

  const visibleWaste = waste.filter((row) => Boolean(row.deleted_at) === showArchived);
  return <>
    <PageTitle eyebrow="A LITTLE LESS FOOD LOST" title="Record waste" detail="Choose the batch the food came from. Waste always reduces that batch’s stock." />
    {error && <Notice>{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
    <div className="workflow-grid two-panel-grid">
      <section className="panel workflow-form-panel"><div className="panel-head"><div><span className="eyebrow">CONFIRM WHAT HAPPENED</span><h2>What went to waste?</h2></div><span className="form-panel-icon peach"><Trash2 size={20} /></span></div>
        {busy ? <LoadingState label="Checking available batches…" /> : stock.length === 0 ? <EmptyState title="No stock to record against" detail="Once you have production in the system, you can record waste against a batch." /> : <form className="data-form" onSubmit={recordWaste}>
          <label>Food batch<select required value={batchId} onChange={(event) => setBatchId(event.target.value)}>{stock.map((row) => <option key={row.id} value={row.id}>{row.menu_name} · {formatBusinessDate(row.production_date)} · {row.quantity_remaining} left</option>)}</select></label>
          <div className="form-two-cols"><label>Boxes wasted<input required type="number" min="1" max={selectedBatch?.quantity_remaining ?? 1} step="1" inputMode="numeric" placeholder="e.g. 2" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><small className="field-help">Available in this batch: {formatQuantity(selectedBatch?.quantity_remaining ?? 0)} boxes</small></label><label>Reason<select value={reason} onChange={(event) => setReason(event.target.value)}>{reasons.map((item) => <option key={item}>{item}</option>)}</select></label></div>
          <label>Note <span className="optional-label">OPTIONAL</span><textarea rows={2} placeholder="Add context if it would help the next shift" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <label className="photo-pick"><span className="photo-pick-icon"><ImagePlus size={19} /></span><span><strong>{photo ? photo.name : 'Add a photo'}</strong><small>Optional · camera or gallery · compressed before upload</small></span><input type="file" accept="image/*" capture="environment" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} /></label>
          <button className="button button-primary" disabled={saving || !selectedBatch}><Trash2 size={17} /> {saving ? 'Saving waste…' : 'Record waste'}</button>
        </form>}
      </section>
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">RECENT RECORDS</span><h2>{showArchived ? 'Archived waste' : 'Waste history'}</h2></div><button className="button button-quiet button-small" onClick={() => setShowArchived(!showArchived)}>{showArchived ? <RotateCcw size={14} /> : <Archive size={14} />}{showArchived ? 'Show active' : 'Show archived'}</button></div>
        {busy ? <LoadingState label="Loading waste…" /> : visibleWaste.length === 0 ? <EmptyState title={showArchived ? 'Nothing archived' : 'No waste records yet'} detail={showArchived ? 'Archived waste can be restored here.' : 'Every small change helps you see where food is being lost.'} /> : <div className="waste-history-list">{visibleWaste.map((row) => <div className={`waste-history-row${row.deleted_at ? ' row-archived' : ''}`} key={row.id}><span className="waste-history-icon"><Trash2 size={16} /></span><span><strong>{row.production_batches?.menu_items?.name ?? 'Food batch'}</strong><small>{row.reason} · {formatBusinessDate(row.waste_date)}{row.photo_url ? ' · Photo attached' : ''}</small></span><span className="waste-amount">−{formatQuantity(row.quantity)}<small>boxes</small></span><button className="icon-button" aria-label={row.deleted_at ? 'Restore waste record' : 'Archive waste record'} title={row.deleted_at ? 'Restore waste record' : 'Archive waste record'} onClick={() => void archiveWaste(row)}>{row.deleted_at ? <RotateCcw size={15} /> : <Archive size={15} />}</button></div>)}</div>}
      </section>
    </div>
    <div className="stock-disclaimer"><span className="soft-chip"><span className="live-dot" /> AUTOMATIC CHECK</span><span>The database checks current batch stock each time, even if several team members are working at once.</span></div>
  </>;
}
