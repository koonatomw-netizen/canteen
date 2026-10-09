import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Archive, BarChart3, Boxes, CalendarCheck, ChevronDown, ClipboardList,
  LayoutDashboard, LogOut, Menu, ReceiptText, Settings2, ShoppingBasket,
  Trash2, X,
} from 'lucide-react';
import { useAuth } from '../features/auth/AuthContext';
import type { AppRole } from '../features/auth/AuthContext';
import { roleLabels } from '../features/auth/permissions';
import { businessDateNow, formatBusinessDate } from '../lib/dates';
import { useI18n } from '../lib/i18n';
import { LanguageToggle } from './LanguageToggle';

const links: { to: string; label: string; icon: typeof Archive; roles: AppRole[]; section: 'workspace' | 'admin' }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'manager'], section: 'workspace' },
  { to: '/', label: 'Today', icon: CalendarCheck, roles: ['front', 'kitchen'], section: 'workspace' },
  { to: '/production', label: 'Production', icon: ShoppingBasket, roles: ['admin', 'front'], section: 'workspace' },
  { to: '/stock', label: 'Stock & expiry', icon: Boxes, roles: ['admin', 'front'], section: 'workspace' },
  { to: '/waste', label: 'Waste', icon: Trash2, roles: ['admin', 'front'], section: 'workspace' },
  { to: '/closing', label: 'Daily closing', icon: CalendarCheck, roles: ['admin', 'front'], section: 'workspace' },
  { to: '/expenses', label: 'Expenses', icon: ReceiptText, roles: ['admin', 'front', 'kitchen'], section: 'workspace' },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['admin', 'manager'], section: 'workspace' },
  { to: '/manage', label: 'Manage', icon: Settings2, roles: ['admin'], section: 'admin' },
  { to: '/activity', label: 'Activity log', icon: ClipboardList, roles: ['admin'], section: 'admin' },
];

const mobileLinkOrder: Record<AppRole, string[]> = {
  admin: ['/', '/stock', '/waste', '/closing', '/manage'],
  manager: ['/', '/reports'],
  front: ['/', '/production', '/stock', '/waste', '/closing'],
  kitchen: ['/', '/expenses'],
};

export function AppShell() {
  const { member, signOut } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const role = member?.role ?? 'front';
  const activeLabel = links.find((link) => link.to === location.pathname && link.roles.includes(role))?.label ?? 'Workspace';
  const visibleLinks = links.filter((link) => link.roles.includes(role));
  const mobileLinks = mobileLinkOrder[role].map((path) => links.find((link) => link.to === path)).filter((link): link is (typeof links)[number] => Boolean(link));

  const navigation = (compact = false) => (
    <nav className={compact ? 'mobile-links' : 'sidebar-links'} aria-label={t('Main navigation')}>
      {visibleLinks.some((link) => link.section === 'workspace') && <p className="sidebar-caption">{t('WORKSPACE')}</p>}
      {visibleLinks.filter((link) => link.section === 'workspace').map((link) => {
        const Icon = link.icon;
        return (
          <NavLink key={link.to} to={link.to} end={link.to === '/'} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Icon size={18} strokeWidth={1.8} />
            <span>{t(link.label)}</span>
            {link.to === '/stock' && <span className="nav-link-dot" />}
          </NavLink>
        );
      })}
      {visibleLinks.some((link) => link.section === 'admin') && <p className="sidebar-caption">{t('MANAGE')}</p>}
      {visibleLinks.filter((link) => link.section === 'admin').map((link) => {
        const Icon = link.icon;
        return (
          <NavLink key={link.to} to={link.to} end={link.to === '/manage'} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Icon size={18} strokeWidth={1.8} /><span>{t(link.label)}</span>
          </NavLink>
        );
      })}
    </nav>
  );

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="Canteen home">
          <span className="brand-mark"><Archive size={19} /></span>
          <span className="brand-name">canteen<span>daily operations</span></span>
        </NavLink>
        <div className="canteen-switcher"><span className="canteen-avatar">K</span><span className="canteen-name">Kitchen 01<small>Chiang Mai</small></span><ChevronDown size={15} /></div>
        {navigation()}
        <div className="sidebar-bottom">
          <div className="staff-card"><span className="staff-avatar">{(member?.display_name || 'S').slice(0, 1).toUpperCase()}</span><span className="staff-name">{member?.display_name || 'Staff member'}<small>{t(roleLabels[role])}</small></span><button className="icon-button small" aria-label={t('Sign out')} onClick={() => void signOut()}><LogOut size={16} /></button></div>
          <p className="sidebar-footnote">{t('Your food, accounted for.')}</p>
        </div>
      </aside>

      <div className="mobile-overlay" data-open={mobileOpen} onClick={() => setMobileOpen(false)} />
      <aside className={`mobile-drawer${mobileOpen ? ' open' : ''}`}>
        <div className="mobile-drawer-head"><span className="brand"><span className="brand-mark"><Archive size={18} /></span><span className="brand-name">canteen</span></span><div className="mobile-drawer-tools"><LanguageToggle compact /><button className="icon-button" aria-label={t('Close navigation')} onClick={() => setMobileOpen(false)}><X size={19} /></button></div></div>
        {navigation(true)}
        <button className="mobile-signout" onClick={() => void signOut()}><LogOut size={17} /> {t('Sign out')}</button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu-button" aria-label={t('Open navigation')} onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
            <div><span className="eyebrow">{t('KITCHEN OPERATIONS')}</span><span className="breadcrumb">{t(activeLabel)}</span></div>
          </div>
          <div className="topbar-right"><LanguageToggle /><span className="date-pill"><CalendarCheck size={15} />{formatBusinessDate(businessDateNow())}</span><span className="topbar-divider" /><span className="topbar-user">{member?.display_name || 'Staff member'}</span><span className="topbar-avatar">{(member?.display_name || 'S').slice(0, 1).toUpperCase()}</span></div>
        </header>
        <div className="page-content"><Outlet /></div>
      </main>
      <nav className="mobile-bottom-nav" aria-label={t('Quick navigation')}>
        {mobileLinks.map((link) => {
          const Icon = link.icon;
          const label = link.label === 'Stock & expiry' ? 'Stock' : link.to === '/closing' ? 'Close' : link.label;
          return <NavLink key={link.to} to={link.to} end={link.to === '/'} className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}><Icon size={19} /><span>{t(label)}</span></NavLink>;
        })}
      </nav>
    </div>
  );
}
