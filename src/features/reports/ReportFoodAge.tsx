import { Lightbulb } from 'lucide-react';
import { EmptyState, LoadingState } from '../../components/Feedback';
import { formatQuantity } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { AgeBucket, foodAge } from '../../lib/foodInsights';

const BUCKETS: Array<{ key: AgeBucket; label: string }> = [
  { key: 'day0', label: 'Same day' },
  { key: 'day1', label: 'Day 2' },
  { key: 'day2', label: 'Day 3' },
  { key: 'day3plus', label: 'Day 4+' },
];

const INSIGHT: Record<AgeBucket, string> = {
  day0: 'Most waste was food thrown away on the day it was made.',
  day1: 'Most waste was food on its 2nd day.',
  day2: 'Most waste was food on its 3rd day.',
  day3plus: 'Most waste was food on its 4th day or older.',
};

function AgeRow({ title, values, tone }: { title: string; values: Record<AgeBucket, number>; tone: 'waste' | 'sold' }) {
  const { t } = useI18n();
  const max = Math.max(1, ...Object.values(values));
  return <div className="report-age-row">
    <strong>{t(title)}</strong>
    <div className="report-age-cells">{BUCKETS.map((bucket) => <div key={bucket.key} className={`report-age-cell ${tone}`}>
      <span className="report-age-bar"><i style={{ height: `${values[bucket.key] / max * 100}%` }} /></span>
      <b>{formatQuantity(values[bucket.key])}</b>
      <small>{t(bucket.label)}</small>
    </div>)}</div>
  </div>;
}

export function ReportFoodAge({ age, busy }: { age: ReturnType<typeof foodAge>; busy: boolean }) {
  const { t } = useI18n();
  const wasteTotal = Object.values(age.waste).reduce((sum, value) => sum + value, 0);
  const soldTotal = Object.values(age.sold).reduce((sum, value) => sum + value, 0);
  return <section className="panel report-food-age">
    <div className="panel-head"><div><span className="eyebrow">{t('FOOD AGE')}</span><h2>{t('How old the food was')}</h2><p>{t('Days since the batch was made. Sold ages are estimated because sales count from the oldest batch first.')}</p></div></div>
    {busy ? <LoadingState label="Building your report…" /> : wasteTotal + soldTotal + age.unknownWaste === 0 ? <EmptyState title="No food records in this range" detail="Try a different date range or clear some filters." /> : <>
      <AgeRow title="Wasted" values={age.waste} tone="waste" />
      <AgeRow title="Sold (estimated)" values={age.sold} tone="sold" />
      {age.dominantWasteBucket && <p className="report-insight"><Lightbulb size={16} aria-hidden="true" /> {t(INSIGHT[age.dominantWasteBucket])}</p>}
      {age.unknownWaste > 0 && <p className="report-age-unknown">{formatQuantity(age.unknownWaste)} {t('boxes without a usable batch date')}</p>}
    </>}
  </section>;
}
