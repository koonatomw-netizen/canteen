import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n';

export function PageTitle({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  const { t } = useI18n();
  const translatedEyebrow = eyebrow ? t(eyebrow) : undefined;
  const translatedTitle = t(title);
  const translatedDetail = detail ? t(detail) : undefined;
  return (
    <div className="page-title-row">
      <div>{translatedEyebrow && <span className="eyebrow page-eyebrow">{translatedEyebrow}</span>}<h1>{translatedTitle}</h1>{translatedDetail && <p>{translatedDetail}</p>}</div>
      {action && <div className="page-title-action">{action}</div>}
    </div>
  );
}
