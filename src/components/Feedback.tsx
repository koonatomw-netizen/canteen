import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import { useI18n } from '../lib/i18n';

export function LoadingState({ label = 'Loading your workspace…' }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={19} aria-hidden="true" />
      <span>{t(label)}</span>
    </div>
  );
}

export function Notice({ children, tone = 'error' }: { children: string; tone?: 'error' | 'success' | 'info' }) {
  const { t } = useI18n();
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={17} aria-hidden="true" />
      <span>{t(children)}</span>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  const { t } = useI18n();
  return (
    <div className="empty-state">
      <div className="empty-mark"><span /></div>
      <strong>{t(title)}</strong>
      <p>{t(detail)}</p>
    </div>
  );
}
