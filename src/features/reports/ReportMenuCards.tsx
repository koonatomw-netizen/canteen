import { useState, type ReactNode } from 'react';
import { CircleCheck, Table2 } from 'lucide-react';
import { EmptyState, LoadingState } from '../../components/Feedback';
import { formatQuantity } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { MenuCard } from '../../lib/foodInsights';

const SOLD = '#2f7a4f';
const WASTE = '#e0795a';
const STOCK = '#9fb3c8';

function donutBackground(card: MenuCard) {
  const stock = Math.max(card.currentStock, 0);
  const total = card.sold + card.waste + stock;
  if (total <= 0) return '#e8ece6';
  const soldEnd = card.sold / total * 100;
  const wasteEnd = soldEnd + card.waste / total * 100;
  return `conic-gradient(${SOLD} 0 ${soldEnd}%, ${WASTE} ${soldEnd}% ${wasteEnd}%, ${STOCK} ${wasteEnd}% 100%)`;
}

function Card({ card, rank }: { card: MenuCard; rank: number | null }) {
  const { t } = useI18n();
  const rate = card.wasteRate === null ? '—' : `${Math.round(card.wasteRate)}%`;
  return <article className={`report-menu-card${rank !== null && rank < 3 ? ' highlighted' : ''}`}>
    {rank === 0 && <span className="report-menu-badge">{t('Most wasted')}</span>}
    <h3>{card.menu}</h3>
    <p className="report-menu-sub">{formatQuantity(card.produced)} {t('made')} · {formatQuantity(card.waste)} {t('wasted')}{card.currentStock > 0 ? ` · ${formatQuantity(card.currentStock)} ${t('in stock')}` : ''}</p>
    <div className="report-donut" style={{ background: donutBackground(card) }} role="img" aria-label={`${card.menu}: ${card.sold} ${t('Sold')}, ${card.waste} ${t('Waste')}, ${Math.max(card.currentStock, 0)} ${t('Still in stock')}`}>
      <span><strong>{rate}</strong><small>{t('waste')}</small></span>
    </div>
    <ul className="report-menu-options">{card.options.map((option) => <li key={option.meat ?? '—'} className={option.isWorst ? 'worst' : undefined}>
      <span>{option.meat ?? t('No meat option')}</span>
      <span>{formatQuantity(option.sold)} {t('sold')} · {formatQuantity(option.waste)} {t('waste')}{option.currentStock > 0 ? ` · ${formatQuantity(option.currentStock)} ${t('left')}` : ''}</span>
    </li>)}</ul>
    {card.hasCorrections && <p className="report-menu-note">{t('Has stock corrections. See the table for details.')}</p>}
  </article>;
}

export function ReportMenuCards(props: { cards: { wasted: MenuCard[]; noWaste: MenuCard[] }; busy: boolean; table: ReactNode }) {
  const { t } = useI18n();
  const [showTable, setShowTable] = useState(false);
  const [showNoWaste, setShowNoWaste] = useState(false);
  const total = props.cards.wasted.length + props.cards.noWaste.length;
  return <section className="panel report-menu-panel">
    <div className="panel-head"><div><span className="eyebrow">{t('MENU AND MEAT BREAKDOWN')}</span><h2>{t('Where each box went')}</h2><p>{t('Highest waste first. Each card shows sold, waste and stock still on hand.')}</p></div>
      <button type="button" className="button button-quiet" aria-pressed={showTable} onClick={() => setShowTable((value) => !value)}><Table2 size={15} /> {t(showTable ? 'Show as cards' : 'Show as table')}</button></div>
    {showTable ? props.table : props.busy ? <LoadingState label="Building your report…" /> : total === 0 ? <EmptyState title="No food records in this range" detail="Try a different date range or clear some filters." /> : <>
      <span className="chart-legend report-menu-legend"><i className="legend-ins-sold" /> {t('Sold')} <i className="legend-ins-waste" /> {t('Waste')} <i className="legend-ins-stock" /> {t('Still in stock')}</span>
      <div className="report-menu-grid">{props.cards.wasted.map((card, index) => <Card key={card.menu} card={card} rank={index} />)}</div>
      {props.cards.noWaste.length > 0 && <>
        <button type="button" className="report-no-waste-toggle" aria-expanded={showNoWaste} onClick={() => setShowNoWaste((value) => !value)}><CircleCheck size={16} /> {props.cards.noWaste.length} {t('menus with no waste')}: {props.cards.noWaste.map((card) => card.menu).join(', ')} · {t(showNoWaste ? 'Hide' : 'Show')}</button>
        {showNoWaste && <div className="report-menu-grid">{props.cards.noWaste.map((card) => <Card key={card.menu} card={card} rank={null} />)}</div>}
      </>}
    </>}
  </section>;
}
