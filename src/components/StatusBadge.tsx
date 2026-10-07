import { Check, Clock3, CircleAlert, CircleX } from 'lucide-react';
import type { ExpiryStatus } from '../lib/stock';

const labels: Record<ExpiryStatus, string> = {
  normal: 'Good',
  tomorrow: 'Expires tomorrow',
  today: 'Expires today',
  expired: 'Expired',
};

export function StatusBadge({ status }: { status: ExpiryStatus }) {
  const Icon = status === 'normal' ? Check : status === 'tomorrow' ? Clock3 : status === 'today' ? CircleAlert : CircleX;
  return <span className={`status-badge status-${status}`}><Icon size={13} />{labels[status]}</span>;
}
