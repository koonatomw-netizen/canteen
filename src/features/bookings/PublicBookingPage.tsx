import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, Check, Clock3, ShieldCheck } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessage, requireSupabase } from '../../lib/supabase';
import { useI18n } from '../../lib/i18n';
import {
  BOOKING_DURATIONS,
  PODCAST_ROOM_SLUG,
  businessDayBounds,
  computeDayAvailability,
  computeWindowSummary,
  minutesToTime,
  timeToMinutes,
  type BusyInterval,
  type DateSummary,
  type DayAvailability,
  type TimeSlot,
} from './bookingModel';
import { BookingPublicLayout } from './BookingPublicLayout';

type Fields = { customerName: string; customerPhone: string; customerEmail: string; purpose: string };
type FieldName = keyof Fields;

const EMPTY_FIELDS: Fields = { customerName: '', customerPhone: '', customerEmail: '', purpose: '' };

function formatDate(date: string, language: 'en' | 'th', options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'UTC', ...options })
    .format(new Date(`${date}T12:00:00Z`));
}

function durationLabel(minutes: number, language: 'en' | 'th'): string {
  if (language === 'th') return minutes < 60 ? `${minutes} นาที` : minutes === 60 ? '1 ชั่วโมง' : `${minutes / 60} ชั่วโมง`;
  return minutes < 60 ? `${minutes} min` : minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
}

async function getBusy(from: Date, to: Date): Promise<BusyInterval[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_room_busy_intervals', {
    p_room_slug: PODCAST_ROOM_SLUG,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw error;
  return ((data ?? []) as Array<{ starts_at: string; ends_at: string }>).map((row) => ({
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
  }));
}

