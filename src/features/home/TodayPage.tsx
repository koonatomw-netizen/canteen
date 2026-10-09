import { useEffect, useState } from 'react';
import { ArrowRight, CalendarCheck, ClipboardCheck, PackageOpen, ReceiptText, Trash2, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { businessDateNow } from '../../lib/dates';
import { formatBaht, formatQuantity } from '../../lib/format';
import { getExpiryStatus } from '../../lib/stock';
import { useI18n } from '../../lib/i18n';
import { requireSupabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';

interface ProductionRow { id: string; }
interface WasteRow { id: string; quantity: number; }
interface ClosingRow { status: 'open' | 'closed' | 'reopened'; version: number; }
interface StockRow { expiry_date: string; quantity_remaining: number; }
interface ExpenseRow { id: string; amount_thb: number; }

function ActionCard({ to, icon: Icon, title, detail, value, tone = 'green' }: { to: string; icon: LucideIcon; title: string; detail: string; value?: string; tone?: string }) {
  return <Link to={to} className={`today-action-card today-${tone}`}>
    <span className="today-action-icon"><Icon size={19} /></span>
    <span className="today-action-copy"><strong>{title}</strong><small>{detail}</small></span>
    {value && <span className="today-action-value">{value}</span>}
    <ArrowRight size={16} className="today-action-arrow" />
  </Link>;
}

export function TodayPage() {
  const { member } = useAuth();
  const { t } = useI18n();
  const today = businessDateNow();
  const [production, setProduction] = useState<ProductionRow[]>([]);
  const [waste, setWaste] = useState<WasteRow[]>([]);
  const [closing, setClosing] = useState<ClosingRow | null>(null);
  const [urgentStock, setUrgentStock] = useState(0);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const isKitchen = member?.role === 'kitchen';

  useEffect(() => {
    let alive = true;
    async function load() {
      setBusy(true); setError('');
      const db = requireSupabase();
      if (isKitchen) {
        const result = await db.from('expenses').select('id, amount_thb').eq('expense_date', today).is('deleted_at', null);
        if (!alive) return;
        if (result.error) setError(result.error.message);
        setExpenses((result.data ?? []) as ExpenseRow[]);
      } else {
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
      }
      if (alive) setBusy(false);
    }
    void load();
    return () => { alive = false; };
  }, [isKitchen, today]);

  const expenseTotal = expenses.reduce((sum, row) => sum + Number(row.amount_thb), 0);

  return <>
    <PageTitle eyebrow={isKitchen ? 'KITCHEN SHIFT' : 'FRONT SHIFT'} title={t('Today’s work')} detail={t('Your shift at a glance')} />
    {error && <Notice>{error}</Notice>}
    {busy ? <section className="panel"><LoadingState /></section> : isKitchen ? <div className="today-home-grid kitchen-today-grid">
      <section className="panel today-summary-panel"><div className="today-summary-mark"><ReceiptText size={20} /></div><span className="eyebrow">{t('Today’s expenses')}</span><strong className="today-summary-number">{formatBaht(expenseTotal)}</strong><p>{expenses.length} {t('purchases recorded')}</p>
        <Link className="button button-primary today-main-action" to="/expenses"><ReceiptText size={17} />{t('Add an expense')}</Link>
      </section>
      <div className="today-action-list"><ActionCard to="/expenses" icon={ReceiptText} title={t('Expense form')} detail={t('Add an expense for today.')} value={`${expenses.length}`} /><ActionCard to="/expenses" icon={ClipboardCheck} title={t('Today’s expenses')} detail={t('Review today’s saved entries.')} value={formatBaht(expenseTotal)} tone="blue" /></div>
    </div> : <div className="today-home-grid">
      <section className="panel today-summary-panel"><div className="today-summary-mark"><CalendarCheck size={20} /></div><span className="eyebrow">{t('Today’s work')}</span><strong className="today-summary-number">{closing?.status === 'closed' ? t('Closing complete') : t('Closing not completed')}</strong><p>{closing?.status === 'closed' ? `${t('Day closed')} · v${closing.version}` : t('Count stock and close the day.')}</p>
        <Link className="button button-primary today-main-action" to="/closing"><CalendarCheck size={17} />{t(closing?.status === 'closed' ? 'Day closed' : 'Open daily closing')}</Link>
      </section>
      <div className="today-action-list">
        <ActionCard to="/production" icon={UtensilsCrossed} title={t(production.length ? 'Production recorded' : 'No production recorded yet')} detail={t('Record food prepared today.')} value={busy ? '—' : `${production.length}`} />
        <ActionCard to="/waste" icon={Trash2} title={t('Waste entries today')} detail={t('Log food that was discarded.')} value={busy ? '—' : `${waste.reduce((sum, row) => sum + Number(row.quantity), 0)} ${t('boxes')}`} tone="peach" />
        <ActionCard to="/closing" icon={CalendarCheck} title={t(closing?.status === 'closed' ? 'Closing complete' : 'Closing not completed')} detail={t('Count stock and close the day.')} value={closing?.status === 'closed' ? '✓' : '→'} tone="blue" />
        <ActionCard to="/stock" icon={PackageOpen} title={t('Stock needs attention')} detail={t('Review batches and expiry dates.')} value={`${formatQuantity(urgentStock)} ${t('boxes')}`} tone="amber" />
      </div>
      {waste.length === 0 && <p className="today-guidance"><Trash2 size={14} />{t('No waste recorded today')} · {t('Log food that was discarded.')}</p>}
    </div>}
  </>;
}
