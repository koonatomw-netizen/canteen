import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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

function SupabaseSetup() {
  return <main className="setup-screen"><section className="panel setup-card"><span className="brand-mark"><span>+</span></span><span className="eyebrow">ONE LAST THING</span><h1>Connect your kitchen.</h1><p>This app needs a Supabase project to securely store staff accounts, daily records, and optional receipt photos.</p><ol><li>Copy <code>.env.example</code> to <code>.env.local</code>.</li><li>Fill in your Supabase Project URL and publishable key.</li><li>Apply the database migrations, then restart <code>npm run dev</code>.</li></ol><p className="setup-small">The app uses a browser publishable key with database row-level security. Never paste a service role key here.</p></section></main>;
}

function AuthenticatedRoutes() {
  const { configured, loading, session, member, memberError, memberLoading, signOut } = useAuth();
  if (!configured) return <SupabaseSetup />;
  if (loading || (session && memberLoading)) return <main className="auth-loading"><LoadingState /></main>;
  if (!session) return <LoginPage />;
  if (memberError || !member?.active) return <main className="access-screen"><section className="panel access-card"><span className="eyebrow">STAFF ACCESS</span><h1>Your sign-in needs a team invitation.</h1><p>{memberError ? 'The team membership could not be checked. Check the connection and try signing in again.' : 'This account has not been added to your canteen yet. Ask the canteen administrator to add you to the staff list.'}</p>{memberError && <Notice>{memberError}</Notice>}<button className="button button-quiet" onClick={() => void signOut()}>Sign out</button></section></main>;
  return <Routes><Route element={<AppShell />}><Route index element={<DashboardPage />} /><Route path="production" element={<ProductionPage />} /><Route path="stock" element={<StockPage />} /><Route path="waste" element={<WastePage />} /><Route path="closing" element={<ClosingPage />} /><Route path="expenses" element={<ExpensesPage />} /><Route path="reports" element={<ReportsPage />} /><Route path="manage" element={<ManagePage />} /><Route path="activity" element={<ActivityPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Route></Routes>;
}

export default function App() {
  return <BrowserRouter><AuthProvider><AuthenticatedRoutes /></AuthProvider></BrowserRouter>;
}
