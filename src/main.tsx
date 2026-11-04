import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import './styles/app.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useParams } from 'react-router';
import { AuthProvider, useAuth } from './app/auth';
import { GymProvider, useGym, useGymBySlug, useMyGyms } from './app/gym';
import { Shell } from './app/Shell';
import { Empty, Notice, ToastProvider } from './components/ui';
import { LoginPage, SetNewPassword, SetupGym } from './features/auth/AuthPages';
import { CheckInPage } from './features/checkin/CheckInPage';
import { Dashboard } from './features/dashboard/Dashboard';
import { MemberDetail } from './features/members/MemberDetail';
import { NewMemberPage } from './features/members/MemberForm';
import { MembersPage } from './features/members/MembersPage';
import { errorMessage } from './lib/errors';

// Less frequent screens load on demand to keep the first load small.
const ExpensesPage = lazy(() => import('./features/expenses/ExpensesPage').then((m) => ({ default: m.ExpensesPage })));
const PaymentsPage = lazy(() => import('./features/payments/PaymentsPage').then((m) => ({ default: m.PaymentsPage })));
const PlansPage = lazy(() => import('./features/plans/PlansPage').then((m) => ({ default: m.PlansPage })));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const ReceiptPage = lazy(() => import('./features/payments/ReceiptPage').then((m) => ({ default: m.ReceiptPage })));
const ImportPage = lazy(() => import('./features/members/ImportPage').then((m) => ({ default: m.ImportPage })));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));

// GitHub Pages cannot send frame-ancestors; refuse to render inside a frame.
if (window.top !== window.self) {
  document.documentElement.style.display = 'none';
  throw new Error('Framing is not allowed');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});

function Splash() {
  return <div className="center-screen" aria-busy="true"><span className="spinner" /></div>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, recovering } = useAuth();
  if (loading) return <Splash />;
  if (recovering) return <SetNewPassword />;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Home() {
  const gyms = useMyGyms();
  if (gyms.isPending) return <Splash />;
  if (gyms.error) return <div className="center-screen"><Notice tone="bad">{errorMessage(gyms.error)}</Notice></div>;
  if (gyms.data.length === 0) return <Navigate to="/setup" replace />;
  return <Navigate to={`/g/${gyms.data[0].gyms.slug}`} replace />;
}

function GymLayout() {
  const { slug } = useParams();
  const ctx = useGymBySlug(slug);
  if (ctx.isPending) return <Splash />;
  if (ctx.error) return <div className="center-screen"><Notice tone="bad">{errorMessage(ctx.error)}</Notice></div>;
  if (!ctx.data) {
    return <div className="center-screen"><Empty title="Gym not found"><p>You may not have access to this gym.</p><Link className="btn" to="/">Go home</Link></Empty></div>;
  }
  return <GymProvider value={ctx.data}><Shell /></GymProvider>;
}

function Allow({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useGym();
  if (!can(perm)) return <Empty title="No access"><p>Your role does not include this page. Ask the gym owner.</p></Empty>;
  return <>{children}</>;
}

function GymHome() {
  const { can } = useGym();
  if (can('reports.operational')) return <Dashboard />;
  return <Navigate to="check-in" replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><Outlet /></RequireAuth>}>
        <Route path="/" element={<Home />} />
        <Route path="/setup" element={<SetupGym />} />
        <Route path="/g/:slug" element={<GymLayout />}>
          <Route index element={<GymHome />} />
          <Route path="check-in" element={<Allow perm="attendance.checkin"><CheckInPage /></Allow>} />
          <Route path="members" element={<Allow perm="members.read"><MembersPage /></Allow>} />
          <Route path="members/import" element={<Allow perm="members.export"><ImportPage /></Allow>} />
          <Route path="members/new" element={<Allow perm="members.write"><NewMemberPage /></Allow>} />
          <Route path="members/:memberId" element={<Allow perm="members.read"><MemberDetail /></Allow>} />
          <Route path="payments" element={<Allow perm="payments.read"><PaymentsPage /></Allow>} />
          <Route path="receipts/:paymentId" element={<Allow perm="payments.read"><ReceiptPage /></Allow>} />
          <Route path="plans" element={<Allow perm="plans.read"><PlansPage /></Allow>} />
          <Route path="expenses" element={<Allow perm="expenses.read"><ExpensesPage /></Allow>} />
          <Route path="reports" element={<Allow perm="reports.financial"><ReportsPage /></Allow>} />
          <Route path="settings" element={<Allow perm="staff.read"><SettingsPage /></Allow>} />
          <Route path="*" element={<Empty title="Page not found" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Suspense fallback={<Splash />}>
              <App />
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
