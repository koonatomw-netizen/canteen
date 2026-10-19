import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Archive, BarChart3, Boxes, CalendarCheck, ChevronDown, ClipboardList,
  LayoutDashboard, LogOut, Menu, ReceiptText, Settings2, ShieldCheck, ShoppingBasket,
  Trash2, UtensilsCrossed, X,
} from 'lucide-react';
import { useAuth } from '../features/auth/AuthContext';
import type { AppRole } from '../features/auth/AuthContext';
import { isReadOnlyDemo, roleLabels } from '../features/auth/permissions';
import { formatBusinessDate } from '../lib/dates';
import { useBusinessDate } from '../lib/useBusinessDate';
import { useI18n } from '../lib/i18n';
import { LoadingState } from './Feedback';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';

type NavGroupId = 'overview' | 'canteen' | 'coliving' | 'administration' | 'staff' | 'coliving-staff';

type NavLinkConfig = {
  to: string;
  label: string;
  icon: typeof Archive;
  roles: AppRole[];
  group: NavGroupId;
};

type NavGroupConfig = {
  id: NavGroupId;
  label: string;
  roles: AppRole[];
  collapsibleFor: AppRole[];
  defaultCollapsed: boolean;
};

// Keep role visibility and grouping in these two lists so future workspace
// additions do not require new role-specific rendering branches.
const navGroups: NavGroupConfig[] = [
  { id: 'overview', label: 'Overview', roles: ['admin', 'auditor'], collapsibleFor: [], defaultCollapsed: false },
  { id: 'canteen', label: 'Canteen operations', roles: ['admin', 'auditor'], collapsibleFor: ['admin', 'auditor'], defaultCollapsed: true },
  { id: 'coliving', label: 'Co-living operations', roles: ['admin', 'coliving'], collapsibleFor: ['admin'], defaultCollapsed: true },
  { id: 'administration', label: 'Administration', roles: ['admin', 'auditor'], collapsibleFor: ['admin', 'auditor'], defaultCollapsed: false },
  { id: 'staff', label: 'WORKSPACE', roles: ['front', 'kitchen', 'manager'], collapsibleFor: [], defaultCollapsed: false },
  { id: 'coliving-staff', label: 'Co-living', roles: ['coliving'], collapsibleFor: [], defaultCollapsed: false },
];

const links: NavLinkConfig[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'auditor'], group: 'overview' },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['admin', 'auditor'], group: 'overview' },
  { to: '/', label: 'Today', icon: CalendarCheck, roles: ['front'], group: 'staff' },
  { to: '/', label: 'Manager Reports', icon: BarChart3, roles: ['manager'], group: 'staff' },
  { to: '/production', label: 'Production', icon: ShoppingBasket, roles: ['admin', 'auditor'], group: 'canteen' },
  { to: '/menus', label: 'Menu items', icon: UtensilsCrossed, roles: ['admin', 'auditor'], group: 'canteen' },
  { to: '/stock', label: 'Stock & expiry', icon: Boxes, roles: ['admin', 'auditor'], group: 'canteen' },
  { to: '/waste', label: 'Waste', icon: Trash2, roles: ['admin', 'auditor'], group: 'canteen' },
  { to: '/closing', label: 'Daily closing', icon: CalendarCheck, roles: ['admin', 'auditor'], group: 'canteen' },
  { to: '/expenses', label: 'Expenses', icon: ReceiptText, roles: ['admin'], group: 'canteen' },
  { to: '/expenses', label: 'Expenses', icon: ReceiptText, roles: ['kitchen'], group: 'staff' },
  { to: '/coliving', label: 'Co-living Dashboard', icon: LayoutDashboard, roles: ['admin'], group: 'coliving' },
  { to: '/coliving/records', label: 'Co-living Records', icon: ClipboardList, roles: ['admin'], group: 'coliving' },
  { to: '/coliving', label: 'Co-living Dashboard', icon: LayoutDashboard, roles: ['coliving'], group: 'coliving-staff' },
  { to: '/coliving/records', label: 'Co-living Records', icon: ClipboardList, roles: ['coliving'], group: 'coliving-staff' },
  { to: '/manage', label: 'Manage', icon: Settings2, roles: ['admin', 'auditor'], group: 'administration' },
  { to: '/activity', label: 'Activity log', icon: ClipboardList, roles: ['admin', 'auditor'], group: 'administration' },
];

