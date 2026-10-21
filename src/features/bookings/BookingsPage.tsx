import { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink, Headphones, Hourglass, Mail, Phone, RefreshCw, UserRound, Users, XCircle } from 'lucide-react';
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
  canApprove,
  canMarkCompleted,
  daySchedule,
  holdsTime,
  isInRoomNow,
  toBusinessDate,
  toBusinessTime,
  weekDates,
  type BookingStatus,
  type StaffBooking,
} from './bookingModel';

const BOOKING_COLUMNS = 'id, reference, customer_name, customer_phone, customer_email, purpose, organization, guest_count, starts_at, ends_at, duration_minutes, status, source, status_changed_by_name';
const MANAGE_ROLES = ['admin', 'manager', 'front'];
const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Waiting for approval', confirmed: 'Confirmed', rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Completed',
};
type StatusChange = Exclude<BookingStatus, 'pending'>;
const CHANGE_TEXT: Record<StatusChange, { title: string; confirm: string; done: string }> = {
  confirmed: { title: 'Approve this booking?', confirm: 'Yes, approve', done: 'approved. The customer now sees it as confirmed.' },
  rejected: { title: 'Reject this request?', confirm: 'Yes, reject', done: 'rejected. The time is available again.' },
  cancelled: { title: 'Cancel this booking?', confirm: 'Yes, cancel booking', done: 'cancelled. The time is available again.' },
  completed: { title: 'Mark this booking completed?', confirm: 'Confirm completed', done: 'marked as completed.' },
};

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
  const [pendingRows, setPendingRows] = useState<StaffBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ booking: StaffBooking; status: StatusChange } | null>(null);
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

  // Every request still waiting, whatever week is open, so none is missed.
  useEffect(() => {
    let alive = true;
    void requireSupabase()
      .from('room_bookings')
      .select(BOOKING_COLUMNS)
      .eq('status', 'pending')
      .gt('ends_at', new Date().toISOString())
      .order('starts_at')
      .then(({ data, error: queryError }) => {
        if (!alive) return;
        if (queryError) setError(errorMessage(queryError));
        setPendingRows((data ?? []) as StaffBooking[]);
      });
    return () => { alive = false; };
  }, [reloadKey]);

  const dayRows = (rows ?? []).filter((booking) => toBusinessDate(new Date(booking.starts_at)) === selectedDate);
  const activeRows = dayRows.filter((booking) => holdsTime(booking.status));
  const closedRows = dayRows.filter((booking) => !holdsTime(booking.status));
  const activeCount = (date: string) => (rows ?? []).filter((booking) => holdsTime(booking.status) && toBusinessDate(new Date(booking.starts_at)) === date).length;

  async function setStatus(booking: StaffBooking, status: StatusChange) {
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
      setNotice(`${booking.reference} ${t(CHANGE_TEXT[status].done)}`);
      setReloadKey((key) => key + 1);
    }
  }

  function bookingCard(booking: StaffBooking, showDate = false) {
    const now = new Date();
    const live = isInRoomNow(booking, now);
    const closed = !holdsTime(booking.status);
    const busy = savingId === booking.id;
    return <article key={booking.id} className={`booking-staff-card${closed ? ' cancelled' : ''}${booking.status === 'pending' ? ' pending' : ''}`}>
      <div className={`booking-staff-time${live ? ' live' : ''}`}>{showDate && <span>{formatDate(toBusinessDate(new Date(booking.starts_at)), language, { day: 'numeric', month: 'short' })}</span>}<strong>{toBusinessTime(new Date(booking.starts_at))}</strong><span>{toBusinessTime(new Date(booking.ends_at))}</span></div>
      <div className="booking-staff-info"><div className="booking-staff-name"><div><UserRound size={16} /><strong>{booking.customer_name}</strong></div><span className={`booking-status booking-status-${live ? 'live' : booking.status}`}>{t(live ? 'In the room now' : STATUS_LABELS[booking.status])}</span></div>
        {(booking.organization || booking.guest_count) && <div className="booking-staff-meta">{booking.organization && <span><Building2 size={13} />{booking.organization}</span>}{booking.guest_count && <span><Users size={13} />{booking.guest_count} {t('people')}</span>}</div>}
        <p>{booking.purpose}</p>
        <div className="booking-staff-contact"><a href={`tel:${booking.customer_phone.replace(/[^\d+]/g, '')}`}><Phone size={13} />{booking.customer_phone}</a>{booking.customer_email && <a href={`mailto:${booking.customer_email}`}><Mail size={13} />{booking.customer_email}</a>}</div>
        <small>{booking.reference} · {t(booking.source === 'front_desk_qr' ? 'Front desk QR' : booking.source === 'admin' ? 'Staff' : 'Website')}{booking.status_changed_by_name ? ` · ${t('Changed by')} ${booking.status_changed_by_name}` : ''}</small>
        {canManage && booking.status === 'pending' && <div className="booking-card-actions">{canApprove(booking, now) && <button className="button button-primary" disabled={busy} onClick={() => setConfirming({ booking, status: 'confirmed' })}><CheckCircle2 size={15} />{t('Approve')}</button>}<button className="button booking-cancel-button" disabled={busy} onClick={() => setConfirming({ booking, status: 'rejected' })}><XCircle size={15} />{t('Reject')}</button></div>}
        {canManage && booking.status === 'confirmed' && <div className="booking-card-actions">{canMarkCompleted(booking, now) && <button className="button button-quiet" disabled={busy} onClick={() => setConfirming({ booking, status: 'completed' })}><CheckCircle2 size={15} />{t('Mark completed')}</button>}<button className="button booking-cancel-button" disabled={busy} onClick={() => setConfirming({ booking, status: 'cancelled' })}><XCircle size={15} />{t('Cancel booking')}</button></div>}
      </div>
    </article>;
  }

  const negative = confirming && (confirming.status === 'cancelled' || confirming.status === 'rejected');
  return <>
    <PageTitle eyebrow="ROOM OPERATIONS" title="Podcast room bookings" detail="Approve requests, see the weekly room schedule, customer contacts and available gaps." action={<Link className="button button-quiet" to="/book" target="_blank"><ExternalLink size={15} />{t('Open public booking')}</Link>} />
    {error && <Notice>{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    <section className="panel booking-staff-toolbar"><div><Headphones size={19} /><span><strong>{t('Podcast Room')}</strong><small>{BOOKING_OPEN_TIME}–{BOOKING_CLOSE_TIME} · {t('Bangkok time')}</small></span></div><button className="button button-quiet" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={15} />{t('Refresh')}</button></section>
    {pendingRows.length > 0 && <section className="panel booking-pending-panel"><div className="panel-head"><div><span className="eyebrow"><Hourglass size={13} /> {t('WAITING FOR APPROVAL')}</span><h2>{pendingRows.length} {t('requests to check')}</h2><p>{t('Check who they are and why they need the room. Call them if anything is unclear.')}</p></div></div><div className="booking-staff-schedule">{pendingRows.map((booking) => bookingCard(booking, true))}</div></section>}
    <section className="panel booking-week-panel">
      <div className="booking-week-head"><button className="icon-button" aria-label={t('Previous week')} onClick={() => setSelectedDate(addCalendarDays(selectedDate, -7))}><ChevronLeft size={19} /></button><div><span>{t('Week of')}</span><strong>{formatDate(week[0], language, { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div><button className="icon-button" aria-label={t('Next week')} onClick={() => setSelectedDate(addCalendarDays(selectedDate, 7))}><ChevronRight size={19} /></button>{selectedDate !== today && <button className="button button-small button-quiet" onClick={() => setSelectedDate(today)}>{t('Today')}</button>}</div>
      <div className="booking-week-days">{week.map((date) => { const count = activeCount(date); return <button type="button" key={date} className={date === selectedDate ? 'active' : ''} onClick={() => setSelectedDate(date)} aria-pressed={date === selectedDate}><span>{formatDate(date, language, { weekday: 'short' })}</span><strong>{Number(date.slice(8))}</strong><small>{rows ? count ? `${count} ${t('booked')}` : t('Free') : '·'}</small></button>; })}</div>
    </section>
    <section className="panel booking-day-panel"><div className="panel-head booking-day-head"><div><span className="eyebrow">{t('DAILY SCHEDULE')}</span><h2>{formatDate(selectedDate, language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2></div><span className="count-chip">{activeRows.length} {t('active bookings')}</span></div>
      {!rows ? <LoadingState label="Loading bookings…" /> : activeRows.length === 0 ? <EmptyState title="The room is free all day" detail="New bookings will appear here automatically." /> : <div className="booking-staff-schedule">{daySchedule(rows, selectedDate).map((item) => item.kind === 'free' ? <div className="booking-free-gap" key={`free-${item.start}`}><Clock3 size={14} /><span>{t('Free')} · {item.start}–{item.end}</span></div> : bookingCard(item.booking))}</div>}
      {closedRows.length > 0 && <details className="booking-cancelled-list"><summary>{closedRows.length} {t('cancelled or rejected bookings')}</summary>{closedRows.map((booking) => bookingCard(booking))}</details>}
    </section>
    {confirming && <div className="booking-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirming(null); }}><section className="booking-action-dialog" role="dialog" aria-modal="true" aria-labelledby="booking-action-title"><div className={`booking-dialog-icon ${negative ? 'cancelled' : ''}`} >{negative ? <XCircle size={22} /> : <CheckCircle2 size={22} />}</div><span className="eyebrow">{t('BOOKING UPDATE')}</span><h2 id="booking-action-title">{t(CHANGE_TEXT[confirming.status].title)}</h2><p>{confirming.booking.customer_name}{confirming.booking.organization ? ` · ${confirming.booking.organization}` : ''} · {toBusinessTime(new Date(confirming.booking.starts_at))}–{toBusinessTime(new Date(confirming.booking.ends_at))}</p><div className="booking-dialog-actions"><button className="button button-quiet" onClick={() => setConfirming(null)}>{t('Go back')}</button><button className={`button ${negative ? 'booking-cancel-confirm' : 'button-primary'}`} disabled={savingId === confirming.booking.id} onClick={() => void setStatus(confirming.booking, confirming.status)}>{savingId ? t('Saving…') : t(CHANGE_TEXT[confirming.status].confirm)}</button></div></section></div>}
  </>;
}
