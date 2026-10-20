import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { AppShell } from './components/AppShell';
import { LoadingState, Notice } from './components/Feedback';
import { AuthProvider, useAuth } from './features/auth/AuthContext';
import { LoginPage } from './features/auth/LoginPage';
import { I18nProvider } from './lib/i18n';

// Each page is downloaded the first time it is opened, so staff only load the
// screens their role uses. AppShell shows a loading state while a page arrives.
function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(async () => ({ default: await load() }));
}
const ActivityPage = lazyPage(() => import('./features/activity/ActivityPage').then((m) => m.ActivityPage));
const ClosingPage = lazyPage(() => import('./features/closing/ClosingPage').then((m) => m.ClosingPage));
const DashboardPage = lazyPage(() => import('./features/dashboard/DashboardPage').then((m) => m.DashboardPage));
const ExpensesPage = lazyPage(() => import('./features/expenses/ExpensesPage').then((m) => m.ExpensesPage));
const ManagePage = lazyPage(() => import('./features/manage/ManagePage').then((m) => m.ManagePage));
const MenuItemsPage = lazyPage(() => import('./features/menus/MenuItemsPage').then((m) => m.MenuItemsPage));
const ProductionPage = lazyPage(() => import('./features/production/ProductionPage').then((m) => m.ProductionPage));
const ReportsPage = lazyPage(() => import('./features/reports/ReportsPage').then((m) => m.ReportsPage));
const StockPage = lazyPage(() => import('./features/stock/StockPage').then((m) => m.StockPage));
const WastePage = lazyPage(() => import('./features/waste/WastePage').then((m) => m.WastePage));
const TodayPage = lazyPage(() => import('./features/home/TodayPage').then((m) => m.TodayPage));
const ColivingPage = lazyPage(() => import('./features/coliving/ColivingPage').then((m) => m.ColivingPage));
const BookingsPage = lazyPage(() => import('./features/bookings/BookingsPage').then((m) => m.BookingsPage));
const PublicBookingPage = lazyPage(() => import('./features/bookings/PublicBookingPage').then((m) => m.PublicBookingPage));
const BookingConfirmationPage = lazyPage(() => import('./features/bookings/BookingConfirmationPage').then((m) => m.BookingConfirmationPage));
const MyBookingPage = lazyPage(() => import('./features/bookings/MyBookingPage').then((m) => m.MyBookingPage));
const BookingPrivacyPage = lazyPage(() => import('./features/bookings/BookingPrivacyPage').then((m) => m.BookingPrivacyPage));
import { canAccessRoute, homePathForRole } from './features/auth/permissions';
import { isBookingHost, isPublicBookingPath } from './lib/bookingHost';
import { useI18n } from './lib/i18n';
import { ThemeProvider } from './lib/theme';
import { LanguageToggle } from './components/LanguageToggle';

function RoleGate({ children }: { children: ReactNode }) {
  const { member } = useAuth();
  const location = useLocation();
  if (member && canAccessRoute(member.role, location.pathname)) return children;
  return <Navigate to={homePathForRole(member?.role ?? 'front')} replace state={{ from: location.pathname }} />;
}

function FrontWorkflowRedirect({ tab, section, children }: { tab: 'production' | 'stock' | 'closing'; section?: 'stock' | 'waste'; children: ReactNode }) {
  const { member } = useAuth();
  const location = useLocation();
  if (member?.role !== 'front') return children;
  const params = new URLSearchParams(location.search);
  params.set('tab', tab);
  if (section) params.set('section', section);
  else params.delete('section');
  return <Navigate to={`/?${params.toString()}`} replace />;
}

function ReportsRoute() {
  const { member } = useAuth();
  return member?.role === 'manager' ? <Navigate to="/" replace /> : <ReportsPage />;
}

function SupabaseSetup() {
  const { t } = useI18n();
  return <main className="setup-screen"><section className="panel setup-card"><div className="setup-language-toggle"><LanguageToggle /></div><span className="brand-mark"><span>+</span></span><span className="eyebrow">{t('ONE LAST THING')}</span><h1>{t('Connect your workspace.')}</h1><p>{t('This app needs a Supabase project to securely store staff accounts, daily records, and optional receipt photos.')}</p><ol><li>{t('Copy')} <code>.env.example</code> {t('to')} <code>.env.local</code>.</li><li>{t('Fill in your Supabase Project URL and publishable key.')}</li><li>{t('Apply the database migrations, then restart')} <code>npm run dev</code>.</li></ol><p className="setup-small">{t('The app uses a browser publishable key with database row-level security. Never paste a service role key here.')}</p></section></main>;
}

