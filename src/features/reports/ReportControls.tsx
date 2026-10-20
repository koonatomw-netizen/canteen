import { useState, type ReactNode } from 'react';
import { ArrowDownToLine, CalendarRange, Filter } from 'lucide-react';
import { formatDate } from '../../lib/format';
import { useI18n } from '../../lib/i18n';

export type RangePreset = 'lastWeek' | 'week' | 'last4' | 'month' | 'custom';

const PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: 'lastWeek', label: 'Last week' },
  { value: 'week', label: 'This week' },
  { value: 'last4', label: 'Last 4 weeks' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
];

export function ReportControls(props: {
  preset: RangePreset;
  onPreset: (preset: RangePreset) => void;
  start: string;
  end: string;
  today: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  activeFilterCount: number;
  filters: ReactNode;
  downloads: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<'filters' | 'downloads' | null>(null);
  const toggle = (panel: 'filters' | 'downloads') => setOpen((current) => current === panel ? null : panel);
  return <section className="panel report-controls report-period-controls">
    <div className="report-period-row">
      <div className="report-range-title"><span className="report-range-icon"><CalendarRange size={18} /></span><span><strong>{formatDate(props.start)} – {formatDate(props.end)}</strong><small>{t('Compared with the previous period of the same length.')}</small></span></div>
      <div className="report-preset-group" role="group" aria-label={t('Your reporting period')}>
        {PRESETS.map((item) => <button key={item.value} type="button" className={`report-preset${props.preset === item.value ? ' active' : ''}`} aria-pressed={props.preset === item.value} onClick={() => props.onPreset(item.value)}>{t(item.label)}</button>)}
      </div>
      <div className="report-tool-buttons">
        <button type="button" className={`button button-quiet${open === 'filters' ? ' active' : ''}`} aria-expanded={open === 'filters'} onClick={() => toggle('filters')}><Filter size={15} /> {t('Filters')}{props.activeFilterCount > 0 && <span className="report-filter-count">{props.activeFilterCount}</span>}</button>
        <button type="button" className={`button button-quiet${open === 'downloads' ? ' active' : ''}`} aria-expanded={open === 'downloads'} onClick={() => toggle('downloads')}><ArrowDownToLine size={15} /> {t('Download')}</button>
      </div>
    </div>
    {props.preset === 'custom' && <div className="report-custom-range">
      <label>{t('From')}<input type="date" value={props.start} max={props.end} onChange={(event) => props.onStart(event.target.value)} /></label>
      <label>{t('To')}<input type="date" value={props.end} min={props.start} max={props.today} onChange={(event) => props.onEnd(event.target.value)} /></label>
      <small>{t('Both start and end dates are included.')}</small>
    </div>}
    {open === 'filters' && <div className="report-disclosure">{props.filters}</div>}
    {open === 'downloads' && <div className="report-disclosure">{props.downloads}</div>}
  </section>;
}
