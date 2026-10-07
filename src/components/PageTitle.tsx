import type { ReactNode } from 'react';

export function PageTitle({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="page-title-row">
      <div>{eyebrow && <span className="eyebrow page-eyebrow">{eyebrow}</span>}<h1>{title}</h1>{detail && <p>{detail}</p>}</div>
      {action && <div className="page-title-action">{action}</div>}
    </div>
  );
}