function AuthenticatedRoutes() {
  const { t } = useI18n();
  const { configured, loading, session, member, memberError, memberLoading, signOut } = useAuth();
  if (!configured) return <SupabaseSetup />;
  if (loading || (session && memberLoading)) return <main className="auth-loading"><LoadingState /></main>;
  if (!session) return <LoginPage />;
  if (memberError || !member?.active) return <main className="access-screen"><section className="panel access-card"><div className="setup-language-toggle"><LanguageToggle /></div><span className="eyebrow">{t('STAFF ACCESS')}</span><h1>{t('Your sign-in needs a team invitation.')}</h1><p>{t(memberError ? 'The team membership could not be checked. Check the connection and try signing in again.' : 'This account has not been added to your workspace yet. Ask your Website Admin to add you to the staff list.')}</p>{memberError && <Notice>{memberError}</Notice>}<button className="button button-quiet" onClick={() => void signOut()}>{t('Sign out')}</button></section></main>;
  const Home = member.role === 'front' ? TodayPage : member.role === 'manager' ? ReportsPage : DashboardPage;
  return <Routes><Route element={<AppShell />}>
    <Route index element={member.role === 'kitchen' ? <Navigate to="/expenses" replace /> : member.role === 'coliving' ? <Navigate to="/coliving" replace /> : <Home />} />
    <Route path="production" element={<RoleGate><FrontWorkflowRedirect tab="production"><ProductionPage /></FrontWorkflowRedirect></RoleGate>} />
    <Route path="menus" element={<RoleGate><MenuItemsPage /></RoleGate>} />
    <Route path="stock" element={<RoleGate><FrontWorkflowRedirect tab="stock" section="stock"><StockPage /></FrontWorkflowRedirect></RoleGate>} />
    <Route path="waste" element={<RoleGate><FrontWorkflowRedirect tab="stock" section="waste"><WastePage /></FrontWorkflowRedirect></RoleGate>} />
    <Route path="closing" element={<RoleGate><FrontWorkflowRedirect tab="closing"><ClosingPage /></FrontWorkflowRedirect></RoleGate>} />
    <Route path="expenses" element={<RoleGate><ExpensesPage /></RoleGate>} />
    <Route path="reports" element={<RoleGate><ReportsRoute /></RoleGate>} />
    <Route path="manage" element={<RoleGate><ManagePage /></RoleGate>} />
    <Route path="activity" element={<RoleGate><ActivityPage /></RoleGate>} />
    <Route path="coliving" element={<RoleGate><ColivingPage view="dashboard" /></RoleGate>} />
    <Route path="coliving/records" element={<RoleGate><ColivingPage view="records" /></RoleGate>} />
    <Route path="bookings" element={<RoleGate><BookingsPage /></RoleGate>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}

/** Customer booking pages. On the booking host every other path goes to /book. */
function PublicBookingRoutes({ redirectOthers = false }: { redirectOthers?: boolean }) {
  return <Suspense fallback={<main className="auth-loading"><LoadingState /></main>}><Routes>
    <Route path="book" element={<PublicBookingPage />} />
    <Route path="booking/confirmation/:reference" element={<BookingConfirmationPage />} />
    <Route path="my-booking" element={<MyBookingPage />} />
    <Route path="privacy" element={<BookingPrivacyPage />} />
    {redirectOthers && <Route path="*" element={<Navigate to="/book" replace />} />}
  </Routes></Suspense>;
}

function ApplicationRoutes() {
  const location = useLocation();
  if (isPublicBookingPath(location.pathname)) return <PublicBookingRoutes />;
  return <AuthenticatedRoutes />;
}

export default function App() {
  // The customer booking domain never mounts staff authentication or staff routes.
  if (isBookingHost(window.location.hostname)) {
    return <ThemeProvider><I18nProvider><BrowserRouter><PublicBookingRoutes redirectOthers /></BrowserRouter></I18nProvider></ThemeProvider>;
  }
  return <ThemeProvider><I18nProvider><BrowserRouter><AuthProvider><ApplicationRoutes /></AuthProvider></BrowserRouter></I18nProvider></ThemeProvider>;
}
