import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Archive, BarChart3, Boxes, CalendarCheck, ChevronDown, ClipboardList,
  LayoutDashboard, LogOut, Menu, ReceiptText, Settings2, ShoppingBasket,
  Trash2, X,
} from 'lucide-react';
import { useAuth } from '../features/auth/AuthContext';
import { businessDateNow, formatBusinessDate } from '../lib/dates';

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/production', label: 'Production', icon: ShoppingBasket },
  { to: '/stock', label: 'Stock & expiry', icon: Boxes },
  { to: '/waste', label: 'Waste', icon: Trash2 },
  { to: '/closing', label: 'Daily closing', icon: CalendarCheck },
  { to: '/expenses', label: 'Expenses', icon: ReceiptText },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/manage', label: 'Manage', icon: Settings2 },
  { to: '/activity', label: 'Activity log', icon: ClipboardList },
];

const mobileLinks = links.filter((link) => ['/', '/stock', '/waste', '/closing', '/manage'].includes(link.to));

export function AppShell() {
  const { member, signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeLabel = links.find((link) => link.to === location.pathname)?.label ?? 'Workspace';

  const navigation = (compact = false) => (
    <nav className={compact ? 'mobile-links' : 'sidebar-links'} aria-label="Main navigation">
      {compact && <p className="sidebar-caption">WORKSPACE</p>}
      {links.slice(0, 8).map((link) => {
        const Icon = link.icon;
        return (
          <NavLink key={link.to} to={link.to} end={link.to === '/'} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Icon size={18} strokeWidth={1.8} />
            <span>{link.label}</span>
            {link.to === '/stock' && <span className="nav-link-dot" />}
          </NavLink>
        );
      })}
      <p className="sidebar-caption">MANAGE</p>
      {links.slice(8).map((link) => {
        const Icon = link.icon;
        return (
          <NavLink key={link.to} to={link.to} end={link.to === '/manage'} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Icon size={18} strokeWidth={1.8} /><span>{link.label}</span>
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
          <div className="staff-card"><span className="staff-avatar">{(member?.display_name || 'S').slice(0, 1).toUpperCase()}</span><span className="staff-name">{member?.display_name || 'Staff member'}<small>{member?.role ?? 'Staff'}</small></span><button className="icon-button small" aria-label="Sign out" onClick={() => void signOut()}><LogOut size={16} /></button></div>
          <p className="sidebar-footnote">Your food, accounted for.</p>
        </div>
      </aside>

      <div className="mobile-overlay" data-open={mobileOpen} onClick={() => setMobileOpen(false)} />
      <aside className={`mobile-drawer${mobileOpen ? ' open' : ''}`}>
        <div className="mobile-drawer-head"><span className="brand"><span className="brand-mark"><Archive size={18} /></span><span className="brand-name">canteen</span></span><button className="icon-button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={19} /></button></div>
        {navigation(true)}
        <button className="mobile-signout" onClick={() => void signOut()}><LogOut size={17} /> Sign out</button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
            <div><span className="eyebrow">KITCHEN OPERATIONS</span><span className="breadcrumb">{activeLabel}</span></div>
          </div>
          <div className="topbar-right"><span className="date-pill"><CalendarCheck size={15} />{formatBusinessDate(businessDateNow())}</span><span className="topbar-divider" /><span className="topbar-user">{member?.display_name || 'Staff member'}</span><span className="topbar-avatar">{(member?.display_name || 'S').slice(0, 1).toUpperCase()}</span></div>
        </header>
        <div className="page-content"><Outlet /></div>
      </main>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {mobileLinks.map((link) => {
          const Icon = link.icon;
          const label = link.label === 'Stock & expiry' ? 'Stock' : link.to === '/closing' ? 'Close' : link.label;
          return <NavLink key={link.to} to={link.to} end={link.to === '/'} className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}><Icon size={19} /><span>{label}</span></NavLink>;
        })}
      </nav>
    </div>
  );
}
