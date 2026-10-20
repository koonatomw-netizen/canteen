import { useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { BookingPublicLayout } from './BookingPublicLayout';
import { useI18n } from '../../lib/i18n';
import { requireSupabase } from '../../lib/supabase';
import { toBusinessDate, toBusinessTime } from './bookingModel';

type Confirmation = { reference: string; starts_at: string; ends_at: string; duration_minutes: number; status: string };

export function BookingConfirmationPage() {
  const { reference = '' } = useParams();
  const { t, language } = useI18n();
  const [booking, setBooking] = useState<Confirmation | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setBooking(undefined);
    setFailed(false);
    void requireSupabase().rpc('get_room_booking_confirmation', { p_reference: reference.toUpperCase() })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setFailed(true); setBooking(null); return; }
        setBooking(((data as Confirmation[] | null) ?? [])[0] ?? null);
      }, () => { if (alive) { setFailed(true); setBooking(null); } });
    return () => { alive = false; };
  }, [reference]);

  const locale = language === 'th' ? 'th-TH' : 'en-GB';
  const date = booking ? toBusinessDate(new Date(booking.starts_at)) : null;
  return <BookingPublicLayout><main className="booking-confirmation-main">
    {booking === undefined ? <p className="booking-loading">{t('Loading booking…')}</p> : failed ? <section className="panel booking-confirmation-card"><h1>{t('Could not check this booking')}</h1><p>{t('Check your internet connection and try again, or ask the front desk for help.')}</p><button type="button" className="button button-primary" onClick={() => window.location.reload()}>{t('Try again')}</button></section> : !booking ? <section className="panel booking-confirmation-card"><h1>{t('Booking not found')}</h1><p>{t('Check the booking reference or ask the front desk for help.')}</p><div className="booking-card-buttons"><Link className="button button-primary" to="/my-booking">{t('Try another code')}</Link><Link className="button button-quiet" to="/book">{t('Back to booking')}</Link></div></section> : booking.status === 'cancelled' ? <section className="panel booking-confirmation-card"><h1>{t('This booking was cancelled')}</h1><p>{t('Please contact the front desk if you need help.')}</p><Link className="button button-primary" to="/book">{t('Book another time')}</Link></section> : <section className="panel booking-confirmation-card"><CheckCircle2 className="booking-confirmation-check" size={48} /><span className="eyebrow">{t('BOOKING CONFIRMED')}</span><h1>{t("You're booked")}</h1><p>{t('Show this reference at the front desk when you arrive.')}</p><div className="booking-reference"><small>{t('Booking reference')}</small><strong>{booking.reference}</strong></div><div className="booking-confirmation-details"><div><CalendarDays size={18} /><span>{t('Date')}<strong>{date ? new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`)) : ''}</strong></span></div><div><Clock3 size={18} /><span>{t('Time')}<strong>{toBusinessTime(new Date(booking.starts_at))}–{toBusinessTime(new Date(booking.ends_at))}</strong></span></div></div><p className="booking-screenshot-hint">{t('Take a screenshot of this page for your records.')}</p><Link className="button button-quiet" to="/book">{t('Book another time')}</Link></section>}
  </main></BookingPublicLayout>;
}
