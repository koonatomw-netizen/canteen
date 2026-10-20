import { EmptyState, LoadingState } from '../../components/Feedback';
import { formatDate } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { weekdaySalesGrid, weeklyWasteTrend } from '../../lib/foodInsights';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatAverage(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function WeekdayGrid({ rows }: { rows: ReturnType<typeof weekdaySalesGrid> }) {
  const { t } = useI18n();
  return <div className="report-weekday-wrap"><table className="report-weekday-grid">
    <thead><tr><th scope="col">{t('Menu / meat')}</th>{WEEKDAYS.map((day) => <th key={day} scope="col">{t(day)}</th>)}</tr></thead>
    <tbody>{rows.map((row) => {
      const max = Math.max(0, ...row.averages.map((value) => value ?? 0));
      return <tr key={row.label}><th scope="row">{row.label}</th>{row.averages.map((value, index) => <td key={WEEKDAYS[index]} style={value !== null && max > 0 ? { background: `rgb(47 122 79 / ${0.08 + value / max * 0.42})` } : undefined}>{value === null ? '' : formatAverage(value)}</td>)}</tr>;
    })}</tbody>
  </table></div>;
}

function TrendLine({ weeks }: { weeks: ReturnType<typeof weeklyWasteTrend> }) {
  const { t } = useI18n();
  const width = 640;
  const height = 200;
  const pad = { top: 16, right: 16, bottom: 34, left: 40 };
  const max = Math.max(10, ...weeks.map((week) => week.wastePercent ?? 0));
  const x = (index: number) => pad.left + index * (width - pad.left - pad.right) / Math.max(1, weeks.length - 1);
  const y = (value: number) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
  const segments: string[] = [];
  let current = '';
  weeks.forEach((week, index) => {
    if (week.wastePercent === null) { if (current) segments.push(current); current = ''; return; }
    current += `${current ? 'L' : 'M'}${x(index).toFixed(1)},${y(week.wastePercent).toFixed(1)}`;
  });
  if (current) segments.push(current);
  return <svg className="report-trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('Weekly waste rate for the last 8 weeks')}>
    {[0, max / 2, max].map((tick) => <g key={tick}><line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="report-trend-grid" /><text x={pad.left - 6} y={y(tick) + 4} textAnchor="end" className="report-trend-axis">{Math.round(tick)}%</text></g>)}
    {segments.map((path) => <path key={path} d={path} className="report-trend-line" />)}
    {weeks.map((week, index) => <g key={week.start}>
      {week.wastePercent !== null && <circle cx={x(index)} cy={y(week.wastePercent)} r={5} className={week.partial ? 'report-trend-point partial' : 'report-trend-point'}><title>{`${formatDate(week.start)} – ${formatDate(week.end)}: ${Math.round(week.wastePercent)}% (${week.waste}/${week.produced})${week.partial ? ` · ${t('so far')}` : ''}`}</title></circle>}
      <text x={x(index)} y={height - 14} textAnchor="middle" className="report-trend-axis">{formatDate(week.start).replace(/\s\d{4}$/, '')}</text>
      {week.partial && <text x={x(index)} y={height - 2} textAnchor="middle" className="report-trend-axis">{t('so far')}</text>}
    </g>)}
  </svg>;
}

export function ReportTrendsTab(props: { weekday: ReturnType<typeof weekdaySalesGrid>; trend: ReturnType<typeof weeklyWasteTrend>; busy: boolean }) {
  const { t } = useI18n();
  const hasTrend = props.trend.some((week) => week.wastePercent !== null);
  return <>
    <section className="panel report-trend-panel">
      <div className="panel-head"><div><span className="eyebrow">{t('LAST 8 WEEKS')}</span><h2>{t('Weekly waste rate')}</h2><p>{t('Waste divided by production for each Monday–Sunday week.')}</p></div></div>
      {props.busy ? <LoadingState label="Building your report…" /> : hasTrend ? <TrendLine weeks={props.trend} /> : <EmptyState title="No production in the last 8 weeks" detail="The trend appears once food is produced." />}
    </section>
    <section className="panel report-weekday-panel">
      <div className="panel-head"><div><span className="eyebrow">{t('LAST 4 WEEKS')}</span><h2>{t('Average sold by weekday')}</h2><p>{t('Average boxes sold on days the option was on offer. Darker means more.')}</p></div></div>
      {props.busy ? <LoadingState label="Building your report…" /> : props.weekday.length === 0 ? <EmptyState title="No closed days yet" detail="Weekday sales appear after daily closing is completed." /> : <WeekdayGrid rows={props.weekday} />}
    </section>
  </>;
}
