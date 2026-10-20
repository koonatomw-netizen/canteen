import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink, Headphones, Mail, Phone, RefreshCw, UserRound, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { useAuth } from '../auth/AuthContext';
import { addCalendarDays, businessDateNow } from '../../lib/dates';
import { errorMessage, requireSupabase } from '../../lib/supabase';
import { useI18n } from '../../lib/i18n';
import {
  BOOKING_CLOSE_TIME,
  BOOKING_OPEN_TIME,
  businessDayBounds,
  canMarkCompleted,
  daySchedule,
  isInRoomNow,
  toBusinessDate,
  toBusinessTime,
  weekDates,
  type BookingStatus,
  type StaffBooking,
} from './bookingModel';

const BOOKING_COLUMNS = 'id, reference, customer_name, customer_phone, customer_email, purpose, starts_at, ends_at, duration_minutes, status, source, status_changed_by_name';
const MANAGE_ROLES = ['admin', 'manager', 'front'];

function formatDate(date: string, language: 'en' | 'th', options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'UTC', ...options })
    .format(new Date(`${date}T12:00:00Z`));
}

export function BookingsPage() {
  const { member } = useAuth();
  const { t, language } = useI18n();
  const today = businessDateNow();
  const [selectedDate, setSelectedDate] = useState(today);
  const week = useMemo(() => weekDates(selectedDate), [selectedDate]);
  const [rows, setRows] = useState<StaffBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ booking: StaffBooking; status: Exclude<BookingStatus, 'confirmed'> } | null>(null);
  const canManage = MANAGE_ROLES.includes(member?.role ?? '');

  useEffect(() => {
    const timer = window.setInterval(() => setReloadKey((key) => key + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    setError(null);
    void requireSupabase()
      .from('room_bookings')
      .select(BOOKING_COLUMNS)
      .gte('starts_at', businessDayBounds(week[0]).start.toISOString())
      .lt('starts_at', businessDayBounds(addCalendarDays(week[6], 1)).start.toISOString())
      .order('starts_at')
      .then(({ data, error: queryError }) => {
        if (!alive) return;
        if (queryError) setError(errorMessage(queryError));
        setRows((data ?? []) as StaffBooking[]);
      });
    return () => { alive = false; };
  }, [week, reloadKey]);

  const dayRows = (rows ?? []).filter((booking) => toBusinessDate(new Date(booking.starts_at)) === selectedDate);
  const cancelled = dayRows.filter((booking) => booking.status === 'cancelled');
  const activeCount = (date: string) => (rows ?? []).filter((booking) => booking.status !== 'cancelled' && toBusinessDate(new Date(booking.starts_at)) === date).length;

  async function setStatus(booking: StaffBooking, status: 'cancelled' | 'completed') {
    setSavingId(booking.id);
    setError(null);
    setNotice(null);
    const { error: mutationError } = await requireSupabase().rpc('set_room_booking_status', {
      p_booking_id: booking.id,
      p_status: status,
    });
    setSavingId(null);
    setConfirming(null);
    if (mutationError) setError(errorMessage(mutationError));
    else {
      setNotice(status === 'cancelled'
        ? `${booking.reference} ${t('cancelled. The time is available again.')}`
        : `${booking.reference} ${t('marked as completed.')}`);
      setReloadKey((key) => key + 1);
    }
  }

  function bookingCard(booking: StaffBooking) {
    const now = new Date();
    const live = isInRoomNow(booking, now);
    const isCancelled = booking.status === 'cancelled';
    return <article key={booking.id} className={`booking-staff-card${isCancelled ? ' cancelled' : ''}`}>
      <div className={`booking-staff-time${live ? ' live' : ''}`}><strong>{toBusinessTime(new Date(booking.starts_at))}</strong><span>{toBusinessTime(new Date(booking.ends_at))}</span></div>
      <div className="booking-staff-info"><div className="booking-staff-name"><div><UserRound size={16} /><strong>{booking.customer_name}</strong></div><span className={`booking-status booking-status-${live ? 'live' : booking.status}`}>{t(live ? 'In the room now' : booking.status === 'confirmed' ? 'Confirmed' : booking.status === 'completed' ? 'Completed' : 'Cancelled')}</span></div>
        <p>{booking.purpose}</p>
        <div className="booking-staff-contact"><a href={`tel:${booking.customer_phone.replace(/[^\d+]/g, '')}`}><Phone size={13} />{booking.customer_phone}</a>{booking.customer_email && <a href={`mailto:${booking.customer_email}`}><Mail size={13} />{booking.customer_email}</a>}</div>
        <small>{booking.reference} · {t(booking.source === 'front_desk_qr' ? 'Front desk QR' : booking.source === 'admin' ? 'Staff' : 'Website')}{booking.status_changed_by_name ? ` · ${t('Changed by')} ${booking.status_changed_by_name}` : ''}</small>
        {canManage && booking.status === 'confirmed' && <div className="booking-card-actions">{canMarkCompleted(booking, now) && <button className="button button-quiet" disabled={savingId === booking.id} onClick={() => setConfirming({ booking, status: 'completed' })}><CheckCircle2 size={15} />{t('Mark completed')}</button>}<button className="button booking-cancel-button" disabled={savingId === booking.id} onClick={() => setConfirming({ booking, status: 'cancelled' })}><XCircle size={15} />{t('Cancel booking')}</button></div>}
      </div>
    </article>;
  }

  return <>
    <PageTitle eyebrow="ROOM OPERATIONS" title="Podcast room bookings" detail="See the weekly room schedule, customer contacts and available gaps." action={<Link className="button button-quiet" to="/book" target="_blank"><ExternalLink size={15} />{t('Open public booking')}</Link>} />
    {error && <Notice>{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    <section className="panel booking-staff-toolbar"><div><Headphones size={19} /><span><strong>{t('Podcast Room')}</strong><small>{BOOKING_OPEN_TIME}–{BOOKING_CLOSE_TIME} · {t('Bangkok time')}</small></span></div><button className="button button-quiet" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={15} />{t('Refresh')}</button></section>
    <section className="panel booking-week-panel">
      <div className="booking-week-head"><button className="icon-button" aria-label={t('Previous week')} onClick={() => setSelectedDate(addCalendarDays(selectedDate, -7))}><ChevronLeft size={19} /></button><div><span>{t('Week of')}</span><strong>{formatDate(week[0], language, { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div><button className="icon-button" aria-label={t('Next week')} onClick={() => setSelectedDate(addCalendarDays(selectedDate, 7))}><ChevronRight size={19} /></button>{selectedDate !== today && <button className="button button-small button-quiet" onClick={() => setSelectedDate(today)}>{t('Today')}</button>}</div>
      <div className="booking-week-days">{week.map((date) => { const count = activeCount(date); return <button type="button" key={date} className={date === selectedDate ? 'active' : ''} onClick={() => setSelectedDate(date)} aria-pressed={date === selectedDate}><span>{formatDate(date, language, { weekday: 'short' })}</span><strong>{Number(date.slice(8))}</strong><small>{rows ? count ? `${count} ${t('booked')}` : t('Free') : '·'}</small></button>; })}</div>
    </section>
    <section className="panel booking-day-panel"><div className="panel-head booking-day-head"><div><span className="eyebrow">{t('DAILY SCHEDULE')}</span><h2>{formatDate(selectedDate, language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2></div><span className="count-chip">{dayRows.filter((row) => row.status !== 'cancelled').length} {t('active bookings')}</span></div>
      {!rows ? <LoadingState label="Loading bookings…" /> : dayRows.filter((booking) => booking.status !== 'cancelled').length === 0 ? <EmptyState title="The room is free all day" detail="New bookings will appear here automatically." /> : <div className="booking-staff-schedule">{daySchedule(rows, selectedDate).map((item) => item.kind === 'free' ? <div className="booking-free-gap" key={`free-${item.start}`}><Clock3 size={14} /><span>{t('Free')} · {item.start}–{item.end}</span></div> : bookingCard(item.booking))}</div>}
      {cancelled.length > 0 && <details className="booking-cancelled-list"><summary>{cancelled.length} {t('cancelled bookings')}</summary>{cancelled.map(bookingCard)}</details>}
    </section>
    {confirming && <div className="booking-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirming(null); }}><section className="booking-action-dialog" role="dialog" aria-modal="true" aria-labelledby="booking-action-title"><div className={`booking-dialog-icon ${confirming.status}`} >{confirming.status === 'cancelled' ? <XCircle size={22} /> : <CheckCircle2 size={22} />}</div><span className="eyebrow">{t('BOOKING UPDATE')}</span><h2 id="booking-action-title">{t(confirming.status === 'cancelled' ? 'Cancel this booking?' : 'Mark this booking completed?')}</h2><p>{confirming.booking.customer_name} · {toBusinessTime(new Date(confirming.booking.starts_at))}–{toBusinessTime(new Date(confirming.booking.ends_at))}</p><div className="booking-dialog-actions"><button className="button button-quiet" onClick={() => setConfirming(null)}>{t('Keep booking')}</button><button className={`button ${confirming.status === 'cancelled' ? 'booking-cancel-confirm' : 'button-primary'}`} disabled={savingId === confirming.booking.id} onClick={() => void setStatus(confirming.booking, confirming.status)}>{savingId ? t('Saving…') : t(confirming.status === 'cancelled' ? 'Yes, cancel booking' : 'Confirm completed')}</button></div></section></div>}
  </>;
}
