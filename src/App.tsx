import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppShell } from './components/AppShell';
import { LoadingState, Notice } from './components/Feedback';
import { AuthProvider, useAuth } from './features/auth/AuthContext';
import { LoginPage } from './features/auth/LoginPage';
import { ActivityPage } from './features/activity/ActivityPage';
import { ClosingPage } from './features/closing/ClosingPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ExpensesPage } from './features/expenses/ExpensesPage';
import { ManagePage } from './features/manage/ManagePage';
import { ProductionPage } from './features/production/ProductionPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { StockPage } from './features/stock/StockPage';
import { WastePage } from './features/waste/WastePage';
import { TodayPage } from './features/home/TodayPage';
import { I18nProvider } from './lib/i18n';
import { canAccessRoute, homePathForRole } from './features/auth/permissions';
import { useI18n } from './lib/i18n';
import { LanguageToggle } from './components/LanguageToggle';

function RoleGate({ children }: { children: ReactNode }) {
  const { member } = useAuth();
  const location = useLocation();
  if (member && canAccessRoute(member.role, location.pathname)) return children;
  return <Navigate to={homePathForRole(member?.role ?? 'front')} replace state={{ from: location.pathname }} />;
}

function SupabaseSetup() {
  const { t } = useI18n();
  return <main className="setup-screen"><section className="panel setup-card"><div className="setup-language-toggle"><LanguageToggle /></div><span className="brand-mark"><span>+</span></span><span className="eyebrow">{t('ONE LAST THING')}</span><h1>{t('Connect your kitchen.')}</h1><p>{t('This app needs a Supabase project to securely store staff accounts, daily records, and optional receipt photos.')}</p><ol><li>{t('Copy')} <code>.env.example</code> {t('to')} <code>.env.local</code>.</li><li>{t('Fill in your Supabase Project URL and publishable key.')}</li><li>{t('Apply the database migrations, then restart')} <code>npm run dev</code>.</li></ol><p className="setup-small">{t('The app uses a browser publishable key with database row-level security. Never paste a service role key here.')}</p></section></main>;
}

function AuthenticatedRoutes() {
  const { t } = useI18n();
  const { configured, loading, session, member, memberError, memberLoading, signOut } = useAuth();
  if (!configured) return <SupabaseSetup />;
  if (loading || (session && memberLoading)) return <main className="auth-loading"><LoadingState /></main>;
  if (!session) return <LoginPage />;
  if (memberError || !member?.active) return <main className="access-screen"><section className="panel access-card"><div className="setup-language-toggle"><LanguageToggle /></div><span className="eyebrow">{t('STAFF ACCESS')}</span><h1>{t('Your sign-in needs a team invitation.')}</h1><p>{t(memberError ? 'The team membership could not be checked. Check the connection and try signing in again.' : 'This account has not been added to your canteen yet. Ask the canteen administrator to add you to the staff list.')}</p>{memberError && <Notice>{memberError}</Notice>}<button className="button button-quiet" onClick={() => void signOut()}>{t('Sign out')}</button></section></main>;
  const Home = member.role === 'front' || member.role === 'kitchen' ? TodayPage : DashboardPage;
  return <Routes><Route element={<AppShell />}>
    <Route index element={<Home />} />
    <Route path="production" element={<RoleGate><ProductionPage /></RoleGate>} />
    <Route path="stock" element={<RoleGate><StockPage /></RoleGate>} />
    <Route path="waste" element={<RoleGate><WastePage /></RoleGate>} />
    <Route path="closing" element={<RoleGate><ClosingPage /></RoleGate>} />
    <Route path="expenses" element={<RoleGate><ExpensesPage /></RoleGate>} />
    <Route path="reports" element={<RoleGate><ReportsPage /></RoleGate>} />
    <Route path="manage" element={<RoleGate><ManagePage /></RoleGate>} />
    <Route path="activity" element={<RoleGate><ActivityPage /></RoleGate>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}

export default function App() {
  return <I18nProvider><BrowserRouter><AuthProvider><AuthenticatedRoutes /></AuthProvider></BrowserRouter></I18nProvider>;
}
