import { useEffect, useState } from 'react';
import { ArrowDownToLine, ClipboardList } from 'lucide-react';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { formatBangkokDate, formatBangkokTime } from '../../lib/dates';
import { downloadCsv } from '../../lib/csv';
import { requireSupabase } from '../../lib/supabase';

interface Activity { id: string; occurred_at: string; action: string; entity_type: string; entity_id: string; description: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; }

export function ActivityPage() {
  const [rows, setRows] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void requireSupabase().from('activity_logs').select('id, occurred_at, action, entity_type, entity_id, description, before_data, after_data').order('occurred_at', { ascending: false }).limit(300).then(({ data, error: loadError }) => {
      if (!alive) return;
      if (loadError) setError(loadError.message);
      setRows((data ?? []) as Activity[]); setBusy(false);
    });
    return () => { alive = false; };
  }, []);

  return <>
    <PageTitle eyebrow="EVERY CHANGE HAS A STORY" title="Activity log" detail="A read-only timeline of the important changes your team has made." action={<button className="button button-quiet" disabled={!rows.length} onClick={() => downloadCsv('canteen-activity.csv', rows.map(({ occurred_at, action, entity_type, entity_id, description, before_data, after_data }) => ({ occurred_at, action, entity_type, entity_id, description, before_data: JSON.stringify(before_data), after_data: JSON.stringify(after_data) })))}><ArrowDownToLine size={16} /> Export log</button>} />
    {error && <Notice>{error}</Notice>}
    <section className="panel activity-full-panel"><div className="panel-head"><div><span className="eyebrow">RECENT OPERATIONS</span><h2>History</h2></div><span className="count-chip">{rows.length} EVENTS</span></div>
      {busy ? <LoadingState label="Loading the activity log…" /> : rows.length === 0 ? <EmptyState title="The log is ready" detail="New menu, batch, waste, closing, and expense activity appears here." /> : <div className="audit-timeline">{rows.map((row) => <details className="audit-event" key={row.id}><summary><span className="audit-event-dot"><ClipboardList size={14} /></span><span className="audit-event-main"><strong>{row.description}</strong><small>{row.entity_type.replaceAll('_', ' ')} · {row.action}</small></span><time>{formatBangkokDate(row.occurred_at)} at {formatBangkokTime(row.occurred_at)}</time><span className="audit-chevron" /></summary><div className="audit-event-details"><span>Record · {row.entity_id}</span>{row.before_data && <pre><b>Before</b>{JSON.stringify(row.before_data, null, 2)}</pre>}{row.after_data && <pre><b>After</b>{JSON.stringify(row.after_data, null, 2)}</pre>}</div></details>)}</div>}
    </section>
    <p className="activity-immutable-note"><ClipboardList size={15} /> Activity records are read-only and stay with the related business history.</p>
  </>;
}
