import { Link } from 'react-router-dom';
import { BookingPublicLayout } from './BookingPublicLayout';
import { useI18n } from '../../lib/i18n';

export function BookingPrivacyPage() {
  const { t } = useI18n();
  const sections = [
    ['Information we collect', 'Your name, phone number, optional email, booking purpose, and booking date and time.'],
    ['How we use it', 'We use this information to manage your booking, identify you on arrival, and contact you if the booking changes.'],
    ['Who can see it', 'Only authorised 4Seas staff can see customer details. Other visitors see only which times are unavailable.'],
    ['How long we keep it', 'We keep booking information only as long as needed for operations. Contact the front desk if you want to request deletion.'],
  ];
  return <BookingPublicLayout><main className="booking-confirmation-main"><section className="panel booking-privacy-card"><span className="eyebrow">{t('YOUR INFORMATION')}</span><h1>{t('Privacy notice')}</h1>{sections.map(([title, body]) => <div key={title}><h2>{t(title)}</h2><p>{t(body)}</p></div>)}<Link className="button button-primary" to="/book">{t('Back to booking')}</Link></section></main></BookingPublicLayout>;
}
