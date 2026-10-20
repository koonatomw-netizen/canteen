import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { LanguageToggle } from '../../components/LanguageToggle';
import { useI18n } from '../../lib/i18n';
import { GlobalFooter, GlobalHeader, siteChromeStyles as styles } from './SiteChrome';

/** Public booking pages render as a 4Seas module: shared site header, module bar, shared footer. */
export function BookingPublicLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return <div className="booking-public-shell">
    <GlobalHeader />
    <div className={styles.moduleBar}>
      <nav className={styles.moduleInner} aria-label={t('Podcast Room booking navigation')}>
        <Link to="/book" className={styles.moduleTitle}>{t('Podcast Room Booking')}</Link>
        <div className={styles.moduleLinks}>
          <NavLink to="/my-booking">{t('My booking')}</NavLink>
          <NavLink to="/privacy">{t('Privacy notice')}</NavLink>
        </div>
        <div className={styles.moduleActions}><LanguageToggle compact /></div>
      </nav>
    </div>
    {children}
    <GlobalFooter />
  </div>;
}
