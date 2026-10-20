import { useId, useRef, useState } from 'react';
import styles from './siteChrome.module.css';

// Ported from 4seas-community/booking components/site-chrome.tsx @ 65f1fda
// (homepage source: 4seas-community/homepage @ 0ea0223). Keep markup, links and
// assets in sync with the other 4Seas public modules.
const ASSET_BASE = '/site-chrome';
const HOME = 'https://4seas.xyz';
const navigation = [
  ['Events', `${HOME}/#events`],
  ['Zuzalu', `${HOME}/#Zuzalu`],
  ['About', `${HOME}/#about`],
  ['Space', `${HOME}/#Space`],
  ['Residency', `${HOME}/residency`],
] as const;

export { styles as siteChromeStyles };

export function GlobalHeader() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);

  return (
    <header className={styles.header} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        setOpen(false);
        menuButton.current?.focus();
      }
    }}>
      <div className={styles.headerInner}>
        <a href={`${HOME}/`} className={styles.brand} aria-label="4Seas home">
          <img src={`${ASSET_BASE}/logo100.png`} width="500" height="113" alt="4Seas" />
          <span>A part of Zuzalu</span>
        </a>
        <nav id={menuId} aria-label="4Seas navigation" className={`${styles.navigation} ${open ? styles.navigationOpen : ''}`}>
          {navigation.map(([label, href]) => (
            <a key={label} href={href} onClick={() => setOpen(false)}>{label}</a>
          ))}
        </nav>
        <div className={styles.socials}>
          <a href="https://x.com/4seasDeSoc" target="_blank" rel="noopener noreferrer" aria-label="4Seas on X">
            <img src={`${ASSET_BASE}/image-62.png`} width="35" height="35" alt="" />
          </a>
          <a href="https://t.me/NomadsBase" target="_blank" rel="noopener noreferrer" aria-label="4Seas on Telegram">
            <img src={`${ASSET_BASE}/image-63.png`} width="35" height="35" alt="" />
          </a>
        </div>
        <button ref={menuButton} type="button" className={styles.menuButton} aria-controls={menuId} aria-expanded={open}
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'} onClick={() => setOpen(!open)}>
          <span className={open ? styles.menuOpen : ''} aria-hidden="true"><i /><i /><i /></span>
        </button>
      </div>
    </header>
  );
}

export function GlobalFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerCard}>
          <p className={styles.quote}>“It has been said that astronomy is a humbling and character-building experience. There is perhaps no better demonstration of the folly of human conceits than this distant image of our tiny world. To me, it underscores our responsibility to deal more kindly with one another, and to preserve and cherish the pale blue dot, the only home we’ve ever known.”— Carl Sagan, Pale Blue Dot, 1994 🌏 🌏</p>
          <div className={styles.footerRow}>
            <a href={`${HOME}/`} className={styles.footerBrand} aria-label="4Seas home">
              <img src={`${ASSET_BASE}/logo100.png`} width="500" height="113" alt="4Seas" loading="lazy" />
            </a>
            <nav className={styles.footerLinks} aria-label="4Seas community links">
              <a href="https://x.com/4seasDeSoc" target="_blank" rel="noopener noreferrer" aria-label="4Seas on X"><img src={`${ASSET_BASE}/x-logo-twitter-icon-x.png`} width="32" height="32" alt="" loading="lazy" /></a>
              <a href="https://t.me/NomadsBase" target="_blank" rel="noopener noreferrer" aria-label="4Seas on Telegram"><img src={`${ASSET_BASE}/telegram-icon.png`} width="32" height="32" alt="" loading="lazy" /></a>
              <a href="https://www.notion.so/4seas/4Seas-Crypto-Nomad-Open-Community-419ab3a4c66c4dab9f3ece6c4e081886" target="_blank" rel="noopener noreferrer" aria-label="4Seas community on Notion"><img src={`${ASSET_BASE}/asdasd.png`} width="32" height="32" alt="" loading="lazy" /></a>
              <a className={styles.brandKit} href="https://www.figma.com/design/3qjSTHbMwaYvO2fOlDRJcD/4Seas-Branding-kit?node-id=76-2&p=f&t=MGwF0a3bR0RZBHER-0" target="_blank" rel="noopener noreferrer">Brand Kit</a>
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
