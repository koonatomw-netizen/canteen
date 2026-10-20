import { useEffect, useRef } from 'react';
import { CalendarDays, CircleAlert, Utensils, X } from 'lucide-react';
import { formatDate } from '../../lib/format';
import { useI18n } from '../../lib/i18n';

interface DuplicateProductionDialogProps {
  open: boolean;
  foodName: string;
  productionDate: string;
  saving: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function DuplicateProductionDialog({ open, foodName, productionDate, saving, onConfirm, onDismiss }: DuplicateProductionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return <dialog
    ref={dialogRef}
    className="duplicate-production-dialog"
    aria-labelledby="duplicate-production-title"
    aria-describedby="duplicate-production-description"
    onCancel={(event) => { event.preventDefault(); if (!saving) onDismiss(); }}
    onClick={(event) => { if (event.target === event.currentTarget && !saving) onDismiss(); }}
  >
    <section className="duplicate-production-card">
      <header className="duplicate-production-head">
        <span className="duplicate-production-icon"><CircleAlert size={22} strokeWidth={2} /></span>
        <div className="duplicate-production-heading">
          <span className="eyebrow">{t('PRODUCTION CHECK')}</span>
          <h2 id="duplicate-production-title">{t('Already produced on this date')}</h2>
        </div>
        <button type="button" className="icon-button duplicate-production-close" aria-label={t('Cancel')} disabled={saving} onClick={onDismiss}><X size={17} /></button>
      </header>
      <p id="duplicate-production-description" className="duplicate-production-description">{t('This menu and meat option already have a production batch for the selected date.')}</p>
      <div className="duplicate-production-detail">
        <span className="duplicate-production-food-icon"><Utensils size={17} /></span>
        <div className="duplicate-production-food">
          <strong>{foodName}</strong>
          <span><CalendarDays size={13} />{t('Production date')} · {formatDate(productionDate)}</span>
        </div>
        <span className="duplicate-production-badge">{t('Already recorded')}</span>
      </div>
      <footer className="duplicate-production-actions">
        <button type="button" className="button button-quiet" disabled={saving} onClick={onDismiss}>{t('Cancel')}</button>
        <button type="button" className="button button-primary" disabled={saving} onClick={onConfirm}>{saving ? t('Saving batch…') : t('Add another batch')}</button>
      </footer>
    </section>
  </dialog>;
}
