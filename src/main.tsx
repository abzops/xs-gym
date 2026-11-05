import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import './styles/app.css';
import './styles/elevation.css';
import './lib/theme';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter, createRoutesFromElements, Link, Navigate, Outlet, Route, RouterProvider, useParams,
} from 'react-router';
import { AuthProvider, useAuth } from './app/auth';
import { GymProvider, useGym, useGymBySlug, useMyGyms } from './app/gym';
import { Shell } from './app/Shell';
import { Empty, Loading, Notice, ToastProvider } from './components/ui';
import { LoginPage, SetNewPassword, SetupGym } from './features/auth/AuthPages';
import { Dashboard } from './features/dashboard/Dashboard';
import { MemberDetail } from './features/members/MemberDetail';
import { NewMemberPage } from './features/members/MemberForm';
import { MembersPage } from './features/members/MembersPage';
import { LandingPage } from './features/landing/LandingPage';
import { errorMessage } from './lib/errors';
import { pageModules } from './lib/sections';

// Less frequent screens load on demand to keep the first load small.
const ExpensesPage = lazy(() => pageModules.expenses().then((m) => ({ default: m.ExpensesPage })));
const PaymentsPage = lazy(() => pageModules.payments().then((m) => ({ default: m.PaymentsPage })));
const PlansPage = lazy(() => pageModules.plans().then((m) => ({ default: m.PlansPage })));
const ReportsPage = lazy(() => pageModules.reports().then((m) => ({ default: m.ReportsPage })));
const ReceiptPage = lazy(() => pageModules.receipt().then((m) => ({ default: m.ReceiptPage })));
const ImportPage = lazy(() => pageModules.import().then((m) => ({ default: m.ImportPage })));
const SettingsPage = lazy(() => pageModules.settings().then((m) => ({ default: m.SettingsPage })));

// GitHub Pages cannot send frame-ancestors; refuse to render inside a frame.
if (window.top !== window.self) {
  document.documentElement.style.display = 'none';
  throw new Error('Framing is not allowed');
}

// A page animation is cancelled when the phone's address bar resizes the
// viewport mid-slide. Navigation still completes; the rejected animation
// promise is expected, so keep it out of the error console.
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { name?: string; message?: string } | undefined;
  if ((r?.name === 'InvalidStateError' || r?.name === 'AbortError') && /transition/i.test(r.message ?? '')) e.preventDefault();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});

function Splash() {
  return <div className="center-screen" aria-busy="true"><span className="spinner" /></div>;
}

function RequireAuth() {
  const { session, loading, recovering } = useAuth();
  if (loading) return <Splash />;
  if (recovering) return <SetNewPassword />;
  if (!session) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Signed out: landing page. Signed in: straight to the gym. */
function Root() {
  const { session, loading, recovering } = useAuth();
  if (loading) return <Splash />;
  if (recovering) return <SetNewPassword />;
  if (!session) return <LandingPage />;
  return <Home />;
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
    return <div className="center-screen"><Empty title="Gym not found"><Link className="btn" to="/">Go home</Link></Empty></div>;
  }
  return <GymProvider value={ctx.data}><Shell /></GymProvider>;
}

function Allow({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useGym();
  if (!can(perm)) return <Empty title="No access">Ask the gym owner for access.</Empty>;
  // A skeleton, never a blank screen, while a page's code downloads.
  return <Suspense fallback={<Loading rows={5} />}>{children}</Suspense>;
}

function GymHome() {
  const { can } = useGym();
  if (can('reports.operational')) return <Dashboard />;
  return <Navigate to="members" replace />;
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/" element={<Root />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/setup" element={<SetupGym />} />
        <Route path="/g/:slug" element={<GymLayout />}>
          <Route index element={<GymHome />} />
          {/* Check-in was removed from the web app; old links land on Home. */}
          <Route path="check-in" element={<Navigate to=".." relative="path" replace />} />
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
    </>,
  ),
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