const mobileLinkOrder: Record<AppRole, string[]> = {
  admin: ['/', '/stock', '/waste', '/closing', '/manage'],
  manager: ['/'],
  front: ['/'],
  kitchen: ['/expenses'],
  auditor: ['/', '/stock', '/waste', '/closing', '/manage'],
  coliving: ['/coliving', '/coliving/records'],
};

const workspaceByRole: Record<AppRole, { initial: string; label: string; detail: string; heading: string }> = {
  admin: { initial: 'A', label: 'All operations', detail: 'Website Admin', heading: 'ALL OPERATIONS' },
  auditor: { initial: 'A', label: 'All operations', detail: 'Website Auditor · read only', heading: 'READ-ONLY AUDIT' },
  front: { initial: 'F', label: 'Canteen', detail: 'Front team', heading: 'CANTEEN OPERATIONS' },
  kitchen: { initial: 'K', label: 'Canteen', detail: 'Kitchen team', heading: 'KITCHEN OPERATIONS' },
  manager: { initial: 'M', label: 'Reports', detail: 'Management team', heading: 'MANAGER REPORTS' },
  coliving: { initial: 'C', label: 'Co-living', detail: 'Community operations', heading: 'CO-LIVING OPERATIONS' },
};

export function AppShell() {
  const { member, signOut } = useAuth();
  const { t } = useI18n();
  const today = useBusinessDate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Partial<Record<NavGroupId, boolean>>>({});
  const role = member?.role ?? 'front';
  const workspace = workspaceByRole[role];
  const activeLabel = links.find((link) => link.to === location.pathname && link.roles.includes(role))?.label ?? 'Workspace';
  const visibleLinks = links.filter((link) => link.roles.includes(role));
  const mobileLinks = role === 'front' ? [
    { to: '/', label: 'Today', icon: CalendarCheck, tab: 'production' },
    { to: '/?tab=stock', label: 'Stock', icon: Boxes, tab: 'stock' },
    { to: '/?tab=closing', label: 'Close', icon: CalendarCheck, tab: 'closing' },
  ] : mobileLinkOrder[role].map((path) => links.find((link) => link.to === path && link.roles.includes(role))).filter((link): link is (typeof links)[number] => Boolean(link));
  const activeTab = new URLSearchParams(location.search).get('tab') ?? 'production';

  const navigation = (compact = false) => (
    <nav className={compact ? 'mobile-links' : 'sidebar-links'} aria-label={t('Main navigation')}>
      {navGroups.filter((group) => group.roles.includes(role)).map((group) => {
        const groupLinks = visibleLinks.filter((link) => link.group === group.id);
        if (groupLinks.length === 0) return null;
        const collapsible = group.collapsibleFor.includes(role);
        const current = groupLinks.some((link) => link.to === location.pathname);
        const expanded = expandedGroups[group.id] ?? (!group.defaultCollapsed || current);
        const groupLinksId = `nav-links-${compact ? 'mobile-' : ''}${group.id}`;
        return (
          <section key={group.id} className={`nav-group${collapsible ? ' collapsible' : ''}`} data-active={current || undefined}>
            {collapsible ? (
              <button type="button" className="nav-group-toggle" aria-expanded={expanded} aria-controls={groupLinksId} onClick={() => setExpandedGroups((previous) => ({ ...previous, [group.id]: !expanded }))}>
                <span>{t(group.label)}</span><ChevronDown size={15} aria-hidden="true" />
              </button>
            ) : <p className="sidebar-caption">{t(group.label)}</p>}
            <div className="nav-group-links" id={groupLinksId} hidden={!expanded}>
              {groupLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink key={`${group.id}:${link.to}`} to={link.to} end={link.to === '/' || link.to === '/coliving'} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                    <Icon size={18} strokeWidth={1.8} />
                    <span>{t(link.label)}</span>
                    {link.to === '/stock' && <span className="nav-link-dot" />}
                  </NavLink>
                );
              })}
            </div>
          </section>
        );
      })}
    </nav>
  );

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="4Seas Operations home">
          <span className="brand-mark"><Archive size={19} /></span>
          <span className="brand-name">4Seas<span>Operations</span></span>
        </NavLink>
        <div className="workspace-context" role="group" aria-label={`${t(workspace.label)} · ${t(workspace.detail)}`}>
          <span className="workspace-avatar">{workspace.initial}</span>
          <span className="workspace-context-copy">{t(workspace.label)}<small>{t(workspace.detail)}</small></span>
        </div>
        {navigation()}
        <div className="sidebar-bottom">
          <div className="staff-card"><span className="staff-avatar">{(member?.display_name || 'S').slice(0, 1).toUpperCase()}</span><span className="staff-name">{member?.display_name || 'Staff member'}<small>{t(roleLabels[role])}</small></span><button className="icon-button small" aria-label={t('Sign out')} onClick={() => void signOut()}><LogOut size={16} /></button></div>
          <p className="sidebar-footnote">{t('Your food, accounted for.')}</p>
        </div>
      </aside>

      <div className="mobile-overlay" data-open={mobileOpen} onClick={() => setMobileOpen(false)} />
      <aside className={`mobile-drawer${mobileOpen ? ' open' : ''}`}>
        <div className="mobile-drawer-head"><span className="brand"><span className="brand-mark"><Archive size={18} /></span><span className="brand-name">4Seas<span>Operations</span></span></span><div className="mobile-drawer-tools"><LanguageToggle compact /><button className="icon-button" aria-label={t('Close navigation')} onClick={() => setMobileOpen(false)}><X size={19} /></button></div></div>
        {navigation(true)}
        <button className="mobile-signout" onClick={() => void signOut()}><LogOut size={17} /> {t('Sign out')}</button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu-button" aria-label={t('Open navigation')} onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
            <div><span className="eyebrow">{t(workspace.heading)}</span><span className="breadcrumb">{t(activeLabel)}</span></div>
          </div>
          <div className="topbar-right"><LanguageToggle /><ThemeToggle /><span className="date-pill"><CalendarCheck size={15} />{formatBusinessDate(today)}</span><span className="topbar-divider" /><span className="topbar-user">{member?.display_name || 'Staff member'}</span><span className="topbar-avatar">{(member?.display_name || 'S').slice(0, 1).toUpperCase()}</span></div>
        </header>
        <div className="page-content" data-role={role} data-readonly-demo={isReadOnlyDemo(role) ? 'true' : undefined}>
          {isReadOnlyDemo(role) && <div className="readonly-demo-banner" role="status"><ShieldCheck size={18} /><span><strong>{t('WEBSITE AUDITOR · DEMO VIEW')}</strong><small>{t('All pages and action buttons are visible. Changes, uploads, and stock actions are disabled for this account.')}</small></span></div>}
          <Suspense fallback={<LoadingState />}><Outlet /></Suspense>
        </div>
      </main>
      <nav className="mobile-bottom-nav" aria-label={t('Quick navigation')}>
        {mobileLinks.map((link) => {
          const Icon = link.icon;
          const label = link.label === 'Stock & expiry' ? 'Stock' : link.to === '/closing' ? 'Close' : link.label;
          const tab = 'tab' in link ? link.tab : undefined;
          const active = role === 'front' ? tab === activeTab : location.pathname === link.to;
          return <NavLink key={link.to} to={link.to} end={link.to === '/' || link.to === '/coliving'} className={() => `bottom-nav-item${active ? ' active' : ''}`}><Icon size={19} /><span>{t(label)}</span></NavLink>;
        })}
      </nav>
    </div>
  );
}