export function PublicBookingPage() {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [days, setDays] = useState<DateSummary[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<DayAvailability | null>(null);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadWindow = useCallback(async () => {
    const now = new Date();
    const first = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
    const last = new Date(`${days.at(-1)?.date ?? first}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() + (days.length ? 1 : 30));
    const busy = await getBusy(businessDayBounds(first).start, businessDayBounds(last.toISOString().slice(0, 10)).start);
    const summary = computeWindowSummary(busy, now);
    setDays(summary);
    setDate((current) => current ?? summary.find((item) => item.availableStarts > 0)?.date ?? summary[0]?.date ?? null);
  }, [days]);

  useEffect(() => {
    let alive = true;
    const now = new Date();
    const first = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
    const endDate = new Date(`${first}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 30);
    void getBusy(businessDayBounds(first).start, businessDayBounds(endDate.toISOString().slice(0, 10)).start)
      .then((busy) => {
        if (!alive) return;
        const summary = computeWindowSummary(busy, now);
        setDays(summary);
        setDate(summary.find((item) => item.availableStarts > 0)?.date ?? summary[0]?.date ?? null);
      })
      .catch((error) => { if (alive) setFormError(errorMessage(error)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    setDay(null);
    setSlot(null);
    setDuration(null);
    const bounds = businessDayBounds(date);
    void getBusy(bounds.start, bounds.end)
      .then((busy) => { if (alive) setDay(computeDayAvailability(date, busy, new Date())); })
      .catch((error) => { if (alive) setFormError(errorMessage(error)); });
    return () => { alive = false; };
  }, [date]);

  const endTime = useMemo(() => slot && duration
    ? minutesToTime(timeToMinutes(slot.startTime) + duration)
    : null, [slot, duration]);

  function chooseSlot(next: TimeSlot) {
    if (!next.durations.length) return;
    setSlot(next);
    setDuration(next.durations.includes(60) ? 60 : next.durations[0]);
    setFormError(null);
  }

  function updateField(name: FieldName, value: string) {
    setFields((previous) => ({ ...previous, [name]: value }));
    setFieldErrors((previous) => ({ ...previous, [name]: undefined }));
  }

  function validate(): boolean {
    const next: Partial<Record<FieldName, string>> = {};
    if (!fields.customerName.trim()) next.customerName = t('Enter your name.');
    const digits = fields.customerPhone.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15 || !/^[0-9+\-\s().]+$/.test(fields.customerPhone)) next.customerPhone = t('Enter a valid phone number.');
    if (fields.customerEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.customerEmail.trim())) next.customerEmail = t('Enter a valid email address.');
    if (!fields.purpose.trim()) next.purpose = t('Tell us what the booking is for.');
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!date || !slot || !duration || !validate() || submitting) return;
    setSubmitting(true);
    setFormError(null);
    const source = searchParams.get('source') === 'front-desk' ? 'front_desk_qr' : 'website';
    const client = requireSupabase();
    const { data, error } = await client.rpc('create_room_booking', {
      p_room_slug: PODCAST_ROOM_SLUG,
      p_date: date,
      p_start_time: slot.startTime,
      p_duration_minutes: duration,
      p_customer_name: fields.customerName.trim(),
      p_customer_phone: fields.customerPhone.trim(),
      p_customer_email: fields.customerEmail.trim() || null,
      p_purpose: fields.purpose.trim(),
      p_source: source,
    });
    if (error) {
      const conflict = error.code === '23P01';
      setFormError(t(conflict ? 'That time was just booked. Choose another available time.' : 'Booking could not be saved. Check the details and try again.'));
      if (conflict) {
        setSlot(null);
        setDuration(null);
        const bounds = businessDayBounds(date);
        try {
          const busy = await getBusy(bounds.start, bounds.end);
          setDay(computeDayAvailability(date, busy, new Date()));
          await loadWindow();
        } catch { /* Keep the conflict message visible. */ }
      }
      setSubmitting(false);
      return;
    }
    const reference = (data as Array<{ reference: string }> | null)?.[0]?.reference;
    if (!reference) {
      setFormError(t('Booking was saved but the confirmation could not be opened. Ask the front desk for help.'));
      setSubmitting(false);
      return;
    }
    navigate(`/booking/confirmation/${encodeURIComponent(reference)}`);
  }

  const visibleSlots = day?.slots.filter((item) => item.status !== 'past') ?? [];

  return (
    <BookingPublicLayout>
      <main className="booking-public-main">
        <div className="booking-public-intro"><span className="eyebrow">{t('PODCAST ROOM')}</span><h1>{t('Book the podcast room')}</h1><p>{t('Open every day 09:00–21:00 · Book up to 2 hours')}</p></div>
        {formError && <div className="notice notice-error booking-public-notice" role="alert">{formError}</div>}
        <form className="booking-form" onSubmit={submit} noValidate>
          <section className="panel booking-step">
            <div className="booking-step-title"><span>1</span><div><h2>{t('Choose a date')}</h2><p>{t('Booking is available up to 30 days ahead.')}</p></div></div>
            {loading ? <p className="booking-loading">{t('Loading available dates…')}</p> : (
              <div className="booking-date-strip">
                {days.map((item) => <button type="button" key={item.date} className={date === item.date ? 'active' : ''} disabled={item.availableStarts === 0} onClick={() => setDate(item.date)} aria-pressed={date === item.date}>
                  <span>{formatDate(item.date, language, { weekday: 'short' })}</span><strong>{formatDate(item.date, language, { day: 'numeric' })}</strong><small>{item.availableStarts ? `${item.availableStarts} ${t('times')}` : t('Full')}</small>
                </button>)}
              </div>
            )}
          </section>

          <section className="panel booking-step">
            <div className="booking-step-title"><span>2</span><div><h2>{t('Choose a start time')}</h2><p>{date ? formatDate(date, language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : t('Choose a date first.')}</p></div></div>
            {!day ? <p className="booking-loading">{t('Loading available times…')}</p> : visibleSlots.some((item) => item.durations.length) ? (
              <div className="booking-time-grid">{visibleSlots.map((item) => <button type="button" key={item.startTime} disabled={!item.durations.length} className={slot?.startTime === item.startTime ? 'active' : ''} onClick={() => chooseSlot(item)} aria-pressed={slot?.startTime === item.startTime}>
                <Clock3 size={15} /><span>{item.startTime}</span>{!item.durations.length && <small>{t('Booked')}</small>}
              </button>)}</div>
            ) : <p className="booking-empty">{t('No available times on this date. Choose another day.')}</p>}
          </section>

          <section className="panel booking-step">
            <div className="booking-step-title"><span>3</span><div><h2>{t('Choose a duration')}</h2><p>{t('Only durations that fit before the next booking are available.')}</p></div></div>
            <div className="booking-duration-grid">{BOOKING_DURATIONS.map((item) => <button type="button" key={item} disabled={!slot?.durations.includes(item)} className={duration === item ? 'active' : ''} onClick={() => setDuration(item)} aria-pressed={duration === item}>{durationLabel(item, language)}</button>)}</div>
          </section>

          <section className="panel booking-step">
            <div className="booking-step-title"><span>4</span><div><h2>{t('Your details')}</h2><p>{t('We use these details only to manage this booking.')}</p></div></div>
            <div className="booking-fields">
              <label>{t('Name')}<input autoComplete="name" maxLength={100} value={fields.customerName} onChange={(event) => updateField('customerName', event.target.value)} aria-invalid={Boolean(fieldErrors.customerName)} />{fieldErrors.customerName && <small className="field-error">{fieldErrors.customerName}</small>}</label>
              <label>{t('Phone number')}<input type="tel" inputMode="tel" autoComplete="tel" maxLength={25} value={fields.customerPhone} onChange={(event) => updateField('customerPhone', event.target.value)} aria-invalid={Boolean(fieldErrors.customerPhone)} />{fieldErrors.customerPhone && <small className="field-error">{fieldErrors.customerPhone}</small>}</label>
              <label>{t('Email (optional)')}<input type="email" inputMode="email" autoComplete="email" maxLength={254} value={fields.customerEmail} onChange={(event) => updateField('customerEmail', event.target.value)} aria-invalid={Boolean(fieldErrors.customerEmail)} />{fieldErrors.customerEmail && <small className="field-error">{fieldErrors.customerEmail}</small>}</label>
              <label className="booking-purpose-field">{t('What is the booking for?')}<textarea rows={3} maxLength={500} placeholder={t('For example: podcast recording or guest interview')} value={fields.purpose} onChange={(event) => updateField('purpose', event.target.value)} aria-invalid={Boolean(fieldErrors.purpose)} />{fieldErrors.purpose && <small className="field-error">{fieldErrors.purpose}</small>}</label>
            </div>
          </section>

          {date && slot && duration && endTime && <section className="booking-summary-card"><CalendarDays size={22} /><div><span>{t('Your booking')}</span><strong>{formatDate(date, language, { weekday: 'long', day: 'numeric', month: 'long' })}</strong><small>{slot.startTime}–{endTime} · {durationLabel(duration, language)}</small></div><Check size={20} /></section>}

          <button className="booking-submit" type="submit" disabled={!date || !slot || !duration || submitting}>{submitting ? t('Booking…') : endTime ? `${t('Confirm booking')} · ${slot?.startTime}–${endTime}` : t('Confirm booking')}</button>
          <p className="booking-privacy-note"><ShieldCheck size={14} /> {t('Your details are private.')} <Link to="/privacy">{t('Privacy notice')}</Link></p>
        </form>
      </main>
    </BookingPublicLayout>
  );
}
