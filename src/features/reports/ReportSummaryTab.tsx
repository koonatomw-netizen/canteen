import type { ReactNode } from 'react';
import { Lightbulb, TrendingDown, TrendingUp } from 'lucide-react';
import { EmptyState, LoadingState } from '../../components/Feedback';
import { formatQuantity } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { GuideRow, MeatSummary, MostWastedRow } from '../../lib/foodInsights';

function percent(value: number | null) {
  return value === null ? '—' : `${Math.round(value)}%`;
}

function fill(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

function share(part: number, total: number) {
  return total > 0 ? `${part / total * 100}%` : '0%';
}

function GuideList({ rows, tone }: { rows: GuideRow[]; tone: 'less' | 'more' }) {
  const { t } = useI18n();
  return <ul className={`report-guide-list report-guide-${tone}`}>{rows.map((row) => <li key={row.label}>
    <strong>{row.label}</strong>
    <small>{row.produced > 0 ? fill(t('wasted {waste} of {produced} · sold out {soldOut} of {days} days'), { waste: formatQuantity(row.waste), produced: formatQuantity(row.produced), soldOut: row.soldOutDays, days: row.stockedDays }) : fill(t('no production in the last 4 weeks · sold out {soldOut} of {days} days'), { soldOut: row.soldOutDays, days: row.stockedDays })}</small>
  </li>)}</ul>;
}

export function ReportSummaryTab(props: {
  mostWasted: MostWastedRow[];
  meat: MeatSummary[];
  guide: GuideRow[];
  busy: boolean;
  reasonFilterActive: boolean;
  totalWaste: number;
  /** Waste behind the Most wasted list (follows the waste-reason filter). */
  rankedWasteTotal: number;
  totalProduced: number;
  chart: ReactNode;
}) {
  const { t } = useI18n();
  const top = props.meat[0];
  const makeLess = props.guide.filter((row) => row.verdict === 'make_less');
  const makeMore = props.guide.filter((row) => row.verdict === 'could_make_more');
  const aboutRight = props.guide.filter((row) => row.verdict === 'about_right');
  const notEnough = props.guide.filter((row) => row.verdict === 'not_enough_data');
  return <>
    <div className="report-summary-grid">
      <section className="panel report-most-wasted">
        <div className="panel-head"><div><span className="eyebrow">{t('MOST WASTED')}</span><h2>{t('What went to waste')}</h2><p>{props.totalProduced > 0 ? fill(t('{waste} boxes wasted out of {produced} made.'), { waste: formatQuantity(props.rankedWasteTotal), produced: formatQuantity(props.totalProduced) }) : t('Ranked by boxes thrown away.')}</p></div></div>
        {props.busy ? <LoadingState label="Building your report…" /> : props.mostWasted.length === 0 ? <EmptyState title="Nothing was wasted in this period" detail="Great work. Wasted menus will be ranked here." /> : <ol className="report-rank-list">{props.mostWasted.map((row, index) => <li key={row.label} className={index < 3 ? 'top' : undefined}>
          <span className="report-rank-number">{index + 1}</span>
          <span className="report-rank-name"><strong>{row.label}</strong><small>{fill(t('Made {produced} · sold {sold}'), { produced: formatQuantity(row.produced), sold: formatQuantity(row.sold) })}</small></span>
          <span className="report-rank-amount"><strong>{formatQuantity(row.waste)} {t('boxes')}</strong><small>{row.wasteRate === null ? t('No production in this period') : fill(t('{percent} of made'), { percent: percent(row.wasteRate) })}</small></span>
        </li>)}</ol>}
      </section>

      <section className="panel report-guide">
        <div className="panel-head"><div><span className="eyebrow">{t('LAST 4 WEEKS')}</span><h2>{t('Make more / Make less')}</h2><p>{t('Suggestions only. Compare them with what you know about the week.')}</p></div></div>
        {props.reasonFilterActive && <p className="report-guide-note">{t('Suggestions ignore the waste-reason filter.')}</p>}
        {props.busy ? <LoadingState label="Building your report…" /> : props.guide.length === 0 ? <EmptyState title="No history yet" detail="Suggestions appear after a few closed days." /> : <>
          {makeLess.length > 0 && <div className="report-guide-group"><span className="report-guide-tag less"><TrendingDown size={14} /> {t('Make less')}</span><GuideList rows={makeLess} tone="less" /></div>}
          {makeMore.length > 0 && <div className="report-guide-group"><span className="report-guide-tag more"><TrendingUp size={14} /> {t('Could make more')}</span><GuideList rows={makeMore} tone="more" /></div>}
          {makeLess.length === 0 && makeMore.length === 0 && <p className="report-guide-calm">{t('No changes suggested. Production matched sales well.')}</p>}
          {aboutRight.length > 0 && <details className="report-guide-more"><summary><span className="report-guide-tag ok">{t('About right')}</span> {aboutRight.length} {t('options')}</summary><GuideList rows={aboutRight} tone="more" /></details>}
          {notEnough.length > 0 && <details className="report-guide-more"><summary><span className="report-guide-tag wait">{t('Not enough data yet')}</span> {notEnough.length} {t('options')}</summary><GuideList rows={notEnough} tone="more" /></details>}
        </>}
      </section>
    </div>

    <section className="panel report-meat-summary">
      <div className="panel-head"><div><span className="eyebrow">{t('BY MEAT OPTION')}</span><h2>{t('Waste by meat option')}</h2></div><span className="chart-legend"><i className="legend-ins-sold" /> {t('Sold')} <i className="legend-ins-waste" /> {t('Waste')} <i className="legend-ins-stock" /> {t('Still in stock')}</span></div>
      {props.busy ? <LoadingState label="Building your report…" /> : props.meat.length === 0 ? <EmptyState title="No food records in this range" detail="Try a different date range or clear some filters." /> : <>
        <div className="report-meat-rows">{props.meat.map((row) => {
          const total = row.sold + row.waste + Math.max(row.currentStock, 0);
          return <div className="report-meat-row" key={row.meat}>
            <strong>{row.meat}</strong>
            <span className="report-stack-bar" role="img" aria-label={`${row.meat}: ${row.sold} ${t('Sold')}, ${row.waste} ${t('Waste')}, ${Math.max(row.currentStock, 0)} ${t('Still in stock')}`}><i className="sold" style={{ width: share(row.sold, total) }} /><i className="waste" style={{ width: share(row.waste, total) }} /><i className="stock" style={{ width: share(Math.max(row.currentStock, 0), total) }} /></span>
            <span className={row.waste > 0 ? 'report-meat-waste has-waste' : 'report-meat-waste'}>{formatQuantity(row.waste)} · {percent(row.wasteRate)}</span>
          </div>;
        })}</div>
        {props.totalWaste >= 3 && top && top.waste > 0 && <p className="report-insight"><Lightbulb size={16} aria-hidden="true" /> {fill(t(top.topMenus.length > 1 ? '{meat} caused {waste} of the {total} wasted boxes, mostly in {menu1} and {menu2}.' : '{meat} caused {waste} of the {total} wasted boxes, mostly in {menu1}.'), { meat: top.meat, waste: formatQuantity(top.waste), total: formatQuantity(props.totalWaste), menu1: top.topMenus[0] ?? '', menu2: top.topMenus[1] ?? '' })}</p>}
      </>}
    </section>

    {props.chart}
  </>;
}
