import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../lib/i18n';
import { BookingPublicLayout } from './BookingPublicLayout';
import { normalizeBookingReference } from './bookingModel';

export function MyBookingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const reference = normalizeBookingReference(value);
    if (!reference) {
      setError(t('Enter the 8-character code from your confirmation, for example 4S-ABCD-EF23.'));
      return;
    }
    navigate(`/booking/confirmation/${encodeURIComponent(reference)}`);
  }

  return <BookingPublicLayout><main className="booking-confirmation-main">
    <section className="panel booking-confirmation-card booking-lookup-card">
      <span className="eyebrow">{t('MY BOOKING')}</span>
      <h1>{t('Check your booking')}</h1>
      <p>{t('Enter the booking code shown on your confirmation page.')}</p>
      <form className="booking-lookup-form" onSubmit={submit} noValidate>
        <label htmlFor="booking-reference">{t('Booking code')}</label>
        <input id="booking-reference" value={value} onChange={(event) => { setValue(event.target.value); setError(null); }}
          placeholder="4S-ABCD-EF23" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20}
          aria-invalid={Boolean(error)} aria-describedby={error ? 'booking-reference-error' : undefined} />
        {error && <small id="booking-reference-error" className="field-error">{error}</small>}
        <button className="booking-submit" type="submit"><Search size={18} /> {t('Find my booking')}</button>
      </form>
      <p className="booking-screenshot-hint">{t('Lost your code? Ask the front desk with the name and phone number you booked with.')}</p>
      <Link className="button button-quiet" to="/book">{t('Book the podcast room')}</Link>
    </section>
  </main></BookingPublicLayout>;
}
