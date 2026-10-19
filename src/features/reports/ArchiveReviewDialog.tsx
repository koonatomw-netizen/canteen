import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays, CircleCheck, Trash2, Utensils, X } from 'lucide-react';
import { formatDate, formatQuantity } from '../../lib/format';
import { useI18n } from '../../lib/i18n';

export interface ArchiveReviewTarget {
  action: 'verify' | 'remove';
  id: string;
  foodName: string;
  wasteDate: string;
  quantity: number;
  reason: string;
  batchId: string | null;
  batchQuantity: number | null;
}

interface ArchiveReviewDialogProps {
  target: ArchiveReviewTarget | null;
  saving: boolean;
  error: string;
  onConfirm: (reason: string, removeBatch: boolean) => void;
  onDismiss: () => void;
}

export function ArchiveReviewDialog({ target, saving, error, onConfirm, onDismiss }: ArchiveReviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [removeBatch, setRemoveBatch] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target && !dialog.open) dialog.showModal();
    else if (!target && dialog.open) dialog.close();
    setRemoveBatch(false);
    if (target?.action === 'remove') setReason(t('Incorrect archived waste entry'));
  }, [target?.action, target?.id, t]);

  if (!target) return null;

  const removing = target.action === 'remove';
  const cleanReason = reason.trim();

  return <dialog
    ref={dialogRef}
    className="archive-review-dialog"
    aria-labelledby="archive-review-title"
    aria-describedby="archive-review-description"
    onCancel={(event) => { event.preventDefault(); if (!saving) onDismiss(); }}
    onClick={(event) => { if (event.target === event.currentTarget && !saving) onDismiss(); }}
  >
    <section className="archive-review-card">
      <header className="archive-review-head">
        <span className={`archive-review-icon${removing ? ' archive-review-icon-remove' : ''}`}>{removing ? <AlertTriangle size={22} /> : <CircleCheck size={22} />}</span>
        <div className="archive-review-heading">
          <span className="eyebrow">{t('ARCHIVED WASTE REVIEW')}</span>
          <h2 id="archive-review-title">{t(removing ? 'Remove archived record?' : 'Verify this was waste?')}</h2>
        </div>
        <button type="button" className="icon-button" aria-label={t('Close')} disabled={saving} onClick={onDismiss}><X size={17} /></button>
      </header>
      <p id="archive-review-description" className="archive-review-description">{t(removing ? removeBatch ? 'Removing the batch also removes every unverified archived waste row attached to it, reverses those waste movements, and archives the batch so it leaves Produced. The action is blocked if the batch was sold, used, or counted at closing.' : 'Only this archived waste row will be removed. Its audit snapshot and original stock movement stay, so stock will not change.' : 'This entry will be counted as confirmed Waste, not Produced. Its current stock movement will not change.')}</p>
      {error && <div className="archive-review-error" role="alert" aria-live="assertive"><AlertTriangle size={16} /><span>{error}</span></div>}
      <div className="archive-review-detail">
        <span className="archive-review-food-icon"><Utensils size={17} /></span>
        <div className="archive-review-food">
          <strong>{target.foodName}</strong>
          <span><CalendarDays size={13} /> {formatDate(target.wasteDate)} · {t(target.reason)}</span>
        </div>
        <span className="archive-review-quantity">{formatQuantity(target.quantity)} {t('boxes')}</span>
      </div>
      {removing && target.batchId && <fieldset className="archive-review-scope"><legend>{t('What should be removed?')}</legend><label><input type="radio" name="archive-remove-scope" checked={!removeBatch} onChange={() => setRemoveBatch(false)} /><span><strong>{t('Only this waste entry')}</strong><small>{t('Keep the production batch and its stock effect.')}</small></span></label><label><input type="radio" name="archive-remove-scope" checked={removeBatch} onChange={() => setRemoveBatch(true)} /><span><strong>{t('This waste entry and the full batch')}{target.batchQuantity ? ` · ${formatQuantity(target.batchQuantity)} ${t('boxes')}` : ''}</strong><small>{t('Remove the batch from Produced and reverse its related archived waste.')}</small></span></label></fieldset>}
      {removing && <label className="archive-review-reason">{t('Removal reason')}<textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
      <footer className="archive-review-actions">
        <button type="button" className="button button-quiet" disabled={saving} onClick={onDismiss}>{t('Keep for review')}</button>
        {removing
          ? <button type="button" className="button archive-review-remove-button" disabled={saving || cleanReason.length < 3} onClick={() => onConfirm(cleanReason, removeBatch)}><Trash2 size={15} /> {saving ? t('Removing…') : t(removeBatch ? 'Remove batch and related waste' : 'Remove record')}</button>
          : <button type="button" className="button button-primary" disabled={saving} onClick={() => onConfirm('', false)}><CircleCheck size={15} /> {saving ? t('Verifying…') : t('Verify as waste')}</button>}
      </footer>
    </section>
  </dialog>;
}
