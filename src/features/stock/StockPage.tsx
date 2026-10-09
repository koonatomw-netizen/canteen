import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Boxes, CircleAlert, Filter, PackageOpen, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { StatusBadge } from '../../components/StatusBadge';
import { businessDateNow, formatBusinessDate } from '../../lib/dates';
import { formatQuantity } from '../../lib/format';
import { getExpiryStatus, type ExpiryStatus } from '../../lib/stock';
import { requireSupabase } from '../../lib/supabase';
import { useI18n } from '../../lib/i18n';

interface StockRow { id: string; menu_id: string; menu_name: string; production_date: string; expiry_date: string; quantity_remaining: number; }

export function StockPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [filter, setFilter] = useState<'all' | ExpiryStatus>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const today = businessDateNow();

  useEffect(() => {
    let alive = true;
    void requireSupabase().from('v_stock_by_batch').select('id, menu_id, menu_name, production_date, expiry_date, quantity_remaining').gt('quantity_remaining', 0).order('expiry_date').then(({ data, error: loadError }) => {
      if (!alive) return;
      if (loadError) setError(loadError.message);
      setRows((data ?? []) as StockRow[]); setBusy(false);
    });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => rows.filter((row) => {
    const status = getExpiryStatus(row.expiry_date, today);
    return (filter === 'all' || filter === status) && row.menu_name.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  }), [rows, filter, search, today]);
  const totalBoxes = rows.reduce((sum, row) => sum + Number(row.quantity_remaining), 0);
  const urgentBoxes = rows.filter((row) => ['today', 'expired'].includes(getExpiryStatus(row.expiry_date, today))).reduce((sum, row) => sum + Number(row.quantity_remaining), 0);

  return <>
    <PageTitle eyebrow="WHAT’S READY TO SELL" title="Stock & expiry" detail="See every box by batch, so you know what’s on hand and what needs attention." action={<Link to="/production" className="button button-primary"><Boxes size={17} /> Add production</Link>} />
    {error && <Notice>{error}</Notice>}
    <section className="stock-summary-row"><div className="stock-summary-card"><span className="summary-icon summary-green"><PackageOpen size={18} /></span><span><small>{t('ON HAND')}</small><strong>{busy ? '—' : formatQuantity(totalBoxes)} {t('boxes')}</strong></span><span className="summary-note">{t('Across')} {rows.length} {t('batches')}</span></div><div className="stock-summary-card"><span className="summary-icon summary-peach"><CircleAlert size={18} /></span><span><small>{t('NEEDS ATTENTION')}</small><strong>{busy ? '—' : formatQuantity(urgentBoxes)} {t('boxes')}</strong></span><span className="summary-note">{t('Expired or expires today')}</span></div><div className="stock-summary-card"><span className="summary-icon summary-blue"><Filter size={18} /></span><span><small>{t('EXPIRY CHECK')}</small><strong>{formatBusinessDate(today)}</strong></span><span className="summary-note">{t('Based on Bangkok time')}</span></div></section>
    <section className="panel stock-full-panel"><div className="stock-tools"><div className="panel-head"><div><span className="eyebrow">{t('BATCH BY BATCH')}</span><h2>{t('Available stock')}</h2></div><span className="count-chip">{filtered.length} {t('SHOWING')}</span></div><div className="stock-search"><Search size={16} /><input aria-label={t('Search menu items')} placeholder={t('Find a menu item')} value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
      <div className="filter-pills" role="group" aria-label={t('Filter stock by expiry')}><button className={filter === 'all' ? 'filter-pill active' : 'filter-pill'} onClick={() => setFilter('all')}>{t('All batches')}</button><button className={filter === 'expired' ? 'filter-pill active' : 'filter-pill'} onClick={() => setFilter('expired')}>{t('Expired')}</button><button className={filter === 'today' ? 'filter-pill active' : 'filter-pill'} onClick={() => setFilter('today')}>{t('Expires today')}</button><button className={filter === 'tomorrow' ? 'filter-pill active' : 'filter-pill'} onClick={() => setFilter('tomorrow')}>{t('Expires tomorrow')}</button><button className={filter === 'normal' ? 'filter-pill active' : 'filter-pill'} onClick={() => setFilter('normal')}>{t('Good')}</button></div>
      {busy ? <LoadingState label="Counting by batch…" /> : filtered.length === 0 ? <EmptyState title={t(rows.length ? 'No batches in this view' : 'Nothing on hand today')} detail={t(rows.length ? 'Try another filter or search term.' : 'Once you record production, each batch will appear here with its own expiry date.')} /> : <div className="stock-cards">{filtered.map((row) => { const status = getExpiryStatus(row.expiry_date, today); return <article className="stock-card" key={row.id}><span className={`stock-food-icon food-${status}`}><Boxes size={18} /></span><div className="stock-card-main"><div className="stock-card-name"><strong>{row.menu_name}</strong><StatusBadge status={status} /></div><span className="stock-card-sub">{t('Made')} {formatBusinessDate(row.production_date)} <span>·</span> {t('Best before')} {formatBusinessDate(row.expiry_date)}</span><span className="stock-card-batch">{t('BATCH')} {row.id.slice(0, 8).toUpperCase()}</span></div><div className="stock-card-qty"><strong>{formatQuantity(row.quantity_remaining)}</strong><small>{t('boxes')}</small></div><Link to={`/waste?batch=${row.id}`} className="icon-button" title={t('Record waste from this batch')} aria-label={`${t('Record waste from')} ${row.menu_name}`}><ArrowRight size={17} /></Link></article>; })}</div>}
    </section>
    <p className="stock-disclaimer"><CircleAlert size={14} /> {t('Expired stock stays on the list until a team member records what happened.')}</p>
  </>;
}
