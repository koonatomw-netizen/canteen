import { useEffect, useState } from 'react';
import { CalendarCheck, PackageOpen, ReceiptText, Trash2, UtensilsCrossed } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { businessDateNow } from '../../lib/dates';
import { formatQuantity } from '../../lib/format';
import { getExpiryStatus } from '../../lib/stock';
import { useI18n } from '../../lib/i18n';
import { requireSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { ProductionPage } from '../production/ProductionPage';
import { StockPage } from '../stock/StockPage';
import { WastePage } from '../waste/WastePage';
import { ClosingPage } from '../closing/ClosingPage';

interface ProductionRow { id: string; }
interface WasteRow { id: string; quantity: number; }
interface ClosingRow { status: 'open' | 'closed' | 'reopened'; version: number; }
interface StockRow { expiry_date: string; quantity_remaining: number; }
type FrontTab = 'production' | 'stock' | 'closing';
type StockSection = 'stock' | 'waste';

function validTab(value: string | null): FrontTab {
  return value === 'stock' || value === 'closing' ? value : 'production';
}

export function TodayPage() {
  const { member } = useAuth();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = businessDateNow();
  const [production, setProduction] = useState<ProductionRow[]>([]);
  const [waste, setWaste] = useState<WasteRow[]>([]);
  const [closing, setClosing] = useState<ClosingRow | null>(null);
  const [urgentStock, setUrgentStock] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const isKitchen = member?.role === 'kitchen';
  const activeTab = validTab(searchParams.get('tab'));
  const stockSection: StockSection = searchParams.get('section') === 'waste' ? 'waste' : 'stock';

  useEffect(() => {
    let alive = true;
    async function load() {
      setBusy(true); setError('');
      if (isKitchen) {
        if (alive) setBusy(false);
        return;
      }
      const db = requireSupabase();
      const [productionResult, wasteResult, closingResult, stockResult] = await Promise.all([
        db.from('production_batches').select('id').eq('production_date', today).is('deleted_at', null),
        db.from('waste_records').select('id, quantity').eq('waste_date', today).is('deleted_at', null),
        db.from('daily_closings').select('status, version').eq('business_date', today).order('version', { ascending: false }).limit(1).maybeSingle(),
        db.from('v_stock_by_batch').select('expiry_date, quantity_remaining').gt('quantity_remaining', 0),
      ]);
      if (!alive) return;
      const firstError = [productionResult, wasteResult, closingResult, stockResult].find((result) => result.error)?.error;
      if (firstError) setError(firstError.message);
      const stockRows = (stockResult.data ?? []) as StockRow[];
      setProduction((productionResult.data ?? []) as ProductionRow[]);
      setWaste((wasteResult.data ?? []) as WasteRow[]);
      setClosing((closingResult.data as ClosingRow | null) ?? null);
      setUrgentStock(stockRows.filter((row) => ['today', 'expired'].includes(getExpiryStatus(row.expiry_date, today))).reduce((sum, row) => sum + Number(row.quantity_remaining), 0));
      setBusy(false);
    }
    void load();
    return () => { alive = false; };
  }, [isKitchen, today]);

  function selectTab(tab: FrontTab) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    if (tab !== 'stock') { next.delete('section'); next.delete('batch'); }
    else if (!next.has('section')) next.set('section', 'stock');
    setSearchParams(next);
  }

  function selectStockSection(section: StockSection) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'stock');
    next.set('section', section);
    if (section === 'stock') next.delete('batch');
    setSearchParams(next);
  }

  return <>
    <PageTitle eyebrow={isKitchen ? 'KITCHEN SHIFT' : 'FRONT SHIFT'} title={t('Today’s work')} detail={t('Your shift at a glance')} />
    {error && <Notice>{error}</Notice>}
    {isKitchen ? <div className="today-home-grid kitchen-today-grid">
      <section className="panel today-summary-panel"><div className="today-summary-mark"><ReceiptText size={20} /></div><span className="eyebrow">{t('KITCHEN SHIFT')}</span><h2>{t('Record a purchase')}</h2><p>{t('Add expenses here. Saved expense details are only visible to managers and Website Admin.')}</p>
        <Link className="button button-primary today-main-action" to="/expenses"><ReceiptText size={17} />{t('Add an expense')}</Link>
      </section>
    </div> : <div className="front-today-workspace">
      <section className="panel front-work-summary"><div className="front-work-summary-heading"><span className="today-summary-mark"><CalendarCheck size={19} /></span><div><span className="eyebrow">{t('TODAY’S CHECK-IN')}</span><strong>{busy ? t('Loading…') : t(closing?.status === 'closed' ? 'Closing complete' : 'Closing not completed')}</strong></div><span className={`front-closing-state${closing?.status === 'closed' ? ' complete' : ''}`}>{busy ? '—' : closing?.status === 'closed' ? t('CLOSED') : t('OPEN')}</span></div>
        <div className="front-work-summary-stats"><span><small>{t('Production batches')}</small><strong>{busy ? '—' : production.length}</strong></span><span><small>{t('Waste today')}</small><strong>{busy ? '—' : `${formatQuantity(waste.reduce((sum, row) => sum + Number(row.quantity), 0))} ${t('boxes')}`}</strong></span><span><small>{t('Needs attention')}</small><strong>{busy ? '—' : `${formatQuantity(urgentStock)} ${t('boxes')}`}</strong></span></div>
      </section>
      <div className="front-work-tabs" role="tablist" aria-label={t('Today’s work')}>
        <button type="button" role="tab" aria-selected={activeTab === 'production'} className={activeTab === 'production' ? 'active' : ''} onClick={() => selectTab('production')}><UtensilsCrossed size={17} /><span>{t('Production')}</span><small>{busy ? '—' : production.length}</small></button>
        <button type="button" role="tab" aria-selected={activeTab === 'stock'} className={activeTab === 'stock' ? 'active' : ''} onClick={() => selectTab('stock')}><PackageOpen size={17} /><span>{t('Stock & waste')}</span><small>{busy ? '—' : formatQuantity(urgentStock)}</small></button>
        <button type="button" role="tab" aria-selected={activeTab === 'closing'} className={activeTab === 'closing' ? 'active' : ''} onClick={() => selectTab('closing')}><CalendarCheck size={17} /><span>{t('Daily closing')}</span><small>{closing?.status === 'closed' ? '✓' : '→'}</small></button>
      </div>
      <section className="front-work-panel" role="tabpanel">
        {activeTab === 'production' && <ProductionPage embedded />}
        {activeTab === 'stock' && <>
          <div className="front-stock-tabs" role="tablist" aria-label={t('Stock and waste')}>
            <button type="button" role="tab" aria-selected={stockSection === 'stock'} className={stockSection === 'stock' ? 'active' : ''} onClick={() => selectStockSection('stock')}><PackageOpen size={16} />{t('Available stock')}</button>
            <button type="button" role="tab" aria-selected={stockSection === 'waste'} className={stockSection === 'waste' ? 'active' : ''} onClick={() => selectStockSection('waste')}><Trash2 size={16} />{t('Waste & after-close')}</button>
          </div>
          {stockSection === 'stock' ? <StockPage embedded /> : <WastePage embedded />}
        </>}
        {activeTab === 'closing' && <ClosingPage embedded />}
      </section>
    </div>}
  </>;
}
