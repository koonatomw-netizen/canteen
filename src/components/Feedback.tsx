import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';

export function LoadingState({ label = 'Loading your workspace…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={19} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Notice({ children, tone = 'error' }: { children: string; tone?: 'error' | 'success' | 'info' }) {
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={17} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <div className="empty-mark"><span /></div>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
